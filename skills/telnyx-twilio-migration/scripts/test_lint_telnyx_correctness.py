#!/usr/bin/env python3
"""Adversarial regression matrix for lint-telnyx-correctness.sh."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Dict, Optional, Tuple


SCRIPT_DIR = Path(__file__).resolve().parent
LINTER = SCRIPT_DIR / "lint-telnyx-correctness.sh"
POST_DIAGNOSTIC = SCRIPT_DIR / "post-test-diagnostic.sh"


class LinterRegressionTests(unittest.TestCase):
    def run_linter(
        self,
        files: Dict[str, str],
        product: str = "all",
        scan: Optional[Dict[str, object]] = None,
    ) -> Tuple[subprocess.CompletedProcess[str], Dict[str, object]]:
        with tempfile.TemporaryDirectory(prefix="telnyx-linter-test-") as temp:
            root = Path(temp)
            for relative_path, content in files.items():
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            command = ["bash", str(LINTER), str(root), "--product", product, "--json"]
            if scan is not None:
                scan_path = root / "scan-context.json"
                scan_path.write_text(json.dumps(scan), encoding="utf-8")
                command.extend(["--scan-json", str(scan_path)])
            completed = subprocess.run(command, text=True, capture_output=True, check=False)
            payload = json.loads(completed.stdout)
            return completed, payload

    @staticmethod
    def check(payload: Dict[str, object], name: str) -> Dict[str, object]:
        checks = payload["checks"]
        assert isinstance(checks, list)
        return next(item for item in checks if item["name"] == name)

    def assert_clean(self, completed: subprocess.CompletedProcess[str], payload: Dict[str, object]) -> None:
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertEqual(payload["summary"]["issues"], 0)

    def test_comments_and_nonsemantic_strings_are_ignored_in_every_source_family(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": '# from twilio.rest import Client\nexample = "VoiceResponse("\n',
                "case.js": '// require("twilio")\nconst x = "twilio.webhook(";\n',
                "case.ts": '/* new TelnyxWebhook( */\nconst x: string = "MessagingResponse(";\n',
                "case.rb": '# MessagingResponse(\nexample = "VoiceResponse("\n',
                "case.go": 'package fixture\n// import twilio\nvar x = "telnyx.Webhook.construct"\n',
                "Case.java": 'class Case { /* import com.twilio.Twilio; */ String x = "speechModel"; }\n',
                "case.php": '<?php // use Twilio\\Rest\\Client;\n$x = "RequestValidator(";\n',
                "Case.cs": '// using Twilio;\nclass Case { string X = "using Twilio"; }\n',
                "case.swift": '// import TwilioVoice\nlet x = "VoiceResponse("\n',
                "case.kt": '// import com.twilio.Twilio\nval x = "speechModel"\n',
                "case.xml": '<!-- speechModel="default" --><Response><Say>speechModel</Say></Response>\n',
                "case.html": '<!-- VoiceResponse( --><p>speechModel</p>\n',
            }
        )
        self.assert_clean(completed, payload)

    def test_nested_comments_are_ignored_in_languages_that_support_them(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.kt": "/* outer /* inner */ VoiceResponse() */\nclass Case\n",
                "case.swift": "/* outer /* inner */ VoiceResponse() */\nlet value = 1\n",
            },
            product="voice",
        )
        self.assert_clean(completed, payload)

    def test_multiline_body_is_detected_in_supported_named_argument_grammars(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": 'client.messages.send(\n to="+1",\n body="bad",\n)\n',
                "case.js": 'client.messages.send({\n to: "+1",\n body: "bad",\n});\n',
                "case.ts": 'client.messages.send({\n to: "+1",\n "body": "bad",\n});\n',
                "case.rb": 'client.messages.send(\n to: "+1",\n body: "bad"\n)\n',
                "case.php": '<?php $client->messages->send([\n "to" => "+1",\n "body" => "bad"\n]);\n',
            },
            product="messaging",
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "body_not_text")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["files"]), 5)

    def test_language_specific_twilio_imports_are_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": 'from twilio.rest import Client\n',
                "case.js": 'const twilio = require("twilio");\n',
                "case.ts": 'import { Twilio } from "twilio";\n',
                "case.rb": 'require "twilio-ruby"\n',
                "case.go": 'package fixture\nimport "github.com/twilio/twilio-go"\n',
                "Case.java": 'import com.twilio.Twilio;\nclass Case {}\n',
                "case.php": '<?php use Twilio\\Rest\\Client;\n',
                "Case.cs": 'using Twilio;\nclass Case {}\n',
                "case.swift": 'import TwilioVoice\n',
                "case.kt": 'import com.twilio.Twilio\nclass Case\n',
            }
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "residual_twilio_imports")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["files"]), 10)

    def test_every_declared_source_suffix_is_scanned(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": "from twilio.rest import Client\n",
                "case.pyi": "from twilio.rest import Client\n",
                "case.js": 'require("twilio")\n',
                "case.jsx": 'require("twilio")\n',
                "case.mjs": 'import twilio from "twilio"\n',
                "case.cjs": 'require("twilio")\n',
                "case.ts": 'import twilio from "twilio"\n',
                "case.tsx": 'import twilio from "twilio"\n',
                "case.mts": 'import twilio from "twilio"\n',
                "case.cts": 'import twilio from "twilio"\n',
                "case.rb": 'require "twilio-ruby"\n',
                "case.rake": 'require "twilio-ruby"\n',
                "case.erb": '<% require "twilio-ruby" %>\n',
                "case.go": 'package fixture\nimport "github.com/twilio/twilio-go"\n',
                "Case.java": "import com.twilio.Twilio;\nclass Case {}\n",
                "case.kt": "import com.twilio.Twilio\nclass Case\n",
                "case.kts": "import com.twilio.Twilio\n",
                "case.php": "<?php use Twilio\\Rest\\Client;\n",
                "Case.cs": "using Twilio;\nclass Case {}\n",
                "case.swift": "import TwilioVoice\n",
                "case.xml": '<Gather speechModel="default" />\n',
                "case.html": '<Gather speechModel="default" />\n',
                "case.htm": '<Gather speechModel="default" />\n',
            }
        )
        self.assertEqual(completed.returncode, 1)
        imports = self.check(payload, "residual_twilio_imports")
        speech = self.check(payload, "speech_model_attr")
        self.assertEqual(len(imports["details"]["files"]), 20)
        self.assertEqual(len(speech["details"]["files"]), 3)

    def test_language_specific_twilio_client_initializers_are_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": "client = Client(account_sid, auth_token)\n",
                "case.js": "const client = new Twilio(accountSid, authToken);\n",
                "case.rb": "client = Twilio::REST::Client.new sid, token\n",
                "case.go": "package fixture\nvar client = twilio.NewRestClient()\n",
                "Case.java": "class Case { void init() { Twilio.init(sid, token); } }\n",
                "case.php": "<?php $client = new \\Twilio\\Rest\\Client($sid, $token);\n",
                "Case.cs": "class Case { void Init() { TwilioClient.Init(sid, token); } }\n",
            }
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "twilio_client_instantiation")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["files"]), 7)

    def test_verify_approved_idioms_are_detected_without_domain_false_positive(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": 'approved = verification.status == "approved"\n',
                "case.js": 'const ok = verification.status === "approved";\n',
                "case.rb": 'ok = verification.status == "approved"\n',
                "case.go": 'package fixture\nvar ok = verification.Status == "approved"\n',
                "Case.java": 'class Case { boolean ok = verification.getStatus().equals("approved"); }\n',
                "case.php": '<?php $ok = $verification->status === "approved";\n',
                "compliance.py": 'approved = order.status == "approved"\n',
            },
            product="verify",
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "verify_status_approved")
        self.assertEqual(len(finding["details"]["files"]), 6)
        self.assertFalse(any(path.endswith("compliance.py") for path in finding["details"]["files"]))

    def test_internal_messages_create_is_not_treated_as_twilio(self) -> None:
        completed, payload = self.run_linter(
            {"case.js": 'const result = await db.messages.create({ text: "internal" });\n'},
            product="messaging",
        )
        self.assert_clean(completed, payload)
        self.assertEqual(self.check(payload, "twilio_messages_create")["status"], "pass")

    def test_twilio_messages_create_with_twilio_context_is_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.js": 'const twilio = require("twilio");\nclient.messages.create({ body: "bad" });\n'
            },
            product="messaging",
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "twilio_messages_create")["status"], "issue")

    def test_key_comment_cannot_make_an_insecure_webhook_pass(self) -> None:
        completed, payload = self.run_linter(
            {
                "handler.py": (
                    '@app.route("/webhook", methods=["POST"])\n'
                    "def webhook():\n"
                    ' hint = "verify_signature(request)"\n'
                    ' return data["payload"]\n'
                ),
                "config.py": '# TODO: load TELNYX_PUBLIC_KEY and call client.webhooks.unwrap(...)\n',
            }
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "webhook_ed25519_missing")["status"], "issue")

    def test_webhook_verification_is_evaluated_per_handler(self) -> None:
        completed, payload = self.run_linter(
            {
                "handlers.js": (
                    'app.post("/secure", (req, res) => {\n'
                    ' verifySignature(req);\n const payload = data.payload;\n});\n'
                    'app.post("/insecure", (req, res) => {\n'
                    ' const payload = data.payload;\n});\n'
                )
            }
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "webhook_ed25519_missing")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["matches"]), 1)

    def test_verifier_definition_below_handler_cannot_secure_it(self) -> None:
        completed, payload = self.run_linter(
            {
                "handler.js": (
                    'app.post("/insecure", (req, res) => {\n'
                    ' const payload = data.payload;\n});\n'
                    'function verifySignature(request) { return true; }\n'
                )
            }
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "webhook_ed25519_missing")["status"], "issue")

    def test_nested_verifier_definition_or_late_verification_cannot_secure_handler(self) -> None:
        completed, payload = self.run_linter(
            {
                "nested.py": (
                    '@app.post("/nested")\n'
                    "def hook():\n"
                    " def verify_signature(request):\n  return True\n"
                    ' return data.get("payload")\n'
                ),
                "late.js": (
                    'app.post("/late", (req, res) => {\n'
                    " const value = data.payload;\n"
                    " verifySignature(req);\n"
                    "});\n"
                ),
            }
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "webhook_ed25519_missing")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["files"]), 2)

    def test_insecure_webhook_handlers_are_found_in_every_declared_server_family(self) -> None:
        completed, payload = self.run_linter(
            {
                "handler.py": '@app.post("/webhook")\ndef hook():\n return data["payload"]\n',
                "handler.js": 'app.post("/webhook", () => { const value = data.payload; });\n',
                "handler.rb": 'post "/webhook" do\n  value = data[:payload]\nend\n',
                "handler.go": 'package fixture\nfunc hook() { http.HandleFunc("/webhook", func() { value := data.Payload }) }\n',
                "Handler.java": '@PostMapping("/webhook")\nvoid hook() { Object value = data.getPayload(); }\n',
                "handler.php": '<?php Route::post("/webhook", function () { $value = $data["payload"]; });\n',
                "Handler.cs": '[HttpPost("/webhook")]\nvoid Hook() { var value = data.Payload; }\n',
                "handler.swift": 'app.post("webhook") { request in let value = data.payload }\n',
            }
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "webhook_ed25519_missing")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["files"]), 8)

    def test_common_framework_handler_grammars_and_map_accessors_are_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "handler.py": '@blueprint.post("/webhook")\ndef hook():\n return data.get("payload")\n',
                "handler.js": 'fastify.post("/webhook", () => { return data["payload"]; });\n',
                "handler.go": 'package fixture\nfunc hook() { router.POST("/webhook", func() { value := data["payload"] }) }\n',
                "Handler.kt": 'post("/webhook") { val value = data["payload"] }\n',
                "Handler.cs": 'app.MapPost("/webhook", () => { var value = data["payload"]; });\n',
            }
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "webhook_ed25519_missing")
        self.assertEqual(finding["status"], "issue")
        self.assertEqual(len(finding["details"]["files"]), 5)

    def test_java_annotation_array_does_not_truncate_handler_body(self) -> None:
        completed, payload = self.run_linter(
            {
                "Handler.java": (
                    '@RequestMapping(path = "/webhook", method = {RequestMethod.POST})\n'
                    "void hook() { Object value = data.get(\"payload\"); }\n"
                )
            }
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "webhook_ed25519_missing")["status"], "issue")

    def test_handler_local_verification_passes(self) -> None:
        completed, payload = self.run_linter(
            {
                "handler.py": (
                    '@app.route("/webhook", methods=["POST"])\n'
                    'def webhook():\n verify_signature(request)\n return data["payload"]\n'
                )
            }
        )
        self.assert_clean(completed, payload)
        self.assertEqual(self.check(payload, "webhook_ed25519_missing")["status"], "pass")

    def test_xml_comments_and_text_are_ignored_but_attributes_are_detected(self) -> None:
        clean, clean_payload = self.run_linter(
            {"case.xml": '<!-- speechModel="x" --><Response><Say>speechModel</Say></Response>\n'},
            product="voice",
        )
        self.assert_clean(clean, clean_payload)
        bad, bad_payload = self.run_linter(
            {"case.xml": '<Response><Gather speechModel="default" /></Response>\n'},
            product="voice",
        )
        self.assertEqual(bad.returncode, 1)
        self.assertEqual(self.check(bad_payload, "speech_model_attr")["status"], "issue")

    def test_xml_greater_than_inside_quoted_attribute_does_not_end_tag(self) -> None:
        completed, payload = self.run_linter(
            {"case.xml": '<Gather condition="count > 0" speechModel="default" />\n'},
            product="voice",
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "speech_model_attr")["status"], "issue")

    def test_builder_syntax_variants_are_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.py": 'response = VoiceResponse()\n',
                "case.js": 'const response = new VoiceResponse();\n',
                "case.rb": 'response = Twilio::TwiML::VoiceResponse.new\n',
                "Case.java": 'class Case { Object response = new VoiceResponse.Builder(); }\n',
                "case.php": '<?php $response = new VoiceResponse();\n',
            },
            product="voice",
        )
        self.assertEqual(completed.returncode, 1)
        finding = self.check(payload, "voice_response_builder")
        self.assertEqual(len(finding["details"]["files"]), 5)

    def test_messaging_response_builder_is_detected(self) -> None:
        completed, payload = self.run_linter(
            {"case.js": "const response = new MessagingResponse();\n"},
            product="messaging",
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "messaging_response_builder")["status"], "issue")

    def test_recording_download_logic_suppresses_expiry_warning(self) -> None:
        completed, payload = self.run_linter(
            {"case.py": 'recording_url = payload.recording_url\ncontent = requests.get(recording_url)\n'},
            product="voice",
        )
        self.assert_clean(completed, payload)
        self.assertEqual(self.check(payload, "recording_url_expiry")["status"], "pass")

    def test_unhandled_recording_url_is_a_warning(self) -> None:
        completed, payload = self.run_linter(
            {"case.py": "recording_url = payload.recording_url\nsave(recording_url)\n"},
            product="voice",
        )
        self.assert_clean(completed, payload)
        self.assertEqual(self.check(payload, "recording_url_expiry")["status"], "warn")

    def test_polly_result_uses_the_matched_voice_not_other_line_text(self) -> None:
        completed, payload = self.run_linter(
            {"case.py": 'voice = "Polly.Amy"  # Polly.Brian-Neural is another option\n'},
            product="voice",
        )
        self.assert_clean(completed, payload)
        self.assertEqual(self.check(payload, "polly_non_neural")["status"], "warn")

    def test_original_unvalidated_webhook_is_still_a_blocking_issue(self) -> None:
        completed, payload = self.run_linter(
            {
                "handler.py": '@app.route("/webhook", methods=["POST"])\ndef webhook():\n return data["payload"]\n'
            },
            scan={"has_webhook_validation": False},
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "webhook_ed25519_missing")["status"], "issue")

    def test_diagnostics_count_unique_files_and_preserve_match_locations(self) -> None:
        completed, payload = self.run_linter(
            {"case.py": 'first = VoiceResponse()\nsecond = VoiceResponse()\n'},
            product="voice",
        )
        self.assertEqual(completed.returncode, 1)
        details = self.check(payload, "voice_response_builder")["details"]
        self.assertEqual(len(details["files"]), 1)
        self.assertEqual(len(details["matches"]), 2)
        self.assertEqual([match["line"] for match in details["matches"]], [1, 2])
        self.assertEqual(payload["issues"], payload["summary"]["issues"])
        self.assertEqual(payload["warnings"], payload["summary"]["warnings"])
        self.assertEqual(payload["passes"], payload["summary"]["passes"])
        self.assertIn("Twilio VoiceResponse builder", self.check(payload, "voice_response_builder")["message"])

    def test_current_telnyx_message_send_is_clean_and_profile_is_optional(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.js": (
                    'import Telnyx from "telnyx";\n'
                    'await client.messages.send({ to: "+1", from: "+2", text: "hello" });\n'
                )
            },
            product="messaging",
        )
        self.assert_clean(completed, payload)
        self.assertEqual(self.check(payload, "missing_messaging_profile_id")["status"], "pass")

    def test_verify_start_without_profile_warns_and_profile_variant_passes(self) -> None:
        warning, warning_payload = self.run_linter(
            {"case.js": "client.verifications.sms.create({ to: phone });\n"},
            product="verify",
        )
        self.assert_clean(warning, warning_payload)
        self.assertEqual(self.check(warning_payload, "missing_verify_profile_id")["status"], "warn")

        clean, clean_payload = self.run_linter(
            {
                "case.js": (
                    "const verifyProfileId = process.env.TELNYX_VERIFY_PROFILE_ID;\n"
                    "client.verifications.sms.create({ to: phone, verifyProfileId });\n"
                )
            },
            product="verify",
        )
        self.assert_clean(clean, clean_payload)
        self.assertEqual(self.check(clean_payload, "missing_verify_profile_id")["status"], "pass")

    def test_hallucinated_method_and_twilio_middleware_are_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "case.js": (
                    "client.verifications.submitVerification({ code });\n"
                    "app.post('/webhook', twilio.webhook(), handler);\n"
                )
            }
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "hallucinated_method")["status"], "issue")
        self.assertEqual(self.check(payload, "twilio_webhook_middleware")["status"], "issue")

    def test_documentation_and_directory_residuals_are_detected(self) -> None:
        completed, payload = self.run_linter(
            {
                "README.md": "This service sends calls through Twilio.\n",
                "twilio-service/placeholder.txt": "fixture\n",
            }
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "docs_still_twilio")["status"], "issue")
        self.assertEqual(self.check(payload, "twilio_directory_names")["status"], "issue")

    def test_all_product_emits_the_complete_check_inventory(self) -> None:
        completed, payload = self.run_linter({"case.py": "value = 1\n"})
        self.assert_clean(completed, payload)
        self.assertEqual(
            {check["name"] for check in payload["checks"]},
            {
                "twilio_messages_create",
                "body_not_text",
                "missing_messaging_profile_id",
                "messaging_response_builder",
                "voice_response_builder",
                "speech_model_attr",
                "recording_url_expiry",
                "verify_status_approved",
                "missing_verify_profile_id",
                "hallucinated_method",
                "webhook_ed25519_missing",
                "twilio_webhook_middleware",
                "polly_non_neural",
                "docs_still_twilio",
                "residual_twilio_imports",
                "twilio_client_instantiation",
                "twilio_directory_names",
            },
        )
        scope = payload["analysis_scope"]
        self.assertEqual(scope["kind"], "dependency-free lexical analysis")
        self.assertEqual(scope["source_suffix_count"], 23)
        self.assertEqual(len(scope["source_suffixes"]), 23)
        self.assertEqual(scope["lexical_family_count"], 9)
        self.assertEqual(len(scope["lexical_families"]), 9)
        self.assertEqual(scope["server_handler_family_count"], 8)
        self.assertEqual(scope["emitted_check_count"], 17)
        self.assertGreaterEqual(len(scope["limitations"]), 5)

    def test_product_filter_omits_unrelated_product_checks(self) -> None:
        completed, payload = self.run_linter({"case.py": "value = 1\n"}, product="messaging")
        self.assert_clean(completed, payload)
        names = {check["name"] for check in payload["checks"]}
        self.assertIn("body_not_text", names)
        self.assertNotIn("voice_response_builder", names)
        self.assertNotIn("verify_status_approved", names)

    def test_pay_filter_runs_voice_and_texml_checks(self) -> None:
        completed, payload = self.run_linter(
            {"pay.xml": '<Response><Pay/><Gather speechModel="phone_call" /></Response>\n'},
            product="pay",
        )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(self.check(payload, "speech_model_attr")["status"], "issue")
        self.assertEqual(payload["product_filter"], "pay")

    def test_invalid_product_is_a_usage_error(self) -> None:
        with tempfile.TemporaryDirectory(prefix="telnyx-linter-test-") as temp:
            completed = subprocess.run(
                ["bash", str(LINTER), temp, "--product", "not-a-product", "--json"],
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("invalid choice", completed.stderr)

    def test_human_output_preserves_issue_exit_and_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory(prefix="telnyx linter human ") as temp:
            root = Path(temp)
            (root / "case.py").write_text("value = VoiceResponse()\n", encoding="utf-8")
            completed = subprocess.run(
                ["bash", str(LINTER), str(root), "--product", "voice"],
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(completed.returncode, 1)
        self.assertIn("ISSUE", completed.stdout)
        self.assertIn("case.py:1", completed.stdout)

    def test_post_diagnostic_reads_nested_summary_and_quotes_space_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="telnyx linter diagnostic ") as temp:
            root = Path(temp)
            (root / "case.js").write_text('require("twilio");\n', encoding="utf-8")
            completed = subprocess.run(
                ["bash", str(POST_DIAGNOSTIC), str(root)],
                text=True,
                capture_output=True,
                check=False,
            )
            report = json.loads((root / "SKILL-DIAGNOSTIC.json").read_text(encoding="utf-8"))
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("Issues: 1", completed.stdout)
        self.assertEqual(report["lint"]["summary"]["issues"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
