# @telnyx/docs-mcp

Read-only Telnyx documentation MCP server — the directory-parity answer to
Twilio's docs connector, built over this repo's Agent Skills and generated API
reference corpus (5,343 indexed documents at the 0.1.0 build). Two tools, no
auth, no account access:

| Tool | What it does |
|---|---|
| `telnyx__search` | BM25 search over TWO corpora: guides/skills (`source="docs"`) and 5,000+ per-operation API entries with method/path (`source="api"`), filterable by parent product (including hyphenated subproducts and cross-family aliases such as 10DLC under Numbers or Messaging) AND SDK language (curl/python/javascript/go/java/ruby — a filter Twilio's connector does not have) |
| `telnyx__retrieve` | Batch retrieve (up to 10 ids) with per-id errors; long docs paginate via offset |

## Run

```bash
npm install && npm run build

# stdio (Claude Code / Claude Desktop)
claude mcp add telnyx-docs -- node /path/to/tools/docs-mcp/dist/cli.js

# streamable HTTP — the claude.ai remote-connector deployment shape
node dist/cli.js --http 8080   # serves /mcp, stateless, no sessions
```

### HTTP mode security

The HTTP endpoint is unauthenticated by design (public docs), so the transport
boundary is hardened:

| Control | Default | Override |
|---|---|---|
| Bind address | `127.0.0.1` (loopback only) | `TELNYX_DOCS_MCP_HOST=0.0.0.0` for a gateway-fronted deploy |
| Browser origins | **deny all** — any request carrying an `Origin` is rejected 403 | `TELNYX_DOCS_MCP_ALLOWED_ORIGINS=https://a.example,https://b.example` |
| Host header | `127.0.0.1:<port>,localhost:<port>` (DNS-rebinding protection) | `TELNYX_DOCS_MCP_ALLOWED_HOSTS=docs.telnyx.com` |
| Request body | 1 MB, enforced while reading (413 beyond it) | `TELNYX_DOCS_MCP_MAX_BODY=<positive integer>` |

Non-browser clients (no `Origin` header) are unaffected by the origin policy.

Starting with `TELNYX_DOCS_MCP_HOST` set to a non-loopback interface while
`TELNYX_DOCS_MCP_ALLOWED_HOSTS` is unset or empty after normalization
**refuses to boot** (exit 2) rather than disabling host validation or serving
an endpoint that would reject every real request. A public deploy sets both:

```bash
TELNYX_DOCS_MCP_HOST=0.0.0.0 TELNYX_DOCS_MCP_ALLOWED_HOSTS=docs.telnyx.com node dist/cli.js --http 8080
```

Terminate TLS and enforce request-rate/concurrency limits at that public
gateway; the MCP process deliberately serves public documentation without
application-level authentication.

These guards are covered by `test/http-boundary.test.ts`, which drives the
built binary over real HTTP (evil Origin 403, allowlisted Origin 200,
no-Origin 200, unsupported methods 405, mismatched Host 403, UTF-8 split
preservation, byte-accurate oversize rejection, rejected-socket closure,
invalid startup config, and a live tool call 200).

## Connector Directory release gate

The source is ready for a remote, authless connector submission; this repository
does not itself create the public deployment. Before submitting it to Anthropic:

1. Deploy `/mcp` behind a Telnyx-owned HTTPS hostname and a gateway that enforces
   request-rate, concurrency, and idle-time limits.
2. Set `TELNYX_DOCS_MCP_ALLOWED_HOSTS` to the public host and, if the gateway
   forwards browser `Origin` headers, explicitly allow the Claude origins seen
   in a custom-connector test.
3. Exercise both tools through MCP Inspector and through Claude's custom
   connector flow against that exact production URL.
4. Prepare the public documentation, Telnyx privacy-policy URL, support contact,
   icon, description, and use cases required by Anthropic's submission form.

See Anthropic's [pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)
and [submission requirements](https://claude.com/docs/connectors/building/submission).

## Why it exists

Twilio's directory-listed Claude connector is exactly this shape:
unauthenticated, read-only, search + retrieve over public docs. This package
matches that feature-for-feature so Telnyx can enter the connectors
directory now, while the authenticated EXECUTION connector
(`tools/connector`) — which Twilio does not have — lands behind OAuth as
phase 2 on the same listing.

The index is built at build time from `skills/` and `guides/` (`npm run build:index`);
regenerate whenever either corpus changes. Known v0.1 limitation: very large skills
(e.g. the Twilio-migration skill) rank high on broad queries; ranking is
BM25 with title boosting, tuned queries in tests.
