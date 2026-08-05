# Telnyx Developer Kit public GA handoff

This directory contains reviewer-facing material that does not belong in the
distributable plugin archive. Submit the kit as a **With MCP** plugin using the
universal endpoint `https://api.telnyx.com/v2/mcp`.

## Readiness status

This branch is **code-ready** when the local validation below passes. It is
**not submission-ready** until the release owner completes the portal, hosted
MCP, identity, credential, recording, scan, and domain-verification gates in
this document. Do not report public-GA readiness above 90% while any of those
externally verified gates remains open.

The checklist was reconciled with the current OpenAI requirements on
2026-07-29. The current error reference requires a demo-recording URL for an
MCP-backed submission. Screenshots are different: they are optional and are
accepted only when the current MCP scan reports custom UI.

## Ready in this branch

- Public listing copy, a supported category, official developer, an accessible
  brand color, and an official square Telnyx asset. The public listing uses
  [Telnyx Support](https://support.telnyx.com), the
  [Telnyx Privacy Policy](https://telnyx.com/privacy-policy), and the
  [Telnyx Terms and Conditions of Service](https://telnyx.com/terms-and-conditions-of-service).
- Exactly five positive and three negative review cases with self-contained
  fixtures and explicit acceptance criteria.
- Positive coverage of all four bundled skills and all six model-visible root
  MCP tools, including the Number Intelligence, Usage and Cost Explorer, and
  Voice Monitor UI openers.
- Justifications for every required annotation on the six model-visible tools.
  The 25-tool local app-only candidate is deliberately reviewed under the
  separate `app-tool-contract.json` metadata contract instead of being added
  to the model-facing annotation-justification scope.
- Initial-submission release notes.
- Four byte-for-byte canonical skills and the production MCP configuration.
- Exact names, titles, descriptions, explicit cost and risk annotations,
  constrained wire-serialized output schemas, OAuth security declarations and
  compatibility mirrors, and `_meta.ui.visibility: ["app"]` for all 25 tools
  in the local candidate across the three repo-owned MCP Apps. All five UI
  resource contents declare the plugin-unique
  `https://telnyx-developer-kit.telnyx.com` component origin and an empty,
  least-privilege CSP because the bundled components use no external network,
  script, image, or frame origins. Protocol-level no-key tests and a production
  dependency audit run in CI.
- A metadata-only hosted release audit. It checks public OAuth and server-card
  discovery, the expected six model-visible tools, the separate 25-tool
  candidate app-only contract, all five linked UI resources, and every endpoint
  schema without calling `invoke_api_endpoint` or an app-only tool.
- Restart-unsafe stored-payment and billing-group creation is fail-closed in
  the hosted reference before any Telnyx request. Their two previews and two
  confirmation tools must remain disabled until a durable shared confirmation
  coordinator or upstream idempotency is deployed and tested across restart
  and concurrent instances.

The packaged mark is the unchanged
[192x192 PNG published by developers.telnyx.com](https://developers.telnyx.com/mintlify-assets/_mintlify/favicons/telnyx/MhCJ9JWG11MInbt6/_generated/favicon/android-chrome-192x192.png).
Its SHA-256 is pinned by the package validator. Telnyx retains all trademark
rights.

## Local validation

Run these checks from the repository root:

```sh
python3 scripts/check-codex-plugin.py
python3 scripts/check-telnyx-mcp-catalog.py --self-test
./scripts/sync-skills.sh --check

(
  cd tools/mcp-apps
  npm ci
  npm run typecheck
  npm run build
  npm test
  npm audit --omit=dev --audit-level=moderate
)
```

These checks make no Telnyx account or API mutations, and `--check` does not
alter tracked generated trees. `npm ci` and `npm run build` do refresh local
`node_modules` and `dist` artifacts. Run `./scripts/sync-skills.sh` without
`--check` only after an intentional change to a canonical skill, then repeat
the checks above.

For the hosted catalog, use a dedicated minimal-balance account:

```sh
TELNYX_API_KEY=... python3 scripts/check-telnyx-mcp-catalog.py
```

The hosted checker validates OAuth discovery and the unauthenticated challenge,
then compares the server card and live initialization with the release-candidate
inventory: six model-visible tools plus the 25-tool app-only contract. It pins
exact app-tool names, titles, and descriptions; verifies constrained output
schemas, four explicit annotations, OAuth declarations and compatibility
mirrors, and app-only visibility; and reads all five UI resources to verify
component origins and CSP. It also pins the 846-name API catalog shape and
recursively validates every endpoint schema and its four annotations. It
continues the complete schema audit before reporting review-contract blockers.
It never invokes a Telnyx API endpoint or an app-only tool.

The local package validator checks the current final-directory text limits,
package-name rules, public URLs, skill resolution and canonical bytes, review
case coverage, annotation justifications, Markdown structure, high-confidence
credential patterns, and full PNG chunk, checksum, compression, and scanline
decoding.

## Release-owner gates

Complete every item immediately before submission:

1. Use a global-data-residency OpenAI project. Confirm Apps Management write
   access and a verified Telnyx business identity whose public details match
   the listing.
2. Supply a dedicated, minimal-balance OAuth demo account privately in the
   portal. It must contain only the documented fixtures and require no MFA,
   SMS confirmation, email confirmation, or private-network access.
3. Record the main skill and MCP workflows across the supported platforms and
   provide the required demo-recording URL in the portal. Keep the recording
   URL and any access secret out of this repository.
4. Repeat OAuth from a clean supported client, complete PKCE authorization,
   run only the bounded review reads, and revoke the test grant afterward.
5. Serve only the portal-generated token at
   `/.well-known/openai-apps-challenge` on the approved MCP host or parent host,
   then complete domain verification. Provision and verify
   `telnyx-developer-kit.telnyx.com` as the dedicated component origin; do not
   reuse it for another plugin.
6. Deploy all hosted MCP remediations, select **Scan Tools**, and confirm a
   successful current scan of tool names, descriptions, schemas, output
   structures, security schemes, annotations, linked UI resources, server
   instructions, and exact CSP metadata.
7. Upload the final skill tree and wait for passing safety and security scans
   for all four skills. Manually check for sensitive information, unnecessary
   access requests, and instructions that conflict with safe plugin behavior.
8. Seed the demo account exactly as described in `review-cases.json`, then run
   all eight cases from clean reviewer sessions. Preserve results without
   storing credentials, tokens, phone numbers, or private account data here.
9. Add optional screenshots only if the current scan reports UI. If supplied,
   include one PNG or JPEG per starter prompt; each image must be exactly
   706 pixels wide and 400–860 pixels tall. Screenshots do not replace the
   required recording.
10. Select only countries where Telnyx support, terms, privacy disclosures, and
    product availability are ready, then complete the policy attestations.

## Hosted MCP remediation before public GA

The local plugin cannot repair metadata served by Telnyx production hosts.
Before submission, the MCP owner must:

- Make the canonical server card and OAuth discovery documents agree on OAuth
  support, authorization endpoints, scopes, PKCE, and client authentication.
  Maintain an operational token-revocation and rotation plan as Telnyx release
  hardening even though a discovery `revocation_endpoint` is not an OpenAI
  submission prerequisite.
- Make the server card match the complete live federation of six model-visible
  tools and the 25-tool candidate app-only contract, the current protocol
  version, and UI-resource capability.
- Deploy the repo-owned MCP Apps metadata hardening through the production
  deployment path, then re-scan all 25 app-only tools and five UI resources.
- Provide durable, shared confirmation state or upstream idempotency for the
  stored-payment and billing-group create flows. Prove replay safety across
  process restart and multiple instances before enabling their two preview and
  two confirmation tools in the hosted catalog.
- Add a truthful per-tool `securitySchemes` declaration to every federated
  tool, mirror it in `_meta.securitySchemes`, and return a standards-compliant
  `mcp/www_authenticate` challenge when authorization is required. First add
  and enforce granular `read` and `write` scopes on the `api.telnyx.com`
  protected resource; only then replace the currently truthful `admin`
  descriptors with least-privilege per-tool scopes.
- Confirm every linked production UI resource content advertises the dedicated
  `https://telnyx-developer-kit.telnyx.com` origin and an exact,
  least-privilege CSP. Explain every external domain reported by the scan and
  ensure the declarations match the returned HTML.
- Expand the live `invoke_api_endpoint` description to disclose writes,
  messages, calls, purchases, charges, and deletion risk, and require schema
  inspection plus confirmation before side effects.
- Repair or remove catalog entries whose required inputs or live routes do not
  match the scanned schema.

As observed on 2026-07-30, the production server card still contradicts the
working OAuth flow, advertises only three of six expected model-visible tools,
uses an older protocol/capability set, and labels MCP Apps experimental. Live
production discovery exposes 24 legacy app-endpoint tools, but zero satisfy the
complete 25-tool candidate contract: they are not exposed under the required
app-only visibility contract and omit required metadata. The 25th local tool,
`billing_preview_billing_group_create`, is not deployed. Federated tools omit
`securitySchemes`; linked UI resource metadata omits `_meta.ui.domain` and
`_meta.ui.csp`; the runtime tool-level OAuth error contract returns a plain
HTTP error instead of an MCP authentication challenge; all 846 endpoint schemas
omit at least one required explicit annotation; and the generic invoker does
not enumerate its message, call, purchase, charge, and deletion risks. The
hosted release audit intentionally remains red until those deployed contracts
are corrected.

Rechecked on 2026-07-31, the `api.telnyx.com` protected-resource metadata and
its authorization-server metadata advertise only the `admin` scope. The
separate `telnyx.com` issuer advertises `read`, `write`, and `admin`, but that
does not make those granular scopes valid for tools hosted under the
`api.telnyx.com` protected resource. Per-tool `read`/`write` declarations are
therefore a backend capability change and live authorization test, not a safe
manifest-only edit.

Do not store demo credentials, API keys, OAuth tokens, the domain challenge
token, recording access secrets, or private account data in this repository.

## Latest internal review evidence

The 2026-07-30 release review passed package ingestion, a clean local
marketplace install, discovery of exactly four namespaced skills in a fresh
Codex session, provider-drift checks, MCP Apps type-check/build/tests, and a
production dependency audit. A headless Codex session also completed the
read-only, non-billable `retrieve_balance` flow through the hosted MCP using a
local bearer-token environment override; returned account values were not
printed or retained.

The authenticated hosted audit confirmed the pinned catalog shape of 846
endpoints (400 read and 446 write), but all 846 endpoint schemas failed the
review contract because their annotations are not fully explicit. The same
audit reproduced the federated-tool inventory, runtime challenge, UI-resource,
and server-card blockers above. Public GA remains a no-go until the production
fixes deploy and the audit passes the expected 6/25 candidate tool split and
846/846 schemas.

## Current OpenAI requirements

- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- [MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review)
- [Plugin submission error reference](https://developers.openai.com/plugins/deploy/submission-errors)
