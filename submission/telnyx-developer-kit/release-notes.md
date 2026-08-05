# Telnyx Developer Kit 0.1.0

Initial public submission. Telnyx Developer Kit combines four hand-authored
skills for product navigation, architecture, production guardrails, and
debugging with the hosted Telnyx MCP server for API discovery and authenticated
account actions. It covers Messaging, Voice, Call Control, TeXML, WebRTC,
Verify, Numbers, 10DLC, and Twilio migrations. The reviewer cases exercise all
four skills, all six model-visible candidate root tools, and all three custom UI
openers.
The local release candidate defines 25 app-only tools for five bundled UI
resources; those tools must be hidden from model selection and are validated as
a separate hosted contract. Current production discovery exposes 24 legacy
app-endpoint tools, zero of which satisfy the complete 25-tool candidate
contract; the 25th local tool is not yet deployed. The production server card
still advertises only three of the expected six model-visible tools and marks
MCP Apps experimental.

The hosted reference deliberately keeps stored-payment and billing-group
creation, including their previews, fail-closed until a durable shared
confirmation coordinator or upstream idempotency is deployed. This prevents a
restart or multi-instance failover from replaying a financial or additive
side effect; it is a release gate, not a completed hosted capability.

Reviewer setup: use the OAuth demo account supplied privately in the submission
portal. It must contain only non-production sample resources and require no MFA,
SMS confirmation, email confirmation, or private-network access.
`invoke_api_endpoint` is conservatively marked read-only false, open-world true,
and destructive true because its behavior depends on the selected API endpoint.
Positive review cases use bounded reads and prohibit sends, writes, purchases,
deletions, and billable number lookups. Supply the required demo-recording URL
privately in the submission portal after recording the documented skill, MCP,
and UI workflows; do not store it or reviewer credentials in this repository.
