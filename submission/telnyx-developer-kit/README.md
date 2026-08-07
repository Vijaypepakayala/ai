# Telnyx Developer Kit public GA handoff

This directory contains reviewer-facing material that stays outside the
distributable plugin archive. Submit the kit as a **With MCP** plugin using the
universal endpoint `https://api.telnyx.com/v2/mcp`.

## Readiness status

The implementation is **code-ready** when every local check below passes. It is
**not submission-ready** until the final MCP Apps, Node, and proxy commits are
recorded and deployed and the release
owner completes the gateway, readiness, Docker, OAuth, reviewer, production-scan,
recording, identity, and domain-verification gates below.

The fixtures were reconciled with the hardened local contract on 2026-08-05:
four model-visible tools, eight app-only tools, two UI resources, and 812
documentation-only API catalog endpoints (382 read and 430 write). The billing app remains implemented
internally but is not part of public federation.

## Ready in this branch

- Exactly five positive and three negative review cases cover all four bundled
  skills and all four model-visible tools.
- The public API catalog supports discovery and exact schema inspection only;
  it exposes no generic read or write executor.
- The public catalog excludes payment, recharge, account-credit, number and SIM
  ordering, generated-audio, and other prohibited resources.
- Number Intelligence and Voice Monitor expose eight app-owned tools behind
  `_meta.ui.visibility: ["app"]`; the public root exposes only their two openers.
- Both UI resources declare the dedicated
  `https://telnyx-developer-kit.telnyx.com` component origin and exact CSP.
- OAuth metadata, titles, descriptions, schemas, safety annotations, Origin
  protection, query-string override blocking, and the OpenAI challenge route
  are implemented locally.
- Readiness fails closed if a prohibited endpoint, incorrect tool contract,
  missing app service, missing resource, or missing service credential appears.
- The local catalog is pinned to 812 names using a reviewed SHA-256 digest.

The public listing uses [Telnyx Support](https://support.telnyx.com), the
[Telnyx Privacy Policy](https://telnyx.com/privacy-policy), and the
[Telnyx Terms and Conditions of Service](https://telnyx.com/terms-and-conditions-of-service).

## Local validation

Run from the `team-telnyx/ai` repository root:

```sh
python3 scripts/check-codex-plugin.py
python3 scripts/check-telnyx-mcp-catalog.py --self-test
./scripts/sync-skills.sh --check
```

Validate the app implementation locally:

```sh
(
  cd tools/mcp-apps
  npm ci
  npm run typecheck
  npm run build
  npm test
  npm audit --omit=dev --audit-level=moderate
)
```

Validate the hardened proxy and Node MCP repositories with their documented
Python, Node, lint, TypeScript, bundle, signing, and dependency-audit commands.
The release pipeline's Docker CI remains a gate even when the local image build
and container smoke test pass.

These checks make no Telnyx account or API mutations. The hosted catalog audit
also performs discovery and schema inspection only; it never calls an API
executor or app-owned tool.

The package validator checks public metadata, skill resolution and canonical
bytes, review-case coverage, annotation justifications, Markdown structure,
credential patterns, and the official PNG asset. The catalog checker pins all
four model-visible tools, eight app-only tools, two UI resources, 812 endpoint
names, the 382/430 operation split, and explicit endpoint annotations.

## Release-owner gates

Complete every item immediately before submission:

1. Create final signed local commits for `team-telnyx/mcp-apps`,
   `team-telnyx/telnyx-node`, and `team-telnyx/mcp-server`; record their hashes
   in this handoff, then deploy them through the normal reviewed pipelines.
2. Route `/.well-known/openai-apps-challenge` through the API gateway and set
   its portal-issued token in the deployment secret store. Never commit it.
3. Verify the MCP Apps service and all internal dependencies satisfy `/ready`.
4. Run Docker CI and require the image build and container smoke tests to pass.
5. Use a global-data-residency OpenAI project with Apps Management permissions
   and a verified Telnyx business identity matching the public listing.
6. Supply a dedicated, minimal-balance OAuth reviewer account privately. It
   must contain only documented fixtures and require no MFA, confirmation, or
   private-network access.
7. Run clean-client PKCE OAuth tests with reviewer credentials, perform only the
   approved app reads, verify the catalog remains documentation-only, and
   revoke the test grant afterward.
8. Run Claude and Codex production scans after deployment. Confirm the scanned
   contract is exactly 4 model-visible / 8 app-only / 2 resources / 812 catalog
   endpoints and that query parameters cannot override it.
9. Upload the final skill tree and require passing safety and security scans for
   all four skills.
10. Record the documented skill, MCP, and UI flows and supply the required
    demo-recording URL privately in the portal.
11. Add optional screenshots only when the current scan reports UI. Each image
    must be exactly 706 pixels wide and 400–860 pixels tall; screenshots do not
    replace the recording.
12. Select only countries where support, terms, privacy disclosures, and product
    availability are ready, then complete the policy attestations.

Do not store demo credentials, API keys, OAuth tokens, challenge tokens,
recording secrets, phone numbers, or private account data in this repository.

## Hosted MCP remediation before public GA

The live endpoint must not be submitted while it serves the old mixed executor,
federates the billing app, accepts query-string catalog overrides, or returns
404 for the OpenAI challenge. After deployment, verify all of the following:

- Public discovery returns exactly `list_api_endpoints`,
  `get_api_endpoint_schema`, `open_number_intelligence`, and
  `open_voice_monitor`.
- The internal billing implementation is unreachable through the public root,
  and no billing opener, billing app-owned tool, or billing UI resource appears.
- App-only discovery returns exactly two Number Intelligence tools and six
  Voice Monitor tools with OAuth security mirrors and app-only visibility.
- `resources/list` and `resources/read` expose only the two approved UI URIs.
- The public catalog contains exactly 812 endpoints, split 382 read / 430 write,
  none belongs to the prohibited resource families, every entry is marked
  `execution: catalog_only`, and no invocation tool is named.
- Schema inspection returns the matching resource, operation, tags, strict
  input contract, and `execution: catalog_only` without dispatching the API.
- The OAuth challenge, protected-resource metadata, authorization-server
  metadata, Origin allowlist, query rejection, response bounds, and `/ready`
  behavior match the local contract.
- `/.well-known/openai-apps-challenge` returns only the configured verification
  token at the public gateway route.

## Latest internal review evidence

As of 2026-08-07, the latest documentation-only contract passes 129 Python
proxy/auth/contract tests and 114 Node MCP tests, plus ESLint, TypeScript build,
and MCP bundle validation/signing. The MCP Apps service passes typecheck, build,
211 root tests, and its 39 Number Intelligence, 70 internal billing, and 37
Voice Monitor workspace tests. A local Streamable HTTP test
observed 4 model-visible tools, 8 app-only tools, 2 resources, successful deep
readiness, the 812-entry catalog-only contract, and auth, Origin, and query
guards. Production dependency audits report zero known vulnerabilities. A local
Docker image build and container smoke test pass; hosted Docker CI is still a
release gate. Five positive and three negative ephemeral
Codex review cases also pass the local activation, tool-selection, answer, and
safety criteria recorded in `codex-local-eval.md`. Desktop and mobile iframe
rendering also pass the local bridge, initial-state, control, overflow, and
console checks. No Telnyx API mutation or billable call was made.

This fixture update does not change that evidence or make production ready. The
deployment, gateway challenge route, `/ready`, Docker CI, clean OAuth, and live
Claude/Codex scans remain mandatory release-owner gates.

## Current OpenAI requirements

- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review)
- [Plugin submission error reference](https://developers.openai.com/plugins/deploy/submission-errors)
