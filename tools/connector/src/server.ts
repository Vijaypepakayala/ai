import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  isDefinitiveHttpFailure,
  redactCredentialText,
  TelnyxApiError,
  TelnyxClient,
  TelnyxRequestNotDispatchedError
} from "./telnyxClient.js";
import type { QueryValue } from "./telnyxClient.js";

const SERVER_NAME = "telnyx-claude-connector";
const SERVER_VERSION = "0.1.0";

// Call Control commands the connector will forward. Kept to an explicit
// allowlist so a prompt-injected "command" cannot reach arbitrary actions.
const CALL_COMMANDS = [
  "answer",
  "hangup",
  "speak",
  "gather_using_speak",
  "playback_start",
  "playback_stop",
  "bridge",
  "transfer",
  "record_start",
  "record_stop",
  "reject"
] as const;

type CallCommand = (typeof CALL_COMMANDS)[number];

// Fields shared by every Call Control action body.
const commonActionFields = {
  client_state: z.string().optional().describe("Base64 state echoed on subsequent webhooks"),
  command_id: z.string().optional().describe("Idempotency key to avoid duplicate commands")
};

// The public API accepts a finite integer from 1 through 100 or the special
// string "infinity". Generated SDKs expose the field as string | number, so
// normalize documented numeric strings without forwarding arbitrary strings.
const playbackLoopSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return /^(?:[1-9]|[1-9][0-9]|100)$/.test(normalized)
    ? Number(normalized)
    : normalized;
}, z.union([z.number().int().min(1).max(100), z.literal("infinity")]));

const httpUrlSchema = z.string().url().superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // z.string().url() already records the malformed URL. Refinements still
    // run after that issue, so return instead of turning bad input into an
    // uncaught TypeError/internal MCP failure.
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must use an http or https URL" });
  }
  if (url.username !== "" || url.password !== "") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must not contain embedded credentials" });
  }
});

