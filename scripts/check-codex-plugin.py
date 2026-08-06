#!/usr/bin/env python3
"""Validate the repository-owned Codex developer-kit package."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import struct
import sys
import unicodedata
import zlib
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

try:
    import yaml
except ModuleNotFoundError:
    print(
        "PyYAML is required; install it with: python -m pip install PyYAML==6.0.3",
        file=sys.stderr,
    )
    raise SystemExit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
PLUGIN_ROOT = REPO_ROOT / "plugins" / "telnyx-developer-kit"
MANIFEST_PATH = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
MCP_PATH = PLUGIN_ROOT / ".mcp.json"
MARKETPLACE_PATH = REPO_ROOT / ".agents" / "plugins" / "marketplace.json"
REVIEW_CASES_PATH = (
    REPO_ROOT / "submission" / "telnyx-developer-kit" / "review-cases.json"
)
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
RELEASE_NOTES_PATH = (
    REPO_ROOT / "submission" / "telnyx-developer-kit" / "release-notes.md"
)
REVIEW_README_PATH = (
    REPO_ROOT / "submission" / "telnyx-developer-kit" / "README.md"
)
INTEGRATION_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "integration-tests.yml"
SYNC_SKILLS_PATH = REPO_ROOT / "scripts" / "sync-skills.sh"
WEBHOOKS_GUIDE_PATH = REPO_ROOT / "guides" / "webhooks.md"
SMS_GUIDE_PATH = REPO_ROOT / "guides" / "sms-messaging.md"

MCP_CATALOG_SELF_TEST_COMMAND = (
    "python3 scripts/check-telnyx-mcp-catalog.py --self-test"
)
TELNYX_API_KEY_SECRET = "${{ secrets.TELNYX_API_KEY }}"
TELNYX_CLI_ARCHIVE_URL = (
    "https://github.com/team-telnyx/telnyx-cli/releases/download/v0.11.0/"
    "telnyx_0.11.0_linux_amd64.tar.gz"
)
TELNYX_CLI_ARCHIVE_SHA256 = (
    "9a4ea6023370f1a1da11157046c6f1fff34dc70d808076f6e8780c32a3581635"
)
PINNED_ACTIONS = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
}
PERMITTED_SECRET_STEPS = {
    "Python API read-only tests": (
        "tools/python",
        'pytest tests/test_integration_ci.py -v -k "readonly"',
    ),
    "TS SDK API read-only tests": (
        "tools/typescript",
        "npx tsx tests/integration-ci.test.ts",
    ),
    "CLI read-only tests": ("cli", "npx tsx tests/integration-ci.test.ts"),
    "Guide API smoke tests": (None, "npx tsx --test tests/guides-api.test.ts"),
    "Validate hosted review metadata and every endpoint schema": (
        None,
        "python3 ./scripts/check-telnyx-mcp-catalog.py",
    ),
    "Python API write tests": (
        "tools/python",
        'pytest tests/test_integration_ci.py -v -k "write"',
    ),
    "TS SDK write tests": (
        "tools/typescript",
        "npx tsx tests/integration-ci.test.ts",
    ),
    "CLI write tests": ("cli", "npx tsx tests/integration-ci-write.test.ts"),
}

PLUGIN_NAME = "telnyx-developer-kit"
MCP_SERVER_URL = "https://api.telnyx.com/v2/mcp"
TELNYX_MARK_PATH = "./assets/telnyx-mark.png"
TELNYX_MARK_SHA256 = (
    "de304ddafa033ec73d619b27123f6891262f726919046d37b1f989ad47160599"
)
EXPECTED_SKILLS = {
    "telnyx-kit-product-navigator",
    "telnyx-kit-architecture-patterns",
    "telnyx-kit-guardrails",
    "telnyx-kit-debugging",
}
EXPECTED_UI_OPENERS = {
    "open_number_intelligence",
    "open_voice_monitor",
}
PUBLIC_CATEGORIES = {
    "Productivity",
    "Creativity",
    "Developer Tools",
    "Business & Operations",
    "Data & Analytics",
    "Communication",
    "Education & Research",
    "Security",
    "Finance",
    "Healthcare",
    "Travel",
    "Entertainment",
    "Other",
}
EXPECTED_ROOT_TOOL_ANNOTATIONS = {
    "get_api_endpoint_schema": {
        "readOnlyHint": True,
        "openWorldHint": False,
        "destructiveHint": False,
    },
    "list_api_endpoints": {
        "readOnlyHint": True,
        "openWorldHint": False,
        "destructiveHint": False,
    },
    "open_number_intelligence": {
        "readOnlyHint": True,
        "openWorldHint": False,
        "destructiveHint": False,
    },
    "open_voice_monitor": {
        "readOnlyHint": True,
        "openWorldHint": False,
        "destructiveHint": False,
    },
}
REQUIRED_KEYWORDS = {
    "telnyx",
    "sms",
    "messaging",
    "voice",
    "call-control",
    "texml",
    "webrtc",
    "verify",
    "numbers",
    "10dlc",
    "twilio-migration",
    "twilio-alternative",
}
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)"
    r"(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\."
    r"(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
PACKAGE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
CASE_ID_RE = re.compile(r"^[PN][1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$")
APP_ID_RE = re.compile(
    r"^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$"
)
HEX_COLOR_RE = re.compile(r"^#[0-9A-F]{6}$", re.IGNORECASE)
HIGH_CONFIDENCE_SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    re.compile(r"(?i)\bBearer[ \t]+[A-Za-z0-9._~+/=-]{24,}\b"),
    re.compile(
        r"""(?ix)
        ["']?
        \b(?:(?:[a-z][a-z0-9]*[_-])?
        (?:api[_-]?key|access[_-]?token|client[_-]?secret))\b
        ["']?[ \t]*[:=][ \t]*["']?
        [A-Za-z0-9._~+/=-]{24,}
        """
    ),
)
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[[^\]\r\n]+\]\(([^)\r\n]+)\)")
ALLOWED_MANIFEST_FIELDS = {
    "id",
    "name",
    "version",
    "description",
    "skills",
    "apps",
    "mcpServers",
    "interface",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
}
ALLOWED_INTERFACE_FIELDS = {
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
    "capabilities",
    "websiteURL",
    "privacyPolicyURL",
    "termsOfServiceURL",
    "brandColor",
    "composerIcon",
    "logo",
    "defaultPrompt",
}

errors: list[str] = []


class UniqueKeySafeLoader(yaml.SafeLoader):
    """PyYAML safe loader that rejects ambiguous duplicate mapping keys."""


class UniqueKeyBaseLoader(yaml.BaseLoader):
    """String-preserving YAML loader for GitHub workflow syntax."""


def construct_unique_yaml_mapping(
    loader: Any, node: yaml.nodes.MappingNode, deep: bool = False
) -> dict[Any, Any]:
    if hasattr(loader, "flatten_mapping"):
        loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found an unhashable key",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    construct_unique_yaml_mapping,
)
UniqueKeyBaseLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    construct_unique_yaml_mapping,
)


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


class DuplicateJSONKey(ValueError):
    """Raised when a JSON object contains the same key more than once."""


class NonFiniteJSONConstant(ValueError):
    """Raised for NaN and infinities, which JSON does not permit."""


def reject_non_finite_json_constant(value: str) -> None:
    raise NonFiniteJSONConstant(f"non-finite numeric constant {value!r}")


def reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise DuplicateJSONKey(f"duplicate object key {key!r}")
        value[key] = item
    return value


def strict_json_loads(document: str) -> Any:
    return json.loads(
        document,
        object_pairs_hook=reject_duplicate_json_keys,
        parse_constant=reject_non_finite_json_constant,
    )


def validate_strict_json_regressions() -> None:
    for document in ('{"value":NaN}', '{"value":1,"value":2}'):
        try:
            strict_json_loads(document)
        except (DuplicateJSONKey, NonFiniteJSONConstant):
            continue
        raise RuntimeError("strict JSON parser regression: ambiguous JSON was accepted")


validate_strict_json_regressions()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = strict_json_loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"missing JSON file: {path.relative_to(REPO_ROOT)}")
        return {}
    except (OSError, UnicodeDecodeError) as exc:
        errors.append(f"cannot read JSON file {path.relative_to(REPO_ROOT)}: {exc}")
        return {}
    except (DuplicateJSONKey, NonFiniteJSONConstant) as exc:
        errors.append(f"invalid JSON in {path.relative_to(REPO_ROOT)}: {exc}")
        return {}
    except json.JSONDecodeError as exc:
        errors.append(
            f"invalid JSON in {path.relative_to(REPO_ROOT)}: "
            f"line {exc.lineno}, column {exc.colno}: {exc.msg}"
        )
        return {}

    if not isinstance(value, dict):
        errors.append(f"{path.relative_to(REPO_ROOT)} must contain a JSON object")
        return {}
    return value


def unsupported_text_character(value: str, *, allow_line_breaks: bool) -> str | None:
    """Return the first character rejected by the public-directory text rules."""

    for character in value:
        codepoint = ord(character)
        if allow_line_breaks and character in {"\n", "\r"}:
            continue
        if (
            unicodedata.category(character) in {"Cc", "Cf", "Cs"}
            or codepoint in {0x2028, 0x2029}
        ):
            return character
    return None


def validate_supported_text(
    value: Any,
    label: str,
    *,
    allow_line_breaks: bool = False,
) -> None:
    if not isinstance(value, str):
        return
    unsupported = unsupported_text_character(
        value, allow_line_breaks=allow_line_breaks
    )
    if unsupported is not None:
        errors.append(
            f"{label} contains unsupported U+{ord(unsupported):04X} text"
        )


def contains_high_confidence_secret(value: str) -> bool:
    return any(
        pattern.search(value) is not None
        for pattern in HIGH_CONFIDENCE_SECRET_PATTERNS
    )


def validate_no_secrets(value: str, label: str) -> None:
    require(
        not contains_high_confidence_secret(value),
        f"{label} appears to contain a credential or private key",
    )


def validate_secret_pattern_regressions() -> None:
    candidate = "A" * 32
    positives = (
        f"api_key={candidate}",
        f"api_key: {candidate}",
        f'"api_key": "{candidate}"',
        f"TELNYX_API_KEY: '{candidate}'",
        f"client-secret = {candidate}",
    )
    negatives = (
        "TELNYX_API_KEY=...",
        "api_key: <secret>",
        "client_secret: supplied privately",
    )
    if not all(contains_high_confidence_secret(value) for value in positives):
        raise RuntimeError("secret scanner regression: expected credential syntax was missed")
    if any(contains_high_confidence_secret(value) for value in negatives):
        raise RuntimeError("secret scanner regression: placeholder text was misclassified")


validate_secret_pattern_regressions()


def validate_integration_workflow() -> None:
    """Enforce the least-privilege CI contract around Telnyx credentials."""

    try:
        workflow = yaml.load(
            INTEGRATION_WORKFLOW_PATH.read_text(encoding="utf-8"),
            Loader=UniqueKeyBaseLoader,
        )
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        errors.append(f"integration workflow must be readable YAML: {exc}")
        return

    if not isinstance(workflow, dict):
        errors.append("integration workflow must contain a YAML object")
        return

    triggers = workflow.get("on")
    jobs = workflow.get("jobs")
    if not isinstance(triggers, dict):
        errors.append("integration workflow must define event triggers")
        return
    if not isinstance(jobs, dict):
        errors.append("integration workflow must define jobs")
        return

    for event_name in ("push", "pull_request"):
        event = triggers.get(event_name)
        require(
            event == {"branches": ["main"]},
            f"integration workflow must run automatically for {event_name} on main",
        )

    for job_name, job in jobs.items():
        if not isinstance(job, dict):
            errors.append(f"integration workflow job {job_name!r} must be an object")
            continue
        require(
            job.get("permissions") == {"contents": "read"},
            f"integration workflow job {job_name!r} must grant only contents: read",
        )

        job_env = job.get("env")
        require(
            TELNYX_API_KEY_SECRET not in json.dumps(job_env, sort_keys=True),
            f"integration workflow job {job_name!r} must not expose the API key job-wide",
        )

        steps = job.get("steps")
        if not isinstance(steps, list):
            errors.append(
                f"integration workflow job {job_name!r} must define a step list"
            )
            continue
        for step in steps:
            if not isinstance(step, dict):
                errors.append(
                    f"integration workflow job {job_name!r} contains a non-object step"
                )
                continue
            uses = step.get("uses")
            if not isinstance(uses, str) or uses.startswith("./"):
                continue
            action_name, separator, revision = uses.partition("@")
            expected_revision = PINNED_ACTIONS.get(action_name)
            require(
                bool(separator)
                and re.fullmatch(r"[0-9a-f]{40}", revision) is not None,
                f"workflow action {uses!r} must use an immutable commit SHA",
            )
            if action_name.startswith("actions/"):
                require(
                    expected_revision is not None and revision == expected_revision,
                    f"workflow action {action_name!r} must use the reviewed commit SHA",
                )

    automatic_job = jobs.get("skills-sync-check")
    if not isinstance(automatic_job, dict):
        errors.append(
            "integration workflow must define the automatic skills-sync-check job"
        )
    else:
        require(
            "if" not in automatic_job and "needs" not in automatic_job,
            "automatic package checks must not be conditionally skipped or depend on "
            "another job",
        )
        require(
            TELNYX_API_KEY_SECRET
            not in json.dumps(automatic_job, sort_keys=True),
            "automatic package checks must remain uncredentialed",
        )
        automatic_steps = automatic_job.get("steps")
        self_test_steps = (
            [
                step
                for step in automatic_steps
                if isinstance(step, dict)
                and isinstance(step.get("run"), str)
                and step["run"].strip() == MCP_CATALOG_SELF_TEST_COMMAND
            ]
            if isinstance(automatic_steps, list)
            else []
        )
        require(
            len(self_test_steps) == 1,
            "automatic package checks must run exactly: "
            f"{MCP_CATALOG_SELF_TEST_COMMAND}",
        )
        if self_test_steps:
            self_test_step = self_test_steps[0]
            require(
                "if" not in self_test_step
                and "env" not in self_test_step
                and "shell" not in self_test_step
                and "working-directory" not in self_test_step
                and self_test_step.get("continue-on-error") not in ("true", True),
                "hosted MCP self-tests must be unconditional, uncredentialed, and "
                "failure-blocking",
            )

    api_readonly = jobs.get("api-readonly")
    api_readonly_condition = (
        api_readonly.get("if", "") if isinstance(api_readonly, dict) else ""
    )
    normalized_api_readonly_condition = re.sub(
        r"\s+", " ", api_readonly_condition
    ).strip()
    expected_api_readonly_condition = (
        "(github.event_name == 'push' && github.ref == 'refs/heads/main') || "
        "(github.event_name == 'workflow_dispatch' && "
        "github.ref == 'refs/heads/main' && "
        "(github.event.inputs.run_mcp_catalog_audit != 'true' || "
        "github.event.inputs.run_write_tests == 'true'))"
    )
    require(
        isinstance(api_readonly, dict),
        "integration workflow must define api-readonly job",
    )
    require(
        isinstance(api_readonly_condition, str)
        and "github.event.pull_request" not in api_readonly_condition
        and "github.event_name == 'pull_request'" not in api_readonly_condition,
        "credentialed api-readonly job must never run for pull_request code",
    )
    require(
        normalized_api_readonly_condition == expected_api_readonly_condition,
        "credentialed api-readonly job must be limited to main push/manual events",
    )

    catalog_audit = jobs.get("mcp-catalog-audit")
    catalog_audit_condition = (
        catalog_audit.get("if", "") if isinstance(catalog_audit, dict) else ""
    )
    require(
        re.sub(r"\s+", " ", catalog_audit_condition).strip()
        == (
            "github.event_name == 'workflow_dispatch' && "
            "github.event.inputs.run_mcp_catalog_audit == 'true' && "
            "github.ref == 'refs/heads/main'"
        ),
        "credentialed hosted catalog audit must require a manual dispatch from main",
    )

    api_write = jobs.get("api-write")
    api_write_condition = api_write.get("if", "") if isinstance(api_write, dict) else ""
    require(
        isinstance(api_write, dict),
        "integration workflow must define api-write job",
    )
    require(
        re.sub(r"\s+", " ", api_write_condition).strip()
        == (
            "github.event_name == 'workflow_dispatch' && "
            "github.ref == 'refs/heads/main' && "
            "github.event.inputs.run_write_tests == 'true'"
        ),
        "credentialed api-write job must require an explicit manual dispatch from main",
    )
    if isinstance(api_write, dict):
        require(
            api_write.get("needs") == "api-readonly",
            "api-write must wait for the read-only integration suite",
        )
        write_steps = api_write.get("steps")
        if isinstance(write_steps, list):
            for step in write_steps:
                if not isinstance(step, dict):
                    continue
                require(
                    step.get("continue-on-error") not in ("true", True),
                    "api-write failures must not be masked with continue-on-error",
                )

    actual_secret_steps: set[str] = set()
    cli_install_runs: list[str] = []
    for job in jobs.values():
        if not isinstance(job, dict) or not isinstance(job.get("steps"), list):
            continue
        for step in job["steps"]:
            if not isinstance(step, dict):
                continue
            run = step.get("run")
            if isinstance(run, str) and TELNYX_CLI_ARCHIVE_URL in run:
                cli_install_runs.append(run)
            if TELNYX_API_KEY_SECRET not in json.dumps(step, sort_keys=True):
                continue
            step_name = step.get("name")
            if isinstance(step_name, str):
                actual_secret_steps.add(step_name)
            step_env = step.get("env")
            expected_secret_step = PERMITTED_SECRET_STEPS.get(step_name)
            require(
                isinstance(run, str)
                and isinstance(step_env, dict)
                and step_env.get("TELNYX_API_KEY") == TELNYX_API_KEY_SECRET
                and expected_secret_step
                == (step.get("working-directory"), run.strip()),
                "TELNYX_API_KEY may be exposed only to an approved test/audit run step",
            )
    require(
        actual_secret_steps == set(PERMITTED_SECRET_STEPS),
        "credentialed workflow steps must match the reviewed test/audit allowlist",
    )

    require(
        len(cli_install_runs) == 2,
        "both credentialed integration suites must install the pinned Telnyx CLI",
    )
    for run in cli_install_runs:
        checksum_position = run.find(TELNYX_CLI_ARCHIVE_SHA256)
        verification_position = run.find("sha256sum --check --strict")
        extraction_position = run.find("tar -xzf")
        verification_lines = {
            line.strip() for line in run.splitlines() if "sha256sum" in line
        }
        require(
            checksum_position != -1
            and verification_position > checksum_position
            and extraction_position > verification_position,
            "downloaded Telnyx CLI archives must match the reviewed SHA-256 before "
            "execution",
        )
        require(
            verification_lines
            == {
                "printf '%s  %s\\n' "
                f"'{TELNYX_CLI_ARCHIVE_SHA256}' \"$cli_archive\" | "
                "sha256sum --check --strict"
            },
            "Telnyx CLI checksum verification must remain failure-blocking",
        )


def validate_json_strings(value: Any, label: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            validate_supported_text(key, f"{label} object key")
            validate_json_strings(item, f"{label}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            validate_json_strings(item, f"{label}[{index}]")
    elif isinstance(value, str):
        validate_supported_text(value, label, allow_line_breaks=True)
        validate_no_secrets(value, label)


def parse_frontmatter(path: Path) -> dict[str, Any]:
    try:
        contents = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        errors.append(f"cannot read {path.relative_to(REPO_ROOT)}: {exc}")
        return {}

    lines = contents.splitlines()
    if not lines or lines[0] != "---":
        errors.append(f"{path.relative_to(REPO_ROOT)} must start with YAML frontmatter")
        return {}

    try:
        frontmatter_end = lines.index("---", 1)
    except ValueError:
        errors.append(f"{path.relative_to(REPO_ROOT)} has unclosed YAML frontmatter")
        return {}

    try:
        frontmatter = yaml.load(
            "\n".join(lines[1:frontmatter_end]),
            Loader=UniqueKeySafeLoader,
        )
    except yaml.YAMLError as exc:
        errors.append(
            f"{path.relative_to(REPO_ROOT)} frontmatter must be valid YAML: {exc}"
        )
        return {}

    if not isinstance(frontmatter, dict):
        errors.append(f"{path.relative_to(REPO_ROOT)} frontmatter must be an object")
        return {}

    markdown = "\n".join(lines[frontmatter_end + 1 :]).strip()
    require(
        bool(markdown),
        f"{path.relative_to(REPO_ROOT)} must contain Markdown after frontmatter",
    )
    validate_supported_text(
        markdown,
        f"{path.relative_to(REPO_ROOT)} Markdown",
        allow_line_breaks=True,
    )
    validate_no_secrets(markdown, str(path.relative_to(REPO_ROOT)))
    return frontmatter


def validate_kit_skill_semantics(skill_texts: dict[str, str]) -> None:
    """Protect product-critical guidance from content regressions."""

    missing_skills = EXPECTED_SKILLS.difference(skill_texts)
    require(
        not missing_skills,
        "semantic skill checks could not read canonical skills: "
        f"{sorted(missing_skills)}",
    )
    if missing_skills:
        return

    navigator = skill_texts["telnyx-kit-product-navigator"]
    architecture = skill_texts["telnyx-kit-architecture-patterns"]
    guardrails = skill_texts["telnyx-kit-guardrails"]
    debugging = skill_texts["telnyx-kit-debugging"]
    navigator_flat = re.sub(r"\s+", " ", navigator)

    codex_marker = "**Claude or Codex with the Telnyx Developer Kit installed**"
    codex_position = navigator.find(codex_marker)
    list_position = navigator.find("`list_api_endpoints`", codex_position)
    schema_position = navigator.find("`get_api_endpoint_schema`", list_position)
    catalog_only_position = navigator.find("documentation-only", schema_position)
    codex_route_positions = (
        codex_position,
        list_position,
        schema_position,
        catalog_only_position,
    )
    require(
        all(position != -1 for position in codex_route_positions)
        and codex_position
        < list_position
        < schema_position
        < catalog_only_position,
        "product navigator must route Claude and Codex through list_api_endpoints, then "
        "get_api_endpoint_schema, and identify the catalog as documentation-only",
    )
    require(
        "cannot execute account API" in navigator,
        "product navigator must prohibit account API execution through the catalog",
    )
    require(
        "Do not ask for or accept a Telnyx API key in chat" in navigator_flat
        and "Do not install another product plugin unless the user explicitly asks"
        in navigator_flat,
        "product navigator must refuse chat credentials and automatic plugin installs",
    )

    cursor_position = navigator.find("**Cursor**")
    use_case_position = navigator.find("## Use case", cursor_position)
    require(
        cursor_position != -1
        and use_case_position > cursor_position
        and "already bundled" in navigator[cursor_position:use_case_position]
        and "`telnyx-<product>-*`" in navigator[cursor_position:use_case_position]
        and "do not run Claude `/plugin install`" in navigator[
            cursor_position:use_case_position
        ],
        "product navigator must tell Cursor to use bundled canonical product "
        "skills without running Claude install commands",
    )
    require(
        "/plugin install telnyx-<product>@telnyx" not in navigator
        and "codex plugin add telnyx-" not in navigator.lower()
        and "Treat any separate migration package as an explicit user choice"
        in navigator_flat,
        "product navigator must not auto-install product or migration packages",
    )

    architecture_lower = re.sub(r"\s+", " ", architecture).lower()
    require(
        "`telnyx-signature-ed25519`" in architecture
        and "`telnyx-timestamp`" in architecture
        and "Mission Control Portal" in architecture
        and "`TELNYX_PUBLIC_KEY`" in architecture
        and "telnyx-public-key" not in architecture_lower,
        "architecture guidance must trust the two webhook request headers and "
        "load the public key from Mission Control Portal/TELNYX_PUBLIC_KEY",
    )

    require(
        re.search(
            r"\|\s*422\s*\|\s*10004\s*\|\s*Missing required parameter\s*\|",
            debugging,
        )
        is not None
        and re.search(
            r"\|\s*404\s*\|\s*10005\s*\|\s*Resource or URL not found\s*\|",
            debugging,
        )
        is not None
        and "10004/10005" not in debugging,
        "debugging guidance must map 10004 to a missing parameter and 10005 "
        "to a missing resource/URL",
    )

    texml_markers = (
        "current Telnyx TeXML Verbs & Nouns reference",
        "do not rely on a fixed verb count",
        "`<AIGather>`",
        "`<AIAssistant>`",
        "`<ConversationRelay>`",
        "`<HttpRequest>`",
    )
    require(
        all(marker in debugging for marker in texml_markers)
        and re.search(r"\b\d+-verb\b", debugging, flags=re.IGNORECASE) is None,
        "debugging guidance must use the current TeXML vocabulary reference, "
        "include newer instructions, and avoid a hard-coded verb count",
    )

    navigator_lower = re.sub(r"\s+", " ", navigator).lower()
    guardrails_lower = re.sub(r"\s+", " ", guardrails).lower()
    debugging_lower = re.sub(r"\s+", " ", debugging).lower()
    require(
        "local 10-digit long codes use a 10dlc brand and campaign"
        in navigator_lower
        and "toll-free senders use toll-free verification" in navigator_lower
        and "short codes use carrier approval" in navigator_lower
        and "consent and opt-out handling, including stop, apply to every sender type"
        in navigator_lower
        and "local 10-digit long code: 10dlc brand + campaign" in guardrails_lower
        and "toll-free: toll-free verification" in guardrails_lower
        and "short code: carrier approval" in guardrails_lower
        and "consent and opt-outs (stop) for every sender type" in guardrails_lower,
        "navigator and guardrails must distinguish local long-code 10DLC, "
        "toll-free verification, short-code approval, and universal consent/STOP",
    )
    require(
        "local 10-digit long-code sender uses a messaging profile linked to its "
        "10dlc campaign" in architecture_lower
        and "toll-free sender needs toll-free verification" in architecture_lower
        and "short code sender needs carrier approval" in architecture_lower
        and "us local long-code sms needs 10dlc campaign linkage" in debugging_lower
        and "toll-free traffic needs toll-free verification" in debugging_lower
        and "short-code traffic needs carrier approval" in debugging_lower,
        "architecture and debugging guidance must preserve sender-specific US "
        "A2P registration and diagnostics",
    )

    require(
        "For API v2 JSON event webhooks" in architecture
        and "`data.event_type`" in architecture
        and "`data.payload.*`" in architecture
        and "event `data.id`" in architecture
        and "`application/x-www-form-urlencoded`" in architecture
        and "`(CallSid, SequenceNumber)`" in architecture
        and "Do not parse these as JSON or read `data.*`" in architecture,
        "architecture guidance must distinguish API v2 JSON event envelopes "
        "from flat TeXML form/query callbacks and use the right dedupe key",
    )
    require(
        "static single-tenant service with a process-wide key" in guardrails_lower
        and "delegated multi-tenant service" in guardrails_lower
        and "before that request's first outbound telnyx action"
        in guardrails_lower
        and "cannot validate every credential at process boot" in guardrails_lower,
        "API-key guidance must distinguish static startup validation from "
        "per-request delegated multi-tenant validation",
    )
    require(
        "## Recording and privacy" in guardrails
        and "before recording starts" in guardrails_lower
        and "never assume one-party consent" in guardrails_lower
        and "retention" in guardrails_lower
        and "failover path must preserve the same consent state"
        in guardrails_lower
        and "explicit notice/consent gate" in architecture_lower
        and "persist that consent state across" in architecture_lower
        and "distinct primary and failover webhook urls" in architecture_lower
        and "correlate `data.id`" in architecture_lower
        and "primary/failover delivery failures" in debugging_lower,
        "the kit must route P2 voice designs through recording consent, tested "
        "failover, and correlated observability guidance",
    )

    webhook_guide = WEBHOOKS_GUIDE_PATH.read_text(encoding="utf-8")
    sms_guide = SMS_GUIDE_PATH.read_text(encoding="utf-8")
    require(
        '"event_type": "message.finalized"' in webhook_guide
        and '"event_type": "message.delivered"' not in webhook_guide
        and "payload.to[0].phone_number" in webhook_guide
        and "API v2 event webhooks use a nested JSON envelope" in webhook_guide
        and "TeXML instruction requests and status callbacks are separate"
        in webhook_guide
        and '"event_type": "message.finalized"' in sms_guide
        and '"event_type": "message.delivered"' not in sms_guide,
        "messaging guides must model delivery outcomes as message.finalized "
        "with recipient status rather than a message.delivered event",
    )


def require_non_empty_string(
    payload: dict[str, Any], field: str, label: str
) -> str | None:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{label}.{field} must be a non-empty string")
        return None
    validate_supported_text(value, f"{label}.{field}", allow_line_breaks=True)
    return value


def reject_unknown_fields(
    payload: dict[str, Any], allowed: set[str], label: str
) -> None:
    for field in sorted(set(payload).difference(allowed)):
        errors.append(f"{label}.{field} is not accepted by the Codex plugin schema")


def require_https_url(
    payload: dict[str, Any],
    field: str,
    label: str,
    *,
    maximum: int = 2048,
    require_public_host: bool = False,
) -> None:
    value = payload.get(field)
    if not isinstance(value, str) or not value:
        errors.append(f"{label}.{field} must be an absolute https:// URL")
        return

    validate_supported_text(value, f"{label}.{field}")
    require(value == value.strip(), f"{label}.{field} must not have outer whitespace")
    require(len(value) <= maximum, f"{label}.{field} must be at most {maximum:,} characters")
    require(
        not any(character.isspace() for character in value),
        f"{label}.{field} must not contain whitespace",
    )
    require("\\" not in value, f"{label}.{field} must not contain backslashes")

    try:
        parsed = urlparse(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError:
        errors.append(f"{label}.{field} must be a valid absolute https:// URL")
        return

    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        errors.append(
            f"{label}.{field} must be an absolute https:// URL without credentials"
        )
        return

    if require_public_host:
        lowered = hostname.rstrip(".").casefold()
        require(
            lowered not in {"localhost", "localhost.localdomain"}
            and not lowered.endswith((".localhost", ".local", ".internal")),
            f"{label}.{field} must use a public host",
        )
        try:
            address = ipaddress.ip_address(lowered)
        except ValueError:
            pass
        else:
            require(address.is_global, f"{label}.{field} must use a public IP address")


def validate_optional_https_url(
    payload: dict[str, Any], field: str, label: str
) -> None:
    if payload.get(field) is not None:
        require_https_url(payload, field, label, maximum=2048)


def validate_public_https_url(
    payload: dict[str, Any], field: str, label: str
) -> None:
    require_https_url(
        payload,
        field,
        label,
        maximum=1024,
        require_public_host=True,
    )


def validate_single_line_text(
    value: Any, label: str, *, maximum: int
) -> None:
    if not isinstance(value, str):
        return
    validate_supported_text(value, label)
    require("\n" not in value and "\r" not in value, f"{label} must fit on one line")
    require(len(value) <= maximum, f"{label} must be at most {maximum} characters")


def resolve_asset_path(raw_path: Any, label: str) -> Path | None:
    if not isinstance(raw_path, str) or not raw_path.strip():
        errors.append(f"{label} must be a non-empty relative path")
        return None
    validate_supported_text(raw_path, label)
    if raw_path != raw_path.strip():
        errors.append(f"{label} must not have outer whitespace")
        return None
    if not raw_path.startswith("./"):
        errors.append(f"{label} must begin with ./")
        return None
    if "\\" in raw_path:
        errors.append(f"{label} must use / path separators")
        return None
    path_tail = raw_path[2:]
    if (
        not path_tail
        or re.match(r"^[A-Za-z]:", path_tail)
        or any(part in {"", ".", ".."} for part in path_tail.split("/"))
    ):
        errors.append(f"{label} must stay inside the plugin package")
        return None

    candidate = PurePosixPath(raw_path)
    if candidate.is_absolute() or any(part in {"", ".."} for part in candidate.parts):
        errors.append(f"{label} must stay inside the plugin package")
        return None

    unresolved_path = PLUGIN_ROOT / candidate.as_posix()
    current_path = PLUGIN_ROOT
    for part in candidate.parts:
        current_path /= part
        if current_path.is_symlink():
            errors.append(f"{label} must not reference a symbolic link")
            return None

    resolved_path = unresolved_path.resolve()
    if not resolved_path.is_relative_to(PLUGIN_ROOT.resolve()):
        errors.append(f"{label} must stay inside the plugin package")
        return None
    elif not resolved_path.is_file():
        errors.append(f"{label} points to a missing file")
        return None
    return resolved_path


def validate_asset_path(raw_path: Any, label: str) -> None:
    resolve_asset_path(raw_path, label)


def png_scanline_lengths(
    width: int, height: int, bits_per_pixel: int, interlace: int
) -> list[tuple[int, int]]:
    if interlace == 0:
        return [(height, (width * bits_per_pixel + 7) // 8)]

    # Adam7 pass geometry: x start, y start, x step, y step.
    passes = (
        (0, 0, 8, 8),
        (4, 0, 8, 8),
        (0, 4, 4, 8),
        (2, 0, 4, 4),
        (0, 2, 2, 4),
        (1, 0, 2, 2),
        (0, 1, 1, 2),
    )
    lengths: list[tuple[int, int]] = []
    for x_start, y_start, x_step, y_step in passes:
        pass_width = (
            0 if width <= x_start else (width - x_start + x_step - 1) // x_step
        )
        pass_height = (
            0 if height <= y_start else (height - y_start + y_step - 1) // y_step
        )
        if pass_width and pass_height:
            lengths.append(
                (pass_height, (pass_width * bits_per_pixel + 7) // 8)
            )
    return lengths


def validate_png_payload(data: bytes, label: str) -> tuple[int, int] | None:
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n":
        errors.append(f"{label} must contain a decodable PNG image")
        return None

    offset = 8
    chunks: list[tuple[bytes, bytes]] = []
    while offset < len(data):
        if offset + 12 > len(data):
            errors.append(f"{label} has a truncated PNG chunk")
            return None
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_end = offset + 12 + length
        if (
            len(chunk_type) != 4
            or not all(
                ord("A") <= byte <= ord("Z") or ord("a") <= byte <= ord("z")
                for byte in chunk_type
            )
            or chunk_end > len(data)
        ):
            errors.append(f"{label} has an invalid PNG chunk")
            return None
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(
            ">I", data[offset + 8 + length : chunk_end]
        )[0]
        actual_crc = zlib.crc32(chunk_type + payload) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            errors.append(f"{label} has a PNG checksum mismatch")
            return None
        chunks.append((chunk_type, payload))
        offset = chunk_end
        if chunk_type == b"IEND":
            break

    if offset != len(data):
        errors.append(f"{label} has data after the PNG IEND chunk")
        return None
    if not chunks or chunks[0][0] != b"IHDR" or chunks[-1][0] != b"IEND":
        errors.append(f"{label} has invalid PNG chunk ordering")
        return None
    if sum(chunk_type == b"IHDR" for chunk_type, _ in chunks) != 1:
        errors.append(f"{label} must contain exactly one PNG IHDR chunk")
        return None
    if sum(chunk_type == b"IEND" for chunk_type, _ in chunks) != 1:
        errors.append(f"{label} must contain exactly one PNG IEND chunk")
        return None
    if chunks[-1][1]:
        errors.append(f"{label} PNG IEND chunk must be empty")
        return None

    known_critical_chunks = {b"IHDR", b"PLTE", b"IDAT", b"IEND"}
    for chunk_type, _ in chunks:
        if chunk_type[:1].isupper() and chunk_type not in known_critical_chunks:
            errors.append(f"{label} contains unsupported critical PNG chunk")
            return None

    ihdr = chunks[0][1]
    if len(ihdr) != 13:
        errors.append(f"{label} PNG IHDR chunk must be 13 bytes")
        return None
    (
        width,
        height,
        bit_depth,
        color_type,
        compression,
        filter_method,
        interlace,
    ) = struct.unpack(">IIBBBBB", ihdr)
    allowed_depths = {
        0: {1, 2, 4, 8, 16},
        2: {8, 16},
        3: {1, 2, 4, 8},
        4: {8, 16},
        6: {8, 16},
    }
    if (
        width == 0
        or height == 0
        or color_type not in allowed_depths
        or bit_depth not in allowed_depths.get(color_type, set())
        or compression != 0
        or filter_method != 0
        or interlace not in {0, 1}
    ):
        errors.append(f"{label} has an unsupported PNG header")
        return None
    if width > 4096 or height > 4096:
        errors.append(f"{label} PNG dimensions exceed the safe decode limit")
        return None

    idat_positions = [
        index for index, (chunk_type, _) in enumerate(chunks) if chunk_type == b"IDAT"
    ]
    if not idat_positions:
        errors.append(f"{label} PNG has no image data")
        return None
    if idat_positions != list(range(idat_positions[0], idat_positions[-1] + 1)):
        errors.append(f"{label} PNG IDAT chunks must be consecutive")
        return None

    palette_positions = [
        index for index, (chunk_type, _) in enumerate(chunks) if chunk_type == b"PLTE"
    ]
    if len(palette_positions) > 1:
        errors.append(f"{label} PNG must not contain multiple palettes")
        return None
    if palette_positions:
        palette = chunks[palette_positions[0]][1]
        if (
            not palette
            or len(palette) % 3 != 0
            or len(palette) > 768
            or palette_positions[0] > idat_positions[0]
            or color_type in {0, 4}
            or (color_type == 3 and len(palette) // 3 > 2**bit_depth)
        ):
            errors.append(f"{label} has an invalid PNG palette")
            return None
    elif color_type == 3:
        errors.append(f"{label} indexed PNG requires a palette")
        return None

    compressed = b"".join(
        payload for chunk_type, payload in chunks if chunk_type == b"IDAT"
    )
    channel_counts = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
    bits_per_pixel = channel_counts[color_type] * bit_depth
    scanlines = png_scanline_lengths(width, height, bits_per_pixel, interlace)
    expected_length = sum(rows * (row_bytes + 1) for rows, row_bytes in scanlines)
    try:
        decompressor = zlib.decompressobj()
        decoded = decompressor.decompress(compressed, expected_length + 1)
        if decompressor.unconsumed_tail or len(decoded) > expected_length:
            errors.append(f"{label} PNG decoded image data exceeds its dimensions")
            return None
        decoded += decompressor.flush()
    except zlib.error as exc:
        errors.append(f"{label} PNG image data cannot be decoded: {exc}")
        return None
    if (
        not decompressor.eof
        or decompressor.unconsumed_tail
        or decompressor.unused_data
    ):
        errors.append(f"{label} PNG image data has an invalid compressed stream")
        return None

    if len(decoded) != expected_length:
        errors.append(f"{label} PNG decoded image data has the wrong size")
        return None
    decoded_offset = 0
    for rows, row_bytes in scanlines:
        for _ in range(rows):
            if decoded[decoded_offset] > 4:
                errors.append(f"{label} PNG uses an invalid scanline filter")
                return None
            decoded_offset += row_bytes + 1
    return width, height


def validate_square_png(raw_path: Any, label: str) -> Path | None:
    path = resolve_asset_path(raw_path, label)
    if path is None:
        return None
    require(path.suffix.lower() == ".png", f"{label} must use a .png filename")
    try:
        data = path.read_bytes()
    except OSError as exc:
        errors.append(f"{label} cannot be read: {exc}")
        return None

    require(len(data) <= 5 * 1024 * 1024, f"{label} must not exceed 5 MiB")
    dimensions = validate_png_payload(data, label)
    if dimensions is None:
        return path

    width, height = dimensions
    require(width == height, f"{label} must be square")
    require(
        48 <= width <= 4096 and 48 <= height <= 4096,
        f"{label} dimensions must be between 48x48 and 4096x4096",
    )
    return path


def relative_luminance(hex_color: str) -> float:
    channels = [int(hex_color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [
        channel / 12.92
        if channel <= 0.04045
        else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast_ratio(first: str, second: str) -> float:
    lighter, darker = sorted(
        (relative_luminance(first), relative_luminance(second)), reverse=True
    )
    return (lighter + 0.05) / (darker + 0.05)


def normalized_prompt(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.split()).casefold()


def validate_markdown_document(
    path: Path,
    *,
    expected_title: str,
    required_headings: set[str] | None = None,
) -> str:
    label = str(path.relative_to(REPO_ROOT))
    try:
        contents = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        errors.append(f"cannot read {label}: {exc}")
        return ""

    require(contents.endswith("\n"), f"{label} must end with a newline")
    require(
        not contents.startswith("\ufeff"),
        f"{label} must not start with a UTF-8 byte-order mark",
    )
    require(
        contents.startswith(f"# {expected_title}\n"),
        f"{label} must start with '# {expected_title}'",
    )
    validate_supported_text(contents, label, allow_line_breaks=True)
    validate_no_secrets(contents, label)
    require(
        not re.search(r"(?i)\b(?:TODO|TBD|CHANGEME)\b", contents),
        f"{label} must not contain unresolved placeholders",
    )

    headings: list[tuple[int, str]] = []
    prose_lines: list[str] = []
    open_fence: tuple[str, int] | None = None
    for line in contents.splitlines():
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            marker = fence.group(1)
            marker_character = marker[0]
            if open_fence is None:
                open_fence = (marker_character, len(marker))
                continue
            if (
                marker_character == open_fence[0]
                and len(marker) >= open_fence[1]
                and not fence.group(2).strip()
            ):
                open_fence = None
                continue
        if open_fence is not None:
            continue
        prose_lines.append(line)
        heading = re.match(r"^(#{1,6})[ \t]+(.+?)[ \t]*$", line)
        if heading:
            headings.append((len(heading.group(1)), heading.group(2)))

    require(open_fence is None, f"{label} has an unclosed fenced code block")
    require(bool(headings), f"{label} must contain Markdown headings")
    if headings:
        first_level, first_title = headings[0]
        require(
            first_level == 1 and first_title == expected_title,
            f"{label} must start with '# {expected_title}'",
        )
        require(
            sum(level == 1 for level, _ in headings) == 1,
            f"{label} must contain exactly one level-one heading",
        )
        previous_level = first_level
        for level, _ in headings[1:]:
            require(
                level <= previous_level + 1,
                f"{label} must not skip Markdown heading levels",
            )
            previous_level = level
        if required_headings:
            actual_headings = {title for _, title in headings}
            missing = sorted(required_headings.difference(actual_headings))
            require(
                not missing,
                f"{label} is missing required headings: {missing}",
            )

    for match in MARKDOWN_LINK_RE.finditer("\n".join(prose_lines)):
        raw_target = match.group(1).strip()
        target = raw_target.split(maxsplit=1)[0].strip("<>")
        require(bool(target), f"{label} contains an empty Markdown link target")
        if target.startswith("https://"):
            require_https_url(
                {"target": target},
                "target",
                f"{label} Markdown link",
                maximum=2048,
                require_public_host=True,
            )
        else:
            require(
                target.startswith(("#", "./", "../")),
                f"{label} Markdown links must use https:// or a relative target",
            )
    return contents


def validate_string_list(
    value: Any,
    label: str,
    *,
    minimum: int = 1,
    maximum: int = 20,
) -> list[str]:
    if not isinstance(value, list) or not all(
        isinstance(item, str) and bool(item.strip()) for item in value
    ):
        errors.append(f"{label} must be an array of non-empty strings")
        return []
    require(
        minimum <= len(value) <= maximum,
        f"{label} must contain between {minimum} and {maximum} entries",
    )
    for index, item in enumerate(value):
        validate_single_line_text(item, f"{label}[{index}]", maximum=500)
        require(
            item == item.strip(),
            f"{label}[{index}] must not have outer whitespace",
        )
    normalized_items = [normalized_prompt(item) for item in value]
    require(
        len(normalized_items) == len(set(normalized_items)),
        f"{label} must not contain duplicate entries after normalization",
    )
    return value


def validate_app_manifest() -> None:
    app_manifest = load_json(PLUGIN_ROOT / ".app.json")
    reject_unknown_fields(app_manifest, {"apps"}, ".app.json")
    apps = app_manifest.get("apps")
    if not isinstance(apps, dict):
        errors.append(".app.json.apps must be an object")
        return

    for app_name, app in apps.items():
        if not isinstance(app_name, str) or not app_name.strip():
            errors.append(".app.json app names must be non-empty strings")
        if not isinstance(app, dict):
            errors.append(f".app.json app {app_name!r} must be an object")
            continue
        reject_unknown_fields(
            app,
            {"id", "optional", "required"},
            f".app.json app {app_name!r}",
        )
        app_id = require_non_empty_string(
            app, "id", f".app.json app {app_name!r}"
        )
        if app_id is not None:
            require(
                APP_ID_RE.fullmatch(app_id) is not None,
                f".app.json app {app_name!r}.id has an unsupported format",
            )
        for field in ("optional", "required"):
            if field in app:
                require(
                    type(app[field]) is bool,
                    f".app.json app {app_name!r}.{field} must be boolean",
                )


def validate_manifest_schema(manifest: dict[str, Any]) -> None:
    reject_unknown_fields(manifest, ALLOWED_MANIFEST_FIELDS, "plugin.json")

    if manifest.get("id") is not None:
        require_non_empty_string(manifest, "id", "plugin.json")
    name = require_non_empty_string(manifest, "name", "plugin.json")
    version = require_non_empty_string(manifest, "version", "plugin.json")
    description = require_non_empty_string(manifest, "description", "plugin.json")
    if version is not None and SEMVER_RE.fullmatch(version) is None:
        errors.append("plugin.json.version must be strict semver")
    if name is not None:
        require(name == PLUGIN_ROOT.name, "plugin.json.name must match its directory")
        require(len(name) <= 64, "plugin.json.name must be at most 64 characters")
        require(
            PACKAGE_NAME_RE.fullmatch(name) is not None,
            "plugin.json.name must start with an ASCII letter or digit and use "
            "only ASCII letters, digits, underscores, or hyphens",
        )
        validate_supported_text(name, "plugin.json.name")
    if version is not None:
        require(len(version) <= 64, "plugin.json.version must be at most 64 characters")
        validate_supported_text(version, "plugin.json.version")
    if description is not None:
        require(
            len(description) <= 1024,
            "plugin.json.description must be at most 1,024 characters",
        )
        validate_supported_text(
            description, "plugin.json.description", allow_line_breaks=True
        )

    author = manifest.get("author")
    if isinstance(author, dict):
        reject_unknown_fields(author, {"name", "email", "url"}, "plugin.json.author")
        author_name = require_non_empty_string(author, "name", "plugin.json.author")
        if author_name is not None:
            require(
                len(author_name) <= 120,
                "plugin.json.author.name must be at most 120 characters",
            )
            validate_single_line_text(
                author_name, "plugin.json.author.name", maximum=120
            )
        if author.get("email") is not None:
            email = require_non_empty_string(author, "email", "plugin.json.author")
            if email is not None:
                validate_single_line_text(
                    email, "plugin.json.author.email", maximum=320
                )
        validate_optional_https_url(author, "url", "plugin.json.author")
    else:
        errors.append("plugin.json.author must be an object")

    for field in ("homepage", "repository"):
        validate_optional_https_url(manifest, field, "plugin.json")

    if manifest.get("license") is not None:
        license_name = require_non_empty_string(manifest, "license", "plugin.json")
        if license_name is not None:
            validate_single_line_text(
                license_name, "plugin.json.license", maximum=128
            )

    keywords = manifest.get("keywords")
    if keywords is not None:
        if not isinstance(keywords, list) or not all(
            isinstance(keyword, str) and keyword.strip() for keyword in keywords
        ):
            errors.append("plugin.json.keywords must be an array of non-empty strings")
        else:
            normalized_keywords = [normalized_prompt(keyword) for keyword in keywords]
            require(
                len(normalized_keywords) == len(set(normalized_keywords)),
                "plugin.json.keywords must be unique after normalization",
            )
            for index, keyword in enumerate(keywords):
                validate_single_line_text(
                    keyword, f"plugin.json.keywords[{index}]", maximum=64
                )

    for field, expected_path in (
        ("skills", "./skills/"),
        ("mcpServers", "./.mcp.json"),
    ):
        if manifest.get(field) is not None:
            value = manifest[field]
            require(
                isinstance(value, str) and bool(value.strip()),
                f"plugin.json.{field} must be a non-empty string",
            )
            if isinstance(value, str):
                validate_supported_text(value, f"plugin.json.{field}")
                require(
                    value == expected_path,
                    f"plugin.json.{field} must be {expected_path}",
                )

    apps_path = manifest.get("apps")
    if apps_path is not None:
        if apps_path != "./.app.json":
            errors.append("plugin.json.apps must be ./.app.json")
        else:
            validate_app_manifest()

    interface = manifest.get("interface")
    if not isinstance(interface, dict):
        errors.append("plugin.json.interface must be an object")
        return

    reject_unknown_fields(interface, ALLOWED_INTERFACE_FIELDS, "plugin.json.interface")
    interface_text_limits = {
        "displayName": 30,
        "shortDescription": 30,
        "longDescription": 4000,
        "developerName": 80,
        "category": 80,
    }
    for field, maximum in interface_text_limits.items():
        value = require_non_empty_string(interface, field, "plugin.json.interface")
        if value is not None:
            if field != "longDescription":
                validate_single_line_text(
                    value,
                    f"plugin.json.interface.{field}",
                    maximum=maximum,
                )
            else:
                require(
                    len(value) <= maximum,
                    f"plugin.json.interface.{field} must be at most "
                    f"{maximum} characters",
                )
                validate_supported_text(
                    value,
                    f"plugin.json.interface.{field}",
                    allow_line_breaks=True,
                )

    category = interface.get("category")
    if isinstance(category, str):
        require(
            category in PUBLIC_CATEGORIES,
            "plugin.json.interface.category must use a public directory category",
        )

    capabilities = interface.get("capabilities")
    if not isinstance(capabilities, list) or not capabilities or not all(
        isinstance(capability, str) and capability.strip()
        for capability in capabilities
    ):
        errors.append(
            "plugin.json.interface.capabilities must be a non-empty array of strings"
        )
    else:
        require(
            len(capabilities) <= 20,
            "plugin.json.interface.capabilities must have at most 20 entries",
        )
        normalized_capabilities = [
            normalized_prompt(capability) for capability in capabilities
        ]
        require(
            len(normalized_capabilities) == len(set(normalized_capabilities)),
            "plugin.json.interface.capabilities must be unique after normalization",
        )
        for index, capability in enumerate(capabilities):
            validate_single_line_text(
                capability,
                f"plugin.json.interface.capabilities[{index}]",
                maximum=120,
            )

    for url_field in (
        "websiteURL",
        "privacyPolicyURL",
        "termsOfServiceURL",
    ):
        validate_public_https_url(interface, url_field, "plugin.json.interface")

    brand_color = interface.get("brandColor")
    if not isinstance(brand_color, str) or HEX_COLOR_RE.fullmatch(brand_color) is None:
        errors.append("plugin.json.interface.brandColor must use #RRGGBB")
    elif contrast_ratio(brand_color, "#FFFFFF") < 2:
        errors.append(
            "plugin.json.interface.brandColor must have at least 2:1 contrast "
            "against white"
        )
    raw_prompts = interface.get("defaultPrompt")
    prompts = [raw_prompts] if isinstance(raw_prompts, str) else raw_prompts
    if not isinstance(prompts, list) or not all(
        isinstance(prompt, str) and prompt.strip() for prompt in prompts
    ):
        errors.append(
            "plugin.json.interface.defaultPrompt must be a non-empty string or "
            "an array of non-empty strings"
        )
    else:
        require(1 <= len(prompts) <= 3, "manifest must define one to three prompts")
        require(
            all(len(prompt) <= 128 for prompt in prompts),
            "manifest prompts must be at most 128 characters",
        )
        for index, prompt in enumerate(prompts):
            validate_single_line_text(
                prompt,
                f"plugin.json.interface.defaultPrompt[{index}]",
                maximum=128,
            )
            require(
                re.search(r"(^|\s)@\S+", prompt) is None,
                f"plugin.json.interface.defaultPrompt[{index}] must not "
                "contain an @mention",
            )
        normalized_prompts = [normalized_prompt(prompt) for prompt in prompts]
        require(
            len(normalized_prompts) == len(set(normalized_prompts)),
            "manifest prompts must be unique after normalization",
        )

    validate_square_png(
        interface.get("composerIcon"), "plugin.json.interface.composerIcon"
    )
    validate_square_png(interface.get("logo"), "plugin.json.interface.logo")


def validate_review_materials() -> None:
    review_cases = load_json(REVIEW_CASES_PATH)
    validate_json_strings(review_cases, "review cases")
    reject_unknown_fields(review_cases, {"positive", "negative"}, "review cases")
    positive = review_cases.get("positive")
    negative = review_cases.get("negative")
    require(
        isinstance(positive, list) and len(positive) == 5,
        "review materials must contain exactly five positive cases",
    )
    require(
        isinstance(negative, list) and len(negative) == 3,
        "review materials must contain exactly three negative cases",
    )

    seen_ids: set[str] = set()
    seen_prompts: set[str] = set()
    covered_skills: list[str] = []
    covered_tools: list[str] = []
    if isinstance(positive, list):
        for index, case in enumerate(positive):
            label = f"positive review case {index + 1}"
            if not isinstance(case, dict):
                errors.append(f"{label} must be an object")
                continue
            reject_unknown_fields(
                case,
                {
                    "id",
                    "userPrompt",
                    "skillsUnderTest",
                    "toolsUnderTest",
                    "expectedBehavior",
                    "expectedResultShape",
                    "fixtureData",
                    "acceptanceCriteria",
                },
                label,
            )
            case_id = require_non_empty_string(case, "id", label)
            prompt = require_non_empty_string(case, "userPrompt", label)
            result_shape = require_non_empty_string(
                case, "expectedResultShape", label
            )
            fixture_data = require_non_empty_string(case, "fixtureData", label)
            if case_id is not None:
                validate_single_line_text(case_id, f"{label}.id", maximum=80)
                require(
                    CASE_ID_RE.fullmatch(case_id) is not None
                    and case_id.startswith(f"P{index + 1}-"),
                    f"{label}.id must use the P{index + 1}-lowercase-slug format",
                )
            if prompt is not None:
                validate_single_line_text(
                    prompt, f"{label}.userPrompt", maximum=2000
                )
                normalized = normalized_prompt(prompt)
                require(
                    normalized not in seen_prompts,
                    f"{label}.userPrompt must be unique after normalization",
                )
                seen_prompts.add(normalized)
            if result_shape is not None:
                validate_single_line_text(
                    result_shape,
                    f"{label}.expectedResultShape",
                    maximum=1000,
                )
            if fixture_data is not None:
                validate_single_line_text(
                    fixture_data, f"{label}.fixtureData", maximum=1000
                )

            behavior = validate_string_list(
                case.get("expectedBehavior"),
                f"{label}.expectedBehavior",
                minimum=3,
                maximum=8,
            )
            require(
                any(
                    "do not" in item.casefold()
                    or "without" in item.casefold()
                    or "bounded" in item.casefold()
                    for item in behavior
                ),
                f"{label}.expectedBehavior must state a bounded or no-side-effect "
                "condition",
            )
            validate_string_list(
                case.get("acceptanceCriteria"),
                f"{label}.acceptanceCriteria",
                minimum=3,
                maximum=8,
            )

            skills_under_test = validate_string_list(
                case.get("skillsUnderTest"),
                f"{label}.skillsUnderTest",
                minimum=0,
                maximum=len(EXPECTED_SKILLS),
            )
            tools_under_test = validate_string_list(
                case.get("toolsUnderTest"),
                f"{label}.toolsUnderTest",
                minimum=0,
                maximum=len(EXPECTED_ROOT_TOOL_ANNOTATIONS),
            )
            unknown_skills = sorted(set(skills_under_test).difference(EXPECTED_SKILLS))
            unknown_tools = sorted(
                set(tools_under_test).difference(EXPECTED_ROOT_TOOL_ANNOTATIONS)
            )
            require(
                not unknown_skills,
                f"{label}.skillsUnderTest contains unknown skills: {unknown_skills}",
            )
            require(
                not unknown_tools,
                f"{label}.toolsUnderTest contains unknown model-visible "
                f"tools: {unknown_tools}",
            )
            covered_skills.extend(skills_under_test)
            covered_tools.extend(tools_under_test)
            if case_id is not None:
                require(case_id not in seen_ids, f"duplicate review case id: {case_id}")
                seen_ids.add(case_id)

        require(
            set(covered_skills) == EXPECTED_SKILLS,
            "positive review cases must cover all four bundled skills",
        )
        for skill_name in EXPECTED_SKILLS:
            require(
                covered_skills.count(skill_name) == 1,
                f"positive review cases must cover {skill_name} exactly once",
            )
        require(
            set(covered_tools) == set(EXPECTED_ROOT_TOOL_ANNOTATIONS),
            "positive review cases must cover all four model-visible MCP tools",
        )
        for opener_name in EXPECTED_UI_OPENERS:
            require(
                covered_tools.count(opener_name) == 1,
                f"positive review cases must cover {opener_name} exactly once",
            )

        voice_case = next(
            (
                case
                for case in positive
                if isinstance(case, dict)
                and case.get("id") == "P2-voice-architecture-monitor-ui"
            ),
            None,
        )
        voice_acceptance = " ".join(
            voice_case.get("acceptanceCriteria", [])
            if isinstance(voice_case, dict)
            and isinstance(voice_case.get("acceptanceCriteria"), list)
            else []
        ).casefold()
        require(
            "primary and failover webhook urls" in voice_acceptance
            and "share durable event-deduplication state" in voice_acceptance
            and "notice and consent before recording starts" in voice_acceptance
            and all(
                marker in voice_acceptance
                for marker in ("retention", "access", "deletion")
            )
            and "event, call-session, call-leg, command, request, and error"
            in voice_acceptance
            and "without logging secrets, recording urls, or transcripts"
            in voice_acceptance,
            "P2 acceptance criteria must explicitly review recording consent, "
            "tested failover with durable dedupe, and privacy-safe observability",
        )

    if isinstance(negative, list):
        for index, case in enumerate(negative):
            label = f"negative review case {index + 1}"
            if not isinstance(case, dict):
                errors.append(f"{label} must be an object")
                continue
            reject_unknown_fields(
                case,
                {
                    "id",
                    "userPrompt",
                    "expectedBehavior",
                    "reason",
                    "acceptanceCriteria",
                },
                label,
            )
            case_id = require_non_empty_string(case, "id", label)
            prompt = require_non_empty_string(case, "userPrompt", label)
            expected_behavior = require_non_empty_string(
                case, "expectedBehavior", label
            )
            reason = require_non_empty_string(case, "reason", label)
            if case_id is not None:
                validate_single_line_text(case_id, f"{label}.id", maximum=80)
                require(
                    CASE_ID_RE.fullmatch(case_id) is not None
                    and case_id.startswith(f"N{index + 1}-"),
                    f"{label}.id must use the N{index + 1}-lowercase-slug format",
                )
            if prompt is not None:
                validate_single_line_text(
                    prompt, f"{label}.userPrompt", maximum=2000
                )
                normalized = normalized_prompt(prompt)
                require(
                    normalized not in seen_prompts,
                    f"{label}.userPrompt must be unique after normalization",
                )
                seen_prompts.add(normalized)
            if expected_behavior is not None:
                validate_single_line_text(
                    expected_behavior,
                    f"{label}.expectedBehavior",
                    maximum=1000,
                )
                require(
                    any(
                        term in expected_behavior.casefold()
                        for term in ("refuse", "clarif", "do not", "safe fallback")
                    ),
                    f"{label}.expectedBehavior must specify refusal, clarification, "
                    "or a safe fallback",
                )
            if reason is not None:
                validate_single_line_text(
                    reason, f"{label}.reason", maximum=1000
                )
            validate_string_list(
                case.get("acceptanceCriteria"),
                f"{label}.acceptanceCriteria",
                minimum=3,
                maximum=8,
            )
            if case_id is not None:
                require(case_id not in seen_ids, f"duplicate review case id: {case_id}")
                seen_ids.add(case_id)

    annotations = load_json(ANNOTATIONS_PATH)
    validate_json_strings(annotations, "annotation justifications")
    reject_unknown_fields(
        annotations,
        {"mcpServerURL", "reviewScope", "tools"},
        "annotation justifications",
    )
    require(
        annotations.get("mcpServerURL") == MCP_SERVER_URL,
        "annotation justifications must target the production MCP endpoint",
    )
    require_non_empty_string(annotations, "reviewScope", "annotation justifications")
    tools = annotations.get("tools")
    if not isinstance(tools, list):
        errors.append("annotation justifications.tools must be an array")
    else:
        indexed_tools = {
            tool.get("name"): tool
            for tool in tools
            if isinstance(tool, dict) and isinstance(tool.get("name"), str)
        }
        require(
            set(indexed_tools) == set(EXPECTED_ROOT_TOOL_ANNOTATIONS),
            "annotation justifications must cover exactly the four model-visible "
            "MCP tools",
        )
        require(
            len(indexed_tools) == len(tools),
            "annotation justifications must not contain duplicate or invalid tools",
        )
        for tool_name, expected in EXPECTED_ROOT_TOOL_ANNOTATIONS.items():
            tool = indexed_tools.get(tool_name)
            if not isinstance(tool, dict):
                continue
            reject_unknown_fields(
                tool,
                {
                    "name",
                    "readOnlyHint",
                    "openWorldHint",
                    "destructiveHint",
                    "justification",
                },
                f"annotation tool {tool_name}",
            )
            for field, expected_value in expected.items():
                require(
                    tool.get(field) is expected_value,
                    f"annotation tool {tool_name}.{field} must be {expected_value}",
                )
            justifications = tool.get("justification")
            if not isinstance(justifications, dict):
                errors.append(
                    f"annotation tool {tool_name}.justification must be an object"
                )
                continue
            require(
                set(justifications)
                == {"readOnlyHint", "openWorldHint", "destructiveHint"},
                f"annotation tool {tool_name} must justify all three required hints",
            )
            for field, value in justifications.items():
                require(
                    isinstance(value, str) and bool(value.strip()),
                    f"annotation tool {tool_name}.justification.{field} "
                    "must be a non-empty string",
                )

    app_tool_contract = load_json(APP_TOOL_CONTRACT_PATH)
    validate_json_strings(app_tool_contract, "app-tool contract")

    release_notes = validate_markdown_document(
        RELEASE_NOTES_PATH,
        expected_title="Telnyx Developer Kit 0.1.0",
    )
    if release_notes:
        require(
            "Initial public submission" in release_notes,
            "release notes must identify this as an initial submission",
        )
        require(
            "demo-recording URL" in release_notes,
            "release notes must tell the owner to supply the required demo-recording "
            "URL in the portal",
        )

    review_readme = validate_markdown_document(
        REVIEW_README_PATH,
        expected_title="Telnyx Developer Kit public GA handoff",
        required_headings={
            "Readiness status",
            "Ready in this branch",
            "Local validation",
            "Release-owner gates",
            "Hosted MCP remediation before public GA",
            "Current OpenAI requirements",
        },
    )
    if review_readme:
        required_phrases = {
            "code-ready": "README must distinguish code-ready status",
            "not submission-ready": "README must distinguish submission-ready status",
            "demo-recording URL": "README must require the current demo-recording URL",
            "safety and security scans": "README must include bundled-skill scans",
            "optional screenshots": "README must identify screenshots as optional",
            "706 pixels wide": "README must record the screenshot width requirement",
            "five positive and three negative": "README must record review-case counts",
        }
        for phrase, message in required_phrases.items():
            require(phrase in review_readme, message)
        for listing_url in (
            "https://support.telnyx.com",
            "https://telnyx.com/privacy-policy",
            "https://telnyx.com/terms-and-conditions-of-service",
        ):
            require(
                listing_url in review_readme,
                f"README must include the public listing URL: {listing_url}",
            )
        for official_url in (
            "https://developers.openai.com/plugins/deploy/submission",
            "https://developers.openai.com/plugins/deploy/app-review",
            "https://developers.openai.com/plugins/deploy/submission-errors",
        ):
            require(
                official_url in review_readme,
                f"README must cite current official requirement: {official_url}",
            )


manifest = load_json(MANIFEST_PATH)
mcp_config = load_json(MCP_PATH)
marketplace = load_json(MARKETPLACE_PATH)

validate_json_strings(manifest, "plugin.json")
validate_json_strings(mcp_config, ".mcp.json")
validate_json_strings(marketplace, "marketplace")
validate_manifest_schema(manifest)
validate_review_materials()
require(
    set(manifest)
    == {
        "name",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "skills",
        "mcpServers",
        "interface",
    },
    "manifest must use the reference plugin structure plus mcpServers",
)
require(PLUGIN_ROOT.name == PLUGIN_NAME, "plugin directory must match the plugin name")
require(
    manifest.get("name") == PLUGIN_NAME,
    "manifest name must be telnyx-developer-kit",
)
require(manifest.get("version") == "0.1.0", "manifest version must be 0.1.0")
require(
    manifest.get("author") == {"name": "Telnyx", "url": "https://telnyx.com"},
    "manifest author must be Telnyx (https://telnyx.com)",
)
require(
    manifest.get("homepage") == "https://developers.telnyx.com",
    "manifest homepage must be https://developers.telnyx.com",
)
require(
    manifest.get("repository") == "https://github.com/team-telnyx/ai",
    "manifest repository must be https://github.com/team-telnyx/ai",
)
require(manifest.get("license") == "MIT", "manifest license must be MIT")

keywords = manifest.get("keywords")
if isinstance(keywords, list) and all(isinstance(item, str) for item in keywords):
    missing_keywords = sorted(REQUIRED_KEYWORDS.difference(keywords))
    require(not missing_keywords, f"manifest is missing keywords: {missing_keywords}")
else:
    errors.append("manifest keywords must be an array of strings")

require(
    manifest.get("skills") == "./skills/",
    "manifest skills must use the isolated ./skills/ directory",
)
require(
    manifest.get("mcpServers") == "./.mcp.json",
    "manifest mcpServers must reference ./.mcp.json",
)

interface = manifest.get("interface")
if isinstance(interface, dict):
    require(
        set(interface)
        == {
            "displayName",
            "shortDescription",
            "longDescription",
            "developerName",
            "category",
            "capabilities",
            "websiteURL",
            "privacyPolicyURL",
            "termsOfServiceURL",
            "defaultPrompt",
            "brandColor",
            "composerIcon",
            "logo",
        },
        "manifest interface must use the exact reference field structure",
    )
    require(
        interface.get("category") == "Developer Tools",
        "manifest category must be Developer Tools",
    )
    require(
        interface.get("shortDescription") == "Build and debug with Telnyx",
        "manifest short description must be public-directory ready",
    )
    long_description = interface.get("longDescription")
    require(
        isinstance(long_description, str)
        and "documentation-only API contract discovery" in long_description
        and "authenticated API actions" not in long_description
        and "account data" not in long_description,
        "manifest long description must match the documentation-only public MCP contract",
    )
    require(
        interface.get("websiteURL") == "https://developers.telnyx.com",
        "manifest website URL must use the Telnyx developer portal",
    )
    require(
        interface.get("privacyPolicyURL") == "https://telnyx.com/privacy-policy",
        "manifest privacy policy URL must use the public Telnyx policy",
    )
    require(
        interface.get("termsOfServiceURL")
        == "https://telnyx.com/terms-and-conditions-of-service",
        "manifest terms URL must use the public Telnyx terms of service",
    )
    require(
        interface.get("brandColor") == "#000000",
        "manifest light brand color must be Telnyx black",
    )
    require(
        interface.get("composerIcon") == TELNYX_MARK_PATH,
        "manifest composer icon must use the official Telnyx mark",
    )
    require(
        interface.get("logo") == TELNYX_MARK_PATH,
        "manifest logo must use the official Telnyx mark",
    )
    require(
        "defaultPrompt" in interface and "default_prompt" not in interface,
        "manifest must use the public defaultPrompt field",
    )

mark_path = PLUGIN_ROOT / TELNYX_MARK_PATH.removeprefix("./")
if mark_path.is_file():
    require(
        hashlib.sha256(mark_path.read_bytes()).hexdigest() == TELNYX_MARK_SHA256,
        "official Telnyx mark does not match its pinned developers.telnyx.com asset",
    )

reject_unknown_fields(mcp_config, {"mcpServers"}, ".mcp.json")
mcp_servers = mcp_config.get("mcpServers")
if isinstance(mcp_servers, dict):
    require(
        mcp_servers == {
            "telnyx": {
                "type": "http",
                "url": MCP_SERVER_URL,
            }
        },
        "MCP config must contain only the hosted Telnyx HTTP endpoint",
    )
else:
    errors.append("MCP config must define an mcpServers object")

reject_unknown_fields(marketplace, {"name", "interface", "plugins"}, "marketplace")
require(
    marketplace.get("name") == "telnyx",
    "marketplace.name must be telnyx",
)
marketplace_interface = marketplace.get("interface")
if isinstance(marketplace_interface, dict):
    reject_unknown_fields(
        marketplace_interface, {"displayName"}, "marketplace.interface"
    )
    require_non_empty_string(
        marketplace_interface, "displayName", "marketplace.interface"
    )
else:
    errors.append("marketplace.interface must be an object")

plugins = marketplace.get("plugins")
marketplace_entry: dict[str, Any] | None = None
if isinstance(plugins, list):
    matching_entries = [
        entry
        for entry in plugins
        if isinstance(entry, dict) and entry.get("name") == PLUGIN_NAME
    ]
    require(
        len(matching_entries) == 1,
        "marketplace must contain exactly one telnyx-developer-kit entry",
    )
    if len(matching_entries) == 1:
        marketplace_entry = matching_entries[0]
else:
    errors.append("marketplace plugins must be an array")

if marketplace_entry is not None:
    reject_unknown_fields(
        marketplace_entry,
        {"name", "source", "policy", "category"},
        "marketplace plugin",
    )
    expected_source = {
        "source": "local",
        "path": "./plugins/telnyx-developer-kit",
    }
    require(
        marketplace_entry.get("source") == expected_source,
        "marketplace source must resolve to the isolated developer-kit package",
    )
    require(
        marketplace_entry.get("category") == "Developer Tools",
        "marketplace category must match the manifest category",
    )
    require(
        marketplace_entry.get("policy")
        == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "marketplace policy must require authentication on install",
    )
    source = marketplace_entry.get("source")
    source_path = source.get("path") if isinstance(source, dict) else None
    if isinstance(source_path, str):
        require(
            (REPO_ROOT / source_path).resolve() == PLUGIN_ROOT.resolve(),
            "marketplace source path does not resolve to the plugin root",
        )

skills_root = PLUGIN_ROOT / "skills"
if skills_root.is_dir():
    skill_entries = list(skills_root.iterdir())
    for entry in skill_entries:
        require(
            entry.is_dir() and not entry.is_symlink(),
            f"Codex skills root contains a non-directory or symlink: {entry.name}",
        )
        require(
            not entry.name.startswith("."),
            f"Codex skill directory must not be hidden: {entry.name}",
        )
    actual_skills = {
        path.name for path in skill_entries if path.is_dir() and not path.is_symlink()
    }
    require(
        actual_skills == EXPECTED_SKILLS,
        "Codex package skills differ from the expected four: "
        f"expected={sorted(EXPECTED_SKILLS)}, actual={sorted(actual_skills)}",
    )
else:
    errors.append("missing generated Codex skills directory")
    actual_skills = set()

canonical_skill_texts: dict[str, str] = {}
for skill_name in sorted(EXPECTED_SKILLS.intersection(actual_skills)):
    packaged_path = skills_root / skill_name / "SKILL.md"
    canonical_path = REPO_ROOT / "skills" / skill_name / "SKILL.md"
    require(packaged_path.is_file(), f"missing packaged skill: {skill_name}/SKILL.md")
    require(canonical_path.is_file(), f"missing canonical skill: {skill_name}/SKILL.md")
    if not packaged_path.is_file() or not canonical_path.is_file():
        continue

    frontmatter = parse_frontmatter(packaged_path)
    require(
        isinstance(frontmatter.get("name"), str)
        and frontmatter.get("name") == skill_name,
        f"{skill_name} frontmatter name must match its directory",
    )
    validate_supported_text(frontmatter.get("name"), f"{skill_name} frontmatter name")
    require(
        isinstance(frontmatter.get("description"), str)
        and bool(frontmatter["description"].strip()),
        f"{skill_name} frontmatter description must be a non-empty string",
    )
    if isinstance(frontmatter.get("description"), str):
        validate_supported_text(
            frontmatter["description"], f"{skill_name} frontmatter description"
        )
        require(
            len(frontmatter["description"]) <= 1024,
            f"{skill_name} frontmatter description must be at most 1,024 characters",
        )
    require(
        len(f"{PLUGIN_NAME}:{skill_name}") <= 64,
        f"{skill_name} combined plugin skill identity must be at most 64 characters",
    )
    metadata = frontmatter.get("metadata")
    require(
        metadata is None or isinstance(metadata, dict),
        f"{skill_name} frontmatter metadata must be an object",
    )
    disable_model_invocation = frontmatter.get(
        "disable-model-invocation",
        frontmatter.get("disable_model_invocation"),
    )
    require(
        disable_model_invocation in (None, False),
        f"{skill_name} disable-model-invocation must be false when present",
    )
    require(
        packaged_path.read_bytes() == canonical_path.read_bytes(),
        f"packaged skill differs from canonical source: {skill_name}",
    )
    canonical_skill_texts[skill_name] = canonical_path.read_text(encoding="utf-8")
    packaged_text = packaged_path.read_text(encoding="utf-8")
    validate_no_secrets(packaged_text, f"packaged skill {skill_name}")
    require(
        "/Users/" not in packaged_text
        and "/private/" not in packaged_text
        and "file://" not in packaged_text,
        f"{skill_name} must not contain developer-local filesystem references",
    )

validate_kit_skill_semantics(canonical_skill_texts)
validate_integration_workflow()

sync_script_text = SYNC_SKILLS_PATH.read_text(encoding="utf-8")
for marker in (
    "assert_repo_path_has_no_symlink_components",
    'find "$SKILLS_SRC" -type l',
    "Refusing generated-tree operation through symlink",
):
    require(
        marker in sync_script_text,
        f"sync-skills symlink safety regression: missing {marker!r}",
    )

if errors:
    print("Codex plugin validation failed:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    raise SystemExit(1)

print("Codex plugin package is valid and resolves exactly four canonical skills.")
