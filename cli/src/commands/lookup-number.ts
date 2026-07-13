/**
 * telnyx-agent lookup-number — Retrieve carrier and caller-name information.
 *
 * Shells out to the Go telnyx CLI `number-lookup retrieve` subcommand.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printSuccess, printError, outputJson } from "../utils/output.ts";

const VALID_LOOKUP_TYPES = ["carrier", "caller-name"] as const;
type LookupType = (typeof VALID_LOOKUP_TYPES)[number];

interface LookupSection {
  [key: string]: unknown;
}

interface NumberLookupResult {
  caller_name?: LookupSection;
  carrier?: LookupSection;
  country_code?: string;
  fraud?: string | null;
  national_format?: string;
  phone_number?: string;
  portability?: LookupSection;
  record_type?: string;
  [key: string]: unknown;
}

export async function lookupNumberCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const phoneNumber = flags["phone-number"] as string | undefined;
  const type = flags.type as string | undefined;

  if (!phoneNumber) {
    printError("--phone-number is required (E.164 format, e.g., +131****0000)");
    process.exit(1);
  }
  if (type && !VALID_LOOKUP_TYPES.includes(type as LookupType)) {
    printError(`Invalid --type "${type}". Valid: ${VALID_LOOKUP_TYPES.join(", ")}`);
    process.exit(1);
  }

  const args = ["number-lookup", "retrieve", "--phone-number", phoneNumber];
  if (type) args.push("--type", type);

  try {
    if (!jsonOutput) console.log(`\n🔍 Looking up ${phoneNumber}...`);

    const response = await telnyxCli(args);
    const data = (response?.data ?? response ?? {}) as NumberLookupResult;

    if (jsonOutput) {
      // The API's data object is the useful lookup result. Preserve all fields,
      // including carrier, caller_name, and portability details.
      outputJson(data);
    } else {
      const carrier = asObject(data.carrier);
      const callerName = asObject(data.caller_name);
      const portability = asObject(data.portability);
      printSuccess("Number lookup complete", {
        "Phone Number": String(data.phone_number ?? phoneNumber),
        ...(data.national_format ? { "National Format": data.national_format } : {}),
        ...(data.country_code ? { "Country Code": data.country_code } : {}),
        ...(carrier.name ? { "Carrier": String(carrier.name) } : {}),
        ...(carrier.type ? { "Carrier Type": String(carrier.type) } : {}),
        ...(callerName.caller_name ? { "Caller Name": String(callerName.caller_name) } : {}),
        ...(portability.line_type ? { "Line Type": String(portability.line_type) } : {}),
        ...(portability.ported_status ? { "Ported": String(portability.ported_status) } : {}),
      });
    }
  } catch (err) {
    const message = errorMsg(err);
    if (jsonOutput) {
      outputJson({ error: message, phone_number: phoneNumber });
    } else {
      printError(message);
    }
    process.exit(1);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
