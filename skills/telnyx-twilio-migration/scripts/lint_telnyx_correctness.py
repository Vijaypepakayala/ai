#!/usr/bin/env python3
"""Language-aware Telnyx migration correctness linter.

The shell entrypoint delegates here so callers keep the documented interface.
This module uses a dependency-free lexical pass for every supported source
family. Checks run on code with comments and irrelevant string contents masked,
which prevents documentation/examples from being treated as executable code.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Pattern, Sequence, Set, Tuple


EXCLUDED_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "vendor",
    "venv",
}
EXCLUDED_FILES = {
    "Gemfile.lock",
    "MIGRATION-PLAN.md",
    "MIGRATION-REPORT.md",
    "Pipfile.lock",
    "go.sum",
    "migration-state.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "poetry.lock",
    "twilio-deep-scan.json",
    "twilio-scan.json",
    "yarn.lock",
}

PYTHON_EXTS = {".py", ".pyi"}
JAVASCRIPT_EXTS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"}
RUBY_EXTS = {".rb", ".rake", ".erb"}
GO_EXTS = {".go"}
JAVA_EXTS = {".java", ".kt", ".kts"}
PHP_EXTS = {".php"}
CSHARP_EXTS = {".cs"}
SWIFT_EXTS = {".swift"}
XML_EXTS = {".xml", ".html", ".htm"}
SOURCE_EXTS = (
    PYTHON_EXTS
    | JAVASCRIPT_EXTS
    | RUBY_EXTS
    | GO_EXTS
    | JAVA_EXTS
    | PHP_EXTS
    | CSHARP_EXTS
    | SWIFT_EXTS
    | XML_EXTS
)

LEXICAL_FAMILIES = (
    "Python",
    "JavaScript/TypeScript",
    "Ruby",
    "Go",
    "Java/Kotlin",
    "PHP",
    "C#",
    "Swift",
    "XML/HTML",
)
SERVER_HANDLER_FAMILIES = 8
ANALYSIS_LIMITATIONS = (
    "runtime-generated or reflected method and route names",
    "code executed only inside string interpolation, eval, macros, or templates",
    "cross-file aliases and data-flow relationships",
    "nonstandard framework route registration",
    "XML generated only at runtime",
)

MESSAGING_EXTS = PYTHON_EXTS | JAVASCRIPT_EXTS | RUBY_EXTS | GO_EXTS | JAVA_EXTS | PHP_EXTS
VOICE_EXTS = MESSAGING_EXTS | XML_EXTS
VERIFY_EXTS = MESSAGING_EXTS
WEBHOOK_EXTS = SOURCE_EXTS - XML_EXTS


@dataclass(frozen=True)
class SourceFile:
    path: Path
    text: str
    masked: str
    extension: str


@dataclass(frozen=True)
class Match:
    path: Path
    line: int
    text: str
    value: str = ""


def blank_range(chars: List[str], start: int, end: int) -> None:
    for index in range(start, min(end, len(chars))):
        if chars[index] != "\n":
            chars[index] = " "


def preserve_literal(value: str) -> bool:
    stripped = value.strip()
    lowered = stripped.lower()
    if lowered in {"approved", "body", "event_type", "payload"}:
        return True
    if re.fullmatch(
        r"(?:twilio|twilio-ruby|@twilio/[\w./-]+|github\.com/twilio/[\w./-]+|com\.twilio[\w./-]*)",
        lowered,
    ):
        return True
    if re.fullmatch(r"Polly\.[A-Z][A-Za-z]*(?:-Neural)?", stripped):
        return True
    if "<" in value and re.search(r"\b(?:speechModel\s*=|Polly\.[A-Z])", value):
        return True
    return False


def mask_xml(text: str) -> str:
    chars = list(text)
    index = 0
    in_tag = False
    quote: Optional[str] = None
    while index < len(text):
        if quote is None and text.startswith("<!--", index):
            end = text.find("-->", index + 4)
            end = len(text) if end < 0 else end + 3
            blank_range(chars, index, end)
            index = end
            continue
        if quote is None and text.startswith("<![CDATA[", index):
            end = text.find("]]>", index + 9)
            end = len(text) if end < 0 else end + 3
            blank_range(chars, index, end)
            index = end
            continue
        char = text[index]
        if not in_tag and char == "<":
            in_tag = True
        elif in_tag and quote is None and char in {"'", '"'}:
            quote = char
        elif in_tag and quote == char:
            quote = None
        elif in_tag and quote is None and char == ">":
            in_tag = False
        elif not in_tag and char != "\n":
            chars[index] = " "
        index += 1
    return "".join(chars)


def mask_ruby_block_comments(text: str, chars: List[str]) -> None:
    offset = 0
    in_comment = False
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        if not in_comment and stripped.startswith("=begin"):
            in_comment = True
        if in_comment:
            blank_range(chars, offset, offset + len(line))
        if in_comment and stripped.startswith("=end"):
            in_comment = False
        offset += len(line)


def mask_source(text: str, extension: str) -> str:
    if extension in XML_EXTS:
        return mask_xml(text)

    chars = list(text)
    if extension in RUBY_EXTS:
        mask_ruby_block_comments(text, chars)

    hash_comments = extension in PYTHON_EXTS | RUBY_EXTS | PHP_EXTS
    slash_comments = extension in (
        JAVASCRIPT_EXTS | GO_EXTS | JAVA_EXTS | PHP_EXTS | CSHARP_EXTS | SWIFT_EXTS
    )
    backtick_strings = extension in JAVASCRIPT_EXTS | GO_EXTS
    triple_strings = extension in PYTHON_EXTS or extension in JAVA_EXTS

    index = 0
    while index < len(text):
        if chars[index] == " " and text[index] != " ":
            index += 1
            continue
        if slash_comments and text.startswith("//", index):
            end = text.find("\n", index + 2)
            end = len(text) if end < 0 else end
            blank_range(chars, index, end)
            index = end
            continue
        if slash_comments and text.startswith("/*", index):
            if extension in SWIFT_EXTS | {".kt", ".kts"}:
                cursor = index + 2
                depth = 1
                while cursor < len(text) and depth:
                    if text.startswith("/*", cursor):
                        depth += 1
                        cursor += 2
                    elif text.startswith("*/", cursor):
                        depth -= 1
                        cursor += 2
                    else:
                        cursor += 1
                end = cursor
            else:
                end = text.find("*/", index + 2)
                end = len(text) if end < 0 else end + 2
            blank_range(chars, index, end)
            index = end
            continue
        if hash_comments and text[index] == "#":
            end = text.find("\n", index + 1)
            end = len(text) if end < 0 else end
            blank_range(chars, index, end)
            index = end
            continue

        quote: Optional[str] = None
        delimiter_length = 1
        if triple_strings and text.startswith("'''", index):
            quote = "'''"
            delimiter_length = 3
        elif triple_strings and text.startswith('\"\"\"', index):
            quote = '\"\"\"'
            delimiter_length = 3
        elif text[index] in {"'", '"'}:
            quote = text[index]
        elif backtick_strings and text[index] == "`":
            quote = "`"

        if quote is None:
            index += 1
            continue

        start = index
        index += delimiter_length
        content_start = index
        escaped = False
        while index < len(text):
            if delimiter_length == 3 and text.startswith(quote, index):
                break
            if delimiter_length == 1 and text[index] == quote:
                if extension in CSHARP_EXTS and quote == '"' and text.startswith('""', index):
                    index += 2
                    continue
                if not escaped:
                    break
            if text[index] == "\\" and not escaped and quote != "`":
                escaped = True
                index += 1
                continue
            escaped = False
            index += 1
        content_end = index
        end = min(len(text), index + delimiter_length)
        value = text[content_start:content_end]
        blank_range(chars, start, end)
        if preserve_literal(value):
            for literal_index in range(content_start, content_end):
                if text[literal_index] != "\n":
                    chars[literal_index] = text[literal_index]
        index = end

    return "".join(chars)


def line_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def line_text(text: str, line: int) -> str:
    lines = text.splitlines()
    return lines[line - 1].strip() if 0 < line <= len(lines) else ""


def make_match(source: SourceFile, offset: int, value: str = "") -> Match:
    line = line_for_offset(source.text, offset)
    return Match(source.path, line, line_text(source.text, line), value)


def dedupe_matches(matches: Iterable[Match]) -> List[Match]:
    unique: Dict[Tuple[str, int, str, str], Match] = {}
    for match in matches:
        unique[(str(match.path), match.line, match.text, match.value)] = match
    return sorted(unique.values(), key=lambda item: (str(item.path), item.line, item.text))


class CorrectnessLinter:
    def __init__(
        self,
        root: Path,
        product: str,
        json_mode: bool,
        scan_json: Optional[Path],
    ) -> None:
        self.root = root
        self.product = product
        self.json_mode = json_mode
        self.sources = self._load_sources()
        self.checks: List[Dict[str, object]] = []
        self.issue_count = 0
        self.warn_count = 0
        self.pass_count = 0
        self.scan_products: Set[str] = set()
        if scan_json and scan_json.is_file():
            try:
                scan = json.loads(scan_json.read_text(encoding="utf-8"))
                self.scan_products = {
                    str(item).lower() for item in scan.get("products_used", [])
                }
            except (OSError, ValueError, TypeError):
                pass

    def _load_sources(self) -> List[SourceFile]:
        sources: List[SourceFile] = []
        for current_root, dirs, files in os.walk(self.root):
            dirs[:] = sorted(directory for directory in dirs if directory not in EXCLUDED_DIRS)
            for filename in sorted(files):
                path = Path(current_root) / filename
                extension = path.suffix.lower()
                if filename in EXCLUDED_FILES or filename.endswith(".min.js"):
                    continue
                if extension not in SOURCE_EXTS:
                    continue
                try:
                    text = path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                sources.append(SourceFile(path, text, mask_source(text, extension), extension))
        return sources

    def product_applies(self, product: str) -> bool:
        return (
            self.product == "all"
            or product == "all"
            or self.product == product
            or (self.product == "pay" and product == "voice")
        )

    def scan_has_product(self, product: str) -> bool:
        return not self.scan_products or product in self.scan_products

    def find(
        self,
        pattern: str,
        extensions: Set[str],
        flags: int = re.IGNORECASE | re.MULTILINE,
        sources: Optional[Iterable[SourceFile]] = None,
    ) -> List[Match]:
        compiled = re.compile(pattern, flags)
        matches: List[Match] = []
        search_sources = self.sources if sources is None else sources
        for source in search_sources:
            if source.extension not in extensions:
                continue
            matches.extend(
                make_match(source, match.start(), match.group(0))
                for match in compiled.finditer(source.masked)
            )
        return dedupe_matches(matches)

    def matching_sources(self, pattern: str, extensions: Set[str]) -> List[SourceFile]:
        compiled = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
        return [
            source
            for source in self.sources
            if source.extension in extensions and compiled.search(source.masked)
        ]

    def details(self, matches: Sequence[Match]) -> Optional[Dict[str, object]]:
        if not matches:
            return None
        limited = list(matches[:20])
        return {
            "files": sorted({str(match.path) for match in matches}),
            "matches": [
                {"path": str(match.path), "line": match.line, "text": match.text}
                for match in limited
            ],
        }

    def emit(
        self,
        name: str,
        status: str,
        message: str,
        fix: Optional[str] = None,
        matches: Sequence[Match] = (),
    ) -> None:
        check: Dict[str, object] = {
            "name": name,
            "status": status,
            "message": message,
        }
        if fix is not None:
            check["fix"] = fix
        detail = self.details(matches)
        if detail is not None:
            check["details"] = detail
        elif status != "pass":
            check["details"] = None
        self.checks.append(check)
        if status == "issue":
            self.issue_count += 1
        elif status == "warn":
            self.warn_count += 1
        else:
            self.pass_count += 1
        if not self.json_mode:
            label = {"issue": "ISSUE", "warn": "WARN", "pass": "PASS"}[status]
            print(f"  {label:<5}  {message}")
            if fix:
                print(f"         FIX:  {fix}")
            for match in matches[:20]:
                print(f"         - {match.path}:{match.line}:{match.text}")

    def check_or_pass(
        self,
        name: str,
        matches: Sequence[Match],
        message: str,
        fix: str,
        pass_message: str,
        status: str = "issue",
    ) -> None:
        if matches:
            self.emit(name, status, message, fix, matches)
        else:
            self.emit(name, "pass", pass_message)

    def find_call_argument(
        self,
        method_pattern: str,
        argument_pattern: str,
        extensions: Set[str],
    ) -> List[Match]:
        method = re.compile(method_pattern, re.IGNORECASE | re.MULTILINE)
        argument = re.compile(argument_pattern, re.IGNORECASE | re.MULTILINE)
        hits: List[Match] = []
        for source in self.sources:
            if source.extension not in extensions:
                continue
            for call in method.finditer(source.masked):
                open_paren = source.masked.find("(", call.start(), call.end() + 1)
                if open_paren < 0:
                    continue
                depth = 0
                end = open_paren
                while end < len(source.masked):
                    char = source.masked[end]
                    if char == "(":
                        depth += 1
                    elif char == ")":
                        depth -= 1
                        if depth == 0:
                            end += 1
                            break
                    end += 1
                arguments = source.masked[open_paren:end]
                found = argument.search(arguments)
                if found:
                    hits.append(make_match(source, open_paren + found.start()))
        return dedupe_matches(hits)

    @staticmethod
    def twilio_context(source: SourceFile) -> bool:
        return bool(
            re.search(
                r"(?i)(?:\bfrom\s+twilio\b|\bimport[ \t]+[^;\n]*twilio|"
                r"\brequire\s*\(?[^)\n]*twilio|\buse\s+Twilio\\|"
                r"\busing\s+Twilio\b|github\.com/twilio/|@twilio/|"
                r"Twilio::|\bnew\s+Twilio\b|\btwilio\.)",
                source.masked,
            )
        )

    def run_messaging(self) -> None:
        twilio_sources = [source for source in self.sources if self.twilio_context(source)]
        create_matches = self.find(
            r"\.messages\s*(?:\.|->)\s*create\s*\(",
            MESSAGING_EXTS,
            sources=twilio_sources,
        )
        self.check_or_pass(
            "twilio_messages_create",
            create_matches,
            f"Twilio messages.create pattern found in {len({m.path for m in create_matches})} file(s)",
            "Use the current Telnyx SDK messages.send method with a text parameter",
            "No Twilio messages.create pattern found",
        )

        body_matches = self.find_call_argument(
            r"(?:\bclient|\btelnyx)\s*(?:\.|->)\s*messages\s*(?:\.|->)\s*(?:send|create)\s*\(",
            r"(?:\bbody\b|['\"]body['\"])\s*(?:=|:|=>)",
            PYTHON_EXTS | JAVASCRIPT_EXTS | RUBY_EXTS | PHP_EXTS,
        )
        self.check_or_pass(
            "body_not_text",
            body_matches,
            f"Message send with body parameter found in {len({m.path for m in body_matches})} file(s)",
            "Telnyx uses text, not body, for message content",
            "No body parameter in Telnyx message calls",
        )

        # Per-request messaging_profile_id is optional when the sending number is
        # already assigned to a profile. A source-only linter cannot prove that
        # provisioning state, so it must not report its absence as a code defect.
        self.emit(
            "missing_messaging_profile_id",
            "pass",
            "Per-request messaging_profile_id is optional; validate number assignment during provisioning",
        )

        builder_matches = self.find(
            r"\bMessagingResponse\s*(?:\(|\.new\b|\.Builder\b)",
            PYTHON_EXTS | JAVASCRIPT_EXTS | RUBY_EXTS | JAVA_EXTS | PHP_EXTS,
        )
        self.check_or_pass(
            "messaging_response_builder",
            builder_matches,
            f"Twilio MessagingResponse builder found in {len({m.path for m in builder_matches})} file(s)",
            "Return JSON or use the Telnyx SDK to send replies; Telnyx has no MessagingResponse builder",
            "No Twilio MessagingResponse builder found",
        )

    def run_voice(self) -> None:
        builders = self.find(
            r"\bVoiceResponse\s*(?:\(|\.new\b|\.Builder\b)",
            VOICE_EXTS - XML_EXTS,
        )
        self.check_or_pass(
            "voice_response_builder",
            builders,
            f"Twilio VoiceResponse builder found in {len({m.path for m in builders})} file(s)",
            "Return TeXML directly or use Call Control; Telnyx has no VoiceResponse builder",
            "No Twilio VoiceResponse builder found",
        )

        speech_model = self.find(r"\bspeechModel\s*=", VOICE_EXTS)
        self.check_or_pass(
            "speech_model_attr",
            speech_model,
            f"speechModel attribute found in {len({m.path for m in speech_model})} file(s)",
            "Remove speechModel; Telnyx uses transcriptionEngine",
            "No speechModel attribute found",
        )

        unsafe_recordings: List[Match] = []
        if self.scan_has_product("voice"):
            refs = re.compile(r"(?i)(?:recording.*url|RecordingUrl|recording_url)")
            downloader = re.compile(
                r"(?i)(?:requests?\.get|fetch\s*\(|download|http\.Get|Net::HTTP|"
                r"file_put_contents|writeFile|File\.write|getInputStream)"
            )
            for source in self.sources:
                if source.extension not in VOICE_EXTS - XML_EXTS:
                    continue
                for match in refs.finditer(source.masked):
                    if not downloader.search(source.masked):
                        unsafe_recordings.append(make_match(source, match.start()))
        self.check_or_pass(
            "recording_url_expiry",
            dedupe_matches(unsafe_recordings),
            f"Recording URL references without download logic found in {len({m.path for m in unsafe_recordings})} file(s)",
            "Download Telnyx recording URLs immediately; they expire after 10 minutes",
            "No unhandled recording URL references found",
            status="warn",
        )

    def run_verify(self) -> None:
        approved_matches: List[Match] = []
        for source in self.sources:
            if source.extension not in VERIFY_EXTS:
                continue
            for approved in re.finditer(r"(?i)\bapproved\b", source.masked):
                start = max(0, approved.start() - 240)
                end = min(len(source.masked), approved.end() + 240)
                window = source.masked[start:end]
                if re.search(r"(?i)verif", window) and re.search(
                    r"(?i)(?:\bstatus\b|\.Status\b|getStatus\s*\()", window
                ):
                    approved_matches.append(make_match(source, approved.start()))
        self.check_or_pass(
            "verify_status_approved",
            dedupe_matches(approved_matches),
            f"Twilio Verify approved-status pattern found in {len({m.path for m in approved_matches})} file(s)",
            "Telnyx verification results use response_code accepted",
            "No Twilio Verify approved-status check found",
        )

        missing_profiles: List[Match] = []
        if self.scan_has_product("verify"):
            start_pattern = re.compile(
                r"(?i)(?:verifications?\s*(?:\.|->).*(?:sms|call|flashcall|create)|/verifications/(?:sms|call|flashcall))"
            )
            profile_pattern = re.compile(
                r"(?i)(?:verify_profile_id|verifyProfileId|profile_id|profileId)"
            )
            for source in self.sources:
                if source.extension not in VERIFY_EXTS:
                    continue
                start = start_pattern.search(source.masked)
                if start and not profile_pattern.search(source.masked):
                    missing_profiles.append(make_match(source, start.start()))
        self.check_or_pass(
            "missing_verify_profile_id",
            dedupe_matches(missing_profiles),
            f"Verification start calls without a profile reference found in {len({m.path for m in missing_profiles})} file(s)",
            "Include verify_profile_id (or the SDK's language-specific equivalent)",
            "Verification calls include a profile reference or were not found",
            status="warn",
        )

    def run_hallucinated_methods(self) -> None:
        patterns = [
            r"verifications\s*(?:\.|->)\s*submitVerification\b",
            r"verifications\s*(?:\.|->)\s*checkVerification\b",
            r"\bnew\s+TelnyxWebhook\s*\(",
            r"telnyx\s*(?:\.|::)\s*Webhook\s*(?:\.|::)\s*construct\b",
        ]
        matches: List[Match] = []
        for pattern in patterns:
            matches.extend(self.find(pattern, SOURCE_EXTS - XML_EXTS))
        self.check_or_pass(
            "hallucinated_method",
            dedupe_matches(matches),
            f"Non-existent Telnyx method patterns found in {len({m.path for m in matches})} file(s)",
            "Consult sdk-reference/{language}/{product}.md for the current method signature",
            "No hallucinated Telnyx method names found",
        )

    @staticmethod
    def handler_pattern(extension: str) -> Optional[Pattern[str]]:
        if extension in PYTHON_EXTS:
            pattern = r"(?m)^[ \t]*(?:@[A-Za-z_]\w*\.(?:post|put|route)|@csrf_exempt)"
        elif extension in JAVASCRIPT_EXTS:
            pattern = r"\b(?:app|router|server|fastify)\s*\.\s*(?:post|put)\s*\("
        elif extension in RUBY_EXTS:
            pattern = r"(?m)^[ \t]*(?:post|put)\b.*\bdo\b"
        elif extension in GO_EXTS:
            pattern = r"(?:\bhttp\.(?:HandleFunc|Handle)|\b[A-Za-z_]\w*\.(?:POST|Post|Put))\s*\("
        elif extension in JAVA_EXTS:
            if extension in {".kt", ".kts"}:
                pattern = r"(?:@(?:PostMapping|PutMapping|RequestMapping|POST)\b|^[ \t]*post\s*\()"
            else:
                pattern = r"@(?:PostMapping|PutMapping|RequestMapping|POST)\b"
        elif extension in PHP_EXTS:
            pattern = r"(?:\bRoute::(?:post|put)\s*\(|->\s*(?:post|put)\s*\()"
        elif extension in CSHARP_EXTS:
            pattern = r"(?:\[(?:HttpPost|HttpPut)\b|\bapp\.Map(?:Post|Put)\s*\()"
        elif extension in SWIFT_EXTS:
            pattern = r"\b(?:app|routes)\.(?:post|put)\s*\("
        else:
            return None
        return re.compile(pattern, re.IGNORECASE | re.MULTILINE)

    @staticmethod
    def balanced_end(text: str, start: int, opening: str, closing: str) -> Optional[int]:
        opening_index = text.find(opening, start)
        if opening_index < 0:
            return None
        depth = 0
        for index in range(opening_index, len(text)):
            if text[index] == opening:
                depth += 1
            elif text[index] == closing:
                depth -= 1
                if depth == 0:
                    return index + 1
        return None

    @classmethod
    def braced_body_end(cls, text: str, start: int, fallback: int) -> int:
        """Find a handler body brace, ignoring braces inside attributes/call arguments."""
        paren_depth = 0
        bracket_depth = 0
        for index in range(start, fallback):
            char = text[index]
            if char == "(":
                paren_depth += 1
            elif char == ")" and paren_depth:
                paren_depth -= 1
            elif char == "[":
                bracket_depth += 1
            elif char == "]" and bracket_depth:
                bracket_depth -= 1
            elif char == "{" and paren_depth == 0 and bracket_depth == 0:
                return min(cls.balanced_end(text, index, "{", "}") or fallback, fallback)
        return fallback

    @classmethod
    def handler_segment_end(cls, source: SourceFile, start: int, fallback: int) -> int:
        if source.extension in JAVASCRIPT_EXTS | GO_EXTS | PHP_EXTS:
            return min(cls.balanced_end(source.masked, start, "(", ")") or fallback, fallback)
        if source.extension in CSHARP_EXTS and re.match(
            r"(?i)app\.Map(?:Post|Put)\s*\(", source.masked[start:]
        ):
            return min(cls.balanced_end(source.masked, start, "(", ")") or fallback, fallback)
        if source.extension in JAVA_EXTS | CSHARP_EXTS | SWIFT_EXTS:
            return cls.braced_body_end(source.masked, start, fallback)
        if source.extension in PYTHON_EXTS:
            function = re.search(
                r"(?m)^[ \t]*(?:async[ \t]+)?def[ \t]+[A-Za-z_]\w*[ \t]*\(",
                source.masked[start:fallback],
            )
            if not function:
                return fallback
            function_start = start + function.start()
            line_start = source.masked.rfind("\n", 0, function_start) + 1
            definition = source.masked[line_start:].split("\n", 1)[0]
            base_indent = len(definition) - len(definition.lstrip(" \t"))
            offset = line_start + len(definition) + 1
            for line in source.masked[offset:fallback].splitlines(keepends=True):
                stripped = line.strip()
                indent = len(line) - len(line.lstrip(" \t"))
                if stripped and indent <= base_indent and not stripped.startswith("@"):
                    return offset
                offset += len(line)
            return fallback
        if source.extension in RUBY_EXTS:
            route_line_start = source.masked.rfind("\n", 0, start) + 1
            route_line = source.masked[route_line_start:].split("\n", 1)[0]
            base_indent = len(route_line) - len(route_line.lstrip(" \t"))
            offset = route_line_start + len(route_line) + 1
            for line in source.masked[offset:fallback].splitlines(keepends=True):
                stripped = line.strip()
                indent = len(line) - len(line.lstrip(" \t"))
                if indent == base_indent and re.match(r"end\b", stripped):
                    return offset + len(line)
                offset += len(line)
        return fallback

    def run_webhooks(self) -> None:
        payload_pattern = re.compile(
            r"(?i)(?:data\s*(?:\.|->)\s*(?:payload|event_type)|"
            r"data\s*\[\s*:?\s*(?:payload|event_type)|"
            r"data\s*(?:\.|->)\s*get\s*\(\s*(?:payload|event_type)|"
            r"data\.(?:Payload|EventType)|get(?:Payload|EventType)\s*\()"
        )
        verification_pattern = re.compile(
            r"(?i)(?:webhooks?\.unwrap\s*\(|"
            r"verify[_A-Za-z]*(?:signature|webhook)\s*\(|"
            r"validate[_A-Za-z]*(?:signature|webhook)\s*\(|"
            r"ed25519\s*\.\s*verify\s*\(|Signature\s*\.\s*verify\s*\(|"
            r"crypto_sign_verify[_A-Za-z]*\s*\(|VerifyWebhookSignature\s*\()"
        )
        insecure: List[Match] = []
        secure_handlers = 0
        for source in self.sources:
            if source.extension not in WEBHOOK_EXTS:
                continue
            handler_pattern = self.handler_pattern(source.extension)
            if handler_pattern is None:
                continue
            starts = list(handler_pattern.finditer(source.masked))
            for index, handler in enumerate(starts):
                fallback = starts[index + 1].start() if index + 1 < len(starts) else len(source.masked)
                segment_end = self.handler_segment_end(source, handler.start(), fallback)
                segment = source.masked[handler.start():segment_end]
                payload = payload_pattern.search(segment)
                if not payload:
                    continue
                verification = next(
                    (
                        candidate
                        for candidate in verification_pattern.finditer(segment)
                        if candidate.start() < payload.start()
                        and not re.search(
                            r"(?i)\b(?:def|function|func)\s*$",
                            segment[max(0, candidate.start() - 40):candidate.start()],
                        )
                    ),
                    None,
                )
                if verification:
                    secure_handlers += 1
                else:
                    insecure.append(make_match(source, handler.start() + payload.start()))
        insecure = dedupe_matches(insecure)
        if insecure:
            self.emit(
                "webhook_ed25519_missing",
                "issue",
                "Telnyx webhook handler(s) lack handler-local signature verification",
                "Verify each handler with Ed25519 before parsing or side effects; configuration strings alone do not count",
                insecure,
            )
        else:
            self.emit(
                "webhook_ed25519_missing",
                "pass",
                f"No insecure Telnyx webhook handlers found ({secure_handlers} verified handler(s))",
            )

        middleware = self.find(
            r"(?i)(?:twilio\s*\.\s*webhook\s*\(|@validate_twilio_request|"
            r"Twilio(?:::[A-Za-z]+)*::RequestValidator(?:\.new|\s*\()|"
            r"\bRequestValidator\s*(?:\.new|\()|twilio.*validateRequest|"
            r"validateExpressRequest)",
            WEBHOOK_EXTS,
        )
        self.check_or_pass(
            "twilio_webhook_middleware",
            middleware,
            f"Twilio webhook validator found in {len({m.path for m in middleware})} file(s)",
            "Remove a validate:false no-op; otherwise replace it with handler-local Ed25519 verification",
            "No Twilio webhook middleware found",
        )

    def run_polly(self) -> None:
        references = self.find(r"\bPolly\.[A-Z][A-Za-z]*(?:-Neural)?", VOICE_EXTS)
        non_neural = [match for match in references if "-Neural" not in match.value]
        self.check_or_pass(
            "polly_non_neural",
            non_neural,
            f"Non-Neural Polly voices found in {len({m.path for m in non_neural})} file(s)",
            "Prefer a Neural variant such as Polly.Amy-Neural",
            "No non-Neural Polly voice references found",
            status="warn",
        )

    def run_docs(self) -> None:
        doc_matches: List[Match] = []
        allowed = re.compile(
            r"(?i)(?:migrat|port|formerly|previously|was twilio|from twilio to)"
        )
        for filename in ("README.md", "README", "README.rst", "CONTRIBUTING.md"):
            path = self.root / filename
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for line_number, line in enumerate(text.splitlines(), start=1):
                if "twilio" in line.lower() and not allowed.search(line):
                    doc_matches.append(Match(path, line_number, line.strip()))
        self.check_or_pass(
            "docs_still_twilio",
            dedupe_matches(doc_matches),
            f"Documentation still contains non-migration Twilio references in {len({m.path for m in doc_matches})} file(s)",
            "Replace Twilio service names, credentials, setup instructions, and URLs",
            "No non-migration Twilio references found in top-level documentation",
        )

    def run_residual_twilio(self) -> None:
        import_pattern = (
            r"(?i)(?:^[ \t]*from[ \t]+twilio\b|^[ \t]*import[ \t]+[^;\n]*twilio|"
            r"\brequire\s*\(?[^)\n]*twilio|\buse\s+Twilio\\|"
            r"^[ \t]*using[ \t]+Twilio\b|github\.com/twilio/|@twilio/)"
        )
        imports = self.find(import_pattern, SOURCE_EXTS - XML_EXTS)
        self.check_or_pass(
            "residual_twilio_imports",
            imports,
            f"Residual Twilio imports found in {len({m.path for m in imports})} file(s)",
            "Remove Twilio dependencies and imports after migration",
            "No residual Twilio imports found",
        )

        clients = self.find(
            r"(?i)(?:\bClient\s*\([^)]*account_sid|\bnew\s+Twilio\b|"
            r"\bnew\s+\\?Twilio\\Rest\\Client\s*\(|"
            r"\btwilio\.Twilio\s*\(|Twilio::REST::Client\.new|"
            r"\btwilio\.NewRestClient|\bTwilio\.init\s*\(|"
            r"\bTwilioClient\.Init\s*\()",
            SOURCE_EXTS - XML_EXTS,
            flags=re.IGNORECASE | re.MULTILINE | re.DOTALL,
        )
        self.check_or_pass(
            "twilio_client_instantiation",
            clients,
            f"Twilio client initialization found in {len({m.path for m in clients})} file(s)",
            "Replace it with the language-appropriate Telnyx client",
            "No Twilio client initialization found",
        )

        directory_matches: List[Match] = []
        for current_root, dirs, _ in os.walk(self.root):
            dirs[:] = sorted(directory for directory in dirs if directory not in EXCLUDED_DIRS)
            for directory in dirs:
                if "twilio" in directory.lower():
                    path = Path(current_root) / directory
                    directory_matches.append(Match(path, 0, directory))
        self.check_or_pass(
            "twilio_directory_names",
            dedupe_matches(directory_matches),
            f"Directory names containing Twilio found in {len(directory_matches)} location(s)",
            "Rename migrated directories to use Telnyx terminology",
            "No directory names containing Twilio",
        )

    def run(self) -> int:
        if not self.json_mode:
            print("Telnyx Correctness Linter")
            print("════════════════════════")
            print(f"\nProject: {self.root}")
            print(f"Product: {self.product}")
        if self.product_applies("messaging"):
            self.run_messaging()
        if self.product_applies("voice"):
            self.run_voice()
        if self.product_applies("verify"):
            self.run_verify()
        self.run_hallucinated_methods()
        self.run_webhooks()
        if self.product_applies("voice"):
            self.run_polly()
        self.run_docs()
        self.run_residual_twilio()

        result = {
            "project_root": str(self.root),
            "product_filter": self.product,
            "analysis_scope": {
                "kind": "dependency-free lexical analysis",
                "source_suffixes": sorted(SOURCE_EXTS),
                "source_suffix_count": len(SOURCE_EXTS),
                "lexical_families": list(LEXICAL_FAMILIES),
                "lexical_family_count": len(LEXICAL_FAMILIES),
                "server_handler_family_count": SERVER_HANDLER_FAMILIES,
                "emitted_check_count": len(self.checks),
                "limitations": list(ANALYSIS_LIMITATIONS),
            },
            "checks": self.checks,
            "summary": {
                "issues": self.issue_count,
                "warnings": self.warn_count,
                "passes": self.pass_count,
            },
            "issues": self.issue_count,
            "warnings": self.warn_count,
            "passes": self.pass_count,
            "result": "issues_found" if self.issue_count else "clean",
        }
        if self.json_mode:
            print(json.dumps(result, indent=2, sort_keys=False))
        else:
            print("\n─────────────────────────────────────")
            print("Summary")
            print(f"  Pass:    {self.pass_count}")
            print(f"  Issues:  {self.issue_count}")
            print(f"  Warns:   {self.warn_count}")
            print("\nISSUES FOUND" if self.issue_count else "\nCLEAN")
        return 1 if self.issue_count else 0


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check migrated Telnyx code for known correctness anti-patterns"
    )
    parser.add_argument("project_root", type=Path)
    parser.add_argument(
        "--product",
        choices=("all", "messaging", "voice", "verify", "webrtc", "pay"),
        default="all",
    )
    parser.add_argument("--json", action="store_true", dest="json_mode")
    parser.add_argument("--scan-json", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    if not args.project_root.is_dir():
        print(f"Error: '{args.project_root}' is not a directory", file=sys.stderr)
        return 2
    root = args.project_root.resolve()
    scan_json = args.scan_json.resolve() if args.scan_json else None
    return CorrectnessLinter(root, args.product, args.json_mode, scan_json).run()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
