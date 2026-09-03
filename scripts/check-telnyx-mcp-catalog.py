#!/usr/bin/env python3
"""Metadata-only audit for the deployed Telnyx AI MCP connector."""

from __future__ import annotations

import argparse
import http.server
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT / "submission" / "telnyx-developer-kit" / "connector-contract.json"
DEFAULT_URL = "https://api.telnyx.com/v2/ai/mcp"
PROTOCOL_VERSION = "2026-07-28"


class AuditError(RuntimeError):
    pass


def parse_body(content_type: str, payload: bytes) -> dict[str, Any]:
    text = payload.decode("utf-8")
    if "text/event-stream" in content_type:
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


def metadata_url(connector_url: str) -> str:
    parsed = urlsplit(connector_url)
    return f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{parsed.path}"


def fetch_json(url: str) -> tuple[int, dict[str, str], dict[str, Any]]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), parse_body(error.headers.get("Content-Type", ""), error.read())
    with response:
        return response.status, dict(response.headers.items()), parse_body(response.headers.get("Content-Type", ""), response.read())


def rpc(url: str, payload: dict[str, Any], token: str, session: str | None = None) -> tuple[dict[str, Any], str | None]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
    }
    if session:
        headers["Mcp-Session-Id"] = session
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise AuditError(f"JSON-RPC request returned HTTP {error.code}: {detail}") from error
    with response:
        body = parse_body(response.headers.get("Content-Type", ""), response.read())
        return body, response.headers.get("Mcp-Session-Id") or session


def notify_initialized(url: str, token: str, session: str | None) -> None:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
    }
    if session:
        headers["Mcp-Session-Id"] = session
    request = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}).encode(),
        headers=headers,
        method="POST",
    )
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise AuditError(f"initialized notification returned HTTP {error.code}: {detail}") from error
    with response:
        require(response.status in {202, 204},
                f"initialized notification returned HTTP {response.status}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def run_audit(url: str, token: str) -> None:
    contract = json.loads(CONTRACT_PATH.read_text())
    expected = {tool["name"]: tool for tool in contract["tools"]}

    status, _, metadata = fetch_json(metadata_url(url))
    require(status == 200, f"protected-resource metadata returned HTTP {status}")
    require(metadata.get("resource") == url, "OAuth resource metadata does not bind the exact connector URL")
    require(metadata.get("scopes_supported") == ["admin"], "OAuth metadata scopes changed")
    servers = metadata.get("authorization_servers")
    require(isinstance(servers, list) and len(servers) == 1, "expected one authorization server")

    initialize, session = rpc(
        url,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "telnyx-codex-release-audit", "version": "1"},
            },
        },
        token,
    )
    require(initialize.get("id") == 1 and "result" in initialize, "initialize failed")
    require(initialize["result"].get("protocolVersion") == PROTOCOL_VERSION, "protocol version drifted")
    notify_initialized(url, token, session)

    tools, _ = rpc(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, token, session)
    require(tools.get("id") == 2 and "result" in tools, "tools/list failed")
    received = tools["result"].get("tools", [])
    by_name = {tool.get("name"): tool for tool in received}
    require(set(by_name) == set(expected), f"tool set drifted: {sorted(by_name)}")
    for name, contract_tool in expected.items():
        require(by_name[name].get("annotations") == contract_tool["annotations"],
                f"annotations drifted for {name}")
        require(isinstance(by_name[name].get("inputSchema"), dict), f"{name} has no input schema")
    lookup_required = set(by_name["lookup_phone_number"]["inputSchema"].get("required", []))
    require("confirm_billable_lookup" in lookup_required, "billable confirmation is not required")
    require(by_name["lookup_phone_number"]["inputSchema"]["properties"]["confirm_billable_lookup"] == {"const": True},
            "billable confirmation is not true-only")
    print("Hosted six-tool OAuth metadata audit: OK (no tools were called)")


def self_test() -> None:
    assert metadata_url(DEFAULT_URL) == "https://api.telnyx.com/.well-known/oauth-protected-resource/v2/ai/mcp"
    assert parse_body("application/json", b'{"jsonrpc":"2.0","id":1,"result":{}}')["id"] == 1
    assert parse_body("text/event-stream", b'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n\n')["id"] == 2
    try:
        parse_body("text/event-stream", b'data: {}\n\ndata: {}\n\n')
    except AuditError:
        pass
    else:
        raise AssertionError("multiple SSE messages must fail closed")

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
            observed.append(method)
            if method == "initialize":
                self.send_json(200, {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "serverInfo": {"name": "test", "version": "1"}},
                })
            elif method == "notifications/initialized":
                self.send_response(204)
                self.end_headers()
            elif method == "tools/list":
                tools = []
                for item in contract["tools"]:
                    schema: dict[str, Any] = {"type": "object", "properties": {}}
                    if item["name"] == "lookup_phone_number":
                        schema = {
                            "type": "object",
                            "required": ["confirm_billable_lookup"],
                            "properties": {"confirm_billable_lookup": {"const": True}},
                        }
                    tools.append({"name": item["name"], "annotations": item["annotations"], "inputSchema": schema})
                self.send_json(200, {"jsonrpc": "2.0", "id": request["id"], "result": {"tools": tools}})
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
    assert observed == ["initialize", "notifications/initialized", "tools/list"]
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
