# Telnyx Developer Kit 0.1.0

Initial public submission. Telnyx Developer Kit combines four hand-authored
skills for product navigation, architecture, production guardrails, and
debugging with the hosted Telnyx MCP server for API discovery, exact request
schemas, and focused app-based account inspection. It covers Messaging, Voice, Call Control, TeXML, WebRTC,
Verify, Numbers, 10DLC, and Twilio migrations.

The release-candidate MCP contract exposes four model-visible tools: catalog
listing, endpoint-schema inspection, Number Intelligence, and Voice Monitor.
The catalog is documentation-only and cannot execute an API request. Eight app-owned tools are available only to
the two public UI resources. Payment, recharge, account-credit, number and SIM
ordering, generated-audio operations, and the internal billing app are excluded
from the public federation.

Number Intelligence labels its execution control and notice as billable before
the user clicks it. Both lookup tools require a server-validated
`confirm_billable_lookup: true` argument; the bundled UI supplies it only from
the labelled submit action. App-only JSON-RPC batches are capped at 25 calls, and mixed
app/catalog or oversized app batches fail before execution.

Local Codex edge-case evaluation now covers five positive and three negative
review prompts. Skill triggers are bounded to their intended task classes,
destructive account-wide requests require exact-target and recovery controls,
and the app openers direct the model to the bundled UI instead of browser or
catalog detours. Catalog list descriptions are compact while exact schemas
remain available through the dedicated schema-inspection tool.

Rendered local QA now covers both public MCP Apps at desktop and mobile
viewports. Voice Monitor keeps discovery fields readable in its split desktop
panel and avoids horizontal overflow in narrow iframes. Both apps now ignore
their own outbound JSON-RPC bridge requests unless a real result or error is
present, preventing false connected states outside an MCP host.

Reviewer setup: use the OAuth demo account supplied privately in the submission
portal. It must contain only non-production sample resources and require no MFA,
SMS confirmation, email confirmation, or private-network access. Positive
review cases use only documentation inspection and bounded focused-app reads.
Telnyx currently advertises only the broad `admin` OAuth scope; the consent
screen must disclose that grant even though the public connector enforces the
smaller reviewed tool allowlist.
No review fixture sends messages,
places calls, purchases resources, changes account state, or invokes a billable
Number Intelligence lookup.

Supply the required demo-recording URL privately in the submission portal after
recording the documented skill, MCP, and UI workflows; do not store it or
reviewer credentials in this repository.
