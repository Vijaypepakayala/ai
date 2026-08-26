import type {
  CallControlApplicationData,
  CallEventsInput,
  ConnectionData,
  PageInput,
  RecordingsInput,
  TelnyxClientOptions,
  TelnyxEnvelope,
  VoiceNumberData
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.telnyx.com/v2";
const OPERATIONAL_ID_KEYS = new Set([
  "id",
  "connection_id",
  "call_control_id",
  "call_leg_id",
  "call_session_id",
  "application_session_id",
  "leg_id",
  "conference_id",
  "queue_name",
  "value",
  "connections_consulted"
]);

export class TelnyxVoiceMonitorError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "TelnyxVoiceMonitorError";
    this.status = status;
    this.details = details;
  }
}

export class TelnyxVoiceMonitorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelnyxClientOptions) {
    if (!options.apiKey) {
      throw new Error("Telnyx API key is required for live Voice Monitor calls");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
  }

  async listConnections(input: PageInput = {}): Promise<TelnyxEnvelope<ConnectionData[]>> {
    const url = this.url("/connections");
    addPaging(url, input);
    return this.request(url, { method: "GET" });
  }

  async listCallControlApplications(input: PageInput = {}): Promise<TelnyxEnvelope<CallControlApplicationData[]>> {
    const url = this.url("/call_control_applications");
    addPaging(url, input);
    return this.request(url, { method: "GET" });
  }

  async listPhoneNumbers(input: PageInput = {}): Promise<TelnyxEnvelope<VoiceNumberData[]>> {
    const url = this.url("/phone_numbers/voice");
    addPaging(url, input);
    return this.request(url, { method: "GET" });
  }

  async listActiveCalls(connectionId: string, input: PageInput = {}): Promise<TelnyxEnvelope> {
    const url = this.url(`/connections/${encodeURIComponent(connectionId)}/active_calls`);
    addPaging(url, input);
    return this.request(url, { method: "GET" });
  }

  async listCallEvents(input: CallEventsInput): Promise<TelnyxEnvelope> {
    const url = this.url("/call_events");
    addFilter(url, "leg_id", input.callLegId);
    addFilter(url, "application_session_id", input.applicationSessionId);
    addFilter(url, "connection_id", input.connectionId);
    addFilter(url, "product", input.product);
    addFilter(url, "failed", input.failed);
    addFilter(url, "from", input.from);
    addFilter(url, "to", input.to);
    addFilter(url, "name", input.name);
    addFilter(url, "type", input.type);
    addFilter(url, "occurred_at][eq", input.occurredAtEq, "filter[occurred_at][eq]");
    addFilter(url, "occurred_at][gt", input.occurredAtGt, "filter[occurred_at][gt]");
    addFilter(url, "occurred_at][gte", input.occurredAtGte, "filter[occurred_at][gte]");
    addFilter(url, "occurred_at][lt", input.occurredAtLt, "filter[occurred_at][lt]");
    addFilter(url, "occurred_at][lte", input.occurredAtLte, "filter[occurred_at][lte]");
    addFilter(url, "status", input.status);
    addPaging(url, input);
    return this.request(url, { method: "GET" });
  }

  async getCallStatus(callControlId: string): Promise<TelnyxEnvelope> {
    return this.request(this.url(`/calls/${encodeURIComponent(callControlId)}`), { method: "GET" });
  }

  async listRecordings(input: RecordingsInput): Promise<TelnyxEnvelope> {
    const url = this.url("/recordings");
    addFilter(url, "call_control_id", input.callControlId);
    addFilter(url, "call_leg_id", input.callLegId);
    addFilter(url, "call_session_id", input.callSessionId);
    addFilter(url, "connection_id", input.connectionId);
    addFilter(url, "created_at][gte", input.createdAtGte, "filter[created_at][gte]");
    addFilter(url, "created_at][lte", input.createdAtLte, "filter[created_at][lte]");
    addPaging(url, input);
    return this.request(url, { method: "GET" });
  }

