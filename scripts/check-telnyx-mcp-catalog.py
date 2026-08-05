#!/usr/bin/env python3
"""Validate the hosted Telnyx MCP review contract without invoking an API.

This checker reads public discovery metadata, MCP tool/resource metadata, the
endpoint catalog, and every endpoint schema. It never calls invoke_api_endpoint
or any app tool, so it cannot send traffic, buy numbers, place calls, charge a
payment method, or mutate Telnyx account state.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import itertools
import json
import math
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parent.parent
MCP_CONFIG_PATH = REPO_ROOT / "plugins" / "telnyx-developer-kit" / ".mcp.json"
ANNOTATIONS_PATH = (
    REPO_ROOT
    / "submission"
    / "telnyx-developer-kit"
    / "annotation-justifications.json"
)
APP_TOOL_CONTRACT_PATH = (
    REPO_ROOT
    / "submission"
    / "telnyx-developer-kit"
    / "app-tool-contract.json"
)
EXPECTED_MCP_URL = "https://api.telnyx.com/v2/mcp"
SERVER_CARD_URL = "https://telnyx.com/.well-known/mcp/server-card.json"
PROTECTED_RESOURCE_URL = (
    "https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp"
)
AUTHORIZATION_SERVER_URL = (
    "https://api.telnyx.com/.well-known/oauth-authorization-server"
)
EXPECTED_AUTHORIZATION_SERVER = "https://api.telnyx.com"
EXPECTED_UI_DOMAIN = "https://telnyx-developer-kit.telnyx.com"
EXPECTED_UI_RESOURCES = {
    "open_number_intelligence": "ui://number-intelligence/index.html",
    "open_usage_cost_explorer": "ui://usage-cost-explorer/index.html",
    "open_voice_monitor": "ui://voice-monitor/index.html",
}
EXPECTED_UI_RESOURCE_URIS = frozenset(
    {
        *EXPECTED_UI_RESOURCES.values(),
        "ui://usage-cost-explorer/auto-recharge.html",
        "ui://usage-cost-explorer/stored-payment-top-up.html",
    }
)
EXPECTED_UI_RESOURCE_MARKERS = {
    "ui://number-intelligence/index.html": (
        "tools/call",
        "window.parent.postMessage",
        "addEventListener",
        "number_intelligence_analyze",
    ),
    "ui://usage-cost-explorer/index.html": (
        "tools/call",
        "window.parent.postMessage",
        "addEventListener",
        "billing_query_usage",
    ),
    "ui://usage-cost-explorer/auto-recharge.html": (
        "tools/call",
        "window.parent.postMessage",
        "addEventListener",
        "billing_update_auto_recharge_preferences",
    ),
    "ui://usage-cost-explorer/stored-payment-top-up.html": (
        "tools/call",
        "window.parent.postMessage",
        "addEventListener",
        "billing_create_stored_payment_transaction",
    ),
    "ui://voice-monitor/index.html": (
        "tools/call",
        "window.parent.postMessage",
        "addEventListener",
        "voice_monitor_active_calls",
    ),
}
SUPPORTED_CSP_FIELDS = {
    "connectDomains",
    "resourceDomains",
    "frameDomains",
}
SPECIAL_USE_HOST_SUFFIXES = (
    ".internal",
    ".invalid",
    ".local",
    ".localhost",
    ".test",
)
SUPPORTED_TOKEN_AUTH_METHODS = {
    "none",
    "private_key_jwt",
    "client_secret_basic",
    "client_secret_post",
}
INVOKE_RISK_TERMS = {
    "message",
    "call",
    "purchase",
    "charge",
    "delete",
}
DESTRUCTIVE_ENDPOINT_PATTERNS = (
    re.compile(r"\b(?:delete|destroy|erase|purge|revoke|terminate|hang[ -]?up)\w*\b"),
    re.compile(r"\b(?:cancel|disconnect)\w*\b"),
    re.compile(
        r"\b(?:send|deliver|dispatch|transmit)\w*\b.{0,60}"
        r"\b(?:message|sms|mms|email|fax)\w*\b"
    ),
    re.compile(
        r"\b(?:place|start|initiate|dial)\w*\b.{0,60}\bcall\w*\b"
    ),
    re.compile(r"\b(?:purchase|buy|charge|refund|payment|pay)\w*\b"),
    re.compile(
        r"\bsubmit\w*\b.{0,60}"
        r"\b(?:brand|campaign|port(?:ing)?|verification)\w*\b"
    ),
)
OPEN_WORLD_ENDPOINT_PATTERNS = (
    re.compile(
        r"\b(?:send|deliver|dispatch|transmit)\w*\b.{0,60}"
        r"\b(?:message|sms|mms|email|fax)\w*\b"
    ),
    re.compile(
        r"\b(?:place|start|initiate|dial)\w*\b.{0,60}\bcall\w*\b"
    ),
    re.compile(r"\b(?:purchase|buy|charge|refund|payment|pay)\w*\b"),
    re.compile(
        r"\bsubmit\w*\b.{0,60}"
        r"\b(?:brand|campaign|port(?:ing)?|verification)\w*\b"
    ),
    re.compile(r"\bpublish\w*\b"),
)
NEGATION_PATTERN = re.compile(
    r"\b(?:do|does|did|will|would|can|cannot|can't|must)?\s*not\b"
    r"|\bnever\b|\bwithout\b|\bpreview\b|\bdry[ -]?run\b"
)
AUTH_PARAMETER_PATTERN = re.compile(
    r"(?:^|,)\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"
    r"(?:\"((?:\\.|[^\"\\])*)\"|([^,\s]+))"
)
SCRIPT_CONNECT_PATTERNS = (
    re.compile(
        r"\b(?:fetch|EventSource|WebSocket)\s*\(\s*[\"'`]"
        r"(https?://[^\"'`\s]+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\baxios\.(?:get|post|put|patch|delete|request)\s*\(\s*[\"'`]"
        r"(https?://[^\"'`\s]+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\.open\s*\(\s*[\"'`][A-Z]+[\"'`]\s*,\s*[\"'`]"
        r"(https?://[^\"'`\s]+)",
        re.IGNORECASE,
    ),
)
SCRIPT_RESOURCE_PATTERNS = (
    re.compile(
        r"\bimport\s*\(\s*[\"'`](https?://[^\"'`\s]+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bfrom\s*[\"'`](https?://[^\"'`\s]+)",
        re.IGNORECASE,
    ),
)
CSS_URL_PATTERN = re.compile(
    r"(?:url\(\s*|@import\s+)[\"']?(https?://[^\"')\s;]+)",
    re.IGNORECASE,
)
REQUESTED_PROTOCOL_VERSION = "2025-06-18"
ANNOTATION_FIELDS = (
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
)
EXPECTED_MODEL_VISIBLE_TOOL_COUNT = 6
EXPECTED_APP_ONLY_TOOL_COUNT = 25
EXPECTED_APP_TOOL_WIRE_CONTRACT = {
    "securitySchemes": [{"type": "oauth2", "scopes": ["admin"]}],
    "_meta": {
        "securitySchemes": [{"type": "oauth2", "scopes": ["admin"]}],
        "ui": {"visibility": ["app"]},
    },
}
EXPECTED_ENDPOINT_COUNT = 846
EXPECTED_READ_COUNT = 400
EXPECTED_WRITE_COUNT = 446
EXPECTED_CATALOG_NAMES_SHA256 = (
    "6e3e7167fc512259e67ba0fb793d9f6ecca6ab1da7f82115e55d480ea843dcbc"
)
CATALOG_FIELDS = {"name", "description", "resource", "operation", "tags"}
REQUEST_IDS = itertools.count(1)


class AuditError(RuntimeError):
    """An MCP response or catalog invariant failed validation."""


class StrictJSONError(ValueError):
    """A document used syntax or object members that strict JSON rejects."""


def reject_non_finite_json_constant(value: str) -> Any:
    raise StrictJSONError(f"non-finite JSON number is not allowed: {value}")


def parse_finite_json_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise StrictJSONError(f"non-finite JSON number is not allowed: {value}")
    return parsed


def reject_duplicate_json_members(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, value in pairs:
        if name in result:
            raise StrictJSONError(f"duplicate JSON object member: {name!r}")
        result[name] = value
    return result


def strict_json_loads(document: str | bytes | bytearray) -> Any:
    """Decode one standards-compliant, unambiguous JSON document."""

    return json.loads(
        document,
        parse_constant=reject_non_finite_json_constant,
        parse_float=parse_finite_json_float,
        object_pairs_hook=reject_duplicate_json_members,
    )


class RejectRedirects(HTTPRedirectHandler):
    """Keep credentials on the configured MCP origin."""

    def redirect_request(
        self,
        req: Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate Telnyx MCP discovery, auth, tools, UI resources, and "
            "every endpoint schema. Requires TELNYX_API_KEY and never invokes "
            "an API endpoint."
        )
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Concurrent schema requests (default: 6; allowed: 1-12)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=45,
        help="Per-request timeout in seconds (default: 45)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=4,
        help="Attempts for rate limits and transient server failures (default: 4)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run offline validator regression checks and exit",
    )
    return parser.parse_args()


def load_mcp_url() -> str:
    try:
        payload = strict_json_loads(MCP_CONFIG_PATH.read_text(encoding="utf-8"))
        server = payload["mcpServers"]["telnyx"]
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        StrictJSONError,
        KeyError,
        TypeError,
    ) as exc:
        raise AuditError(f"cannot read Telnyx MCP config: {exc}") from exc
    if server != {"type": "http", "url": EXPECTED_MCP_URL}:
        raise AuditError(
            "Telnyx MCP config does not match the production HTTP endpoint"
        )
    return EXPECTED_MCP_URL


def load_expected_root_annotations() -> dict[str, dict[str, bool]]:
    try:
        payload = strict_json_loads(
            ANNOTATIONS_PATH.read_text(encoding="utf-8")
        )
        tools = payload["tools"]
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        StrictJSONError,
        KeyError,
        TypeError,
    ) as exc:
        raise AuditError(f"cannot read annotation justifications: {exc}") from exc
    if not isinstance(tools, list):
        raise AuditError("annotation justifications tools must be an array")

    expected: dict[str, dict[str, bool]] = {}
    for tool in tools:
        if not isinstance(tool, dict) or not isinstance(tool.get("name"), str):
            raise AuditError("annotation justifications contain an invalid tool")
        name = tool["name"]
        if name in expected:
            raise AuditError(f"duplicate annotation justification: {name}")
        hints = {
            field: tool.get(field)
            for field in ("readOnlyHint", "openWorldHint", "destructiveHint")
        }
        if not all(isinstance(value, bool) for value in hints.values()):
            raise AuditError(f"annotation justification hints are invalid: {name}")
        expected[name] = hints
    return expected


def load_expected_app_tools() -> dict[str, dict[str, Any]]:
    try:
        payload = strict_json_loads(
            APP_TOOL_CONTRACT_PATH.read_text(encoding="utf-8")
        )
        tools = payload["tools"]
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        StrictJSONError,
        KeyError,
        TypeError,
    ) as exc:
        raise AuditError(f"cannot read app-tool contract: {exc}") from exc
    if set(payload) != {
        "mcpServerURL",
        "reviewScope",
        "visibility",
        "wireContract",
        "tools",
    }:
        raise AuditError("app-tool contract has unexpected top-level fields")
    if payload["mcpServerURL"] != EXPECTED_MCP_URL:
        raise AuditError("app-tool contract targets the wrong MCP endpoint")
    if (
        not isinstance(payload["reviewScope"], str)
        or not payload["reviewScope"].strip()
    ):
        raise AuditError("app-tool contract reviewScope must be non-empty")
    if payload["visibility"] != ["app"]:
        raise AuditError("app-tool contract visibility must be exactly ['app']")
    if payload["wireContract"] != EXPECTED_APP_TOOL_WIRE_CONTRACT:
        raise AuditError(
            "app-tool contract wireContract must pin OAuth admin, its exact "
            "_meta security mirror, and app-only UI visibility"
        )
    if not isinstance(tools, list):
        raise AuditError("app-tool contract tools must be an array")

    expected: dict[str, dict[str, Any]] = {}
    expected_fields = {"name", "title", "description", "annotations"}
    for tool in tools:
        if not isinstance(tool, dict) or set(tool) != expected_fields:
            raise AuditError("app-tool contract contains an invalid tool")
        name = tool["name"]
        if not isinstance(name, str) or not name.strip() or name in expected:
            raise AuditError(f"app-tool contract has an invalid tool name: {name!r}")
        for field in ("title", "description"):
            if (
                not isinstance(tool[field], str)
                or not tool[field].strip()
                or tool[field] != tool[field].strip()
            ):
                raise AuditError(
                    f"app-tool contract {name}.{field} must be non-empty"
                )
        annotations = tool["annotations"]
        if (
            not isinstance(annotations, dict)
            or set(annotations) != set(ANNOTATION_FIELDS)
            or not all(
                isinstance(annotations[field], bool)
                for field in ANNOTATION_FIELDS
            )
        ):
            raise AuditError(
                f"app-tool contract annotations are invalid: {name}"
            )
        expected[name] = tool

    if len(expected) != EXPECTED_APP_ONLY_TOOL_COUNT:
        raise AuditError(
            "app-tool contract count changed: "
            f"actual={len(expected)}, expected={EXPECTED_APP_ONLY_TOOL_COUNT}"
        )
    return expected


def validate_api_key(api_key: str) -> None:
    if (
        api_key != api_key.strip()
        or not api_key
        or len(api_key) > 4096
        or any(not 0x21 <= ord(character) <= 0x7E for character in api_key)
    ):
        raise AuditError(
            "TELNYX_API_KEY contains unsupported whitespace or control characters"
        )


def parse_json_rpc_response(raw: bytes) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AuditError("MCP response is not valid UTF-8") from exc

    candidates: list[str]
    if text.lstrip().startswith(("event:", "data:")):
        candidates = [
            line.removeprefix("data:").strip()
            for line in text.splitlines()
            if line.startswith("data:") and line.removeprefix("data:").strip()
        ]
    else:
        candidates = [text]

    first_payload: dict[str, Any] | None = None
    for candidate in candidates:
        try:
            payload = strict_json_loads(candidate)
        except StrictJSONError as exc:
            raise AuditError(
                "MCP response contains non-standard or ambiguous JSON"
            ) from exc
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and first_payload is None:
            first_payload = payload
    if first_payload is not None:
        return first_payload
    raise AuditError("MCP response did not contain a JSON-RPC object")


def retry_delay(headers: Any, attempt: int) -> float:
    raw_retry_after = headers.get("Retry-After") if headers is not None else None
    try:
        retry_after = float(raw_retry_after)
    except (TypeError, ValueError):
        retry_after = 0.5 * (2**attempt)
    return min(max(retry_after, 0.1) + random.uniform(0, 0.25), 30)


def get_json_document(
    *,
    url: str,
    timeout: float,
    retries: int,
) -> dict[str, Any]:
    request = Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "telnyx-codex-plugin-catalog-audit/0.1.0",
        },
    )
    opener = build_opener(RejectRedirects())
    for attempt in range(retries):
        try:
            with opener.open(request, timeout=timeout) as response:
                raw = response.read()
            break
        except HTTPError as exc:
            if exc.code != 429 and exc.code < 500:
                raise AuditError(
                    f"metadata request failed with HTTP {exc.code}: {url}"
                ) from exc
            if attempt + 1 == retries:
                raise AuditError(
                    f"metadata request failed after {retries} attempts: {url}"
                ) from exc
            time.sleep(retry_delay(exc.headers, attempt))
        except URLError as exc:
            if attempt + 1 == retries:
                raise AuditError(
                    f"metadata network request failed after {retries} attempts: {url}"
                ) from exc
            time.sleep(retry_delay(None, attempt))
    else:  # pragma: no cover - loop always breaks or raises
        raise AuditError(f"metadata request exhausted retries: {url}")

    try:
        payload = strict_json_loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, StrictJSONError) as exc:
        raise AuditError(f"metadata is not valid strict UTF-8 JSON: {url}") from exc
    if not isinstance(payload, dict):
        raise AuditError(f"metadata document must be a JSON object: {url}")
    return payload


def has_public_https_host(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if (
        not value
        or value != value.strip()
        or any(character.isspace() for character in value)
        or "\\" in value
    ):
        return False
    try:
        parsed = urlparse(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        return False

    normalized_host = hostname.rstrip(".").casefold()
    if (
        normalized_host == "localhost"
        or normalized_host.endswith(SPECIAL_USE_HOST_SUFFIXES)
    ):
        return False
    try:
        address = ipaddress.ip_address(normalized_host)
    except ValueError:
        labels = normalized_host.split(".")
        if (
            len(labels) < 2
            or any(
                not label
                or len(label) > 63
                or label.startswith("-")
                or label.endswith("-")
                or re.fullmatch(r"[a-z0-9-]+", label) is None
                for label in labels
            )
        ):
            return False
    else:
        if not address.is_global:
            return False
    return True


def is_https_origin(value: Any) -> bool:
    if not has_public_https_host(value):
        return False
    parsed = urlparse(value)
    return (
        parsed.path in {"", "/"}
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
        and "*" not in value
    )


def is_https_url(value: Any) -> bool:
    if not has_public_https_host(value):
        return False
    parsed = urlparse(value)
    return (
        not parsed.fragment
        and "*" not in value
    )


def validate_oauth_metadata(
    protected_resource: dict[str, Any],
    authorization_server: dict[str, Any],
) -> set[str]:
    if protected_resource.get("resource") != EXPECTED_MCP_URL:
        raise AuditError("OAuth protected-resource metadata has the wrong resource")
    authorization_servers = protected_resource.get("authorization_servers")
    if authorization_servers != [EXPECTED_AUTHORIZATION_SERVER]:
        raise AuditError(
            "OAuth protected-resource metadata has unexpected authorization servers"
        )
    bearer_methods = protected_resource.get("bearer_methods_supported")
    if bearer_methods is not None and (
        not isinstance(bearer_methods, list)
        or "header" not in bearer_methods
        or not all(isinstance(method, str) for method in bearer_methods)
    ):
        raise AuditError(
            "OAuth protected-resource bearer methods must include header when present"
        )

    if authorization_server.get("issuer") != EXPECTED_AUTHORIZATION_SERVER:
        raise AuditError("OAuth authorization-server issuer is unexpected")
    required_endpoints = {"authorization_endpoint", "token_endpoint"}
    for field in sorted(required_endpoints):
        if not is_https_url(authorization_server.get(field)):
            raise AuditError(
                f"OAuth authorization-server metadata is missing HTTPS {field}"
            )
    for field in ("registration_endpoint", "jwks_uri", "revocation_endpoint"):
        if field in authorization_server and not is_https_url(
            authorization_server.get(field)
        ):
            raise AuditError(
                f"OAuth authorization-server metadata has invalid HTTPS {field}"
            )
    supports_cimd = (
        authorization_server.get("client_id_metadata_document_supported") is True
    )
    supports_dcr = is_https_url(authorization_server.get("registration_endpoint"))
    if not supports_cimd and not supports_dcr:
        raise AuditError(
            "OAuth authorization server must support CIMD or dynamic client "
            "registration"
        )
    token_auth_methods = authorization_server.get(
        "token_endpoint_auth_methods_supported"
    )
    if (
        not isinstance(token_auth_methods, list)
        or not token_auth_methods
        or not all(isinstance(method, str) for method in token_auth_methods)
        or len(token_auth_methods) != len(set(token_auth_methods))
        or not set(token_auth_methods).intersection(SUPPORTED_TOKEN_AUTH_METHODS)
    ):
        raise AuditError(
            "OAuth authorization server must advertise a supported token "
            "endpoint authentication method"
        )
    methods = authorization_server.get("code_challenge_methods_supported")
    if not isinstance(methods, list) or "S256" not in methods:
        raise AuditError("OAuth authorization server must advertise PKCE S256")
    grants = authorization_server.get("grant_types_supported")
    if not isinstance(grants, list) or "authorization_code" not in grants:
        raise AuditError(
            "OAuth authorization server must advertise authorization_code"
        )
    response_types = authorization_server.get("response_types_supported")
    if not isinstance(response_types, list) or "code" not in response_types:
        raise AuditError("OAuth authorization server must advertise code responses")
    scopes = authorization_server.get("scopes_supported")
    if (
        not isinstance(scopes, list)
        or not scopes
        or not all(isinstance(scope, str) and scope.strip() for scope in scopes)
        or len(scopes) != len(set(scopes))
    ):
        raise AuditError(
            "OAuth authorization server must advertise unique non-empty scopes"
        )
    return set(scopes)


def parse_bearer_parameters(challenge: str) -> dict[str, str]:
    normalized = challenge.strip().strip("'")
    scheme, separator, raw_parameters = normalized.partition(" ")
    if not separator or scheme.casefold() != "bearer":
        raise AuditError("authentication challenge must use the Bearer scheme")
    parameters: dict[str, str] = {}
    for match in AUTH_PARAMETER_PATTERN.finditer(raw_parameters):
        key = match.group(1).casefold()
        raw_value = match.group(2) if match.group(2) is not None else match.group(3)
        value = re.sub(r"\\(.)", r"\1", raw_value)
        if key in parameters:
            raise AuditError(f"authentication challenge repeats {key}")
        parameters[key] = value
    return parameters


def validate_bearer_parameters(
    challenge: str,
    *,
    require_runtime_error: bool,
) -> None:
    parameters = parse_bearer_parameters(challenge)
    if parameters.get("resource_metadata") != PROTECTED_RESOURCE_URL:
        raise AuditError(
            "authentication challenge has the wrong protected-resource URL"
        )
    if require_runtime_error:
        if not parameters.get("error") or not parameters.get("error_description"):
            raise AuditError(
                "tool-result authentication challenge must include error and "
                "error_description"
            )


def validate_tool_result_auth_challenge(payload: dict[str, Any]) -> None:
    if payload.get("jsonrpc") != "2.0" or payload.get("id") != "auth-probe":
        raise AuditError(
            "unauthenticated tool-result challenge must be matching JSON-RPC 2.0"
        )
    result = payload.get("result")
    if not isinstance(result, dict) or result.get("isError") is not True:
        raise AuditError(
            "unauthenticated read tool must return an MCP isError result"
        )
    result_meta = result.get("_meta")
    challenges = (
        result_meta.get("mcp/www_authenticate")
        if isinstance(result_meta, dict)
        else None
    )
    if isinstance(challenges, str):
        challenge_values = [challenges]
    elif isinstance(challenges, list) and all(
        isinstance(challenge, str) for challenge in challenges
    ):
        challenge_values = challenges
    else:
        raise AuditError(
            "unauthenticated read tool result lacks _meta[mcp/www_authenticate]"
        )
    if not challenge_values:
        raise AuditError(
            "unauthenticated read tool result has an empty authentication challenge"
        )

    failures: list[str] = []
    for challenge in challenge_values:
        try:
            validate_bearer_parameters(
                challenge,
                require_runtime_error=True,
            )
            return
        except AuditError as exc:
            failures.append(str(exc))
    raise AuditError(
        "no tool-result authentication challenge is complete: "
        + "; ".join(failures)
    )


def validate_unauthenticated_challenge(
    *,
    mcp_url: str,
    timeout: float,
) -> None:
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": "auth-probe",
            "method": "tools/call",
            "params": {"name": "list_api_endpoints", "arguments": {}},
        }
    ).encode("utf-8")
    request = Request(
        mcp_url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "User-Agent": "telnyx-codex-plugin-catalog-audit/0.1.0",
        },
    )
    try:
        with build_opener(RejectRedirects()).open(request, timeout=timeout) as response:
            response.read()
    except HTTPError as exc:
        if exc.code != 401:
            raise AuditError(
                f"unauthenticated MCP probe returned HTTP {exc.code}, expected 401"
            ) from exc
        challenge = exc.headers.get("WWW-Authenticate", "")
        validate_bearer_parameters(
            challenge,
            require_runtime_error=False,
        )
        try:
            raw_error_body = exc.read()
        except OSError as body_error:
            raise AuditError(
                "unauthenticated MCP probe body cannot be read"
            ) from body_error
        if not raw_error_body:
            raise AuditError(
                "unauthenticated MCP probe lacks the tool-result authentication "
                "challenge"
            ) from exc
        try:
            body_payload = parse_json_rpc_response(raw_error_body)
        except AuditError as body_error:
            raise AuditError(
                "unauthenticated MCP probe lacks a JSON-RPC tool-result "
                "authentication challenge"
            ) from body_error
        validate_tool_result_auth_challenge(body_payload)
        return
    except URLError as exc:
        raise AuditError("unauthenticated MCP probe failed") from exc
    raise AuditError("unauthenticated MCP probe unexpectedly succeeded")


def post_json_rpc(
    *,
    mcp_url: str,
    api_key: str,
    method: str,
    params: dict[str, Any],
    protocol_version: str | None,
    session_id: str | None,
    timeout: float,
    retries: int,
) -> tuple[dict[str, Any], str | None]:
    request_id = next(REQUEST_IDS)
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }
    ).encode("utf-8")
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "telnyx-codex-plugin-catalog-audit/0.1.0",
    }
    if protocol_version is not None:
        headers["MCP-Protocol-Version"] = protocol_version
    if session_id is not None:
        headers["MCP-Session-Id"] = session_id
    request = Request(
        mcp_url,
        data=body,
        method="POST",
        headers=headers,
    )
    opener = build_opener(RejectRedirects())

    for attempt in range(retries):
        try:
            with opener.open(request, timeout=timeout) as response:
                payload = parse_json_rpc_response(response.read())
                response_session_id = response.headers.get("MCP-Session-Id")
            break
        except HTTPError as exc:
            if exc.code == 401:
                raise AuditError("Telnyx rejected TELNYX_API_KEY") from exc
            if exc.code != 429 and exc.code < 500:
                raise AuditError(f"MCP request failed with HTTP {exc.code}") from exc
            if attempt + 1 == retries:
                raise AuditError(
                    f"MCP request failed with HTTP {exc.code} after {retries} attempts"
                ) from exc
            time.sleep(retry_delay(exc.headers, attempt))
        except URLError as exc:
            if attempt + 1 == retries:
                raise AuditError(
                    f"MCP network request failed after {retries} attempts"
                ) from exc
            time.sleep(retry_delay(None, attempt))
    else:  # pragma: no cover - loop always breaks or raises
        raise AuditError("MCP request exhausted retries")

    if payload.get("jsonrpc") != "2.0":
        raise AuditError("MCP response must use JSON-RPC 2.0")
    if payload.get("id") != request_id:
        raise AuditError("MCP response id does not match the request")
    if payload.get("error") is not None:
        error = payload["error"]
        code = error.get("code") if isinstance(error, dict) else "unknown"
        raise AuditError(f"MCP JSON-RPC error {code}")
    return payload, response_session_id


def send_initialized_notification(
    *,
    mcp_url: str,
    api_key: str,
    protocol_version: str,
    session_id: str | None,
    timeout: float,
    retries: int,
) -> None:
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {},
        }
    ).encode("utf-8")
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": protocol_version,
        "User-Agent": "telnyx-codex-plugin-catalog-audit/0.1.0",
    }
    if session_id is not None:
        headers["MCP-Session-Id"] = session_id
    request = Request(mcp_url, data=body, method="POST", headers=headers)
    opener = build_opener(RejectRedirects())

    for attempt in range(retries):
        try:
            with opener.open(request, timeout=timeout) as response:
                response.read()
            return
        except HTTPError as exc:
            if exc.code == 401:
                raise AuditError("Telnyx rejected TELNYX_API_KEY") from exc
            if exc.code != 429 and exc.code < 500:
                raise AuditError(
                    f"MCP initialized notification failed with HTTP {exc.code}"
                ) from exc
            if attempt + 1 == retries:
                raise AuditError(
                    "MCP initialized notification failed after retries"
                ) from exc
            time.sleep(retry_delay(exc.headers, attempt))
        except URLError as exc:
            if attempt + 1 == retries:
                raise AuditError(
                    "MCP initialized notification failed after retries"
                ) from exc
            time.sleep(retry_delay(None, attempt))


def initialize_client(
    *,
    mcp_url: str,
    api_key: str,
    timeout: float,
    retries: int,
) -> tuple[dict[str, Any], str | None]:
    payload, session_id = post_json_rpc(
        mcp_url=mcp_url,
        api_key=api_key,
        method="initialize",
        params={
            "protocolVersion": REQUESTED_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "telnyx-codex-plugin-catalog-audit",
                "version": "0.1.0",
            },
        },
        protocol_version=None,
        session_id=None,
        timeout=timeout,
        retries=retries,
    )
    result = payload.get("result")
    if not isinstance(result, dict):
        raise AuditError("MCP initialize response is missing result")
    protocol_version = result.get("protocolVersion")
    server_info = result.get("serverInfo")
    if not isinstance(protocol_version, str) or not protocol_version:
        raise AuditError("MCP initialize response is missing protocolVersion")
    if (
        not isinstance(server_info, dict)
        or server_info.get("name") != "telnyx_api"
    ):
        raise AuditError("MCP initialize response has unexpected serverInfo")
    send_initialized_notification(
        mcp_url=mcp_url,
        api_key=api_key,
        protocol_version=protocol_version,
        session_id=session_id,
        timeout=timeout,
        retries=retries,
    )
    return result, session_id


def call_tool(
    *,
    mcp_url: str,
    api_key: str,
    protocol_version: str,
    session_id: str | None,
    tool_name: str,
    arguments: dict[str, Any],
    timeout: float,
    retries: int,
) -> dict[str, Any]:
    payload, _ = post_json_rpc(
        mcp_url=mcp_url,
        api_key=api_key,
        method="tools/call",
        params={"name": tool_name, "arguments": arguments},
        protocol_version=protocol_version,
        session_id=session_id,
        timeout=timeout,
        retries=retries,
    )
    result = payload.get("result")
    if not isinstance(result, dict):
        raise AuditError("MCP tool response is missing result")
    if result.get("isError") is True:
        raise AuditError("MCP tool returned isError=true")
    content = result.get("content")
    if (
        not isinstance(content, list)
        or len(content) != 1
        or not isinstance(content[0], dict)
        or content[0].get("type") != "text"
        or not isinstance(content[0].get("text"), str)
    ):
        raise AuditError("MCP tool response must contain exactly one text block")
    try:
        decoded = strict_json_loads(content[0]["text"])
    except (json.JSONDecodeError, StrictJSONError) as exc:
        raise AuditError("MCP text block does not contain strict JSON") from exc
    if not isinstance(decoded, dict):
        raise AuditError("MCP text block JSON must be an object")
    return decoded


def index_federated_tools(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = payload.get("result")
    tools = result.get("tools") if isinstance(result, dict) else None
    if not isinstance(tools, list):
        raise AuditError("tools/list response must contain a tools array")
    indexed = {
        tool.get("name"): tool
        for tool in tools
        if isinstance(tool, dict) and isinstance(tool.get("name"), str)
    }
    if len(indexed) != len(tools):
        raise AuditError("tools/list contains duplicate or invalid tool names")
    return indexed


def partition_federated_tools(
    indexed: dict[str, dict[str, Any]],
    expected_root_annotations: dict[str, dict[str, bool]],
    expected_app_tools: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    expected_root_names = set(expected_root_annotations)
    expected_app_names = set(expected_app_tools)
    overlap = sorted(expected_root_names.intersection(expected_app_names))
    if overlap:
        raise AuditError(
            f"model-visible and app-only tool contracts overlap: {overlap}"
        )
    expected_names = expected_root_names.union(expected_app_names)
    actual_names = set(indexed)
    if actual_names != expected_names:
        missing = sorted(expected_names.difference(actual_names))
        unexpected = sorted(actual_names.difference(expected_names))
        raise AuditError(
            "live federated tool names changed: "
            f"missing={missing}, unexpected={unexpected}"
        )
    if len(expected_root_names) != EXPECTED_MODEL_VISIBLE_TOOL_COUNT:
        raise AuditError(
            "model-visible tool count changed: "
            f"actual={len(expected_root_names)}, "
            f"expected={EXPECTED_MODEL_VISIBLE_TOOL_COUNT}"
        )

    return (
        {name: indexed[name] for name in expected_root_names},
        {name: indexed[name] for name in expected_app_names},
    )


def validate_oauth_security_schemes(
    tool: dict[str, Any],
    *,
    tool_name: str,
    tool_class: str,
    supported_scopes: set[str],
    require_meta_mirror: bool,
) -> None:
    security_schemes = tool.get("securitySchemes")
    if not isinstance(security_schemes, list) or not security_schemes:
        raise AuditError(
            f"{tool_class} tool securitySchemes are missing: {tool_name}"
        )
    oauth_scopes: set[str] = set()
    for scheme in security_schemes:
        if not isinstance(scheme, dict) or scheme.get("type") != "oauth2":
            raise AuditError(
                f"{tool_class} tool must use OAuth 2 security only: {tool_name}"
            )
        scopes = scheme.get("scopes")
        if (
            not isinstance(scopes, list)
            or not scopes
            or not all(
                isinstance(scope, str) and scope.strip() for scope in scopes
            )
            or len(scopes) != len(set(scopes))
        ):
            raise AuditError(
                f"{tool_class} tool OAuth scopes are invalid: {tool_name}"
            )
        oauth_scopes.update(scopes)
    unsupported = sorted(oauth_scopes.difference(supported_scopes))
    if unsupported:
        raise AuditError(
            f"{tool_class} tool advertises unsupported OAuth scopes "
            f"{unsupported}: {tool_name}"
        )

    tool_meta = tool.get("_meta")
    if not isinstance(tool_meta, dict):
        tool_meta = {}
    legacy_schemes = tool_meta.get("securitySchemes")
    if require_meta_mirror and legacy_schemes != security_schemes:
        raise AuditError(
            f"{tool_class} tool securitySchemes compatibility mirror is "
            f"missing or different: {tool_name}"
        )
    if not require_meta_mirror and (
        legacy_schemes is not None and legacy_schemes != security_schemes
    ):
        raise AuditError(
            f"{tool_class} tool securitySchemes compatibility mirror differs: "
            f"{tool_name}"
        )


def validate_root_tool_schemas(
    tool: dict[str, Any],
    *,
    tool_name: str,
    tool_class: str,
) -> None:
    input_schema = tool.get("inputSchema")
    if not isinstance(input_schema, dict) or input_schema.get("type") != "object":
        raise AuditError(
            f"{tool_class} tool inputSchema must be an object schema: {tool_name}"
        )
    validate_json_schema_node(
        input_schema,
        path=f"{tool_name}.inputSchema",
        root=input_schema,
    )

    if "outputSchema" not in tool:
        return
    output_schema = tool["outputSchema"]
    if not isinstance(output_schema, dict) or output_schema.get("type") != "object":
        raise AuditError(
            f"{tool_class} tool outputSchema must be an object schema: {tool_name}"
        )
    validate_json_schema_node(
        output_schema,
        path=f"{tool_name}.outputSchema",
        root=output_schema,
    )


def validate_model_visible_tools(
    indexed: dict[str, dict[str, Any]],
    expected_annotations: dict[str, dict[str, bool]],
    supported_scopes: set[str],
) -> None:
    if set(indexed) != set(expected_annotations):
        raise AuditError(
            "live model-visible tool names differ from annotation justifications"
        )

    for tool_name, expected in expected_annotations.items():
        tool = indexed[tool_name]
        if not isinstance(tool.get("title"), str) or not tool["title"].strip():
            raise AuditError(f"model-visible tool title is empty: {tool_name}")
        if not isinstance(tool.get("description"), str) or not tool[
            "description"
        ].strip():
            raise AuditError(
                f"model-visible tool description is empty: {tool_name}"
            )
        validate_root_tool_schemas(
            tool,
            tool_name=tool_name,
            tool_class="model-visible",
        )
        annotations = tool.get("annotations")
        if not isinstance(annotations, dict):
            raise AuditError(
                f"model-visible tool annotations are missing: {tool_name}"
            )
        for field, expected_value in expected.items():
            if annotations.get(field) is not expected_value:
                raise AuditError(
                    f"model-visible tool {tool_name}.{field} changed: "
                    f"actual={annotations.get(field)!r}, "
                    f"expected={expected_value!r}"
                )
        if not isinstance(annotations.get("idempotentHint"), bool):
            raise AuditError(
                f"model-visible tool idempotentHint must be explicit: {tool_name}"
            )

        validate_oauth_security_schemes(
            tool,
            tool_name=tool_name,
            tool_class="model-visible",
            supported_scopes=supported_scopes,
            require_meta_mirror=False,
        )
        tool_meta = tool.get("_meta")
        if not isinstance(tool_meta, dict):
            tool_meta = {}
        ui_meta = tool_meta.get("ui")
        if isinstance(ui_meta, dict) and "visibility" in ui_meta:
            raise AuditError(
                f"model-visible tool must not declare app-only visibility: "
                f"{tool_name}"
            )

        resource_uri = (
            ui_meta.get("resourceUri") if isinstance(ui_meta, dict) else None
        )
        expected_resource_uri = EXPECTED_UI_RESOURCES.get(tool_name)
        if resource_uri != expected_resource_uri:
            raise AuditError(
                f"model-visible tool UI resource changed: {tool_name}; "
                f"actual={resource_uri!r}, expected={expected_resource_uri!r}"
            )

    invoke_description = indexed["invoke_api_endpoint"]["description"].lower()
    missing_risk_terms = sorted(
        term for term in INVOKE_RISK_TERMS if term not in invoke_description
    )
    if missing_risk_terms:
        raise AuditError(
            "invoke_api_endpoint description does not disclose "
            f"{', '.join(missing_risk_terms)} risk"
        )


def validate_constrained_output_schema(
    schema: Any,
    *,
    tool_name: str,
    path: str = "$",
) -> None:
    if not isinstance(schema, dict) or not schema:
        raise AuditError(
            f"app-only tool outputSchema is unconstrained at {path}: {tool_name}"
        )
    if path == "$":
        if schema.get("type") != "object":
            raise AuditError(
                f"app-only tool outputSchema must be an object: {tool_name}"
            )
        validate_json_schema_node(
            schema,
            path=f"{tool_name}.outputSchema",
            root=schema,
        )

    if schema.get("type") == "object":
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            raise AuditError(
                f"app-only tool outputSchema properties are invalid at "
                f"{path}: {tool_name}"
            )
        additional_properties = schema.get("additionalProperties")
        has_named_properties = bool(properties)
        has_typed_additional_properties = (
            isinstance(additional_properties, dict)
            and bool(additional_properties)
        )
        if not has_named_properties and not has_typed_additional_properties:
            raise AuditError(
                f"app-only tool outputSchema object is wildcard-only at "
                f"{path}: {tool_name}"
            )
        if path == "$" and (
            not has_named_properties or additional_properties is not False
        ):
            raise AuditError(
                f"app-only tool outputSchema must name fields and reject "
                f"undeclared top-level properties: {tool_name}"
            )
        if (
            path != "$"
            and not has_typed_additional_properties
            and additional_properties is not False
        ):
            raise AuditError(
                f"app-only tool outputSchema must reject undeclared "
                f"properties at {path}: {tool_name}"
            )

    if schema.get("type") == "array" and "items" not in schema:
        raise AuditError(
            f"app-only tool outputSchema array has unconstrained items at "
            f"{path}: {tool_name}"
        )

    for keyword in ("properties", "$defs", "definitions"):
        children = schema.get(keyword)
        if not isinstance(children, dict):
            continue
        for name, child in children.items():
            if isinstance(child, dict):
                validate_constrained_output_schema(
                    child,
                    tool_name=tool_name,
                    path=f"{path}.{keyword}.{name}",
                )
            elif child is True:
                raise AuditError(
                    f"app-only tool outputSchema allows any value at "
                    f"{path}.{keyword}.{name}: {tool_name}"
                )

    for keyword in (
        "items",
        "additionalProperties",
        "not",
        "if",
        "then",
        "else",
    ):
        child = schema.get(keyword)
        if isinstance(child, dict):
            validate_constrained_output_schema(
                child,
                tool_name=tool_name,
                path=f"{path}.{keyword}",
            )
        elif child is True:
            raise AuditError(
                f"app-only tool outputSchema allows any value at "
                f"{path}.{keyword}: {tool_name}"
            )

    for keyword in ("allOf", "anyOf", "oneOf", "prefixItems"):
        children = schema.get(keyword)
        if not isinstance(children, list):
            continue
        for index, child in enumerate(children):
            if isinstance(child, dict):
                validate_constrained_output_schema(
                    child,
                    tool_name=tool_name,
                    path=f"{path}.{keyword}[{index}]",
                )
            elif child is True:
                raise AuditError(
                    f"app-only tool outputSchema allows any value at "
                    f"{path}.{keyword}[{index}]: {tool_name}"
                )


def validate_app_tools(
    indexed: dict[str, dict[str, Any]],
    expected_tools: dict[str, dict[str, Any]],
    supported_scopes: set[str],
) -> None:
    if set(indexed) != set(expected_tools):
        raise AuditError("live app-only tool names differ from the reviewed contract")

    for tool_name, expected in expected_tools.items():
        tool = indexed[tool_name]
        for field in ("title", "description"):
            if tool.get(field) != expected[field]:
                raise AuditError(
                    f"app-only tool {tool_name}.{field} changed: "
                    f"actual={tool.get(field)!r}, expected={expected[field]!r}"
                )
        validate_root_tool_schemas(
            tool,
            tool_name=tool_name,
            tool_class="app-only",
        )
        validate_constrained_output_schema(
            tool.get("outputSchema"),
            tool_name=tool_name,
        )

        annotations = tool.get("annotations")
        if not isinstance(annotations, dict):
            raise AuditError(
                f"app-only tool annotations are missing: {tool_name}"
            )
        for field in ANNOTATION_FIELDS:
            expected_value = expected["annotations"][field]
            if annotations.get(field) is not expected_value:
                raise AuditError(
                    f"app-only tool {tool_name}.{field} changed: "
                    f"actual={annotations.get(field)!r}, "
                    f"expected={expected_value!r}"
                )

        expected_security_schemes = EXPECTED_APP_TOOL_WIRE_CONTRACT[
            "securitySchemes"
        ]
        if tool.get("securitySchemes") != expected_security_schemes:
            raise AuditError(
                f"app-only tool securitySchemes changed: {tool_name}"
            )
        tool_meta = tool.get("_meta")
        if not isinstance(tool_meta, dict):
            raise AuditError(
                f"app-only tool _meta is missing: {tool_name}"
            )
        expected_meta = EXPECTED_APP_TOOL_WIRE_CONTRACT["_meta"]
        if tool_meta.get("securitySchemes") != expected_meta["securitySchemes"]:
            raise AuditError(
                f"app-only tool _meta.securitySchemes changed: {tool_name}"
            )

        validate_oauth_security_schemes(
            tool,
            tool_name=tool_name,
            tool_class="app-only",
            supported_scopes=supported_scopes,
            require_meta_mirror=True,
        )
        ui_meta = tool_meta.get("ui") if isinstance(tool_meta, dict) else None
        visibility = (
            ui_meta.get("visibility") if isinstance(ui_meta, dict) else None
        )
        if visibility != expected_meta["ui"]["visibility"]:
            raise AuditError(
                f"app-only tool visibility must be exactly ['app']: {tool_name}"
            )


class UIHTMLReferenceParser(HTMLParser):
    """Collect network-capable URL references from an MCP Apps document."""

    RESOURCE_ATTRIBUTES = {
        "audio": ("src",),
        "base": ("href",),
        "embed": ("src",),
        "img": ("src", "srcset"),
        "input": ("src",),
        "link": ("href",),
        "object": ("data",),
        "script": ("src",),
        "source": ("src", "srcset"),
        "track": ("src",),
        "video": ("poster", "src"),
    }
    FRAME_ATTRIBUTES = {
        "frame": ("src",),
        "iframe": ("src",),
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: dict[str, list[str]] = {
            "connectDomains": [],
            "resourceDomains": [],
            "frameDomains": [],
        }
        self.script_chunks: list[str] = []
        self.style_chunks: list[str] = []
        self._script_depth = 0
        self._style_depth = 0

    @staticmethod
    def _attribute_values(name: str, value: str) -> list[str]:
        if name != "srcset":
            return [value]
        return [
            candidate.strip().split(maxsplit=1)[0]
            for candidate in value.split(",")
            if candidate.strip()
        ]

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        lowered_tag = tag.casefold()
        attributes = {
            name.casefold(): value
            for name, value in attrs
            if isinstance(value, str)
        }
        for attribute in self.RESOURCE_ATTRIBUTES.get(lowered_tag, ()):
            value = attributes.get(attribute)
            if value is not None:
                self.references["resourceDomains"].extend(
                    self._attribute_values(attribute, value)
                )
        for attribute in self.FRAME_ATTRIBUTES.get(lowered_tag, ()):
            value = attributes.get(attribute)
            if value is not None:
                self.references["frameDomains"].append(value)
        style = attributes.get("style")
        if style:
            self.style_chunks.append(style)
        if lowered_tag == "script":
            self._script_depth += 1
        elif lowered_tag == "style":
            self._style_depth += 1
        if lowered_tag == "iframe" and attributes.get("srcdoc"):
            nested = UIHTMLReferenceParser()
            nested.feed(attributes["srcdoc"])
            nested.close()
            for field, values in nested.references.items():
                self.references[field].extend(values)
            self.script_chunks.extend(nested.script_chunks)
            self.style_chunks.extend(nested.style_chunks)

    def handle_endtag(self, tag: str) -> None:
        lowered_tag = tag.casefold()
        if lowered_tag == "script" and self._script_depth:
            self._script_depth -= 1
        elif lowered_tag == "style" and self._style_depth:
            self._style_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._script_depth:
            self.script_chunks.append(data)
        if self._style_depth:
            self.style_chunks.append(data)


def referenced_origin(value: str, *, context: str) -> str | None:
    reference = value.strip()
    if reference.startswith("//"):
        raise AuditError(f"{context} uses a protocol-relative external URL")
    if not reference or reference.startswith(("#", "/", "./", "../")):
        return None
    parsed = urlparse(reference)
    if parsed.scheme.casefold() in {"about", "blob", "data", "ui"}:
        return None
    if parsed.scheme.casefold() != "https":
        raise AuditError(f"{context} uses a non-HTTPS external URL")
    if not is_https_url(reference):
        raise AuditError(f"{context} uses a non-public or invalid HTTPS URL")

    hostname = parsed.hostname
    if hostname is None:  # guarded by is_https_url
        raise AuditError(f"{context} uses an invalid HTTPS URL")
    host = f"[{hostname}]" if ":" in hostname else hostname
    port = parsed.port
    origin = f"https://{host}{f':{port}' if port is not None else ''}"
    if origin == EXPECTED_UI_DOMAIN:
        return None
    return origin


def referenced_ui_origins(
    html: str,
    *,
    resource_uri: str,
) -> dict[str, set[str]]:
    parser = UIHTMLReferenceParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as exc:  # noqa: BLE001 - normalize parser failures
        raise AuditError(
            f"UI resource HTML cannot be inspected: {resource_uri}"
        ) from exc

    for script in parser.script_chunks:
        for pattern in SCRIPT_CONNECT_PATTERNS:
            parser.references["connectDomains"].extend(
                match.group(1) for match in pattern.finditer(script)
            )
        for pattern in SCRIPT_RESOURCE_PATTERNS:
            parser.references["resourceDomains"].extend(
                match.group(1) for match in pattern.finditer(script)
            )
    for style in parser.style_chunks:
        parser.references["resourceDomains"].extend(
            match.group(1) for match in CSS_URL_PATTERN.finditer(style)
        )

    origins: dict[str, set[str]] = {
        "connectDomains": set(),
        "resourceDomains": set(),
        "frameDomains": set(),
    }
    for field, references in parser.references.items():
        for reference in references:
            origin = referenced_origin(
                reference,
                context=f"UI resource {resource_uri} {field}",
            )
            if origin is not None:
                origins[field].add(origin)
    return origins


def validate_ui_metadata(
    ui_meta: Any,
    *,
    resource_uri: str,
    html: str,
) -> None:
    if not isinstance(ui_meta, dict):
        raise AuditError(f"UI metadata is missing: {resource_uri}")
    if ui_meta.get("domain") != EXPECTED_UI_DOMAIN:
        raise AuditError(
            f"UI resource must use the reviewed component origin "
            f"{EXPECTED_UI_DOMAIN}: {resource_uri}"
        )
    if not is_https_origin(ui_meta["domain"]):
        raise AuditError(f"UI resource domain must be an HTTPS origin: {resource_uri}")

    csp = ui_meta.get("csp")
    if not isinstance(csp, dict):
        raise AuditError(f"UI resource CSP is missing: {resource_uri}")
    if not {"connectDomains", "resourceDomains"}.issubset(csp):
        raise AuditError(
            f"UI resource CSP must declare connectDomains and "
            f"resourceDomains: {resource_uri}"
        )
    unsupported_fields = sorted(set(csp).difference(SUPPORTED_CSP_FIELDS))
    if unsupported_fields:
        raise AuditError(
            f"UI resource CSP has unsupported fields {unsupported_fields}: "
            f"{resource_uri}"
        )
    for field, domains in csp.items():
        if (
            not isinstance(domains, list)
            or len(domains) != len(set(domains))
            or not all(is_https_origin(domain) for domain in domains)
        ):
            raise AuditError(
                f"UI resource CSP {field} must contain unique HTTPS origins: "
                f"{resource_uri}"
            )
    actual_origins = referenced_ui_origins(html, resource_uri=resource_uri)
    for field in SUPPORTED_CSP_FIELDS:
        declared = set(csp.get(field, []))
        actual = actual_origins[field]
        undeclared = sorted(actual.difference(declared))
        unused = sorted(declared.difference(actual))
        if undeclared:
            raise AuditError(
                f"UI resource CSP {field} omits referenced origins {undeclared}: "
                f"{resource_uri}"
            )
        if unused:
            raise AuditError(
                f"UI resource CSP {field} contains unused origins {unused}: "
                f"{resource_uri}"
            )


def validate_ui_semantics(*, resource_uri: str, html: str) -> None:
    markers = EXPECTED_UI_RESOURCE_MARKERS.get(resource_uri)
    if markers is None:
        raise AuditError(f"UI resource has no reviewed semantic contract: {resource_uri}")
    missing = [marker for marker in markers if marker not in html]
    if missing:
        raise AuditError(
            f"UI resource is missing reviewed interactive markers {missing}: "
            f"{resource_uri}"
        )


def validate_ui_resources(
    *,
    mcp_url: str,
    api_key: str,
    protocol_version: str,
    session_id: str | None,
    timeout: float,
    retries: int,
) -> None:
    payload, _ = post_json_rpc(
        mcp_url=mcp_url,
        api_key=api_key,
        method="resources/list",
        params={},
        protocol_version=protocol_version,
        session_id=session_id,
        timeout=timeout,
        retries=retries,
    )
    result = payload.get("result")
    resources = result.get("resources") if isinstance(result, dict) else None
    if not isinstance(resources, list):
        raise AuditError("resources/list response must contain a resources array")
    indexed = {
        resource.get("uri"): resource
        for resource in resources
        if isinstance(resource, dict) and isinstance(resource.get("uri"), str)
    }
    if len(indexed) != len(resources):
        raise AuditError("resources/list contains duplicate or invalid URIs")
    expected_uris = set(EXPECTED_UI_RESOURCE_URIS)
    if set(indexed) != expected_uris:
        raise AuditError("live UI resource URIs differ from the reviewed set")

    for resource_uri in sorted(expected_uris):
        listed = indexed[resource_uri]
        if listed.get("mimeType") != "text/html;profile=mcp-app":
            raise AuditError(f"UI resource MIME type is invalid: {resource_uri}")
        if not isinstance(listed.get("description"), str) or not listed[
            "description"
        ].strip():
            raise AuditError(f"UI resource description is empty: {resource_uri}")

        read_payload, _ = post_json_rpc(
            mcp_url=mcp_url,
            api_key=api_key,
            method="resources/read",
            params={"uri": resource_uri},
            protocol_version=protocol_version,
            session_id=session_id,
            timeout=timeout,
            retries=retries,
        )
        read_result = read_payload.get("result")
        contents = (
            read_result.get("contents") if isinstance(read_result, dict) else None
        )
        if (
            not isinstance(contents, list)
            or len(contents) != 1
            or not isinstance(contents[0], dict)
        ):
            raise AuditError(
                f"resources/read must return one content item: {resource_uri}"
            )
        content = contents[0]
        if (
            content.get("uri") != resource_uri
            or content.get("mimeType") != "text/html;profile=mcp-app"
            or not isinstance(content.get("text"), str)
            or not content["text"].strip()
        ):
            raise AuditError(f"resources/read content is invalid: {resource_uri}")
        validate_ui_semantics(resource_uri=resource_uri, html=content["text"])
        content_meta = content.get("_meta")
        if not isinstance(content_meta, dict):
            raise AuditError(
                f"resources/read content metadata is missing: {resource_uri}"
            )
        content_ui = content_meta.get("ui")
        validate_ui_metadata(
            content_ui,
            resource_uri=resource_uri,
            html=content["text"],
        )


def validate_server_card(
    card: dict[str, Any],
    initialize_result: dict[str, Any],
    root_tools: dict[str, dict[str, Any]],
) -> None:
    if card.get("serverUrl") != EXPECTED_MCP_URL:
        raise AuditError("server card has the wrong MCP URL")
    if card.get("serverInfo") != initialize_result.get("serverInfo"):
        raise AuditError("server card serverInfo differs from live initialize")
    if card.get("protocolVersion") != initialize_result.get("protocolVersion"):
        raise AuditError("server card protocolVersion differs from live initialize")

    live_capabilities = initialize_result.get("capabilities")
    card_capabilities = card.get("capabilities")
    if (
        not isinstance(live_capabilities, dict)
        or not isinstance(card_capabilities, dict)
    ):
        raise AuditError("server card and live initialize capabilities must be objects")
    if card_capabilities != live_capabilities:
        raise AuditError("server card capabilities differ from live initialize")
    if not isinstance(live_capabilities.get("resources"), dict):
        raise AuditError("server card and live initialize must advertise resources")

    live_instructions = initialize_result.get("instructions")
    card_instructions = card.get("instructions")
    if live_instructions != card_instructions:
        raise AuditError("server card instructions differ from live initialize")
    if live_instructions is not None and (
        not isinstance(live_instructions, str) or not live_instructions.strip()
    ):
        raise AuditError("live MCP server instructions must be a non-empty string")

    card_tools = card.get("tools")
    if not isinstance(card_tools, list):
        raise AuditError("server card tools must be an array")
    indexed_card_tools = {
        tool.get("name"): tool
        for tool in card_tools
        if isinstance(tool, dict) and isinstance(tool.get("name"), str)
    }
    if (
        len(indexed_card_tools) != len(card_tools)
        or set(indexed_card_tools) != set(root_tools)
    ):
        raise AuditError("server card tool names differ from live tools/list")
    for tool_name, live_tool in root_tools.items():
        card_tool = indexed_card_tools[tool_name]
        for field in (
            "title",
            "description",
            "inputSchema",
            "outputSchema",
            "annotations",
            "securitySchemes",
            "_meta",
        ):
            if card_tool.get(field) != live_tool.get(field):
                raise AuditError(
                    f"server card tool metadata differs from live tools/list: "
                    f"{tool_name}.{field}"
                )

    auth_text = json.dumps(card.get("auth", {}), sort_keys=True).lower()
    if "oauth" not in auth_text or "no oauth" in auth_text:
        raise AuditError("server card auth metadata contradicts live OAuth")
    mcp_apps = card.get("mcp_apps")
    availability = (
        mcp_apps.get("availability") if isinstance(mcp_apps, dict) else None
    )
    if availability not in {"ga", "production", "stable"}:
        raise AuditError("server card still marks MCP Apps as non-GA")


def validate_catalog(
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if set(payload) != {"tools"} or not isinstance(payload.get("tools"), list):
        raise AuditError("catalog must contain only a tools array")
    tools = payload["tools"]

    seen_names: set[str] = set()
    for index, tool in enumerate(tools):
        label = f"catalog entry {index + 1}"
        if not isinstance(tool, dict) or set(tool) != CATALOG_FIELDS:
            raise AuditError(f"{label} does not match the five-field catalog shape")
        for field in ("name", "description", "resource"):
            if not isinstance(tool[field], str) or not tool[field].strip():
                raise AuditError(f"{label}.{field} must be a non-empty string")
        if tool["name"] in seen_names:
            raise AuditError(f"duplicate catalog endpoint: {tool['name']}")
        seen_names.add(tool["name"])
        if tool["operation"] not in {"read", "write"}:
            raise AuditError(f"{label}.operation must be read or write")
        if not isinstance(tool["tags"], list) or not all(
            isinstance(tag, str) for tag in tool["tags"]
        ):
            raise AuditError(f"{label}.tags must be an array of strings")
    return tools


def resolve_json_pointer(root: dict[str, Any], pointer: str) -> Any:
    if pointer == "#":
        return root
    if not pointer.startswith("#/"):
        raise AuditError(f"schema uses a non-local $ref: {pointer}")
    current: Any = root
    for raw_segment in pointer[2:].split("/"):
        segment = raw_segment.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and segment in current:
            current = current[segment]
            continue
        if isinstance(current, list) and segment.isdigit():
            index = int(segment)
            if index < len(current):
                current = current[index]
                continue
        raise AuditError(f"schema $ref does not resolve: {pointer}")
    return current


def validate_json_schema_node(
    schema: Any,
    *,
    path: str,
    root: dict[str, Any],
    active_refs: set[str] | None = None,
) -> None:
    if active_refs is None:
        active_refs = set()
    if isinstance(schema, bool):
        return
    if not isinstance(schema, dict):
        raise AuditError(f"{path} must be a JSON Schema object or boolean")

    if "$ref" in schema:
        reference = schema["$ref"]
        if not isinstance(reference, str) or not reference:
            raise AuditError(f"{path}.$ref must be a non-empty string")
        referenced_schema = resolve_json_pointer(root, reference)
        if reference not in active_refs:
            active_refs.add(reference)
            try:
                validate_json_schema_node(
                    referenced_schema,
                    path=f"{path}.$ref[{reference!r}]",
                    root=root,
                    active_refs=active_refs,
                )
            finally:
                active_refs.remove(reference)

    allowed_types = {
        "array",
        "boolean",
        "integer",
        "null",
        "number",
        "object",
        "string",
    }
    schema_type = schema.get("type")
    if schema_type is not None:
        types = schema_type if isinstance(schema_type, list) else [schema_type]
        if (
            not types
            or not all(isinstance(value, str) for value in types)
            or len(types) != len(set(types))
            or not set(types).issubset(allowed_types)
        ):
            raise AuditError(f"{path}.type is invalid")

    for field in ("title", "description", "format", "$id", "$schema"):
        if field in schema and not isinstance(schema[field], str):
            raise AuditError(f"{path}.{field} must be a string")
    if "pattern" in schema:
        if not isinstance(schema["pattern"], str):
            raise AuditError(f"{path}.pattern must be a string")
        try:
            re.compile(schema["pattern"])
        except re.error as exc:
            raise AuditError(f"{path}.pattern is invalid") from exc

    for field in (
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minProperties",
        "maxProperties",
    ):
        value = schema.get(field)
        if value is not None and (
            not isinstance(value, int) or isinstance(value, bool) or value < 0
        ):
            raise AuditError(f"{path}.{field} must be a non-negative integer")
    for minimum_field, maximum_field in (
        ("minLength", "maxLength"),
        ("minItems", "maxItems"),
        ("minProperties", "maxProperties"),
    ):
        if (
            minimum_field in schema
            and maximum_field in schema
            and schema[minimum_field] > schema[maximum_field]
        ):
            raise AuditError(
                f"{path}.{minimum_field} exceeds {maximum_field}"
            )

    for field in (
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
    ):
        value = schema.get(field)
        if value is not None and (
            not isinstance(value, (int, float)) or isinstance(value, bool)
        ):
            raise AuditError(f"{path}.{field} must be numeric")
    if schema.get("multipleOf") is not None and schema["multipleOf"] <= 0:
        raise AuditError(f"{path}.multipleOf must be positive")
    if (
        "minimum" in schema
        and "maximum" in schema
        and schema["minimum"] > schema["maximum"]
    ):
        raise AuditError(f"{path}.minimum exceeds maximum")

    enum_values = schema.get("enum")
    if enum_values is not None:
        if not isinstance(enum_values, list) or not enum_values:
            raise AuditError(f"{path}.enum must be a non-empty array")
        canonical_values = [
            json.dumps(value, sort_keys=True, separators=(",", ":"))
            for value in enum_values
        ]
        if len(canonical_values) != len(set(canonical_values)):
            raise AuditError(f"{path}.enum contains duplicates")

    required = schema.get("required")
    if required is not None and (
        not isinstance(required, list)
        or not all(isinstance(field, str) for field in required)
        or len(required) != len(set(required))
    ):
        raise AuditError(f"{path}.required must be a unique string array")

    for field in (
        "properties",
        "patternProperties",
        "definitions",
        "$defs",
        "dependentSchemas",
    ):
        children = schema.get(field)
        if children is None:
            continue
        if not isinstance(children, dict) or not all(
            isinstance(name, str) for name in children
        ):
            raise AuditError(f"{path}.{field} must be an object")
        for name, child in children.items():
            validate_json_schema_node(
                child,
                path=f"{path}.{field}[{name!r}]",
                root=root,
                active_refs=active_refs,
            )

    for field in (
        "additionalProperties",
        "additionalItems",
        "contains",
        "propertyNames",
        "not",
        "if",
        "then",
        "else",
        "unevaluatedProperties",
    ):
        child = schema.get(field)
        if child is not None:
            validate_json_schema_node(
                child,
                path=f"{path}.{field}",
                root=root,
                active_refs=active_refs,
            )

    items = schema.get("items")
    if isinstance(items, list):
        if not items:
            raise AuditError(f"{path}.items tuple schema must not be empty")
        for index, child in enumerate(items):
            validate_json_schema_node(
                child,
                path=f"{path}.items[{index}]",
                root=root,
                active_refs=active_refs,
            )
    elif items is not None:
        validate_json_schema_node(
            items,
            path=f"{path}.items",
            root=root,
            active_refs=active_refs,
        )

    for field in ("allOf", "anyOf", "oneOf", "prefixItems"):
        children = schema.get(field)
        if children is None:
            continue
        if not isinstance(children, list) or not children:
            raise AuditError(f"{path}.{field} must be a non-empty array")
        for index, child in enumerate(children):
            validate_json_schema_node(
                child,
                path=f"{path}.{field}[{index}]",
                root=root,
                active_refs=active_refs,
            )

    dependencies = schema.get("dependencies")
    if dependencies is not None:
        if not isinstance(dependencies, dict):
            raise AuditError(f"{path}.dependencies must be an object")
        for name, dependency in dependencies.items():
            dependency_path = f"{path}.dependencies[{name!r}]"
            if isinstance(dependency, list):
                if (
                    not dependency
                    or not all(isinstance(field, str) for field in dependency)
                    or len(dependency) != len(set(dependency))
                ):
                    raise AuditError(
                        f"{dependency_path} must be a unique non-empty string array"
                    )
            else:
                validate_json_schema_node(
                    dependency,
                    path=dependency_path,
                    root=root,
                    active_refs=active_refs,
                )

    dependent_required = schema.get("dependentRequired")
    if dependent_required is not None:
        if not isinstance(dependent_required, dict):
            raise AuditError(f"{path}.dependentRequired must be an object")
        for name, fields in dependent_required.items():
            if (
                not isinstance(fields, list)
                or not fields
                or not all(isinstance(field, str) for field in fields)
                or len(fields) != len(set(fields))
            ):
                raise AuditError(
                    f"{path}.dependentRequired[{name!r}] must be a unique "
                    "non-empty string array"
                )


def normalized_semantic_text(value: str) -> str:
    return " ".join(re.sub(r"[_/.:+-]+", " ", value.casefold()).split())


def unnegated_pattern_evidence(
    patterns: tuple[re.Pattern[str], ...],
    catalog_tool: dict[str, Any],
) -> str | None:
    identity_text = normalized_semantic_text(
        " ".join(
            [
                catalog_tool["name"],
                catalog_tool["resource"],
                *catalog_tool["tags"],
            ]
        )
    )
    for pattern in patterns:
        match = pattern.search(identity_text)
        if match:
            return match.group(0)

    description = normalized_semantic_text(catalog_tool["description"])
    for pattern in patterns:
        for match in pattern.finditer(description):
            preceding = description[max(0, match.start() - 48) : match.start()]
            if NEGATION_PATTERN.search(preceding) is None:
                return match.group(0)
    return None


def validate_annotation_semantics(
    catalog_tool: dict[str, Any],
    annotations: dict[str, Any],
) -> None:
    operation = catalog_tool["operation"]
    endpoint_name = catalog_tool["name"]
    if operation == "read":
        expected_read_hints = {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        }
        mismatches = {
            field: (annotations.get(field), expected)
            for field, expected in expected_read_hints.items()
            if annotations.get(field) is not expected
        }
        if mismatches:
            raise AuditError(
                f"read endpoint annotations are semantically inconsistent "
                f"{mismatches}: {endpoint_name}"
            )
        return

    destructive_evidence = unnegated_pattern_evidence(
        DESTRUCTIVE_ENDPOINT_PATTERNS,
        catalog_tool,
    )
    if destructive_evidence and annotations.get("destructiveHint") is not True:
        raise AuditError(
            f"write endpoint has irreversible-action evidence "
            f"{destructive_evidence!r} but destructiveHint is false: "
            f"{endpoint_name}"
        )
    open_world_evidence = unnegated_pattern_evidence(
        OPEN_WORLD_ENDPOINT_PATTERNS,
        catalog_tool,
    )
    if open_world_evidence and annotations.get("openWorldHint") is not True:
        raise AuditError(
            f"write endpoint has external-action evidence "
            f"{open_world_evidence!r} but openWorldHint is false: "
            f"{endpoint_name}"
        )


def validate_schema(
    *,
    mcp_url: str,
    api_key: str,
    protocol_version: str,
    session_id: str | None,
    catalog_tool: dict[str, Any],
    timeout: float,
    retries: int,
) -> None:
    endpoint_name = catalog_tool["name"]
    payload = call_tool(
        mcp_url=mcp_url,
        api_key=api_key,
        protocol_version=protocol_version,
        session_id=session_id,
        tool_name="get_api_endpoint_schema",
        arguments={"endpoint": endpoint_name},
        timeout=timeout,
        retries=retries,
    )
    if payload.get("name") != endpoint_name:
        raise AuditError("schema name does not match the catalog")
    if payload.get("description") != catalog_tool["description"]:
        raise AuditError("schema description does not match the catalog")

    input_schema = payload.get("inputSchema")
    if not isinstance(input_schema, dict) or input_schema.get("type") != "object":
        raise AuditError("inputSchema must be an object schema")
    validate_json_schema_node(
        input_schema,
        path=f"{endpoint_name}.inputSchema",
        root=input_schema,
    )
    properties = input_schema.get("properties")
    if not isinstance(properties, dict):
        raise AuditError("inputSchema.properties must be an object")
    required = input_schema.get("required", [])
    if (
        not isinstance(required, list)
        or not all(isinstance(field, str) for field in required)
        or len(required) != len(set(required))
    ):
        raise AuditError("inputSchema.required must be a unique string array")
    unknown_required = sorted(set(required).difference(properties))
    if unknown_required:
        raise AuditError(
            f"inputSchema.required contains unknown properties: {unknown_required}"
        )

    annotations = payload.get("annotations")
    if not isinstance(annotations, dict):
        raise AuditError("annotations must be an object")
    for field in (
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
    ):
        if not isinstance(annotations.get(field), bool):
            raise AuditError(f"annotations.{field} must be explicit")
    read_only = annotations.get("readOnlyHint")
    if catalog_tool["operation"] == "read" and read_only is not True:
        raise AuditError("read endpoint must set readOnlyHint=true")
    if catalog_tool["operation"] == "write" and read_only is True:
        raise AuditError("write endpoint must not set readOnlyHint=true")
    validate_annotation_semantics(catalog_tool, annotations)


def expect_audit_error(label: str, callback: Any) -> None:
    try:
        callback()
    except AuditError:
        return
    raise AuditError(f"self-test expected an AuditError: {label}")


def expect_strict_json_error(label: str, document: str) -> None:
    try:
        strict_json_loads(document)
    except StrictJSONError:
        return
    except json.JSONDecodeError as exc:
        raise AuditError(
            f"self-test used syntactically invalid JSON instead of {label}"
        ) from exc
    raise AuditError(f"self-test accepted {label}")


def run_self_tests() -> None:
    expected_root_contract = load_expected_root_annotations()
    if len(expected_root_contract) != EXPECTED_MODEL_VISIBLE_TOOL_COUNT:
        raise AuditError("self-test model-visible tool fixture count changed")
    expected_app_contract = load_expected_app_tools()
    if len(expected_app_contract) != EXPECTED_APP_ONLY_TOOL_COUNT:
        raise AuditError("self-test app-only tool fixture count changed")
    if set(EXPECTED_UI_RESOURCE_MARKERS) != set(EXPECTED_UI_RESOURCE_URIS):
        raise AuditError("self-test UI resource semantic contract changed")
    synthetic_federated_tools = {
        name: {"name": name}
        for name in {
            *expected_root_contract,
            *expected_app_contract,
        }
    }
    model_visible_tools, app_only_tools = partition_federated_tools(
        synthetic_federated_tools,
        expected_root_contract,
        expected_app_contract,
    )
    if (
        len(model_visible_tools) != EXPECTED_MODEL_VISIBLE_TOOL_COUNT
        or len(app_only_tools) != EXPECTED_APP_ONLY_TOOL_COUNT
    ):
        raise AuditError("self-test federated tool partition changed")
    expect_audit_error(
        "unexpected federated tool",
        lambda: partition_federated_tools(
            {
                **synthetic_federated_tools,
                "unexpected_tool": {"name": "unexpected_tool"},
            },
            expected_root_contract,
            expected_app_contract,
        ),
    )

    validate_api_key("KEY0123456789")
    expect_audit_error(
        "API key header injection",
        lambda: validate_api_key("secret\r\nInjected: value"),
    )
    if strict_json_loads('{"nested":{"value":1.5},"enabled":true}') != {
        "nested": {"value": 1.5},
        "enabled": True,
    }:
        raise AuditError("self-test strict JSON decoder changed valid JSON")
    for label, document in (
        ("NaN", '{"value":NaN}'),
        ("positive Infinity", '{"value":Infinity}'),
        ("negative Infinity", '{"value":-Infinity}'),
        ("overflowing finite-number syntax", '{"value":1e9999}'),
        ("duplicate object members", '{"value":1,"value":2}'),
        (
            "nested duplicate object members",
            '{"outer":{"value":1,"value":2}}',
        ),
    ):
        expect_strict_json_error(label, document)
        expect_audit_error(
            f"MCP response {label}",
            lambda document=document: parse_json_rpc_response(
                document.encode("utf-8")
            ),
        )
    valid_json_rpc = '{"jsonrpc":"2.0","id":1,"result":{}}'
    for label, invalid_frame in (
        ("NaN SSE frame", '{"jsonrpc":"2.0","id":1,"result":{"value":NaN}}'),
        (
            "duplicate-member SSE frame",
            '{"jsonrpc":"2.0","id":1,"result":{},"result":{}}',
        ),
    ):
        for order, frames in (
            ("before", (invalid_frame, valid_json_rpc)),
            ("after", (valid_json_rpc, invalid_frame)),
        ):
            mixed_sse = "".join(
                f"event: message\ndata: {frame}\n\n" for frame in frames
            )
            expect_audit_error(
                f"{label} {order} valid frame",
                lambda mixed_sse=mixed_sse: parse_json_rpc_response(
                    mixed_sse.encode("utf-8")
                ),
            )

    recursive_schema: dict[str, Any] = {
        "type": "object",
        "properties": {"next": {"$ref": "#/$defs/node"}},
        "$defs": {
            "node": {
                "type": "object",
                "properties": {"next": {"$ref": "#/$defs/node"}},
            }
        },
    }
    validate_json_schema_node(
        recursive_schema,
        path="recursiveSchema",
        root=recursive_schema,
    )
    malformed_ref_target = {
        "type": "object",
        "properties": {"value": {"$ref": "#/type"}},
    }
    expect_audit_error(
        "non-schema $ref target",
        lambda: validate_json_schema_node(
            malformed_ref_target,
            path="malformedRefTarget",
            root=malformed_ref_target,
        ),
    )
    for unsafe_url in (
        "https://user:secret@example.com/token",
        "https://127.0.0.1/token",
        "https://169.254.169.254/token",
        "https://[::1]/token",
        "https://localhost/token",
        "https://service.internal/token",
    ):
        if is_https_url(unsafe_url):
            raise AuditError(f"self-test accepted a non-public URL: {unsafe_url}")
    if not is_https_url("https://api.telnyx.com/oauth/token"):
        raise AuditError("self-test rejected a public Telnyx HTTPS URL")

    protected_resource = {
        "resource": EXPECTED_MCP_URL,
        "authorization_servers": [EXPECTED_AUTHORIZATION_SERVER],
        "bearer_methods_supported": ["header"],
    }
    authorization_server = {
        "issuer": EXPECTED_AUTHORIZATION_SERVER,
        "authorization_endpoint": "https://api.telnyx.com/oauth/authorize",
        "token_endpoint": "https://api.telnyx.com/oauth/token",
        "registration_endpoint": "https://api.telnyx.com/oauth/register",
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "code_challenge_methods_supported": ["S256"],
        "grant_types_supported": ["authorization_code"],
        "response_types_supported": ["code"],
        "scopes_supported": ["mcp.read"],
    }
    if validate_oauth_metadata(protected_resource, authorization_server) != {
        "mcp.read"
    }:
        raise AuditError("self-test OAuth scopes changed")
    unsafe_authorization_server = dict(authorization_server)
    unsafe_authorization_server["token_endpoint"] = (
        "https://user:secret@api.telnyx.com/oauth/token"
    )
    expect_audit_error(
        "OAuth endpoint userinfo",
        lambda: validate_oauth_metadata(
            protected_resource,
            unsafe_authorization_server,
        ),
    )

    runtime_challenge = (
        f'Bearer resource_metadata="{PROTECTED_RESOURCE_URL}", '
        'error="invalid_token", error_description="Login required"'
    )
    validate_tool_result_auth_challenge(
        {
            "jsonrpc": "2.0",
            "id": "auth-probe",
            "result": {
                "content": [
                    {"type": "text", "text": "Authentication required"}
                ],
                "_meta": {"mcp/www_authenticate": [runtime_challenge]},
                "isError": True,
            },
        }
    )
    expect_audit_error(
        "runtime challenge missing error_description",
        lambda: validate_bearer_parameters(
            f'Bearer resource_metadata="{PROTECTED_RESOURCE_URL}", '
            'error="invalid_token"',
            require_runtime_error=True,
        ),
    )

    inline_ui_meta = {
        "domain": EXPECTED_UI_DOMAIN,
        "csp": {
            "connectDomains": [],
            "resourceDomains": [],
            "frameDomains": [],
        },
    }
    validate_ui_metadata(
        inline_ui_meta,
        resource_uri="ui://self-test/inline.html",
        html=(
            "<main>Inline only</main><script>const value = 1;</script>"
            f'<img src="{EXPECTED_UI_DOMAIN}/self.png">'
        ),
    )
    external_ui_meta = {
        "domain": EXPECTED_UI_DOMAIN,
        "csp": {
            "connectDomains": ["https://api.telnyx.com"],
            "resourceDomains": ["https://developers.telnyx.com"],
            "frameDomains": ["https://support.telnyx.com"],
        },
    }
    validate_ui_metadata(
        external_ui_meta,
        resource_uri="ui://self-test/external.html",
        html=(
            '<script>fetch("https://api.telnyx.com/v2/status")</script>'
            '<img src="https://developers.telnyx.com/logo.png">'
            '<iframe src="https://support.telnyx.com/help"></iframe>'
        ),
    )
    expect_audit_error(
        "undeclared UI origin",
        lambda: validate_ui_metadata(
            inline_ui_meta,
            resource_uri="ui://self-test/undeclared.html",
            html='<script src="https://developers.telnyx.com/app.js"></script>',
        ),
    )
    expect_audit_error(
        "unused UI allowlist",
        lambda: validate_ui_metadata(
            external_ui_meta,
            resource_uri="ui://self-test/unused.html",
            html="<main>No external requests</main>",
        ),
    )
    validate_ui_semantics(
        resource_uri="ui://number-intelligence/index.html",
        html=(
            "<button>Analyze</button><script>"
            'window.parent.postMessage({method:"tools/call"}, "*");'
            'window.addEventListener("message", () => '
            '"number_intelligence_analyze");'
            "</script>"
        ),
    )
    expect_audit_error(
        "placeholder UI resource",
        lambda: validate_ui_semantics(
            resource_uri="ui://number-intelligence/index.html",
            html="<main>Open the Number Intelligence app.</main>",
        ),
    )

    root_tool_name = "invoke_api_endpoint"
    root_annotations = {
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": False,
        "openWorldHint": True,
    }
    root_expected_annotations = {
        "readOnlyHint": False,
        "destructiveHint": True,
        "openWorldHint": True,
    }
    root_tool = {
        "name": root_tool_name,
        "title": "Invoke API endpoint",
        "description": (
            "Invoke an endpoint that may send a message, place a call, "
            "purchase, charge, or delete resources."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "endpoint": {"type": "string"},
                "payload": {
                    "type": "object",
                    "additionalProperties": True,
                },
            },
            "required": ["endpoint"],
        },
        "outputSchema": {
            "type": "object",
            "properties": {
                "data": {
                    "type": "object",
                    "additionalProperties": True,
                }
            },
        },
        "annotations": root_annotations,
        "securitySchemes": [{"type": "oauth2", "scopes": ["mcp.read"]}],
        "_meta": {},
    }
    validate_model_visible_tools(
        {root_tool_name: root_tool},
        {root_tool_name: root_expected_annotations},
        {"mcp.read"},
    )
    root_tool_with_malformed_input = {
        **root_tool,
        "inputSchema": {
            "type": "object",
            "properties": {
                "endpoint": {"type": "definitely-not-a-json-schema-type"}
            },
        },
    }
    expect_audit_error(
        "malformed model-visible root inputSchema",
        lambda: validate_model_visible_tools(
            {root_tool_name: root_tool_with_malformed_input},
            {root_tool_name: root_expected_annotations},
            {"mcp.read"},
        ),
    )
    root_tool_with_malformed_output = {
        **root_tool,
        "outputSchema": {
            "type": "object",
            "properties": {
                "data": {"type": "definitely-not-a-json-schema-type"}
            },
        },
    }
    expect_audit_error(
        "malformed model-visible root outputSchema",
        lambda: validate_model_visible_tools(
            {root_tool_name: root_tool_with_malformed_output},
            {root_tool_name: root_expected_annotations},
            {"mcp.read"},
        ),
    )

    live_tool = {
        "name": "list_widgets",
        "title": "List widgets",
        "description": "List private widgets.",
        "inputSchema": {"type": "object", "properties": {}},
        "outputSchema": {"type": "object"},
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
        "securitySchemes": [{"type": "oauth2", "scopes": ["mcp.read"]}],
        "_meta": {},
    }
    app_annotations = {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    }
    app_security_schemes = [{"type": "oauth2", "scopes": ["admin"]}]
    app_tool = {
        "name": "app_list_widgets",
        "title": "List app widgets",
        "description": "List private widgets for the bundled app.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "outputSchema": {
            "type": "object",
            "properties": {
                "widgets": {
                    "type": "array",
                    "items": {"type": "string"},
                }
            },
            "required": ["widgets"],
            "additionalProperties": False,
        },
        "annotations": app_annotations,
        "securitySchemes": app_security_schemes,
        "_meta": {
            "securitySchemes": app_security_schemes,
            "ui": {"visibility": ["app"]},
        },
    }
    expected_app_tool = {
        "name": app_tool["name"],
        "title": app_tool["title"],
        "description": app_tool["description"],
        "annotations": app_annotations,
    }
    validate_app_tools(
        {app_tool["name"]: app_tool},
        {app_tool["name"]: expected_app_tool},
        {"admin"},
    )
    app_tool_with_malformed_input = {
        **app_tool,
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "definitely-not-a-json-schema-type"}
            },
            "additionalProperties": False,
        },
    }
    expect_audit_error(
        "malformed app-only root inputSchema",
        lambda: validate_app_tools(
            {app_tool["name"]: app_tool_with_malformed_input},
            {app_tool["name"]: expected_app_tool},
            {"admin"},
        ),
    )
    app_tool_without_visibility = {
        **app_tool,
        "_meta": {"securitySchemes": app_security_schemes, "ui": {}},
    }
    expect_audit_error(
        "app-only tool missing visibility",
        lambda: validate_app_tools(
            {app_tool["name"]: app_tool_without_visibility},
            {app_tool["name"]: expected_app_tool},
            {"admin"},
        ),
    )
    app_tool_without_security_mirror = {
        **app_tool,
        "_meta": {"ui": {"visibility": ["app"]}},
    }
    expect_audit_error(
        "app-only tool missing security mirror",
        lambda: validate_app_tools(
            {app_tool["name"]: app_tool_without_security_mirror},
            {app_tool["name"]: expected_app_tool},
            {"admin"},
        ),
    )
    alternate_security_schemes = [
        {"type": "oauth2", "scopes": ["mcp.read"]}
    ]
    app_tool_with_supported_security_drift = {
        **app_tool,
        "securitySchemes": alternate_security_schemes,
        "_meta": {
            "securitySchemes": alternate_security_schemes,
            "ui": {"visibility": ["app"]},
        },
    }
    expect_audit_error(
        "app-only tool exact security contract drift",
        lambda: validate_app_tools(
            {app_tool["name"]: app_tool_with_supported_security_drift},
            {app_tool["name"]: expected_app_tool},
            {"admin", "mcp.read"},
        ),
    )
    app_tool_with_open_output = {
        **app_tool,
        "outputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": True,
        },
    }
    expect_audit_error(
        "app-only tool unconstrained output",
        lambda: validate_app_tools(
            {app_tool["name"]: app_tool_with_open_output},
            {app_tool["name"]: expected_app_tool},
            {"admin"},
        ),
    )
    app_tool_with_title_drift = {
        **app_tool,
        "title": "Unexpected title",
    }
    expect_audit_error(
        "app-only tool title drift",
        lambda: validate_app_tools(
            {app_tool["name"]: app_tool_with_title_drift},
            {app_tool["name"]: expected_app_tool},
            {"admin"},
        ),
    )
    initialize_result = {
        "protocolVersion": REQUESTED_PROTOCOL_VERSION,
        "serverInfo": {"name": "telnyx_api", "version": "self-test"},
        "capabilities": {"tools": {}, "resources": {}},
        "instructions": "Use Telnyx tools only for explicit user requests.",
    }
    server_card = {
        "serverUrl": EXPECTED_MCP_URL,
        "protocolVersion": REQUESTED_PROTOCOL_VERSION,
        "serverInfo": initialize_result["serverInfo"],
        "capabilities": initialize_result["capabilities"],
        "instructions": initialize_result["instructions"],
        "tools": [live_tool, app_tool],
        "auth": {"type": "oauth2"},
        "mcp_apps": {"availability": "stable"},
    }
    validate_server_card(
        server_card,
        initialize_result,
        {
            "list_widgets": live_tool,
            "app_list_widgets": app_tool,
        },
    )
    stale_card = dict(server_card)
    stale_card["capabilities"] = {"resources": {}}
    expect_audit_error(
        "stale server-card capabilities",
        lambda: validate_server_card(
            stale_card,
            initialize_result,
            {
                "list_widgets": live_tool,
                "app_list_widgets": app_tool,
            },
        ),
    )

    read_tool = {
        "name": "list_widgets",
        "description": "List private widgets.",
        "resource": "widgets",
        "operation": "read",
        "tags": ["widgets"],
    }
    validate_annotation_semantics(
        read_tool,
        {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    )
    expect_audit_error(
        "read endpoint marked destructive",
        lambda: validate_annotation_semantics(
            read_tool,
            {
                "readOnlyHint": True,
                "destructiveHint": True,
                "idempotentHint": True,
                "openWorldHint": False,
            },
        ),
    )
    send_tool = {
        "name": "send_sms_message",
        "description": "Send an SMS message to an external recipient.",
        "resource": "messages",
        "operation": "write",
        "tags": ["messaging"],
    }
    expect_audit_error(
        "outbound message annotations",
        lambda: validate_annotation_semantics(
            send_tool,
            {
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
        ),
    )
    validate_annotation_semantics(
        send_tool,
        {
            "readOnlyHint": False,
            "destructiveHint": True,
            "idempotentHint": False,
            "openWorldHint": True,
        },
    )
    preview_tool = {
        "name": "preview_message_cost",
        "description": "Preview cost; this does not send a message.",
        "resource": "messages",
        "operation": "write",
        "tags": ["messaging"],
    }
    validate_annotation_semantics(
        preview_tool,
        {
            "readOnlyHint": False,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    )


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_tests()
        print("Hosted MCP catalog validator self-tests passed.")
        return
    if not 1 <= args.workers <= 12:
        raise AuditError("--workers must be between 1 and 12")
    if args.timeout <= 0:
        raise AuditError("--timeout must be positive")
    if args.retries < 1:
        raise AuditError("--retries must be positive")

    api_key = os.environ.get("TELNYX_API_KEY")
    if not api_key:
        raise AuditError("TELNYX_API_KEY is required")
    validate_api_key(api_key)
    mcp_url = load_mcp_url()
    expected_root_annotations = load_expected_root_annotations()
    expected_app_tools = load_expected_app_tools()
    initialize_result, session_id = initialize_client(
        mcp_url=mcp_url,
        api_key=api_key,
        timeout=args.timeout,
        retries=args.retries,
    )
    protocol_version = initialize_result["protocolVersion"]
    federated_tools_payload, _ = post_json_rpc(
        mcp_url=mcp_url,
        api_key=api_key,
        method="tools/list",
        params={},
        protocol_version=protocol_version,
        session_id=session_id,
        timeout=args.timeout,
        retries=args.retries,
    )
    federated_tools = index_federated_tools(federated_tools_payload)

    review_failures: list[tuple[str, str]] = []
    model_visible_tools = {
        name: federated_tools[name]
        for name in expected_root_annotations
        if name in federated_tools
    }
    app_only_tools = {
        name: federated_tools[name]
        for name in expected_app_tools
        if name in federated_tools
    }
    try:
        model_visible_tools, app_only_tools = partition_federated_tools(
            federated_tools,
            expected_root_annotations,
            expected_app_tools,
        )
    except AuditError as exc:
        review_failures.append(("federated tool inventory", str(exc)))

    documents: dict[str, dict[str, Any]] = {}
    for label, url in (
        ("server card", SERVER_CARD_URL),
        ("protected-resource metadata", PROTECTED_RESOURCE_URL),
        ("authorization-server metadata", AUTHORIZATION_SERVER_URL),
    ):
        try:
            documents[label] = get_json_document(
                url=url,
                timeout=args.timeout,
                retries=args.retries,
            )
        except AuditError as exc:
            review_failures.append((label, str(exc)))

    authorization_server = documents.get("authorization-server metadata", {})
    raw_scopes = authorization_server.get("scopes_supported")
    supported_scopes = (
        {
            scope
            for scope in raw_scopes
            if isinstance(scope, str) and scope.strip()
        }
        if isinstance(raw_scopes, list)
        else set()
    )
    try:
        validate_oauth_metadata(
            documents.get("protected-resource metadata", {}),
            authorization_server,
        )
        if "revocation_endpoint" not in authorization_server:
            print(
                "OAuth hardening recommendation: publish a revocation_endpoint; "
                "OpenAI does not require it for plugin submission."
            )
    except AuditError as exc:
        review_failures.append(("OAuth discovery", str(exc)))
    try:
        validate_unauthenticated_challenge(
            mcp_url=mcp_url,
            timeout=args.timeout,
        )
    except AuditError as exc:
        review_failures.append(("OAuth runtime challenge", str(exc)))
    try:
        validate_model_visible_tools(
            model_visible_tools,
            expected_root_annotations,
            supported_scopes,
        )
    except AuditError as exc:
        review_failures.append(("model-visible tools", str(exc)))
    try:
        validate_app_tools(
            app_only_tools,
            expected_app_tools,
            supported_scopes,
        )
    except AuditError as exc:
        review_failures.append(("app-only tools", str(exc)))
    try:
        validate_ui_resources(
            mcp_url=mcp_url,
            api_key=api_key,
            protocol_version=protocol_version,
            session_id=session_id,
            timeout=args.timeout,
            retries=args.retries,
        )
    except AuditError as exc:
        review_failures.append(("UI resources", str(exc)))
    try:
        validate_server_card(
            documents.get("server card", {}),
            initialize_result,
            federated_tools,
        )
    except AuditError as exc:
        review_failures.append(("server card", str(exc)))
    if review_failures:
        print(
            f"Hosted review contract has {len(review_failures)} blocker(s); "
            "continuing the full endpoint-schema audit."
        )
    else:
        print(
            "Hosted review contract passed: OAuth, six model-visible tools, "
            "25 app-only tools, server card, and five UI resources."
        )

    catalog_payload = call_tool(
        mcp_url=mcp_url,
        api_key=api_key,
        protocol_version=protocol_version,
        session_id=session_id,
        tool_name="list_api_endpoints",
        arguments={},
        timeout=args.timeout,
        retries=args.retries,
    )
    catalog = validate_catalog(catalog_payload)
    read_count = sum(tool["operation"] == "read" for tool in catalog)
    write_count = len(catalog) - read_count
    catalog_names = "".join(
        f"{name}\n" for name in sorted(tool["name"] for tool in catalog)
    ).encode("utf-8")
    catalog_names_sha256 = hashlib.sha256(catalog_names).hexdigest()
    if (
        len(catalog),
        read_count,
        write_count,
    ) != (
        EXPECTED_ENDPOINT_COUNT,
        EXPECTED_READ_COUNT,
        EXPECTED_WRITE_COUNT,
    ):
        raise AuditError(
            "catalog counts changed: "
            f"actual={len(catalog)}/{read_count}/{write_count}, "
            f"expected={EXPECTED_ENDPOINT_COUNT}/{EXPECTED_READ_COUNT}/"
            f"{EXPECTED_WRITE_COUNT}; review and update the expected counts"
        )
    if catalog_names_sha256 != EXPECTED_CATALOG_NAMES_SHA256:
        raise AuditError(
            "catalog endpoint names changed: "
            f"actual sha256={catalog_names_sha256}, "
            f"expected sha256={EXPECTED_CATALOG_NAMES_SHA256}; "
            "review the added, removed, or renamed endpoints before updating"
        )
    print(
        f"Catalog shape passed: {len(catalog)} endpoints "
        f"({read_count} read, {write_count} write)."
    )

    failures: list[tuple[str, str]] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                validate_schema,
                mcp_url=mcp_url,
                api_key=api_key,
                protocol_version=protocol_version,
                session_id=session_id,
                catalog_tool=tool,
                timeout=args.timeout,
                retries=args.retries,
            ): tool["name"]
            for tool in catalog
        }
        for future in as_completed(futures):
            endpoint_name = futures[future]
            try:
                future.result()
            except Exception as exc:  # noqa: BLE001 - aggregate endpoint failures
                failures.append((endpoint_name, str(exc)))
            completed += 1
            if completed % 100 == 0:
                print(f"Validated {completed}/{len(catalog)} endpoint schemas.")

    if failures:
        print(
            f"Catalog audit failed for {len(failures)}/{len(catalog)} schemas:",
            flush=True,
        )
        for endpoint_name, message in sorted(failures)[:20]:
            print(f"  - {endpoint_name}: {message}")
        if len(failures) > 20:
            print(f"  - ... {len(failures) - 20} additional failures omitted")
        raise SystemExit(1)

    if review_failures:
        print("Hosted MCP public-review contract failed:", flush=True)
        for label, message in review_failures:
            print(f"  - {label}: {message}")
        raise SystemExit(1)

    print(
        f"Hosted MCP release audit passed: {len(catalog)}/{len(catalog)} "
        "endpoint schemas plus discovery, auth, tools, and UI resources; "
        "invoke_api_endpoint was never called."
    )


if __name__ == "__main__":
    try:
        main()
    except AuditError as exc:
        print(f"Hosted MCP catalog audit failed: {exc}")
        raise SystemExit(1) from exc
