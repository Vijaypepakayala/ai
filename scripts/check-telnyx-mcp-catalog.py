#!/usr/bin/env python3
"""Metadata-only audit for the deployed Telnyx AI MCP connector."""

from __future__ import annotations

import argparse
import http.server
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT / "submission" / "telnyx-developer-kit" / "connector-contract.json"
DEFAULT_URL = "https://api.telnyx.com/v2/ai/mcp"
PROTOCOL_VERSION = "2026-07-28"
MAX_RESPONSE_BYTES = 1024 * 1024
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"
PROTOCOL_META = {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": {
        "name": "telnyx-codex-release-audit",
        "version": "1",
    },
    "io.modelcontextprotocol/clientCapabilities": {},
}


class AuditError(RuntimeError):
    pass


class NoAuthenticatedRedirects(urllib.request.HTTPRedirectHandler):
    """Never forward an OAuth token through an HTTP redirect."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


AUTHENTICATED_OPENER = urllib.request.build_opener(NoAuthenticatedRedirects)


def read_limited(response: Any) -> bytes:
    payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise AuditError(f"response exceeded {MAX_RESPONSE_BYTES} bytes")
    return payload


def parse_body(content_type: str, payload: bytes) -> dict[str, Any]:
    text = payload.decode("utf-8")
    if "text/event-stream" in content_type.lower():
        data = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
        if len(data) != 1:
            raise AuditError(f"expected one SSE data event, received {len(data)}")
        text = data[0]
    try:
        body = json.loads(text)
    except json.JSONDecodeError as error:
        raise AuditError(f"response is not valid JSON: {error}") from error
    if not isinstance(body, dict):
        raise AuditError("JSON-RPC response must be an object")
    return body


def iter_sse_data(
    response: Any,
    max_event_bytes: int = MAX_RESPONSE_BYTES,
    deadline: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> Iterator[str]:
    data_lines: list[str] = []
    event_size = 0
    while True:
        if deadline is not None:
            remaining = deadline - clock()
            if remaining <= 0:
                raise AuditError("SSE response exceeded its wall-clock deadline")
            set_response_read_timeout(response, remaining)
        raw_line = response.readline(max_event_bytes + 1)
        if deadline is not None and clock() >= deadline:
            raise AuditError("SSE response exceeded its wall-clock deadline")
        if not raw_line:
            break
        if len(raw_line) > max_event_bytes:
            raise AuditError(f"SSE line exceeded {max_event_bytes} bytes")
        try:
            line = raw_line.decode("utf-8").rstrip("\r\n")
        except UnicodeDecodeError as error:
            raise AuditError("SSE response is not valid UTF-8") from error
        if not line:
            if data_lines:
                yield "\n".join(data_lines)
                data_lines = []
                event_size = 0
            continue
        if line.startswith(":"):
            continue
        field, separator, value = line.partition(":")
        if field != "data":
            continue
        if separator and value.startswith(" "):
            value = value[1:]
        event_size += len(value.encode("utf-8")) + (1 if data_lines else 0)
        if event_size > max_event_bytes:
            raise AuditError(f"SSE event exceeded {max_event_bytes} bytes")
        data_lines.append(value)
    if data_lines:
        yield "\n".join(data_lines)


def set_response_read_timeout(response: Any, timeout: float) -> None:
    test_setter = getattr(response, "set_audit_read_timeout", None)
    if callable(test_setter):
        test_setter(timeout)
        return
    try:
        settimeout = response.fp.raw._sock.settimeout
    except AttributeError as error:
        raise AuditError("cannot enforce the SSE wall-clock deadline") from error
    settimeout(max(timeout, 0.001))


def read_rpc_response(
    response: Any, expected_id: int, timeout_seconds: float = 30
) -> dict[str, Any]:
    content_type = response.headers.get("Content-Type", "")
    if "text/event-stream" not in content_type.lower():
        body = parse_body(content_type, read_limited(response))
        require(body.get("id") == expected_id, f"expected JSON-RPC id {expected_id}")
        return body

    deadline = time.monotonic() + timeout_seconds
    for data in iter_sse_data(response, deadline=deadline):
        try:
            body = json.loads(data)
        except json.JSONDecodeError as error:
            raise AuditError(f"SSE data is not valid JSON: {error}") from error
        if not isinstance(body, dict):
            raise AuditError("SSE JSON-RPC response must be an object")
        if body.get("id") == expected_id:
            return body
    raise AuditError(f"SSE stream ended before JSON-RPC id {expected_id}")


def open_authenticated(request: urllib.request.Request, timeout: int) -> Any:
    try:
        return AUTHENTICATED_OPENER.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        if error.code in {301, 302, 303, 307, 308}:
            raise AuditError(
                f"authenticated request refused HTTP redirect {error.code}"
            ) from error
        raise


def error_detail(error: urllib.error.HTTPError) -> str:
    return error.read(501).decode("utf-8", errors="replace")[:500]


def metadata_url(connector_url: str) -> str:
    parsed = urlsplit(connector_url)
    return f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{parsed.path}"


def fetch_json(url: str) -> tuple[int, dict[str, str], dict[str, Any]]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), parse_body(
            error.headers.get("Content-Type", ""), read_limited(error)
        )
    with response:
        return response.status, dict(response.headers.items()), parse_body(
            response.headers.get("Content-Type", ""), read_limited(response)
        )


def rpc(url: str, payload: dict[str, Any], token: str, session: str | None = None) -> tuple[dict[str, Any], str | None]:
    method = payload.get("method")
    require(isinstance(method, str), "JSON-RPC audit requests require a method")
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "MCP-Method": method,
    }
    if session:
        headers["Mcp-Session-Id"] = session
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        response = open_authenticated(request, timeout=30)
    except urllib.error.HTTPError as error:
        detail = error_detail(error)
        raise AuditError(f"JSON-RPC request returned HTTP {error.code}: {detail}") from error
    with response:
        request_id = payload.get("id")
        require(isinstance(request_id, int), "JSON-RPC audit requests require an integer id")
        body = read_rpc_response(response, request_id)
        return body, response.headers.get("Mcp-Session-Id") or session


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def canonical_validation_schema(value: Any) -> Any:
    """Remove only non-behavioral JSON Schema serializer differences."""
    if isinstance(value, list):
        return [canonical_validation_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    normalized = {
        key: canonical_validation_schema(item)
        for key, item in value.items()
        if key not in {"$schema", "description"}
    }
    const_type = {
        bool: "boolean",
        int: "integer",
        float: "number",
        str: "string",
    }.get(type(normalized.get("const")))
    if const_type and normalized.get("type") == const_type:
        normalized.pop("type")
    return normalized


def validate_schema_dialects(value: Any, tool_name: str) -> None:
    if isinstance(value, list):
        for item in value:
            validate_schema_dialects(item, tool_name)
        return
    if not isinstance(value, dict):
        return
    dialect = value.get("$schema")
    require(
        dialect in {None, JSON_SCHEMA_DIALECT},
        f"unsupported JSON Schema dialect for {tool_name}: {dialect}",
    )
    for item in value.values():
        validate_schema_dialects(item, tool_name)


def validate_tool_catalog(received: Any, contract: dict[str, Any]) -> None:
    require(isinstance(received, list), "tools/list result must contain a tool array")
    require(all(isinstance(tool, dict) for tool in received), "every tool must be an object")
    names = [tool.get("name") for tool in received]
    require(all(isinstance(name, str) for name in names), "every tool must have a string name")
    require(len(set(names)) == len(names), "tools/list contains duplicate tool names")

    expected = {tool["name"]: tool for tool in contract["tools"]}
    by_name = {tool["name"]: tool for tool in received}
    require(set(by_name) == set(expected), f"tool set drifted: {sorted(by_name)}")
    endpoint_schemas = {
        endpoint["executionTool"]: endpoint["inputSchema"]
        for endpoint in contract["endpoints"]
    }
    for name, contract_tool in expected.items():
        require(by_name[name].get("title") == contract_tool["title"], f"title drifted for {name}")
        require(
            by_name[name].get("annotations") == contract_tool["annotations"],
            f"annotations drifted for {name}",
        )
        schema = by_name[name].get("inputSchema")
        require(isinstance(schema, dict), f"{name} has no input schema")
        validate_schema_dialects(schema, name)
        if name in endpoint_schemas:
            require(
                canonical_validation_schema(schema)
                == canonical_validation_schema(endpoint_schemas[name]),
                f"input schema drifted for {name}",
            )


def run_audit(url: str, token: str) -> None:
    contract = json.loads(CONTRACT_PATH.read_text())

    status, _, metadata = fetch_json(metadata_url(url))
    require(status == 200, f"protected-resource metadata returned HTTP {status}")
    require(metadata.get("resource") == url, "OAuth resource metadata does not bind the exact connector URL")
    require(metadata.get("scopes_supported") == ["admin"], "OAuth metadata scopes changed")
    servers = metadata.get("authorization_servers")
    require(isinstance(servers, list) and len(servers) == 1, "expected one authorization server")

    discovery, session = rpc(
        url,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "server/discover",
            "params": {"_meta": PROTOCOL_META},
        },
        token,
    )
    require(discovery.get("id") == 1 and "result" in discovery, "server/discover failed")
    require(
        discovery["result"].get("supportedVersions") == [PROTOCOL_VERSION],
        "protocol version drifted",
    )
    require(
        discovery["result"].get("_meta", {}).get(
            "io.modelcontextprotocol/serverInfo", {}
        ).get("version")
        == contract["version"],
        "deployed connector version drifted",
    )

    tools, _ = rpc(
        url,
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {"_meta": PROTOCOL_META},
        },
        token,
        session,
    )
    require(tools.get("id") == 2 and "result" in tools, "tools/list failed")
    received = tools["result"].get("tools", [])
    validate_tool_catalog(received, contract)
    print("Hosted six-tool OAuth metadata audit: OK (no tools were called)")


def self_test() -> None:
    assert metadata_url(DEFAULT_URL) == "https://api.telnyx.com/.well-known/oauth-protected-resource/v2/ai/mcp"
    assert parse_body("application/json", b'{"jsonrpc":"2.0","id":1,"result":{}}')["id"] == 1

    class StreamingResponse:
        headers = {"Content-Type": "text/event-stream"}
        lines = iter([
            b': keepalive\n',
            b'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n',
            b'\n',
            b'data: {"jsonrpc":"2.0","id":2,\n',
            b'data: "result":{}}\n',
            b'\n',
        ])

        def readline(self, _: int) -> bytes:
            try:
                return next(self.lines)
            except StopIteration as error:
                raise AssertionError(
                    "reader must stop at the matching response without waiting for EOF"
                ) from error

        def set_audit_read_timeout(self, _: float) -> None:
            return

    assert read_rpc_response(StreamingResponse(), 2)["id"] == 2

    class OversizedMultilineEvent:
        lines = iter([b"data:\n"] * 12 + [b"\n"])

        def readline(self, _: int) -> bytes:
            return next(self.lines, b"")

    try:
        next(iter_sse_data(OversizedMultilineEvent(), max_event_bytes=10))
    except AuditError as error:
        assert str(error) == "SSE event exceeded 10 bytes"
    else:
        raise AssertionError("joined SSE data-line separators must count toward the size limit")

    class NeverCompletesEvent:
        lines = iter([b"data: {}\n"])
        timeouts: list[float] = []

        def readline(self, _: int) -> bytes:
            return next(self.lines, b"")

        def set_audit_read_timeout(self, timeout: float) -> None:
            self.timeouts.append(timeout)

    ticks = iter([0.0, 5.0, 11.0])
    incomplete = NeverCompletesEvent()
    try:
        next(iter_sse_data(incomplete, deadline=10.0, clock=lambda: next(ticks)))
    except AuditError as error:
        assert str(error) == "SSE response exceeded its wall-clock deadline"
    else:
        raise AssertionError("an unfinished SSE event must not extend the absolute deadline")
    assert incomplete.timeouts == [10.0]

    contract = json.loads(CONTRACT_PATH.read_text())
    observed: list[str] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_: Any) -> None:
            return

        def send_json(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def send_sse(self, *events: dict[str, Any]) -> None:
            payload = "".join(
                f"event: message\ndata: {json.dumps(event)}\n\n" for event in events
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:
            expected = "/.well-known/oauth-protected-resource/v2/ai/mcp"
            if self.path != expected:
                self.send_json(404, {"error": "not found"})
                return
            self.send_json(200, {
                "resource": test_url,
                "authorization_servers": ["https://auth.example.test"],
                "scopes_supported": ["admin"],
            })

        def do_POST(self) -> None:
            if self.headers.get("Authorization") != "Bearer test-token":
                self.send_json(401, {"error": "invalid_token"})
                return
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            method = request.get("method", "")
            if (
                self.headers.get("MCP-Method") != method
                or request.get("params", {}).get("_meta") != PROTOCOL_META
            ):
                self.send_json(400, {"error": "invalid modern MCP envelope"})
                return
            observed.append(method)
            if method == "server/discover":
                self.send_json(200, {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    "result": {
                        "supportedVersions": [PROTOCOL_VERSION],
                        "capabilities": {"tools": {"listChanged": True}},
                        "_meta": {
                            "io.modelcontextprotocol/serverInfo": {
                                "name": "test",
                                "version": contract["version"],
                            }
                        },
                    },
                })
            elif method == "tools/list":
                tools = []
                endpoint_schemas = {
                    endpoint["executionTool"]: endpoint["inputSchema"]
                    for endpoint in contract["endpoints"]
                }
                for item in contract["tools"]:
                    schema = endpoint_schemas.get(
                        item["name"], {"type": "object", "properties": {}}
                    )
                    tools.append({
                        "name": item["name"],
                        "title": item["title"],
                        "annotations": item["annotations"],
                        "inputSchema": schema,
                    })
                self.send_sse(
                    {"jsonrpc": "2.0", "method": "notifications/progress"},
                    {"jsonrpc": "2.0", "id": request["id"], "result": {"tools": tools}},
                )
            else:
                self.send_json(400, {"error": "unexpected method"})

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    test_url = f"http://127.0.0.1:{server.server_port}/v2/ai/mcp"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        run_audit(test_url, "test-token")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert observed == ["server/discover", "tools/list"]

    endpoint_schemas = {
        endpoint["executionTool"]: endpoint["inputSchema"]
        for endpoint in contract["endpoints"]
    }
    valid_tools = [
        {
            "name": item["name"],
            "title": item["title"],
            "annotations": item["annotations"],
            "inputSchema": endpoint_schemas.get(
                item["name"], {"type": "object", "properties": {}}
            ),
        }
        for item in contract["tools"]
    ]
    drifted_tools = json.loads(json.dumps(valid_tools))
    lookup = next(tool for tool in drifted_tools if tool["name"] == "lookup_phone_number")
    lookup["inputSchema"]["required"].remove("lookup_type")
    try:
        validate_tool_catalog(drifted_tools, contract)
    except AuditError as error:
        assert str(error) == "input schema drifted for lookup_phone_number"
    else:
        raise AssertionError("execution-tool schema drift must fail the release audit")

    dialect_drift = json.loads(json.dumps(valid_tools))
    lookup = next(tool for tool in dialect_drift if tool["name"] == "lookup_phone_number")
    lookup["inputSchema"]["$schema"] = "http://json-schema.org/draft-04/schema#"
    try:
        validate_tool_catalog(dialect_drift, contract)
    except AuditError as error:
        assert str(error).startswith("unsupported JSON Schema dialect for lookup_phone_number")
    else:
        raise AssertionError("behavior-changing JSON Schema dialect drift must fail the audit")

    redirect_hits: list[str | None] = []

    class RedirectTarget(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_: Any) -> None:
            return

        def record(self) -> None:
            redirect_hits.append(self.headers.get("Authorization"))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"jsonrpc":"2.0","id":7,"result":{}}')

        do_GET = record
        do_POST = record

    target = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RedirectTarget)
    target_url = f"http://127.0.0.1:{target.server_port}/capture"

    class RedirectSource(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_: Any) -> None:
            return

        def do_POST(self) -> None:
            self.send_response(302)
            self.send_header("Location", target_url)
            self.end_headers()

    source = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RedirectSource)
    target_thread = threading.Thread(target=target.serve_forever, daemon=True)
    source_thread = threading.Thread(target=source.serve_forever, daemon=True)
    target_thread.start()
    source_thread.start()
    try:
        try:
            rpc(
                f"http://127.0.0.1:{source.server_port}/redirect",
                {"jsonrpc": "2.0", "id": 7, "method": "tools/list", "params": {}},
                "redirect-secret",
            )
        except AuditError as error:
            assert "refused HTTP redirect 302" in str(error)
        else:
            raise AssertionError("authenticated redirects must fail closed")
    finally:
        source.shutdown()
        target.shutdown()
        source.server_close()
        target.server_close()
        source_thread.join(timeout=5)
        target_thread.join(timeout=5)
    assert redirect_hits == []
    print("Hosted MCP audit self-test: OK")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    token = os.environ.get("TELNYX_MCP_OAUTH_TOKEN", "")
    if not token:
        print("TELNYX_MCP_OAUTH_TOKEN is required", file=sys.stderr)
        return 2
    try:
        run_audit(args.url, token)
    except AuditError as error:
        print(f"Hosted MCP audit failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