// One STRICT schema per command: only the documented fields for that action
// are accepted, unknown keys are rejected. Deliberately absent everywhere:
// webhook_url / webhook_url_method — a per-command webhook override is an
// event-exfiltration primitive under prompt injection, so this connector
// never forwards one; call events go to the application's configured webhook.
const COMMAND_PARAMS: Record<CallCommand, z.ZodTypeAny> = {
  answer: z.object({ ...commonActionFields }).strict(),
  hangup: z.object({ ...commonActionFields }).strict(),
  reject: z
    .object({ cause: z.enum(["USER_BUSY", "CALL_REJECTED"]), ...commonActionFields })
    .strict(),
  speak: z
    .object({
      payload: z.string().min(1),
      voice: z.string().min(1).describe("e.g. Polly.Joanna-Neural"),
      language: z.string().optional(),
      loop: playbackLoopSchema.optional(),
      payload_type: z.enum(["text", "ssml"]).optional(),
      service_level: z.enum(["basic", "premium"]).optional(),
      stop: z.enum(["current", "all"]).optional(),
      target_legs: z.enum(["self", "opposite", "both"]).optional(),
      voice_settings: z.record(z.unknown()).optional(),
      ...commonActionFields
    })
    .strict(),
  gather_using_speak: z
    .object({
      payload: z.string().min(1),
      voice: z.string().min(1),
      language: z.string().optional(),
      minimum_digits: z.number().int().min(1).max(128).optional(),
      maximum_digits: z.number().int().min(1).max(128).optional(),
      timeout_millis: z.number().int().optional(),
      inter_digit_timeout_millis: z.number().int().optional(),
      invalid_payload: z.string().optional(),
      maximum_tries: z.number().int().optional(),
      payload_type: z.enum(["text", "ssml"]).optional(),
      service_level: z.enum(["basic", "premium"]).optional(),
      terminating_digit: z.string().optional(),
      valid_digits: z.string().optional(),
      voice_settings: z.record(z.unknown()).optional(),
      ...commonActionFields
    })
    .strict()
    .refine(
      (value) => value.minimum_digits === undefined || value.maximum_digits === undefined ||
        value.minimum_digits <= value.maximum_digits,
      { path: ["minimum_digits"], message: "must not exceed maximum_digits" }
    ),
  playback_start: z
    .object({
      audio_url: httpUrlSchema.optional(),
      media_name: z.string().min(1).optional().describe("Play an already-uploaded media asset by name"),
      playback_content: z.string().min(1).optional().describe("Base64 audio to play directly"),
      audio_type: z.enum(["mp3", "wav"]).optional(),
      cache_audio: z.boolean().optional(),
      loop: playbackLoopSchema.optional(),
      overlay: z.boolean().optional(),
      stop: z.enum(["current", "all"]).optional(),
      target_legs: z.enum(["self", "opposite", "both"]).optional(),
      ...commonActionFields
    })
    .strict()
    .refine((value) => [value.audio_url, value.media_name, value.playback_content]
      .filter((source) => source !== undefined).length === 1, {
      message: "exactly one of audio_url, media_name, or playback_content is required"
    })
    .refine(
      (value) => value.overlay !== true || value.target_legs === undefined || value.target_legs === "self",
      {
        path: ["target_legs"],
        message: "must be omitted or self when overlay is enabled"
      }
    ),
  playback_stop: z
    .object({
      overlay: z.boolean().optional(),
      stop: z.enum(["current", "all"]).optional(),
      ...commonActionFields
    })
    .strict(),
  record_start: z
    .object({
      format: z.enum(["wav", "mp3"]),
      channels: z.enum(["single", "dual"]),
      custom_file_name: z.string().min(1).max(40).optional(),
      max_length: z.number().int().min(0).max(14_400).optional(),
      play_beep: z.boolean().optional(),
      recording_track: z.enum(["both", "inbound", "outbound"]).optional(),
      timeout_secs: z.number().int().min(0).optional(),
      transcription: z.boolean().optional(),
      transcription_engine: z.enum(["A", "B", "deepgram/nova-3"]).optional(),
      transcription_language: z
        .string()
        .regex(/^(?:auto_detect|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2})$/)
        .optional(),
      transcription_max_speaker_count: z.number().int().min(1).optional(),
      transcription_min_speaker_count: z.number().int().min(1).optional(),
      transcription_profanity_filter: z.boolean().optional(),
      transcription_speaker_diarization: z.boolean().optional(),
      trim: z.literal("trim-silence").optional(),
      ...commonActionFields
    })
    .strict()
    .superRefine((value, ctx) => {
      const transcriptionOptions = [
        value.transcription_engine,
        value.transcription_language,
        value.transcription_max_speaker_count,
        value.transcription_min_speaker_count,
        value.transcription_profanity_filter,
        value.transcription_speaker_diarization
      ];
      if (transcriptionOptions.some((option) => option !== undefined) && value.transcription !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transcription"],
          message: "must be true when transcription options are provided"
        });
      }
      const googleOnlyOptions = [
        value.transcription_max_speaker_count,
        value.transcription_min_speaker_count,
        value.transcription_profanity_filter,
        value.transcription_speaker_diarization
      ];
      if (googleOnlyOptions.some((option) => option !== undefined) && value.transcription_engine !== "A") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transcription_engine"],
          message: "must be A (Google) for speaker-count, profanity-filter, or diarization options"
        });
      }
      if (
        value.transcription_engine === "deepgram/nova-3" &&
        value.transcription_language !== undefined &&
        !/^en(?:-[A-Za-z0-9]{2,8})?$/.test(value.transcription_language)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transcription_language"],
          message: "must be en or an en-Region code for deepgram/nova-3"
        });
      }
      if (
        value.transcription_min_speaker_count !== undefined &&
        value.transcription_max_speaker_count !== undefined &&
        value.transcription_min_speaker_count > value.transcription_max_speaker_count
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transcription_min_speaker_count"],
          message: "must not exceed transcription_max_speaker_count"
        });
      }
    }),
  record_stop: z
    .object({ recording_id: z.string().uuid().optional(), ...commonActionFields })
    .strict(),
  bridge: z
    .object({
      // This is the generated-SDK alias. call_command translates it to the
      // raw REST body's call_control_id key before transport, keeping the tool
      // input unambiguous from the source call_control_id at the top level.
      call_control_id_to_bridge_with: z.string().min(1).describe("The OTHER call to bridge with").optional(),
      queue: z.string().min(1).describe("Queue whose first call should be bridged").optional(),
      video_room_id: z.string().uuid().describe("Video room to bridge with").optional(),
      video_room_context: z.string().optional(),
      ...commonActionFields
    })
    .strict()
    .superRefine((value, ctx) => {
      const targets = [value.call_control_id_to_bridge_with, value.queue, value.video_room_id]
        .filter((target) => target !== undefined);
      if (targets.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "exactly one of call_control_id_to_bridge_with, queue, or video_room_id is required"
        });
      }
      if (value.video_room_context !== undefined && value.video_room_id === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["video_room_context"],
          message: "requires video_room_id"
        });
      }
    }),
  transfer: z
    .object({
      to: z.string().min(4).describe("Transfer destination, E.164 or SIP URI"),
      from: z.string().min(1).optional(),
      audio_url: httpUrlSchema.optional()
        .describe("WAV or MP3 URL to play after the destination answers and before bridging"),
      media_name: z.string().min(1).optional()
        .describe("Previously uploaded WAV or MP3 to play after answer and before bridging"),
      send_digits_on_answer: z.string()
        .regex(/^[0-9A-DwW*#]{1,64}$/, "must contain 1-64 DTMF digits or pause characters (0-9, A-D, w, W, *, #)")
        .optional(),
      timeout_secs: z.number().int().min(5).max(600).optional(),
      time_limit_secs: z.number().int().min(30).max(14_400).optional(),
      ...commonActionFields
    })
    .strict()
    .refine((value) => value.audio_url === undefined || value.media_name === undefined, {
      message: "audio_url and media_name cannot be used together"
    })
};

// Commands that redirect/splice a live human's call or begin capturing their
// audio require explicit approval. Protective stop/termination actions
// (record_stop, playback_stop, hangup, reject) deliberately remain immediately
// available.
const CONFIRM_REQUIRED_COMMANDS: ReadonlySet<CallCommand> = new Set([
  "transfer",
  "bridge",
  "record_start"
]);

// These commands only stop or terminate live-call activity. They must remain
// available even after an injected/looping amplifying command exhausts the
// session cap. Keep this as an explicit exemption set so every existing or
// future command defaults to capped unless it is deliberately classified as a
// protective stop.
const PROTECTIVE_CALL_COMMANDS: ReadonlySet<CallCommand> = new Set([
  "hangup",
  "reject",
  "record_stop",
  "playback_stop"
]);

type CanonicalCostInformation = Record<string, string>;

interface VerifiedNumberQuote {
  phoneNumber: string;
  costInformation: CanonicalCostInformation;
}

function canonicalDecimal(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  // Prices must be finite, non-negative decimal values. Reject exponent,
  // infinity/NaN, signs and blank values instead of trying to guess a charge.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const [wholeRaw, fractionRaw = ""] = raw.split(".");
  const whole = (wholeRaw || "0").replace(/^0+(?=\d)/, "");
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function canonicalCostInformation(value: unknown): CanonicalCostInformation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const monthlyCost = canonicalDecimal(raw.monthly_cost);
  const currency = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
  if (monthlyCost === null || !/^[A-Z]{3}$/.test(currency)) return null;

  const canonical: CanonicalCostInformation = {};
  for (const key of Object.keys(raw).sort()) {
    const entry = raw[key];
    if (key === "currency") {
      canonical[key] = currency;
      continue;
    }
    if (key.endsWith("_cost")) {
      const amount = canonicalDecimal(entry);
      if (amount === null) return null;
      canonical[key] = amount;
      continue;
    }
    // Incidental inventory metadata is not part of the price. Ignore it so a
    // future non-charge field cannot make valid inventory unorderable.
  }

  // The required fields must be represented even if Object.keys behavior or
  // a future response shape changes unexpectedly.
  canonical.monthly_cost = monthlyCost;
  canonical.currency = currency;
  return Object.fromEntries(Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)));
}

