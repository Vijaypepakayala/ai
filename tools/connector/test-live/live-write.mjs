import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// Explicitly gated: a real key, named sender and destination, compliance
// acknowledgement, and a deliberate opt-in. Every successful run sends one
// billed SMS and leaves a permanent message record.
const apiKey = process.env.TELNYX_API_KEY;
const to = process.env.TELNYX_TEST_TO_NUMBER;
const from = process.env.TELNYX_TEST_FROM_NUMBER;
if (
  !apiKey ||
  !to ||
  !from ||
  process.env.TELNYX_TEST_SENDER_COMPLIANCE_OK !== "yes" ||
  process.env.LIVE_WRITE_OK !== "yes"
) {
  console.error(
    "Refusing: set TELNYX_API_KEY, TELNYX_TEST_FROM_NUMBER, TELNYX_TEST_TO_NUMBER (an opted-in test recipient), TELNYX_TEST_SENDER_COMPLIANCE_OK=yes, and LIVE_WRITE_OK=yes."
  );
  process.exit(2);
}
const transport = new StdioClientTransport({
  command: "node", args: ["dist/cli.js"],
  env: {
    ...process.env,
    TELNYX_API_KEY: apiKey,
    TELNYX_CONNECTOR_MAX_SEND_MESSAGE: "1",
    TELNYX_CONNECTOR_MAX_ORDER_NUMBER: "0",
    TELNYX_CONNECTOR_MAX_PLACE_CALL: "0",
    TELNYX_CONNECTOR_MAX_CALL_COMMAND: "0"
  }
});
const client = new Client({ name: "live-write", version: "0" });
await client.connect(transport);

const owned = await client.callTool({
  name: "list_owned_numbers",
  arguments: { page_size: 5, page: 1, phone_number: from }
});
if (owned.isError) {
  console.error("Could not verify the named sender:", owned.content[0].text.slice(0, 300));
  process.exit(1);
}
const exact = JSON.parse(owned.content[0].text).data
  .filter((number) => number.phone_number === from && number.status === "active");
if (exact.length !== 1) {
  console.error("The named sender is not exactly one active number on this account; refusing to send.");
  process.exit(1);
}
const readiness = await client.callTool({
  name: "check_messaging_readiness",
  arguments: { phone_number_id: String(exact[0].id) }
});
if (readiness.isError) {
  console.error("The named sender failed messaging readiness:", readiness.content[0].text.slice(0, 300));
  process.exit(1);
}
const messaging = JSON.parse(readiness.content[0].text).data;
if (!messaging?.messaging_profile_id) {
  console.error("The named sender has no messaging profile assignment; refusing to send.");
  process.exit(1);
}
console.log("Named sender is active and has a messaging profile; operator acknowledged sender-specific registration and recipient consent.");

const sent = await client.callTool({
  name: "send_message",
  arguments: { to, from, text: "Telnyx Claude connector live write test — reply not needed" }
});
if (sent.isError) { console.error("SEND FAILED:", sent.content[0].text.slice(0, 400)); process.exit(1); }
const msg = JSON.parse(sent.content[0].text).data;
console.log("sent, message id:", msg.id, "| initial status:", msg.to?.[0]?.status);

await new Promise((r) => setTimeout(r, 8000));
const status = await client.callTool({ name: "get_message_status", arguments: { message_id: msg.id } });
const after = JSON.parse(status.content[0].text).data;
console.log("status after 8s:", after.to?.[0]?.status, "| parts:", after.parts, "| cost:", JSON.stringify(after.cost));
await client.close();
