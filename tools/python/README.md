# Telnyx Agent Toolkit

Python SDK for building AI agents with [Telnyx](https://telnyx.com) APIs. Works with **OpenAI**, **LangChain**, and **CrewAI**.

For trusted in-process agents, the toolkit can expose raw Telnyx tools directly. For external, multi-tenant, or approval-sensitive agents, prefer a governed Telnyx MCP App first and only fall back to the raw toolkit when you intentionally own the broader behavior model.

## Installation

```bash
# Core (no framework dependency)
pip install telnyx-agent-toolkit

# With OpenAI support
pip install telnyx-agent-toolkit[openai]

# With LangChain support
pip install telnyx-agent-toolkit[langchain]

# With CrewAI support
pip install telnyx-agent-toolkit[crewai]

# Everything
pip install telnyx-agent-toolkit[all]
```

## Quick Start

### OpenAI

```python
import os
from openai import OpenAI
from telnyx_agent_toolkit import TelnyxAgentToolkit

toolkit = TelnyxAgentToolkit(
    api_key=os.environ["TELNYX_API_KEY"],
    configuration={
        "actions": {
            "messaging": {"send_sms": True},
            "numbers": {"list": True, "search": True},
            "account": {"get_balance": True},
        }
    },
)

client = OpenAI()
tools = toolkit.get_openai_tools()
executor = toolkit.get_openai_tool_executor()

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What's my Telnyx balance?"}],
    tools=tools,
)

# Execute tool calls
for tool_call in response.choices[0].message.tool_calls:
    result = executor.execute(tool_call)
    print(result)
```

### LangChain

```python
from telnyx_agent_toolkit import TelnyxAgentToolkit

toolkit = TelnyxAgentToolkit(api_key="KEY...")
tools = toolkit.get_langchain_tools()

# Use with any LangChain agent
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4o")
llm_with_tools = llm.bind_tools(tools)
```

### CrewAI

```python
from crewai import Agent
from telnyx_agent_toolkit import TelnyxAgentToolkit

toolkit = TelnyxAgentToolkit(api_key="KEY...")
tools = toolkit.get_crewai_tools()

agent = Agent(
    role="Telecom Specialist",
    goal="Help manage phone numbers and messaging",
    tools=tools,
)
```

## Governed External-Agent Pattern

Use the governed MCP App surface when you need a stable, least-privilege contract instead of raw endpoint semantics.

- Use [`tools/mcp-apps`](/tools/mcp-apps) when the workflow should stay read-first or preview-first and the agent should not invent its own mutation policy.
- Use the generic [`tools/mcp`](/tools/mcp) proxy when an expert client needs broad MCP access to the Telnyx API surface.
- Use this toolkit directly when you control the agent code, trust boundary, and approval/idempotency rules yourself.

The example directories show the governed pattern for OpenAI, LangChain, and CrewAI by discovering a focused MCP App and binding only the published tool contract:

- [OpenAI governed example](/tools/python/examples/openai)
- [LangChain governed example](/tools/python/examples/langchain)
- [CrewAI governed example](/tools/python/examples/crewai)

## Configuration

Control which tools are available to the agent:

```python
toolkit = TelnyxAgentToolkit(
    api_key="KEY...",
    configuration={
        "actions": {
            # Messaging
            "messaging": {
                "send_sms": True,            # Send SMS/MMS
                "list_messaging_profiles": True,
                "create_messaging_profile": True,
            },
            # Phone Numbers
            "numbers": {
                "list": True,    # List account numbers
                "search": True,  # Search available numbers
                "buy": True,     # Purchase numbers (charges account)
            },
            # Account
            "account": {
                "get_balance": True,
            },
            # Voice
            "voice": {
                "make_call": True,
                "list_connections": True,
            },
            # AI
            "ai": {
                "chat": True,              # Chat completions
                "embed": True,             # Embeddings
                "list_ai_assistants": True,
                "create_ai_assistant": True,
            },
            # Fax
            "fax": {
                "send_fax": True,
            },
            # Lookup
            "lookup": {
                "lookup_number": True,     # Carrier/CNAM lookup
            },
            # IoT
            "iot": {
                "list_sim_cards": True,
            },
            # Verification
            "verify": {
                "verify_phone": True,      # Send verification code
                "verify_code": True,       # Check verification code
            },
        }
    },
)
```

> **No configuration = all tools enabled.** Use configuration to restrict which tools the agent can access.

## Available Tools

| Tool | Category | Description |
|------|----------|-------------|
| `send_sms` | Messaging | Send an SMS or MMS message |
| `list_messaging_profiles` | Messaging | List messaging profiles |
| `create_messaging_profile` | Messaging | Create a messaging profile |
| `list_phone_numbers` | Numbers | List phone numbers on the account |
| `search_phone_numbers` | Numbers | Search available numbers to buy |
| `buy_phone_number` | Numbers | Purchase a phone number |
| `get_balance` | Account | Check account balance |
| `make_call` | Voice | Initiate an outbound call |
| `list_connections` | Voice | List voice connections |
| `ai_chat` | AI | Chat completion via Telnyx inference |
| `ai_embed` | AI | Generate embeddings |
| `list_ai_assistants` | AI | List AI assistants |
| `create_ai_assistant` | AI | Create an AI assistant |
| `send_fax` | Fax | Send a fax |
| `lookup_number` | Lookup | Phone number lookup |
| `list_sim_cards` | IoT | List IoT SIM cards |
| `verify_phone` | Verify | Start phone verification |
| `verify_code` | Verify | Check verification code |

## Async Support

All tools support async execution natively:

```python
# Async execution
result = await executor.execute_async(tool_call)

# Direct tool execution
result = await toolkit.core.run_tool_async("get_balance", {})
```

## API Client

Access the underlying HTTP client directly:

```python
# Async
data = await toolkit.api_client.get_async("/phone_numbers")

# Sync
data = toolkit.api_client.get("/phone_numbers")
```

For mutating REST calls, send a caller-generated idempotency key and poll asynchronous resources until they reach a terminal state:

```python
import uuid

created = toolkit.api_client.post(
    "/messages",
    json={
        "from": "+15551234567",
        "to": "+15557654321",
        "text": "Your workflow is live.",
    },
    idempotency_key=str(uuid.uuid4()),
)

message = toolkit.api_client.poll(
    f"/messages/{created['data']['id']}",
    timeout_seconds=30,
)

print(message["data"]["status"])
```

`poll()` respects `Retry-After` when Telnyx returns `202 Accepted`, and defaults to terminal statuses such as `completed`, `failed`, `cancelled`, and `succeeded`.

## Requirements

- Python 3.11+
- [Telnyx API key](https://portal.telnyx.com/#/app/api-keys)

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Lint
ruff check .

# Type check
pyright
```

## License

MIT
