/**
 * telnyx-agent send-group-mms — Send a group MMS message.
 *
 * Shells out to the Go telnyx CLI `messages send-group-mms` subcommand.
 * `--to` accepts a comma-separated list of E.164 recipients.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printSuccess, printError, outputJson } from "../utils/output.ts";

interface SendGroupMmsResult {
  message_id: string;
  status: string;
  type: string;
  from: string;
  to: string[];
}

export async function sendGroupMmsCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const from = flags["from"] as string | undefined;
  const to = flags["to"] as string | undefined;
  const text = flags["text"] as string | undefined;
  const mediaUrl = flags["media-url"] as string | undefined;

  if (!from) {
    printError("--from is required (E.164 format, e.g., +131****0000)");
    process.exit(1);
  }
  if (!to) {
    printError("--to is required (comma-separated E.164 numbers, e.g., +131****0001,+131****0002)");
    process.exit(1);
  }

  // Group MMS always goes through the group-MMS subcommand (type is MMS).
  const type = "MMS";

  const args: string[] = [
    "messages", "send-group-mms",
    "--from", from,
    "--to", to,
  ];
  if (text) args.push("--text", text);
  if (mediaUrl) args.push("--media-url", mediaUrl);

  try {
    const res = await telnyxCli(args);
    const data = (res?.data ?? res) as Record<string, unknown>;
    const messageId = String(data.id ?? data.message_id ?? "");
    // Telnyx returns the per-recipient status under data.to[].status; fall back
    // to "submitted" when the recipient status is not present.
    const recipientStatus = Array.isArray(data.to) ? data.to[0]?.status : undefined;
    const status = String(recipientStatus ?? "submitted");

    const recipients = to.split(",").map((n) => n.trim()).filter(Boolean);

    const result: SendGroupMmsResult = {
      message_id: messageId,
      status,
      type,
      from,
      to: recipients,
    };

    if (jsonOutput) {
      outputJson(result);
    } else {
      printSuccess("Group MMS sent!", {
        "Message ID": messageId,
        Status: status,
        Type: type,
        From: from,
        To: recipients.join(", "),
      });
    }
  } catch (err) {
    if (jsonOutput) {
      outputJson({ error: errorMsg(err) });
    } else {
      printError(errorMsg(err));
    }
    process.exit(1);
  }
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