function verifiedNumberQuote(inventory: unknown, expectedNumber: string): VerifiedNumberQuote | null {
  if (!inventory || typeof inventory !== "object") return null;
  const data = (inventory as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const exact = data.find(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && (item as { phone_number?: unknown }).phone_number === expectedNumber
  );
  if (!exact) return null;
  const costInformation = canonicalCostInformation(exact.cost_information);
  return costInformation ? { phoneNumber: expectedNumber, costInformation } : null;
}

function sameVerifiedQuote(a: VerifiedNumberQuote, b: VerifiedNumberQuote): boolean {
  return a.phoneNumber === b.phoneNumber &&
    JSON.stringify(a.costInformation) === JSON.stringify(b.costInformation);
}

function quoteSummary(quote: VerifiedNumberQuote): string {
  return Object.entries(quote.costInformation)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

const MAX_QUOTE_SUMMARY_CHARS = 2_000;
const MAX_APPROVAL_PROMPT_CHARS = 4_000;
const MAX_TOOL_ERROR_CHARS = 8_000;
const MAX_REMEMBERED_SEARCH_RESULTS = 500;
const LIVE_QUOTE_SEARCH_LIMIT = 50;

type NumberSearchQuery = Record<string, QueryValue>;

function boundToolError(value: string, maxChars: number, label: string): string {
  if (value.length <= maxChars) return value;
  const marker = `\n…[TRUNCATED: ${label} was ${value.length} chars]`;
  let head = value.slice(0, Math.max(0, maxChars - marker.length));
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return `${head}${marker}`;
}

function sanitizeToolError(value: string): string {
  return boundToolError(
    redactCredentialText(value),
    MAX_TOOL_ERROR_CHARS,
    "tool error output"
  );
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = (value as { data?: unknown }).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
}

function dataOrTopLevelRecord(value: unknown): Record<string, unknown> | null {
  const enveloped = dataRecord(value);
  if (enveloped) return enveloped;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function dataRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

// Session-scoped velocity caps on billable / abuse-amplifiable tools. A prompt
// injection that slips past the model still cannot loop these unbounded.
// Overridable via env for legitimate heavy sessions (restart to reset).
const DEFAULT_CAPS: Record<string, number> = {
  send_message: 10,
  send_message_attempt: 10,
  place_call: 5,
  place_call_attempt: 5,
  order_number: 2,
  billable_lookup: 20,
  call_command: 50
};

function capFromEnv(name: string, fallback: number): number {
  const variable = `TELNYX_CONNECTOR_MAX_${name.toUpperCase()}`;
  const raw = process.env[variable];
  if (raw === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new ConnectorConfigurationError(
      `${variable} must be a non-negative safe integer; refusing to enable a fallback spend budget`
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConnectorConfigurationError(
      `${variable} must be a non-negative safe integer; refusing to enable a fallback spend budget`
    );
  }
  return parsed;
}

export interface CreateServerOptions {
  client?: TelnyxClient;
  apiKey?: string;
}

class ConnectorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorConfigurationError";
  }
}

export function requireStartupApiKey(value = process.env.TELNYX_API_KEY): string {
  const apiKey = value?.trim() ?? "";
  if (!apiKey) {
    throw new ConnectorConfigurationError(
      "TELNYX_API_KEY is not set. Configure the connector secret before startup (never paste it into chat)."
    );
  }
  return apiKey;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  // Spend controls are configuration, not runtime input. Validate every
  // override before exposing any tools so a typo cannot silently reactivate a
  // default billable budget or leave a partially usable connector running.
  for (const [bucket, fallback] of Object.entries(DEFAULT_CAPS)) {
    capFromEnv(bucket, fallback);
  }
  const apiKey = options.apiKey ?? process.env.TELNYX_API_KEY ?? "";
  let client = options.client ?? null;
  const getClient = (): TelnyxClient => {
    if (!client) {
      if (!apiKey) {
        throw new ConnectorConfigurationError(
          "TELNYX_API_KEY is not set. Provide it in the MCP server env config (never in chat)."
        );
      }
      client = new TelnyxClient({ apiKey, userAgent: `${SERVER_NAME}/${SERVER_VERSION}` });
    }
    return client;
  };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Ordering is only valid for inventory returned by a recent search. Retain
  // the documented originating query for each number so quote checks can
  // repeat that country-aware search instead of inventing an unsupported
  // scalar exact-match filter. The map is session-local and bounded so
  // repeated read-only searches cannot grow process memory without limit.
  const recentNumberSearches = new Map<string, NumberSearchQuery>();
  // Contains only actively executing purchase attempts and is always cleaned
  // in a finally block. This prevents duplicate concurrent orders for one DID
  // while allowing a later retry when no order POST was dispatched.
  const inFlightNumberOrders = new Set<string>();
  // A success or ambiguous POST outcome must not be retried blindly: the
  // upstream may already own the DID. These markers are bounded by the order
  // cap because that reservation is retained for both outcome classes.
  const dispatchedNumberOrders = new Set<string>();
  const rememberNumberSearch = (inventory: unknown, query: NumberSearchQuery): void => {
    if (!inventory || typeof inventory !== "object") return;
    const data = (inventory as { data?: unknown }).data;
    if (!Array.isArray(data)) return;

    const querySnapshot: NumberSearchQuery = Object.fromEntries(
      Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
    );
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const phoneNumber = (item as { phone_number?: unknown }).phone_number;
      if (typeof phoneNumber !== "string" || phoneNumber.length === 0) continue;
      // Refresh insertion order when a later search returns the same number.
      recentNumberSearches.delete(phoneNumber);
      recentNumberSearches.set(phoneNumber, querySnapshot);
      while (recentNumberSearches.size > MAX_REMEMBERED_SEARCH_RESULTS) {
        const oldest = recentNumberSearches.keys().next().value;
        if (oldest === undefined) break;
        recentNumberSearches.delete(oldest);
      }
    }
  };

  // Caps are a RESERVATION, taken atomically BEFORE dispatch. Checking a
  // counter and incrementing it after the response returns is raceable:
  // concurrent calls all observe the same pre-request count and every one
  // passes, which defeats the cap as a blast-radius boundary. JS is
  // single-threaded between awaits, so incrementing before any await makes
  // the reservation atomic with respect to other tool calls.
  //
  // Release policy: a reservation is released ONLY on a definitive failure
  // (a request that provably did not act — refused before dispatch, or a
  // 4xx other than 429). Timeouts, 5xx and 429s are AMBIGUOUS: the write may
  // have landed upstream, so the reservation is kept — the cap must never
  // under-count real billable actions.
  const used: Record<string, number> = {};
  const limitMessage = (bucket: keyof typeof DEFAULT_CAPS, units = 1): string | null => {
    const cap = capFromEnv(String(bucket), DEFAULT_CAPS[bucket]);
    const count = used[bucket] ?? 0;
    return count + units > cap
      ? `Session limit reached: ${String(bucket)} has used ${count}/${cap} of this session's budget and this request needs ${units} unit${units === 1 ? "" : "s"}. This is an abuse backstop. Ask the user to restart the connector (or raise TELNYX_CONNECTOR_MAX_${String(bucket).toUpperCase()}) if this is intentional.`
      : null;
  };
  const reserve = (bucket: keyof typeof DEFAULT_CAPS, units = 1): string | null => {
    const limited = limitMessage(bucket, units);
    if (limited) return limited;
    const count = used[bucket] ?? 0;
    used[bucket] = count + units;
    return null;
  };
  const releaseReservation = (bucket: keyof typeof DEFAULT_CAPS, units = 1): void => {
    used[bucket] = Math.max(0, (used[bucket] ?? units) - units);
  };
  const refuse = (text: string) => ({
    // Refusals can include caught upstream errors (for example, the direct
    // pricing checks in order_number), so they need the same transcript
    // boundary as errors surfaced through run().
    content: [{ type: "text" as const, text: sanitizeToolError(text) }],
    isError: true
  });
  const withNumberOrderLock = async <T>(
    phoneNumber: string,
    action: () => Promise<T>
  ): Promise<T | ReturnType<typeof refuse>> => {
    // No await between the check and add: concurrent handlers cannot both
    // acquire the same DID in JavaScript's event loop.
    if (dispatchedNumberOrders.has(phoneNumber)) {
      return refuse(
        `An order request for ${phoneNumber} was already dispatched in this connector session and may have succeeded. This request did not fetch a quote, prompt for approval, or place another order. Verify ownership with list_owned_numbers or Telnyx Mission Control before restarting the connector to retry.`
      );
    }
    if (inFlightNumberOrders.has(phoneNumber)) {
      return refuse(
        `An order attempt for ${phoneNumber} is already in progress in this connector session. This duplicate request did not fetch a quote, prompt for approval, or place an order. Wait for the active attempt to finish before deliberately retrying.`
      );
    }
    const flowLimit = Math.max(1, capFromEnv("order_number", DEFAULT_CAPS.order_number));
    if (inFlightNumberOrders.size >= flowLimit) {
      return refuse(
        `The connector already has ${inFlightNumberOrders.size}/${flowLimit} concurrent number-order quote/approval flows in progress. This request did not fetch a quote, prompt for approval, or place an order. Wait for an active flow to finish before retrying.`
      );
    }
    inFlightNumberOrders.add(phoneNumber);
    try {
      // Await inside the try so the lock remains held until every quote,
      // elicitation, revalidation, and order response has settled.
      return await action();
    } finally {
      inFlightNumberOrders.delete(phoneNumber);
    }
  };

  // Human-in-the-loop confirmation. The HUMAN answers an MCP elicitation
  // prompt raised by the server — an injected instruction cannot fake that.
  // Clients without elicitation fail closed for every confirmation-gated
  // action; a model-supplied boolean is never treated as human approval.
  let elicitationCancellationReady: Promise<void> | undefined;
  const prepareElicitationCancellation = (signal?: AbortSignal): Promise<void> => {
    let readiness = elicitationCancellationReady;
    if (!readiness) {
      // @modelcontextprotocol/sdk 1.x assigns the first server-to-client
      // request id 0, but its cancellation receiver currently treats 0 as
      // absent. Consume that id with a protocol ping so cancelling the first
      // real approval prompt also aborts the client's prompt handler. Share
      // the readiness request across concurrent calls; any failure resets it
      // so a later attempt can retry, while this attempt still fails closed.
      const pendingPing = server.server.ping().then(() => undefined);
      readiness = pendingPing.catch((error) => {
        elicitationCancellationReady = undefined;
        throw error;
      });
      elicitationCancellationReady = readiness;
    }
    if (!signal) return readiness;

    // The ping is shared session readiness and must continue for other calls,
    // but a cancelled caller must not retain its DID lock while waiting for
    // that shared work. Race only this caller's wait against its own signal.
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(signal.reason ?? new Error("Operation aborted")));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      readiness.then(
        () => finish(resolve),
        (error) => finish(() => reject(error))
      );
    });
  };
  const humanConfirm = async (
    message: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; refusal?: string }> => {
    if (message.length > MAX_APPROVAL_PROMPT_CHARS) {
      return {
        ok: false,
        refusal:
          `Refusing: the complete approval prompt would be ${message.length} characters, above the ${MAX_APPROVAL_PROMPT_CHARS}-character safety limit. Approval details were not truncated or shown; shorten the action inputs and try again.`
      };
    }
    const caps = server.server.getClientCapabilities();
    if (caps?.elicitation) {
      try {
        await prepareElicitationCancellation(signal);
        const res = await server.server.elicitInput(
          {
            message,
            requestedSchema: {
              type: "object",
              properties: {
                approve: { type: "boolean", title: "Approve this action?" }
              },
              required: ["approve"]
            }
          },
          // Humans deserve longer than the 60s protocol default to decide.
          { timeout: 300_000, signal }
        );
        if (res.action === "accept" && (res.content as { approve?: boolean } | undefined)?.approve === true) {
          return { ok: true };
        }
        return { ok: false, refusal: `The user ${res.action === "accept" ? "did not approve" : res.action + "ed"} the confirmation prompt. Do not retry unless the user asks.` };
      } catch (err) {
        // Elicitation is advertised, so it is AUTHORITATIVE: a timeout, client
        // bug, or dropped prompt must NOT quietly downgrade to the
        // model-attested flag — that would reopen the injection hole exactly
        // when the human did not answer.
        console.error(
          `[${SERVER_NAME}] elicitation failed, refusing action:`,
          sanitizeToolError(err instanceof Error ? err.message : String(err))
        );
        return {
          ok: false,
          refusal:
            "The confirmation prompt to the user failed or timed out — the action was NOT approved. Ask the user to respond to the confirmation prompt and retry."
        };
      }
    }
    return {
      ok: false,
      refusal:
        "Refusing: this action requires an MCP client with elicitation support so the human can approve the exact action. Nothing was sent to Telnyx."
    };
  };

  interface VerifiedMessagingSender {
    phoneNumberId: string;
    messagingProfileId: string;
    campaignId: string;
    campaignKind: "native" | "partner";
  }
  const verifyMessagingSender = async (
    client: TelnyxClient,
    from: string,
    signal?: AbortSignal
  ): Promise<VerifiedMessagingSender | { refusal: string }> => {
    const ownedResponse = await client.request("GET", "/v2/phone_numbers", {
      query: {
        "page[size]": 2,
        "page[number]": 1,
        "filter[phone_number]": from
      },
      signal
    });
    const exactOwnedNumbers = dataRecords(ownedResponse).filter(
      (entry) =>
        entry.phone_number === from &&
        entry.status === "active" &&
        typeof entry.id === "string"
    );
    if (exactOwnedNumbers.length !== 1) {
      return {
        refusal: `${from} was not resolved to exactly one active owned Telnyx number.`
      };
    }
    const phoneNumberId = exactOwnedNumbers[0].id as string;
    const readinessResponse = await client.request(
      "GET",
      `/v2/phone_numbers/${encodeURIComponent(phoneNumberId)}/messaging`,
      { signal }
    );
    const readiness = dataRecord(readinessResponse);
    if (
      readiness?.phone_number !== from ||
      typeof readiness.messaging_profile_id !== "string" ||
      readiness.messaging_profile_id.length === 0
    ) {
      return { refusal: `${from} is not assigned to a messaging profile for this account.` };
    }
    // Registration APIs differ by sender class. Public GA currently permits
    // only the path whose complete state can be proven here; toll-free and
    // short-code sends fail closed until their own verification gates exist.
    const senderType = typeof readiness.type === "string" ? readiness.type.toLowerCase() : "";
    if (senderType !== "long-code" && senderType !== "longcode") {
      return {
        refusal:
          `${from} is a ${String(readiness.type ?? "unknown")} sender. This connector currently sends only from objectively verified 10DLC long-code senders; toll-free and short-code traffic is not dispatched.`
      };
    }
    const assignmentResponse = await client.request(
      "GET",
      `/v2/10dlc/phone_number_campaigns/${encodeURIComponent(from)}`,
      { signal }
    );
    // 10DLC deployments and generated clients expose both the legacy direct
    // record and the API-v2 `data` envelope. Accept only those two object
    // shapes, then apply the same strict field validation below.
    const assignment = dataOrTopLevelRecord(assignmentResponse);
    const legacyCampaignId =
      typeof assignment?.campaignId === "string" && assignment.campaignId.length > 0
        ? assignment.campaignId
        : undefined;
    const telnyxCampaignId =
      typeof assignment?.telnyxCampaignId === "string" && assignment.telnyxCampaignId.length > 0
        ? assignment.telnyxCampaignId
        : undefined;
    const tcrCampaignId =
      typeof assignment?.tcrCampaignId === "string" && assignment.tcrCampaignId.length > 0
        ? assignment.tcrCampaignId
        : undefined;
    if (
      assignment?.phoneNumber !== from ||
      assignment.assignmentStatus !== "ASSIGNED" ||
      (!legacyCampaignId && !telnyxCampaignId && !tcrCampaignId)
    ) {
      return { refusal: `${from} does not have an ASSIGNED 10DLC phone-number campaign.` };
    }
    // Native and shared 10DLC assignments expose different stable IDs and
    // must be read through different resources. Prefer the explicit Telnyx
    // ID for native campaigns. A TCR-only assignment is a shared partner
    // campaign. The legacy campaignId-only shape remains native-compatible.
    const campaignKind: "native" | "partner" = telnyxCampaignId
      ? "native"
      : tcrCampaignId
        ? "partner"
        : "native";
    const campaignId = telnyxCampaignId ?? tcrCampaignId ?? legacyCampaignId!;
    const campaignResponse = await client.request(
      "GET",
      campaignKind === "partner"
        ? `/v2/10dlc/partner_campaigns/${encodeURIComponent(campaignId)}`
        : `/v2/10dlc/campaign/${encodeURIComponent(campaignId)}`,
      { signal }
    );
    const campaign = dataOrTopLevelRecord(campaignResponse);
    if (campaign?.campaignStatus !== "MNO_PROVISIONED") {
      return {
        refusal:
          `${from}'s 10DLC campaign ${campaignId} is not MNO_PROVISIONED (current status: ${String(campaign?.campaignStatus ?? "unknown")}).`
      };
    }
    return {
      phoneNumberId,
      messagingProfileId: readiness.messaging_profile_id,
      campaignId,
      campaignKind
    };
  };

  type HandlerExtra = { signal?: AbortSignal };
  type RequestOutcome = "success" | "definitive_failure" | "ambiguous_failure";
  const run = async (
    fn: (c: TelnyxClient, signal?: AbortSignal) => Promise<unknown>,
    extra?: HandlerExtra,
    bucket?: keyof typeof DEFAULT_CAPS,
    onOutcome?: (outcome: RequestOutcome) => void,
    reservationUnits = 1
  ) => {
    try {
      const result = await fn(getClient(), extra?.signal);
      const text = JSON.stringify(result);
      // Claude Code truncates tool results (~25k tokens). Dense API JSON runs
      // ~2.6 chars/token, so 40k chars ≈ 15k tokens — comfortable margin, and
      // the truncation marker is budgeted inside the cap. Truncating honestly
      // means the model KNOWS data is missing instead of parsing silently
      // cut-off JSON.
      const MAX_CHARS = 40_000;
      let out = text;
      if (text.length > MAX_CHARS) {
        let head = text.slice(0, MAX_CHARS - 200);
        // never split a UTF-16 surrogate pair at the cut point
        if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
        out = `${head}\n…[TRUNCATED: response was ${text.length} chars. Narrow the query (smaller page_size / tighter filters) to see the rest.]`;
      }
      onOutcome?.("success");
      return {
        content: [{ type: "text" as const, text: out }]
      };
    } catch (err) {
      // Release the reservation only when the request definitively did not
      // act: a 4xx other than 429. Timeouts (status 0), 429 and 5xx are
      // ambiguous — the action may have landed, so the budget stays spent.
      const definitiveFailure =
        err instanceof ConnectorConfigurationError ||
        err instanceof TelnyxRequestNotDispatchedError ||
        (err instanceof TelnyxApiError && isDefinitiveHttpFailure(err.status));
      if (bucket && definitiveFailure) releaseReservation(bucket, reservationUnits);
      onOutcome?.(definitiveFailure ? "definitive_failure" : "ambiguous_failure");
      // Error output obeys the same size discipline as successful results —
      // an unbounded upstream error must not blow the client's budget.
      const MAX_ERR_BODY_CHARS = 6_000;
      const detailText = (() => {
        if (!(err instanceof TelnyxApiError)) return "";
        const j = JSON.stringify(err.details, null, 2) ?? "";
        return boundToolError(j, MAX_ERR_BODY_CHARS, "serialized error body");
      })();
      const rawMessage =
        err instanceof TelnyxApiError
          ? `${err.message}\n${detailText}`
          : err instanceof Error
            ? err.message
            : String(err);
      // Defense in depth: even if a future error source bypasses the client's
      // structured redaction or embeds a huge detail in Error.message, the
      // complete tool-visible output is scrubbed and bounded here.
      const message = sanitizeToolError(rawMessage);
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true
      };
    }
  };

  // --------------------------------------- free reads / optional paid lookup

  server.registerTool(
    "search_available_numbers",
    {
      title: "Search available phone numbers",
      description:
        "Search Telnyx inventory for purchasable phone numbers. Read-only: never buys anything. Returns numbers with monthly cost and features so the user can choose before any order.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        country_code: z.string().length(2).describe("ISO country code, e.g. US"),
        area_code: z.string().optional().describe("National destination code / area code, e.g. 312"),
        contains: z.string().optional().describe("Digit pattern the number must contain"),
        features: z
          .array(z.enum(["sms", "mms", "voice", "fax", "emergency"]))
          .optional()
          .describe("Required features"),
        limit: z.number().int().min(1).max(50).default(10)
      }
    },
    async ({ country_code, area_code, contains, features, limit }, extra) => {
      const query: NumberSearchQuery = {
        "filter[country_code]": country_code,
        "filter[national_destination_code]": area_code,
        "filter[phone_number][contains]": contains,
        "filter[features][]": features,
        "filter[limit]": limit
      };
      return run(
        async (c, signal) => {
          const inventory = await c.request("GET", "/v2/available_phone_numbers", { query, signal });
          rememberNumberSearch(inventory, query);
          return inventory;
        },
        extra
      );
    }
  );

  server.registerTool(
    "lookup_number",
    {
      title: "Look up a phone number (may incur charges)",
      description:
        "Telnyx Number Lookup for any phone number: portability info by default; carrier and caller-name data only when requested via types (billable per lookup type). Because one invocation can request paid data, clients must treat this combined tool as side-effecting and non-idempotent.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        phone_number: z.string().min(4).describe("Phone number, E.164 preferred"),
        types: z
          .array(z.enum(["carrier", "caller-name"]))
          .optional()
          .describe("Extra data to request. carrier and caller-name are null unless requested here.")
      }
    },
    async ({ phone_number, types }, extra) => {
      const requestedTypes = [...new Set(types ?? [])];
      const billableUnits = requestedTypes.length;
      if (billableUnits > 0) {
        const limited = reserve("billable_lookup", billableUnits);
        if (limited) return refuse(limited);
      }
      return run(
        (c, signal) =>
          c.request("GET", `/v2/number_lookup/${encodeURIComponent(phone_number)}`, {
            query: { type: requestedTypes.length > 0 ? requestedTypes : undefined },
            signal
          }),
        extra,
        billableUnits > 0 ? "billable_lookup" : undefined,
        undefined,
        billableUnits
      );
    }
  );

  server.registerTool(
    "list_owned_numbers",
    {
      title: "List owned phone numbers",
      description: "List phone numbers on this Telnyx account, with status and connection assignment.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        page_size: z.number().int().min(1).max(100).default(25),
        page: z.number().int().min(1).default(1).describe("Page number; response meta reports total_pages"),
        phone_number: z
          .string()
          .optional()
          .describe("Filter: exact E.164 number, e.g. +13125551234 (returns its internal id)")
      }
    },
    async ({ page_size, page, phone_number }, extra) =>
      run(
        (c, signal) =>
          c.request("GET", "/v2/phone_numbers", {
            query: {
              "page[size]": page_size,
              "page[number]": page,
              "filter[phone_number]": phone_number
            },
            signal
          }),
        extra
      )
  );

  server.registerTool(
    "check_messaging_readiness",
    {
      title: "Check a number's messaging readiness",
      description:
        "Pre-flight for sending SMS from a number on this account: reports the number's messaging profile assignment and messaging feature status. For US A2P traffic the number's profile must also be linked to a 10DLC campaign — treat an unassigned profile as not-ready.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        phone_number_id: z
          .string()
          .describe("Telnyx internal numeric ID of the phone number (from list_owned_numbers), NOT the E.164 string")
      }
    },
    async ({ phone_number_id }, extra) =>
      run((c, signal) => c.request("GET", `/v2/phone_numbers/${encodeURIComponent(phone_number_id)}/messaging`, { signal }), extra)
  );

  server.registerTool(
    "get_message_status",
    {
      title: "Get message delivery status",
      description:
        "Fetch a sent message by id. Delivery outcome is in data.to[0].status (delivered/failed/queued etc).",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        message_id: z.string().uuid().describe("Message id returned by send_message")
      }
    },
    async ({ message_id }, extra) =>
      run((c, signal) => c.request("GET", `/v2/messages/${encodeURIComponent(message_id)}`, { signal }), extra)
  );

  // ------------------------------------------------------------------- writes

  server.registerTool(
    "send_message",
    {
      title: "Send an SMS/MMS",
      description:
        "Send an outbound message from an objectively verified 10DLC long-code sender on this account. Billable per message. The connector verifies active ownership, profile assignment, phone-number campaign assignment, and MNO_PROVISIONED campaign status, then requires client-supported MCP elicitation so the human confirms recipient consent. It revalidates the same sender state after approval. Toll-free/short-code and no-elicitation clients fail closed.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        to: z.string().min(4).describe("Destination number, E.164"),
        from: z.string().min(4).describe("Source number on this Telnyx account, E.164"),
        text: z.string().max(3072).optional().describe("Message body (optional when media_urls present)"),
        media_urls: z.array(httpUrlSchema).optional().describe("MMS media URLs")
      }).strict()
    },
    async ({ to, from, text, media_urls }, extra) => {
      if (!text && (!media_urls || media_urls.length === 0)) {
        return refuse("A message needs text, media_urls, or both.");
      }
      // Reserve atomically before the first await so concurrent injected calls
      // cannot amplify readiness reads or human prompts beyond the cap.
      const limited = reserve("send_message");
      if (limited) return refuse(limited);
      // Spend reservations are released for definite no-ops, but valid send
      // attempts are never released. This separate ceiling prevents a caller
      // from turning repeated preflight failures or declined prompts into an
      // unbounded stream of account reads or human approval requests.
      const attemptLimited = reserve("send_message_attempt");
      if (attemptLimited) {
        releaseReservation("send_message");
        return refuse(attemptLimited);
      }

      let verifiedSender: VerifiedMessagingSender;
      try {
        const client = getClient();
        const verification = await verifyMessagingSender(client, from, extra?.signal);
        if ("refusal" in verification) {
          releaseReservation("send_message");
          return refuse(`Refusing to send: ${verification.refusal} Nothing was sent.`);
        }
        verifiedSender = verification;
      } catch (error) {
        releaseReservation("send_message");
        return run(async () => { throw error; }, extra);
      }

      const mediaSummary = media_urls?.length
        ? `; media URLs: ${media_urls.map((url) => JSON.stringify(url)).join(", ")}`
        : "";
      const approval = await humanConfirm(
        `Send a billable SMS/MMS from ${from} to ${to}${text ? ` with text ${JSON.stringify(text)}` : ""}${mediaSummary}? The server verified 10DLC campaign ${verifiedSender.campaignId} is MNO_PROVISIONED. Approve only after confirming that the recipient has consented to this message.`,
        extra?.signal
      );
      if (!approval.ok) {
        releaseReservation("send_message");
        return refuse(approval.refusal!);
      }

      let revalidatedSender: VerifiedMessagingSender;
      try {
        const revalidated = await verifyMessagingSender(getClient(), from, extra?.signal);
        if (
          "refusal" in revalidated ||
          revalidated.phoneNumberId !== verifiedSender.phoneNumberId ||
          revalidated.messagingProfileId !== verifiedSender.messagingProfileId ||
          revalidated.campaignId !== verifiedSender.campaignId ||
          revalidated.campaignKind !== verifiedSender.campaignKind
        ) {
          releaseReservation("send_message");
          return refuse(
            `Refusing to send: sender ownership, profile, or 10DLC registration changed or became unready while approval was pending. Nothing was sent.`
          );
        }
        revalidatedSender = revalidated;
      } catch (error) {
        releaseReservation("send_message");
        return run(async () => { throw error; }, extra);
      }
      return run(
        (c, signal) =>
          c.request("POST", "/v2/messages", {
            body: {
              to,
              from,
              ...(text ? { text } : {}),
              ...(media_urls ? { media_urls } : {}),
              messaging_profile_id: revalidatedSender.messagingProfileId
            },
            signal
          }),
        extra,
        "send_message"
      );
    }
  );

  server.registerTool(
    "order_number",
    {
      title: "Order a phone number (spends money)",
      description:
        "Purchase a phone number found via search_available_numbers. SPENDS ACCOUNT BALANCE and creates a recurring monthly charge. Requires client-supported MCP elicitation so the human approves the authoritative live quote; clients without elicitation receive the quote but cannot purchase.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: z
        .object({
          phone_number: z.string().min(4).describe("The exact E.164 number to purchase")
        })
        .strict()
    },
    async ({ phone_number }, extra) => {
      return withNumberOrderLock(phone_number, async () => {
        // The lock checks any prior/ambiguous dispatch before provenance so a
        // bounded-cache eviction can never turn "verify ownership" into an
        // unsafe invitation to search and retry the same DID.
        const originatingSearch = recentNumberSearches.get(phone_number);
        if (!originatingSearch) {
          return refuse(
            `${phone_number} was not returned by search_available_numbers in this connector session. Search for it first, then choose a number from those results; nothing was ordered.`
          );
        }

        // Reserve the spend budget before either live quote lookup or human
        // elicitation. An exhausted (including zero) cap must not let injected
        // retries produce upstream traffic or approval prompts for an action
        // that cannot be dispatched. Pre-dispatch no-ops release below; once
        // run() owns the reservation, its definitive/ambiguous outcome policy
        // decides whether the unit is released or retained.
        const limited = reserve("order_number");
        if (limited) return refuse(limited);
        let reservationOwnedByRun = false;
        try {
          // Pricing is AUTHORITATIVE, not model-supplied: re-query this exact
          // originating search immediately before asking the human, exact-match
          // the selected number in its results, and quote only what the API
          // returned. A model cannot fabricate a cheap price to obtain approval
          // for a different recurring charge.
          const fetchLiveQuote = async (): Promise<VerifiedNumberQuote | null> => {
            const inventory = await getClient().request("GET", "/v2/available_phone_numbers", {
              query: { ...originatingSearch, "filter[limit]": LIVE_QUOTE_SEARCH_LIMIT },
              signal: extra?.signal
            });
            return verifiedNumberQuote(inventory, phone_number);
          };

          let priced: VerifiedNumberQuote | null;
          try {
            priced = await fetchLiveQuote();
          } catch (err) {
            return refuse(
              `Could not price ${phone_number} before purchase (${err instanceof Error ? err.message : String(err)}). Refusing to order without a live quote.`
            );
          }
          if (!priced) {
            return refuse(
              `${phone_number} is not currently available with valid current pricing (no exact live inventory match). Use search_available_numbers to pick an orderable number; nothing was ordered.`
            );
          }
          const quoted = quoteSummary(priced);
          if (quoted.length > MAX_QUOTE_SUMMARY_CHARS) {
            return refuse(
              `The live quote for ${phone_number} contains too many charge fields to present completely (${quoted.length} characters). Refusing to truncate pricing or request approval; nothing was ordered.`
            );
          }
          const quotedAt = new Date().toISOString();
          const approvalMessage =
            `Buy ${phone_number}? Live quote from Telnyx (${quotedAt}): ${quoted}. This creates a recurring charge.`;

          // A model-supplied boolean cannot prove that a human saw this exact
          // authoritative quote. Fail closed when the client cannot present the
          // server-owned elicitation prompt. The refusal is sanitized/bounded by
          // refuse(); the provisional budget reservation is released and no POST
          // occurs.
          if (!server.server.getClientCapabilities()?.elicitation) {
            return refuse(
              `Live authoritative quote for ${phone_number} (${quotedAt}): ${quoted}. This number was NOT ordered. Purchasing requires an MCP client with elicitation support so the human can approve this exact quote.`
            );
          }

          const approved = await humanConfirm(approvalMessage, extra?.signal);
          if (!approved.ok) return refuse(`order_number ${phone_number}: ${approved.refusal}`);

          // Re-read inventory after the human answers and refuse any change we can
          // observe before ordering. This narrows the approval-to-order race, but
          // the order API accepts no quote/version token, so a residual race remains
          // between this GET and the POST below.
          let revalidated: VerifiedNumberQuote | null;
          try {
            revalidated = await fetchLiveQuote();
          } catch (err) {
            return refuse(
              `Could not revalidate ${phone_number} after approval (${err instanceof Error ? err.message : String(err)}). The number was NOT ordered; review a fresh quote and approve again.`
            );
          }
          if (!revalidated || !sameVerifiedQuote(priced, revalidated)) {
            return refuse(
              `The live quote for ${phone_number} changed or disappeared after approval. The number was NOT ordered; review the fresh quote and approve again.`
            );
          }

          reservationOwnedByRun = true;
          const result = await run(
            (c, signal) =>
              c.request("POST", "/v2/number_orders", {
                body: { phone_numbers: [{ phone_number: revalidated.phoneNumber }] },
                signal
              }),
            extra,
            "order_number",
            (outcome) => {
              if (outcome !== "definitive_failure") dispatchedNumberOrders.add(phone_number);
            }
          );
          // Return the approved quote alongside the order so the receipt the user
          // approved is visible in the transcript.
          if (!result.isError) {
            result.content.push({
              type: "text" as const,
              text: JSON.stringify({ approved_quote: { phone_number: priced.phoneNumber, quoted, quoted_at: quotedAt } })
            });
          }
          return result;
        } finally {
          if (!reservationOwnedByRun) releaseReservation("order_number");
        }
      });
    }
  );

  server.registerTool(
    "place_call",
    {
      title: "Place an outbound call (Call Control)",
      description:
        "Dial an outbound call via Telnyx Call Control. Billable per minute once answered. Returns a call_control_id to drive the live call with call_command. Requires a Call Control application/connection id.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        to: z.string().min(4).describe("Destination, E.164 or SIP URI"),
        from: z.string().min(4).describe("Caller id number on this account, E.164"),
        connection_id: z.string().describe("Call Control application (connection) id")
        // No per-call webhook_url override: call events go to the application's
        // configured webhook. A per-call override is an exfiltration primitive
        // under prompt injection, so this connector does not expose one.
      }
    },
    async ({ to, from, connection_id }, extra) => {
      const limited = reserve("place_call");
      if (limited) return refuse(limited);
      const attemptLimited = reserve("place_call_attempt");
      if (attemptLimited) {
        releaseReservation("place_call");
        return refuse(attemptLimited);
      }
      const approval = await humanConfirm(
        `Place a billable outbound call with caller ID ${JSON.stringify(from)}, destination ${JSON.stringify(to)}, and Call Control connection ${JSON.stringify(connection_id)}? Approve only after confirming that these exact literal values are intended and that this call is permitted.`,
        extra?.signal
      );
      if (!approval.ok) {
        releaseReservation("place_call");
        return refuse(`place_call: ${approval.refusal}`);
      }
      return run(
        (c, signal) =>
          c.request("POST", "/v2/calls", {
            body: { to, from, connection_id },
            signal
          }),
        extra,
        "place_call"
      );
    }
  );

  server.registerTool(
    "call_command",
    {
      title: "Send a command to a live call",
      description:
        `Drive an active Call Control call: ${CALL_COMMANDS.join(", ")}. Each command maps to POST /v2/calls/{call_control_id}/actions/{command}. speak requires payload+voice; bridge/transfer affect other parties; hangup and transfer end or move the user's live call; record_start captures call audio and may require participant consent.`,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        call_control_id: z.string().min(1).describe("From place_call or an inbound call webhook"),
        command: z.enum(CALL_COMMANDS),
        params: z
          .record(z.unknown())
          .optional()
          .describe(
            "Command body, validated per command against a curated documented field set (unknown keys rejected; webhook overrides never forwarded). Required fields: speak/gather_using_speak {payload, voice}; playback_start one of {audio_url, media_name, playback_content}; bridge exactly one of {call_control_id_to_bridge_with, queue, video_room_id}; transfer {to} plus optional answer-time audio_url or media_name and send_digits_on_answer; record_start {format, channels}. playback_start/playback_stop accept stop=current|all."
          ),
      }
    },
    async ({ call_control_id, command, params }, extra) => {
      const parsed = COMMAND_PARAMS[command].safeParse(params ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        return refuse(`Invalid params for ${command}: ${issues}`);
      }
      const capBucket: keyof typeof DEFAULT_CAPS | undefined =
        PROTECTIVE_CALL_COMMANDS.has(command) ? undefined : "call_command";
      if (capBucket) {
        const limited = reserve(capBucket);
        if (limited) return refuse(limited);
      }
      const requestBody = (() => {
        const body = parsed.data as Record<string, unknown>;
        if (command !== "bridge") return body;
        const { call_control_id_to_bridge_with: targetCallControlId, ...rest } = body;
        return targetCallControlId === undefined
          ? rest
          : { ...rest, call_control_id: targetCallControlId };
      })();
      if (CONFIRM_REQUIRED_COMMANDS.has(command)) {
        const message = command === "record_start"
          ? (() => {
              const recording = parsed.data as {
                format: string;
                channels: string;
                max_length?: number;
                play_beep?: boolean;
                recording_track?: string;
                timeout_secs?: number;
                transcription?: boolean;
                transcription_engine?: string;
                transcription_language?: string;
                transcription_max_speaker_count?: number;
                transcription_min_speaker_count?: number;
                transcription_profanity_filter?: boolean;
                transcription_speaker_diarization?: boolean;
                custom_file_name?: string;
                trim?: string;
              };
              const duration = recording.max_length && recording.max_length > 0
                ? `maximum ${recording.max_length} seconds`
                : "no maximum duration";
              const transcriptionOptions = [
                recording.transcription_engine,
                recording.transcription_language,
                recording.transcription_min_speaker_count !== undefined
                  ? `minimum ${recording.transcription_min_speaker_count} speakers`
                  : undefined,
                recording.transcription_max_speaker_count !== undefined
                  ? `maximum ${recording.transcription_max_speaker_count} speakers`
                  : undefined,
                recording.transcription_profanity_filter !== undefined
                  ? `profanity filter ${recording.transcription_profanity_filter ? "enabled" : "disabled"}`
                  : undefined,
                recording.transcription_speaker_diarization !== undefined
                  ? `speaker diarization ${recording.transcription_speaker_diarization ? "enabled" : "disabled"}`
                  : undefined
              ].filter((option): option is string => option !== undefined);
              const transcription = recording.transcription
                ? `post-recording transcription enabled${transcriptionOptions.length ? ` (${transcriptionOptions.join("; ")})` : ""}`
                : "post-recording transcription disabled";
              const silenceTimeout = recording.timeout_secs && recording.timeout_secs > 0
                ? `silence timeout ${recording.timeout_secs} seconds (uses billable transcription)`
                : "no silence timeout";
              const fileName = recording.custom_file_name
                ? `file name ${recording.custom_file_name}`
                : "default file name";
              return `Start a ${recording.format}, ${recording.channels}-channel recording of live call ${call_control_id} (${duration}; ${fileName}; track ${recording.recording_track ?? "both"}; ${recording.play_beep ? "start beep enabled" : "start beep disabled"}; ${recording.trim ?? "no silence trimming"}; ${transcription}; ${silenceTimeout})? This captures call audio. Approve only after every participant has received the notice and provided the consent required for every applicable jurisdiction.`;
            })()
          : command === "bridge"
            ? (() => {
                const bridge = parsed.data as {
                  call_control_id_to_bridge_with?: string;
                  queue?: string;
                  video_room_id?: string;
                  video_room_context?: string;
                };
                if (bridge.queue) {
                  return `Bridge live call ${call_control_id} with the first call in queue ${bridge.queue}? Telnyx removes that call from the queue even if bridging fails.`;
                }
                if (bridge.video_room_id) {
                  return `Bridge live call ${call_control_id} into video room ${bridge.video_room_id}${bridge.video_room_context ? ` with context ${bridge.video_room_context}` : ""}?`;
                }
                return `Bridge live call ${call_control_id} with live call ${bridge.call_control_id_to_bridge_with}?`;
              })()
            : (() => {
                const transfer = parsed.data as {
                  to: string;
                  from?: string;
                  audio_url?: string;
                  media_name?: string;
                  send_digits_on_answer?: string;
                  timeout_secs?: number;
                  time_limit_secs?: number;
                };
                const transferControls = [
                  transfer.from ? `use caller ID ${transfer.from}` : undefined,
                  transfer.timeout_secs !== undefined
                    ? `wait up to ${transfer.timeout_secs} seconds for an answer`
                    : undefined,
                  transfer.time_limit_secs !== undefined
                    ? `limit the transferred call to ${transfer.time_limit_secs} seconds`
                    : undefined,
                  transfer.audio_url ? `play audio URL ${transfer.audio_url} after answer` : undefined,
                  transfer.media_name ? `play uploaded media ${transfer.media_name} after answer` : undefined,
                  transfer.send_digits_on_answer
                    ? `send DTMF sequence ${transfer.send_digits_on_answer} after answer`
                    : undefined
                ].filter((control): control is string => control !== undefined);
                return `Transfer live call ${call_control_id} to ${transfer.to}${transferControls.length ? ` (${transferControls.join("; ")})` : ""}?`;
              })();
        const approved = await humanConfirm(message, extra?.signal);
        if (!approved.ok) {
          if (capBucket) releaseReservation(capBucket);
          return refuse(`${command}: ${approved.refusal}`);
        }
      }
      return run(
        (c, signal) =>
          c.request("POST", `/v2/calls/${encodeURIComponent(call_control_id)}/actions/${command}`, {
            body: requestBody,
            signal
          }),
        extra,
        capBucket
      );
    }
  );

  return server;
}

export async function main(): Promise<void> {
  // The executable is a static single-tenant service. Fail boot instead of
  // accepting MCP traffic and discovering the missing credential on the first
  // tool call. Programmatic createServer() remains lazy so clients can still
  // receive a bounded tool error in embedded/test scenarios.
  const server = createServer({ apiKey: requireStartupApiKey() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] ready (stdio)`);
}
