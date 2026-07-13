/**
 * telnyx-agent send-fax — Send a fax from a hosted or pre-uploaded document.
 *
 * Shells out to the Go telnyx CLI `faxes create` subcommand. The document can
 * be supplied with --media-url or with --media-name after uploading it to the
 * Telnyx Media API.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printSuccess, printError, outputJson } from "../utils/output.ts";

interface SendFaxResult {
  fax_id: string;
  status: string;
  connection_id: string;
  from: string;
  to: string;
  media_url?: string;
  media_name?: string;
}

const QUALITY_VALUES = ["normal", "high", "very_high", "ultra_light", "ultra_dark"] as const;
const PREVIEW_FORMAT_VALUES = ["pdf", "tiff"] as const;

export async function sendFaxCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const connectionId = stringFlag(flags, "connection-id");
  const from = stringFlag(flags, "from");
  const to = stringFlag(flags, "to");
  const mediaUrl = stringFlag(flags, "media-url");
  const mediaName = stringFlag(flags, "media-name");
  const blackThreshold = stringFlag(flags, "black-threshold");
  const clientState = stringFlag(flags, "client-state");
  const fromDisplayName = stringFlag(flags, "from-display-name");
  const previewFormat = stringFlag(flags, "preview-format");
  const quality = stringFlag(flags, "quality");
  const webhookUrl = stringFlag(flags, "webhook-url");
  const monochrome = booleanFlag(flags, "monochrome");
  const storeMedia = booleanFlag(flags, "store-media");
  const storePreview = booleanFlag(flags, "store-preview");
  const t38Enabled = booleanFlag(flags, "t38-enabled");

  if (!connectionId) fail("--connection-id is required (the fax application connection to use)");
  if (!from) fail("--from is required (E.164 format, e.g. +131****0000)");
  if (!to) fail("--to is required (E.164 format or a SIP URI)");
  if (!mediaUrl && !mediaName) {
    fail("One document source is required: pass --media-url or --media-name");
  }
  if (mediaUrl && mediaName) {
    fail("--media-url and --media-name are mutually exclusive");
  }
  if (mediaName && storeMedia === true) {
    fail("--store-media is not supported with --media-name");
  }
  if (blackThreshold !== undefined && (!/^\d+$/.test(blackThreshold) || Number(blackThreshold) > 100)) {
    fail("--black-threshold must be an integer from 0 to 100");
  }
  if (previewFormat !== undefined && !PREVIEW_FORMAT_VALUES.includes(previewFormat as (typeof PREVIEW_FORMAT_VALUES)[number])) {
    fail(`--preview-format must be one of: ${PREVIEW_FORMAT_VALUES.join(", ")}`);
  }
  if (quality !== undefined && !QUALITY_VALUES.includes(quality as (typeof QUALITY_VALUES)[number])) {
    fail(`--quality must be one of: ${QUALITY_VALUES.join(", ")}`);
  }

  const args: string[] = [
    "faxes", "create",
    "--connection-id", connectionId,
    "--from", from,
    "--to", to,
  ];
  if (mediaUrl) args.push("--media-url", mediaUrl);
  if (mediaName) args.push("--media-name", mediaName);
  if (blackThreshold) args.push("--black-threshold", blackThreshold);
  if (clientState) args.push("--client-state", clientState);
  if (fromDisplayName) args.push("--from-display-name", fromDisplayName);
  if (previewFormat) args.push("--preview-format", previewFormat);
  if (quality) args.push("--quality", quality);
  if (webhookUrl) args.push("--webhook-url", webhookUrl);
  pushBooleanFlag(args, "monochrome", monochrome);
  pushBooleanFlag(args, "store-media", storeMedia);
  pushBooleanFlag(args, "store-preview", storePreview);
  pushBooleanFlag(args, "t38-enabled", t38Enabled);

  try {
    const res = await telnyxCli(args);
    const data = (res?.data ?? res ?? {}) as Record<string, unknown>;
    const result: SendFaxResult = {
      fax_id: valueOr(data.id ?? data.fax_id, ""),
      status: valueOr(data.status, "queued"),
      connection_id: valueOr(data.connection_id, connectionId),
      from: valueOr(data.from, from),
      to: valueOr(data.to, to),
      media_url: optionalValue(data.media_url) ?? mediaUrl,
      media_name: optionalValue(data.media_name) ?? mediaName,
    };

    if (jsonOutput) {
      outputJson(result);
    } else {
      const details: Record<string, string | number | boolean> = {
        "Fax ID": result.fax_id,
        Status: result.status,
        "Connection ID": result.connection_id,
        From: result.from,
        To: result.to,
        "Document": result.media_name ?? result.media_url ?? "",
      };
      printSuccess("Fax submitted!", details);
    }
  } catch (err) {
    const message = errorMsg(err);
    if (jsonOutput) {
      outputJson({ error: message });
    } else {
      printError(message);
    }
    process.exit(1);
  }
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  fail(`--${name} must be true or false`);
}

function pushBooleanFlag(args: string[], name: string, value: boolean | undefined): void {
  if (value === undefined) return;
  // Go boolean flags accept a bare flag for true. Use --flag=false as one argv
  // token so urfave/cli does not interpret "false" as a positional argument.
  args.push(value ? `--${name}` : `--${name}=false`);
}

function valueOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(message: string): never {
  printError(message);
  process.exit(1);
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
