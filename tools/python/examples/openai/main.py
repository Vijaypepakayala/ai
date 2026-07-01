"""OpenAI example for governed Telnyx MCP Apps.

This example discovers a focused Telnyx MCP App and exposes only its published
tool contract to the model. By default it uses the read-first Number
Intelligence app instead of raw Telnyx API tools.
"""

import json
import os
import sys
import time
from pathlib import Path

from openai import OpenAI
from telnyx_agent_toolkit import TelnyxAgentToolkit

sys.path.append(str(Path(__file__).resolve().parents[1]))

from governed_mcp import GovernedMcpAppClient, build_openai_tools, mcp_result_to_text


def main() -> None:
    telnyx_api_key = os.environ["TELNYX_API_KEY"]
    governed_app = os.environ.get("TELNYX_GOVERNED_APP", "number-intelligence")
    openai_client = OpenAI()
    openai_helper = TelnyxAgentToolkit(api_key=telnyx_api_key).get_openai_tool_executor()

    mcp_client = GovernedMcpAppClient(
        api_key=telnyx_api_key,
        slug=governed_app,
        client_name="telnyx-governed-openai-example",
    )
    tools = build_openai_tools(mcp_client.list_tools())
    prompt_cache_key = openai_helper.build_prompt_cache_key(
        namespace="telnyx-governed-mcp-example",
        workflow=governed_app,
        model="gpt-4o",
        version="v1",
        tool_names=[tool["function"]["name"] for tool in tools],
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a careful Telnyx telecom assistant. "
                "Use only the governed Telnyx MCP App tools that were provided. "
                "Prefer read-first analysis. If a future tool requires a preview "
                "token, explicit confirm flag, or operator approval before a "
                "mutation, do not bypass that contract."
            ),
        },
        {
            "role": "user",
            "content": os.environ.get(
                "TELNYX_EXAMPLE_PROMPT",
                "Analyze +14155550123 and explain whether it looks ready for SMS onboarding.",
            ),
        },
    ]

    try:
        while True:
            print(f"Sending request to OpenAI with governed app '{governed_app}'...")
            started_at = time.monotonic()
            response = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=tools,
                prompt_cache_key=prompt_cache_key,
            )
            telemetry = openai_helper.report_orchestration_telemetry(
                response,
                cache_key=prompt_cache_key,
                latency_ms=int((time.monotonic() - started_at) * 1000),
            )
            print(f"Prompt-cache telemetry: {json.dumps(telemetry, indent=2)}")
            message = response.choices[0].message

            if not message.tool_calls:
                print(f"\nAssistant: {message.content}")
                break

            messages.append(message)  # type: ignore[arg-type]
            for tool_call in message.tool_calls:
                arguments = json.loads(tool_call.function.arguments)
                print(f"Calling governed tool: {tool_call.function.name}")
                print(f"  Arguments: {tool_call.function.arguments}")

                result = mcp_client.call_tool(tool_call.function.name, arguments)
                text_result = mcp_result_to_text(result)
                print(f"  Result: {text_result}")

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": text_result,
                    }
                )
    finally:
        mcp_client.close()


if __name__ == "__main__":
    main()