  private url(path: string): URL {
    return new URL(`${this.baseUrl}${path}`);
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined)
    };
    const response = await this.fetchImpl(url.toString(), { ...init, headers });
    const body = await parseJson(response);
    if (!response.ok) {
      const sanitizedDetails = sanitizeVoiceMonitorValue(body);
      const message = sanitizeMessage(extractTelnyxErrorMessage(sanitizedDetails) ?? `Telnyx request failed with status ${response.status}`);
      throw new TelnyxVoiceMonitorError(message, response.status, sanitizedDetails);
    }
    return body as T;
  }
}

function addPaging(url: URL, input: PageInput): void {
  if (input.pageNumber !== undefined) url.searchParams.set("page[number]", String(input.pageNumber));
  if (input.pageSize !== undefined) url.searchParams.set("page[size]", String(input.pageSize));
}

function addFilter(url: URL, name: string, value: unknown, rawKey = `filter[${name}]`): void {
  if (value === undefined || value === null || value === "") return;
  url.searchParams.append(rawKey, String(value));
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function extractTelnyxErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first = errors[0];
  if (!first || typeof first !== "object") return undefined;
  const title = (first as { title?: unknown }).title;
  const detail = (first as { detail?: unknown }).detail;
  return [title, detail].filter((value): value is string => typeof value === "string" && value.length > 0).join(": ");
}

export function sanitizeError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const sanitized = new Error(sanitizeMessage(source.message));
  sanitized.name = source.name;
  return sanitized;
}

export function sanitizeVoiceMonitorValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((nested) => sanitizeVoiceMonitorValue(nested, key));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (isMetadataKey(nestedKey)) output[nestedKey] = "[redacted-metadata]";
      else if (isTranscriptKey(nestedKey)) output[nestedKey] = "[redacted-transcript]";
      else if (isRecordingUrlKey(nestedKey)) output[nestedKey] = "[redacted-recording-url]";
      else if (isSecretKey(nestedKey)) output[nestedKey] = "[redacted-secret]";
      else output[nestedKey] = sanitizeVoiceMonitorValue(nestedValue, nestedKey);
    }
    return output;
  }
  if (typeof value === "string") {
    if (OPERATIONAL_ID_KEYS.has(key)) return sanitizeMessage(value, false, false);
    if (isPhoneKey(key)) return redactPhoneNumbers(sanitizeMessage(value));
    return sanitizeMessage(value);
  }
  return value;
}

function isPhoneKey(key: string): boolean {
  return /(^|_)(from|to|phone|number|caller_id|callee_id|ani|dnis)($|_)/i.test(key) && !OPERATIONAL_ID_KEYS.has(key);
}

function isSecretKey(key: string): boolean {
  return /(^|_)(auth|authorization|api_?key|secret|token|password|credential|private_key)($|_)/i.test(key);
}

function isRecordingUrlKey(key: string): boolean {
  return /(^|_)(recording_?url|download_?url|media_?url|audio_?url|url)($|_)/i.test(key);
}

function isTranscriptKey(key: string): boolean {
  return /(^|_)(transcript|transcription)($|_)/i.test(key);
}

function isMetadataKey(key: string): boolean {
  return /(^|_)(metadata|meta|payload|webhook_payload)($|_)/i.test(key);
}

function sanitizeMessage(message: string, redactPhones = true, redactPayments = true): string {
  const withoutSecrets = message
    .replace(/Authorization\s*:\s*Bearer\s+[^\s;,)]+/gi, "Authorization: Bearer [redacted-secret]")
    .replace(/Bearer\s+[^\s;,)]+/gi, "Bearer [redacted-secret]")
    .replace(/\b(?:sk|pk|key|api)[_-]?(?:live|test|secret)?_[A-Za-z0-9_\-]{6,}\b/gi, "[redacted-secret]")
    .replace(/\b(?:api[_-]?key|secret|token|password)\s*(?:[=:]|\s)\s*[^\s;,)]+/gi, (match) => `${match.split(/[=:\s]/)[0]}=[redacted-secret]`);
  const withoutPayments = redactPayments ? withoutSecrets.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-payment]") : withoutSecrets;
  return redactPhones ? redactPhoneNumbers(withoutPayments) : withoutPayments;
}

function redactPhoneNumbers(value: string): string {
  return value
    .replace(/\+?\d[\d .()\-]{7,}\d/g, "[redacted-phone]")
    .replace(/\b(?:\d[ -]?){10,15}\b/g, "[redacted-phone]");
}
