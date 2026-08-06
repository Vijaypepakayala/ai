# Changelog

## 0.1.0 (unreleased)

Initial curated Telnyx MCP connector for Claude.

- 9 task-level tools (4 unconditionally read-only, 4 write, and 1 optionally
  billable lookup conservatively marked side-effecting) with directory-grade
  `readOnlyHint`/`destructiveHint` annotations on every tool.
- Safety: strict per-command Call Control schemas (unknown keys rejected, no
  webhook overrides anywhere), mandatory human-in-the-loop elicitation for
  purchases and for live-call redirects or recording (clients without MCP
  elicitation fail closed; no model-attested confirmation fallback),
  session velocity caps on billable tools, and authoritative live pricing plus
  post-approval revalidation on number orders. Atomic per-DID and global
  in-flight guards prevent duplicate/concurrent approval flows; successful or
  ambiguous order dispatches remain marked at-most-once for the session.
- Robustness: 30s request timeout + client-cancellation wiring, compact JSON
  with honest truncation markers, pagination, Retry-After surfacing on 429,
  truncated non-JSON error bodies, explicit empty-2xx success markers.
- Request shapes verified against the bundled OpenAPI reference and the
  live-verified migration docs; the production read contract exercises all
  nine tool boundaries (`npm run test:live`) while a transport backstop blocks
  every non-GET before network I/O; the live write path previously exercised
  three real error surfaces (40305/40312/40300) end to end.
- Validated in three rounds: API fact-check, independent code + security
  reviews (15 findings fixed incl. 1 critical injection path), adversarial
  re-review of the hardening.
