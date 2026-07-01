"""OpenAI function-calling adapter for the Telnyx Agent Toolkit."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from telnyx_agent_toolkit.shared.constants import ToolDefinition
from telnyx_agent_toolkit.shared.toolkit_core import ToolkitCore


def _normalize_cache_key_part(value: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in value.strip().lower())
    return normalized.strip("-")


def _get_value(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class OpenAIToolkit:
    """Adapter that provides Telnyx tools in OpenAI function-calling format.

    Usage:
        ```python
        toolkit = TelnyxAgentToolkit(api_key="KEY...")
        openai_tools = toolkit.get_openai_tools()

        # Use with OpenAI
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            tools=openai_tools,
        )

        # Execute tool calls
        executor = toolkit.get_openai_tool_executor()
        for tool_call in response.choices[0].message.tool_calls:
            result = await executor.execute_async(tool_call)
        ```
    """

    def __init__(self, core: ToolkitCore, tools: list[ToolDefinition]) -> None:
        self._core = core
        self._tools = tools

    def get_tools(self) -> list[dict[str, Any]]:
        """Get tool definitions formatted for OpenAI's `tools` parameter."""
        result: list[dict[str, Any]] = []
        for tool_def in self._tools:
            # Build clean parameter schema
            params = dict(tool_def["parameters"])
            # Remove non-JSON-Schema keys and normalize
            properties = params.get("properties", {})

            # Clean up properties for OpenAI (remove defaults from schema)
            clean_props: dict[str, Any] = {}
            for prop_name, prop_schema in properties.items():
                clean_prop = {k: v for k, v in prop_schema.items() if k != "default"}
                clean_props[prop_name] = clean_prop

            result.append({
                "type": "function",
                "function": {
                    "name": tool_def["name"],
                    "description": tool_def["description"],
                    "parameters": {
                        "type": "object",
                        "properties": clean_props,
                        "required": params.get("required", []),
                    },
                },
            })
        return result

    async def execute_async(self, tool_call: Any) -> str:
        """Execute an OpenAI tool call and return the result as a string.

        Args:
            tool_call: An OpenAI ChatCompletionMessageToolCall object,
                       or a dict with 'function.name' and 'function.arguments'.
        """
        if hasattr(tool_call, "function"):
            name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)
        else:
            name = tool_call["function"]["name"]
            arguments = json.loads(tool_call["function"]["arguments"])

        return await self._core.run_tool_async(name, arguments)

    def execute(self, tool_call: Any) -> str:
        """Sync wrapper for execute_async."""
        from telnyx_agent_toolkit.shared.api_client import _run_sync

        return _run_sync(self.execute_async(tool_call))

    def build_prompt_cache_key(
        self,
        *,
        namespace: str,
        model: str,
        workflow: str = "chat-completions",
        version: str = "v1",
        tool_names: list[str] | None = None,
    ) -> str:
        """Build a stable prompt cache key without prompt contents."""
        parts = [
            _normalize_cache_key_part(namespace),
            _normalize_cache_key_part(workflow),
            _normalize_cache_key_part(model),
            _normalize_cache_key_part(version),
        ]
        if tool_names:
            fingerprint = ",".join(sorted(_normalize_cache_key_part(name) for name in tool_names))
            parts.append(f"tools={fingerprint}")
        return ":".join(part for part in parts if part)

    def extract_orchestration_telemetry(
        self,
        response: Any,
        *,
        cache_key: str | None = None,
        latency_ms: int | None = None,
    ) -> dict[str, Any]:
        """Extract cache and token telemetry from an OpenAI response object."""
        usage = _get_value(response, "usage", {})
        prompt_details = _get_value(usage, "prompt_tokens_details", {})
        completion_details = _get_value(usage, "completion_tokens_details", {})

        input_tokens = _get_value(usage, "prompt_tokens", 0)
        completion_tokens = _get_value(usage, "completion_tokens", 0)
        total_tokens = _get_value(usage, "total_tokens", input_tokens + completion_tokens)

        cached_tokens = _get_value(prompt_details, "cached_tokens", 0)
        reasoning_tokens = _get_value(completion_details, "reasoning_tokens", 0)

        cache_hit_rate = round(cached_tokens / input_tokens, 4) if input_tokens else None

        return {
            "model": _get_value(response, "model"),
            "response_id": _get_value(response, "id"),
            "cache_key": cache_key,
            "cache_key_hash": hashlib.sha256(cache_key.encode("utf-8")).hexdigest()[:16] if cache_key else None,
            "input_tokens": input_tokens,
            "cached_tokens": cached_tokens,
            "uncached_input_tokens": max(input_tokens - cached_tokens, 0),
            "output_tokens": completion_tokens,
            "reasoning_tokens": reasoning_tokens,
            "total_tokens": total_tokens,
            "cache_hit_rate": cache_hit_rate,
            "latency_ms": latency_ms,
        }

    def report_orchestration_telemetry(
        self,
        response: Any,
        *,
        cache_key: str | None = None,
        latency_ms: int | None = None,
        api_path: str = "/openai/chat.completions",
        status: str = "success",
        http_status: int = 200,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        """Emit prompt-cache-safe orchestration telemetry for an OpenAI response."""
        summary = self.extract_orchestration_telemetry(
            response,
            cache_key=cache_key,
            latency_ms=latency_ms,
        )
        self._core.report_telemetry_event(
            tool="openai_orchestration",
            status=status,
            duration_ms=latency_ms or 0,
            http_status=http_status,
            http_method="POST",
            api_path=api_path,
            error_message=error_message,
            context=summary,
        )
        return summary
