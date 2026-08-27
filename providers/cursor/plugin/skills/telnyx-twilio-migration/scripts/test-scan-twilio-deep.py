#!/usr/bin/env python3
"""Focused complexity regressions for the packaged Twilio deep scanner."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType


def load_scanner() -> ModuleType:
    path = Path(__file__).resolve().with_name("scan-twilio-deep.py")
    spec = importlib.util.spec_from_file_location("telnyx_twilio_deep_scanner", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load scanner from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_one_comment_pass(
    module: ModuleType, operation, label: str, masker: str = "mask_comments"
) -> None:
    original = getattr(module, masker)
    calls = 0

    def counted(text: str, **kwargs: object) -> str:
        nonlocal calls
        calls += 1
        return original(text, **kwargs)

    setattr(module, masker, counted)
    try:
        operation()
    finally:
        setattr(module, masker, original)
    if calls != 1:
        raise AssertionError(f"{label} parsed comments {calls} times instead of once")


def main() -> None:
    scanner = load_scanner()
    comment_probe = (
        "curl https://api.telnyx.com/v2/calls/example/pay\n"
        "value = this.#response\n"
        "# POST /v2/calls/comment/pay\n"
        "value = 1 // POST /v2/calls/comment/pay\n"
    )
    masked_probe = scanner.mask_comments(comment_probe)
    if "https://api.telnyx.com/v2/calls/example/pay" not in masked_probe:
        raise AssertionError("comment masking must preserve unquoted HTTP URLs")
    if "this.#response" not in masked_probe:
        raise AssertionError("comment masking must preserve C#/JS private identifiers")
    if "/v2/calls/comment/pay" in masked_probe:
        raise AssertionError("comment masking must remove hash and slash comments")
    python_masked = scanner.mask_comments(
        "value = 1# response.pay()\n", language="python"
    )
    if "response.pay" in python_masked:
        raise AssertionError("Python comments do not require preceding whitespace")
    javascript_masked = scanner.mask_comments(
        "const value = 8 // 2; response.pay();\n", language="javascript"
    )
    if "response.pay" in javascript_masked:
        raise AssertionError("JavaScript // always begins a line comment")
    csharp_masked = scanner.mask_comments(
        "value = this.#response;\n", language="csharp"
    )
    if "this.#response" not in csharp_masked:
        raise AssertionError("C# private identifiers must not become hash comments")
    unrelated_literals = "\n".join(
        f'const value{index} = "unrelated-{index}";' for index in range(1_000)
    )
    assert_one_comment_pass(
        scanner,
        lambda: scanner.inline_texml_pay_offset(unrelated_literals),
        "inline TeXML detection",
    )

    alias_source = (
        'const twilio = require("twilio");\n'
        'const response = new VoiceResponse();\n'
        + "\n".join(f"const alias{index} = response;" for index in range(100))
        + "\nalias99.pay();\n"
    )
    assert_one_comment_pass(
        scanner,
        lambda: scanner.add_contextual_pay_alias_detections(
            [], alias_source, alias_source.splitlines()
        ),
        "VoiceResponse alias detection",
        "mask_comments_and_strings",
    )

    string_only_source = (
        'const twilio = require("twilio");\n'
        'const direct = "response.pay()";\n'
        'const constructor = "const response = new VoiceResponse()";\n'
        'const propagated = "alias = response; alias.pay()";\n'
        'const builder = "new Pay.Builder()";\n'
    )
    string_only_detections = []
    scanner.add_contextual_pay_alias_detections(
        string_only_detections,
        string_only_source,
        string_only_source.splitlines(),
    )
    scanner.add_contextual_pay_type_detections(
        string_only_detections,
        string_only_source,
        string_only_source.splitlines(),
    )
    if string_only_detections:
        raise AssertionError("Pay-like source strings must not be executable Pay usage")

    multiline_js = (
        'const twilio = require("twilio");\n'
        "const migrationNotes = `old example:\n"
        "response.pay()\n"
        "twilio.messages.create({ body: 'sample' })\n"
        "`;\n"
    )
    multiline_js_detections = scanner.scan_js_file(
        Path("example.js"), multiline_js.splitlines()
    )
    if any(detection.line in {3, 4} for detection in multiline_js_detections):
        raise AssertionError("multiline JavaScript strings must not be executable usage")

    escaped_backtick_js = (
        'const twilio = require("twilio");\n'
        'const note = `escaped \\` text`;\n'
        'const response = new twilio.twiml.VoiceResponse();\n'
        'response.pay({ paymentConnector: "Default" });\n'
    )
    escaped_backtick_detections = scanner.scan_js_file(
        Path("escaped-backtick.js"), escaped_backtick_js.splitlines()
    )
    if not any(detection.line == 4 for detection in escaped_backtick_detections):
        raise AssertionError("escaped backticks must not mask later executable Pay usage")

    multiline_python = (
        "from twilio.rest import Client\n"
        'migration_notes = """old example:\n'
        "response.pay()\n"
        "client.messages.create(body='sample')\n"
        '"""\n'
    )
    multiline_python_detections = scanner.scan_python_regex(
        Path("example.py"), multiline_python.splitlines(), set()
    )
    if any(detection.line in {3, 4} for detection in multiline_python_detections):
        raise AssertionError("multiline Python strings must not be executable usage")

    ruby_percent_source = 'require "twilio-ruby"\nnotes = %q{response.pay()}\n'
    ruby_percent_detections = []
    scanner.add_contextual_pay_alias_detections(
        ruby_percent_detections,
        ruby_percent_source,
        ruby_percent_source.splitlines(),
        language="ruby",
    )
    if ruby_percent_detections:
        raise AssertionError("Ruby percent literals must not be executable Pay usage")

    inline_xml_source = 'const response = "<Response><Pay /></Response>";\n'
    inline_xml_detections = []
    scanner.add_inline_texml_pay_detection(
        inline_xml_detections,
        inline_xml_source,
        inline_xml_source.splitlines(),
    )
    if not inline_xml_detections:
        raise AssertionError("inline TeXML Pay literals must remain detectable")
    escaped_backtick_xml = (
        'const response = `<Response><Say>Press \\`</Say><Pay /></Response>`;\n'
    )
    escaped_backtick_xml_detections = []
    scanner.add_inline_texml_pay_detection(
        escaped_backtick_xml_detections,
        escaped_backtick_xml,
        escaped_backtick_xml.splitlines(),
    )
    if not escaped_backtick_xml_detections:
        raise AssertionError("escaped backticks must not truncate inline TeXML Pay")
    commented_inline_xml = (
        'const response = "<Response><!-- <Pay /> --><Say>Hi</Say></Response>";\n'
    )
    commented_inline_detections = []
    scanner.add_inline_texml_pay_detection(
        commented_inline_detections,
        commented_inline_xml,
        commented_inline_xml.splitlines(),
    )
    if commented_inline_detections:
        raise AssertionError("XML-commented inline Pay tags must remain inactive")

    with TemporaryDirectory() as directory:
        project = Path(directory)
        (project / "routes.yaml").write_text(
            "endpoint: https://api.twilio.com/2010-04-01/Accounts.json\n"
            "# old_endpoint: https://api.twilio.com/comment-only\n"
        )
        (project / "request.sh").write_text(
            "curl https://api.twilio.com/2010-04-01/Accounts.json\n"
            "# curl https://api.twilio.com/comment-only\n"
        )
        (project / "config.yml").write_text(
            "endpoint: https://api.twilio.com/v1\n"
            "# TWILIO_AUTH_TOKEN=comment-only\n"
        )
        result = scanner.run_scan(project)
        detected = {
            (entry["path"], detection["line"])
            for entry in result["files"]
            for detection in entry["detections"]
        }
        expected = {("routes.yaml", 1), ("request.sh", 1), ("config.yml", 1)}
        if not expected.issubset(detected):
            raise AssertionError(
                f"unquoted URL parity missing {sorted(expected - detected)}"
            )
        comment_only = {("routes.yaml", 2), ("request.sh", 2), ("config.yml", 2)}
        if detected & comment_only:
            raise AssertionError(
                f"comment-only Twilio references detected {sorted(detected & comment_only)}"
            )


if __name__ == "__main__":
    main()
