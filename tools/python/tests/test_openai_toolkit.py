"""Tests for the OpenAI adapter."""

import json
from typing import Any
from unittest.mock import MagicMock
from types import SimpleNamespace

import httpx
import pytest
import respx

from telnyx_agent_toolkit import TelnyxAgentToolkit
from telnyx_agent_toolkit.openai.toolkit import OpenAIToolkit
from telnyx_agent_toolkit.shared.api_client import TelnyxAPIClient
from telnyx_agent_toolkit.shared.constants import TOOL_DEFINITIONS
from telnyx_agent_toolkit.shared.toolkit_core import ToolkitCore


@pytest.fixture
def toolkit() -> TelnyxAgentToolkit:
    return TelnyxAgentToolkit(
        api_key="test-key",
        configuration={
            "actions": {
                "messaging": {"send_sms": True},
                "numbers": {"list": True},
                "account": {"get_balance": True},
            }
        },
    )


class TestOpenAIToolkit:
    def test_get_tools_format(self, toolkit: TelnyxAgentToolkit) -> None:
        tools = toolkit.get_openai_tools()
        assert len(tools) == 3

        for tool in tools:
            assert tool["type"] == "function"
            assert "function" in tool
            func = tool["function"]
            assert "name" in func
            assert "description" in func
            assert "parameters" in func
            assert func["parameters"]["type"] == "object"

    def test_tool_names(self, toolkit: TelnyxAgentToolkit) -> None:
        tools = toolkit.get_openai_tools()
        names = {t["function"]["name"] for t in tools}
        assert names == {"send_sms", "list_phone_numbers", "get_balance"}

    def test_tool_has_properties(self, toolkit: TelnyxAgentToolkit) -> None:
        tools = toolkit.get_openai_tools()
        sms_tool = next(t for t in tools if t["function"]["name"] == "send_sms")
        props = sms_tool["function"]["parameters"]["properties"]
        assert "from_" in props
        assert "to" in props
        assert "text" in props

    def test_tool_has_required(self, toolkit: TelnyxAgentToolkit) -> None:
        tools = toolkit.get_openai_tools()
        sms_tool = next(t for t in tools if t["function"]["name"] == "send_sms")
        required = sms_tool["function"]["parameters"]["required"]
        assert "from_" in required
        assert "to" in required
        assert "text" in required

    @respx.mock
    @pytest.mark.asyncio
    async def test_execute_async_with_object(self, toolkit: TelnyxAgentToolkit) -> None:
        respx.get("https://api.telnyx.com/v2/balance").mock(
            return_value=httpx.Response(200, json={"data": {"balance": "100.00"}})
        )

        executor = toolkit.get_openai_tool_executor()
        # Simulate an OpenAI tool call object
        tool_call = MagicMock()
        tool_call.function.name = "get_balance"
        tool_call.function.arguments = "{}"

        result = await executor.execute_async(tool_call)
        data = json.loads(result)
        assert data["data"]["balance"] == "100.00"

    @respx.mock
    @pytest.mark.asyncio
    async def test_execute_async_with_dict(self, toolkit: TelnyxAgentToolkit) -> None:
        respx.get("https://api.telnyx.com/v2/balance").mock(
            return_value=httpx.Response(200, json={"data": {"balance": "50.00"}})
        )

        executor = toolkit.get_openai_tool_executor()
        tool_call: dict[str, Any] = {
            "function": {
                "name": "get_balance",
                "arguments": "{}",
            }
        }
        result = await executor.execute_async(tool_call)
        data = json.loads(result)
        assert data["data"]["balance"] == "50.00"

    @respx.mock
    def test_execute_sync(self, toolkit: TelnyxAgentToolkit) -> None:
        respx.get("https://api.telnyx.com/v2/balance").mock(
            return_value=httpx.Response(200, json={"data": {"balance": "75.00"}})
        )

        executor = toolkit.get_openai_tool_executor()
        tool_call = MagicMock()
        tool_call.function.name = "get_balance"
        tool_call.function.arguments = "{}"

        result = executor.execute(tool_call)
        data = json.loads(result)
        assert data["data"]["balance"] == "75.00"

    def test_all_tools_no_config(self) -> None:
        toolkit = TelnyxAgentToolkit(api_key="test-key")
        tools = toolkit.get_openai_tools()
        assert len(tools) == len(TOOL_DEFINITIONS)

    def test_defaults_not_in_schema(self, toolkit: TelnyxAgentToolkit) -> None:
        """Ensure 'default' values are stripped from OpenAI tool schemas."""
        tools = toolkit.get_openai_tools()
        for tool in tools:
            for prop_name, prop_schema in tool["function"]["parameters"]["properties"].items():
                assert "default" not in prop_schema, (
                    f"Tool {tool['function']['name']}.{prop_name} has 'default' in schema"
                )

    def test_build_prompt_cache_key_is_stable(self, toolkit: TelnyxAgentToolkit) -> None:
        executor = toolkit.get_openai_tool_executor()
        cache_key = executor.build_prompt_cache_key(
            namespace="Telnyx Account Assistant",
            workflow="Balance Check",
            model="gpt-4o",
            version="v2",
            tool_names=["get_balance", "list_phone_numbers"],
        )

        assert cache_key == "telnyx-account-assistant:balance-check:gpt-4o:v2:tools=get_balance,list_phone_numbers"

    def test_extract_orchestration_telemetry(self, toolkit: TelnyxAgentToolkit) -> None:
        executor = toolkit.get_openai_tool_executor()
        response = {
            "id": "resp_123",
            "model": "gpt-4o",
            "usage": {
                "prompt_tokens": 400,
                "completion_tokens": 120,
                "total_tokens": 520,
                "prompt_tokens_details": {"cached_tokens": 250},
                "completion_tokens_details": {"reasoning_tokens": 12},
            },
        }

        telemetry = executor.extract_orchestration_telemetry(
            response,
            cache_key="acct:balance:gpt-4o:v1",
            latency_ms=840,
        )

        assert telemetry["cached_tokens"] == 250
        assert telemetry["uncached_input_tokens"] == 150
        assert telemetry["cache_hit_rate"] == 0.625
        assert telemetry["reasoning_tokens"] == 12
        assert telemetry["latency_ms"] == 840
        assert telemetry["cache_key_hash"] is not None

    def test_report_orchestration_telemetry(self) -> None:
        telemetry = MagicMock()
        core = ToolkitCore(client=TelnyxAPIClient(api_key="test-key"), telemetry=telemetry)
        executor = OpenAIToolkit(core=core, tools=[])
        response = SimpleNamespace(
            id="resp_456",
            model="gpt-4o",
            usage=SimpleNamespace(
                prompt_tokens=100,
                completion_tokens=40,
                total_tokens=140,
                prompt_tokens_details=SimpleNamespace(cached_tokens=60),
                completion_tokens_details=SimpleNamespace(reasoning_tokens=4),
            ),
        )

        summary = executor.report_orchestration_telemetry(
            response,
            cache_key="acct:balance:gpt-4o:v1",
            latency_ms=320,
        )

        telemetry.report.assert_called_once()
        payload = telemetry.report.call_args.kwargs
        assert payload["tool"] == "openai_orchestration"
        assert payload["context"]["cached_tokens"] == 60
        assert payload["context"]["cache_hit_rate"] == 0.6
        assert summary["total_tokens"] == 140
