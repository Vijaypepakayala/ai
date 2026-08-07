import type {
  MessagingSignalInput,
  OwnershipSignalInput,
  PortabilitySignalInput,
  ReputationSignalInput,
  TelnyxClientOptions,
  TelnyxNumberLookupResponse,
  VoiceSignalInput
} from "./types.js";
import { fetchBoundedJson } from "./boundedFetch.js";

const MAX_SAFE_MESSAGE_CHARS = 4096;
const DEFAULT_BASE_URL = "https://api.telnyx.com/v2";
const RECORD_SEARCH_PAGE_SIZE = 100;
const MAX_RECORD_SEARCH_PAGES = 100;

export class TelnyxNumberLookupError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "TelnyxNumberLookupError";
    this.status = status;
    this.details = details;
  }
}

class TelnyxBaseClient {
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly timeoutMs: number | undefined;
  protected readonly maxResponseBytes: number | undefined;
  protected readonly signal: AbortSignal | undefined;

  constructor(options: TelnyxClientOptions) {
    if (!options.apiKey) {
      throw new Error("Telnyx API key is required for live number intelligence");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = normalizeTelnyxV2BaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
    this.signal = options.signal;

    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
  }

  protected url(path: string): URL {
    return new URL(`${this.baseUrl}${path}`);
  }

  protected async request<T>(url: URL, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined)
    };

    const { response, body } = await fetchBoundedJson(
      this.fetchImpl,
      url.toString(),
      { ...init, headers },
      {
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        signal: this.signal
      }
    );

    if (!response.ok) {
      const sanitizedDetails = sanitizeNumberIntelligenceValue(body);
      throw new TelnyxNumberLookupError(
        sanitizeMessage(
          extractTelnyxErrorMessage(sanitizedDetails) ??
            `Telnyx request failed with status ${response.status}`
        ),
        response.status,
        sanitizedDetails
      );
    }

    return body as T;
  }
}

export class TelnyxNumberLookupClient extends TelnyxBaseClient {
  async lookupNumber(phoneNumber: string): Promise<TelnyxNumberLookupResponse> {
    const url = this.url(`/number_lookup/${encodeURIComponent(normalizeE164ish(phoneNumber))}`);
    url.searchParams.append("type", "carrier");
    url.searchParams.append("type", "caller-name");

    return this.request<TelnyxNumberLookupResponse>(url, { method: "GET" });
  }
}

export class TelnyxReadOnlyClient extends TelnyxNumberLookupClient {
  async getOwnedNumber(phoneNumber: string): Promise<OwnershipSignalInput> {
    const record = await this.findOwnedNumberRecord(phoneNumber);
    if (!record) {
      return { owned: false, reason: "No owned Telnyx phone-number inventory record was found." };
    }

    const missing: string[] = [];
    if (!stringField(record, "messaging_profile_id")) missing.push("messaging profile");
    if (!stringField(record, "connection_id")) missing.push("voice connection");

    return {
      owned: true,
      numberId: stringField(record, "id"),
      reason: missing.length > 0 ? `Owned number found; missing ${missing.join(" and ")}.` : "Owned number found with messaging and voice assignments."
    };
  }

  private async findOwnedNumberRecord(phoneNumber: string): Promise<Record<string, unknown> | undefined> {
    return this.findPhoneNumberAcrossPages("/phone_numbers", phoneNumber, (url) => {
      url.searchParams.set("filter[phone_number]", digitsOnly(phoneNumber));
      url.searchParams.set("handle_messaging_profile_error", "true");
    });
  }

  private async findPhoneNumberAcrossPages(
    path: string,
    phoneNumber: string,
    configure: (url: URL) => void
  ): Promise<Record<string, unknown> | undefined> {
    for (let pageNumber = 1; pageNumber <= MAX_RECORD_SEARCH_PAGES; pageNumber += 1) {
      const url = this.url(path);
      configure(url);
      url.searchParams.set("page[size]", String(RECORD_SEARCH_PAGE_SIZE));
      url.searchParams.set("page[number]", String(pageNumber));

      const body = await this.request<TelnyxListResponse<Record<string, unknown>>>(url, { method: "GET" });
      const record = findPhoneNumberRecord(body, phoneNumber);
      if (record) return record;
      if (!hasNextPage(body, pageNumber, RECORD_SEARCH_PAGE_SIZE)) return undefined;
    }

    throw new Error(
      `Telnyx phone-number search exceeded the ${MAX_RECORD_SEARCH_PAGES}-page safety limit`
    );
  }

  async checkPortability(phoneNumber: string): Promise<PortabilitySignalInput> {
    const normalized = normalizeE164ish(phoneNumber);
    const url = this.url("/portability_checks");
    const body = await this.request<TelnyxListResponse<Record<string, unknown>>>(url, {
      method: "POST",
      body: JSON.stringify({ phone_numbers: [normalized] })
    });
    const record = findPhoneNumberRecord(body, normalized);
    if (!record) {
      return { status: "unknown", reason: "Portability check returned no result for the number." };
    }

    const portable = booleanField(record, "portable");
    const reason = stringField(record, "not_portable_reason") ?? stringField(record, "reason");
    return {
      portable,
      status: portable === true ? "portable" : portable === false ? "not_portable" : "unknown",
      reason: reason ?? (portable === true ? "Telnyx portability check returned portable." : "Telnyx portability check returned no explicit reason.")
    };
  }

  async checkMessagingReadiness(phoneNumber: string): Promise<MessagingSignalInput> {
    const normalized = normalizeE164ish(phoneNumber);
    const record = await this.findPhoneNumberAcrossPages(
      "/phone_numbers/messaging",
      normalized,
      (url) => url.searchParams.set("filter[phone_number]", normalized)
    );
    if (!record) {
      return { configured: false, capable: false, reason: "No Telnyx messaging settings record was found for this number." };
    }

    const profileId = stringField(record, "messaging_profile_id");
    const capable = messagingCapable(record);
    if (!profileId) {
      return { configured: false, capable, reason: "Messaging settings exist but no messaging profile is attached." };
    }

    const profileUrl = this.url(`/messaging_profiles/${encodeURIComponent(profileId)}`);
    const profileBody = await this.request<TelnyxSingleResponse<Record<string, unknown>>>(profileUrl, { method: "GET" });
    const profile = singleRecord(profileBody);
    const enabled = booleanField(profile, "enabled");
    const healthReason = messagingHealthReason(record);

    if (enabled === false) {
      return { configured: false, capable, profileId, reason: "Messaging profile is attached but disabled." };
    }

    return {
      configured: true,
      capable,
      profileId,
      reason: healthReason ?? "Messaging profile is attached and enabled."
    };
  }

  async checkVoiceReadiness(phoneNumber: string): Promise<VoiceSignalInput> {
    const inventoryRecord = await this.findOwnedNumberRecord(phoneNumber);
    if (!inventoryRecord) {
      return { configured: false, reason: "No Telnyx voice settings record was found for this number." };
    }

    const numberId = stringField(inventoryRecord, "id");
    if (!numberId) {
      return { configured: false, reason: "Owned number record has no ID for voice-settings lookup." };
    }

    const voiceUrl = this.url(`/phone_numbers/${encodeURIComponent(numberId)}/voice`);
    const voiceBody = await this.request<TelnyxSingleResponse<Record<string, unknown>>>(voiceUrl, { method: "GET" });
    const record = singleRecord(voiceBody);

    const connectionId = stringField(record, "connection_id");
    if (!connectionId) {
      return { configured: false, reason: "Voice settings exist but no connection is assigned." };
    }

    const connectionUrl = this.url(`/connections/${encodeURIComponent(connectionId)}`);
    const connectionBody = await this.request<TelnyxSingleResponse<Record<string, unknown>>>(connectionUrl, { method: "GET" });
    const connection = singleRecord(connectionBody);
    const active = booleanField(connection, "active");

    if (active === false) {
      return { configured: false, connectionId, reason: "Voice connection is assigned but inactive." };
    }

    return { configured: true, connectionId, reason: "Active voice connection is assigned." };
  }

  async getCachedReputation(phoneNumber: string): Promise<ReputationSignalInput> {
    const url = this.url(`/reputation/numbers/${encodeURIComponent(normalizeE164ish(phoneNumber))}`);
    url.searchParams.set("fresh", "false");

    try {
      const body = await this.request<TelnyxSingleResponse<Record<string, unknown>>>(url, { method: "GET" });
      const record = singleRecord(body);
      const reputation = objectField(record, "reputation_data");
      if (!reputation) {
        return { status: "unknown", reason: "Cached reputation endpoint returned no reputation data." };
      }

      const spamRisk = stringField(reputation, "spam_risk")?.toLowerCase();
      const maturityScore = numberField(reputation, "maturity_score");
      if (spamRisk === "high" || spamRisk === "very_high") {
        return { status: "bad", reason: "Cached Telnyx reputation spam risk is high." };
      }
      if (spamRisk === "medium" || spamRisk === "moderate" || (typeof maturityScore === "number" && maturityScore < 50)) {
        return { status: "warning", reason: "Cached Telnyx reputation should be reviewed before production use." };
      }
      if (spamRisk === "low" || (typeof maturityScore === "number" && maturityScore >= 80)) {
        return { status: "good", reason: "Cached Telnyx reputation does not show elevated risk." };
      }
      return { status: "unknown", reason: "Cached Telnyx reputation exists but could not be scored." };
    } catch (error) {
      if (error instanceof TelnyxNumberLookupError && error.status === 404) {
        return { status: "unknown", reason: "No cached Telnyx reputation record was found; no fresh lookup was requested." };
      }
      throw error;
    }
  }
}

function normalizeTelnyxV2BaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Telnyx API base URL must not be empty");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Telnyx API base URL must be an absolute HTTP(S) URL");
  }

  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Telnyx API base URL must be an absolute HTTP(S) URL without credentials, query, or fragment");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.includes("//")) {
    throw new Error("Telnyx API base URL path must not contain empty segments");
  }

  const rawSegments = pathname.split("/").filter(Boolean);
  let decodedSegments: string[];
  try {
    decodedSegments = rawSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("Telnyx API base URL path must use valid percent encoding");
  }

  if (decodedSegments.some((segment) => /[\/\\\u0000-\u001f\u007f]/.test(segment))) {
    throw new Error("Telnyx API base URL path contains an invalid encoded segment");
  }

  const versionSegments = decodedSegments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => /^v\d+$/i.test(segment));
  if (versionSegments.some(({ segment }) => segment !== "v2")) {
    throw new Error("Telnyx API base URL supports only a literal lowercase /v2 version segment");
  }
  if (versionSegments.length > 1 || (versionSegments.length === 1 && versionSegments[0]?.index !== decodedSegments.length - 1)) {
    throw new Error("Telnyx API base URL must contain at most one trailing /v2 segment");
  }
  if (decodedSegments.at(-1)?.toLowerCase() === "v2" && rawSegments.at(-1) !== "v2") {
    throw new Error("Telnyx API base URL version segment must be literal lowercase /v2");
  }

  url.pathname = rawSegments.at(-1) === "v2" ? pathname : `${pathname}/v2`;
  return url.toString().replace(/\/$/, "");
}

interface TelnyxListResponse<T> {
  data?: T[];
  meta?: {
    page_number?: number;
    total_pages?: number;
  };
}

interface TelnyxSingleResponse<T> {
  data?: T;
}

function extractTelnyxErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return undefined;
  }

  const first = errors[0];
  if (!first || typeof first !== "object") {
    return undefined;
  }

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

export function sanitizeNumberIntelligenceValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((nested) => sanitizeNumberIntelligenceValue(nested, key));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      output[nestedKey] = isSecretKey(nestedKey)
        ? "[redacted-secret]"
        : sanitizeNumberIntelligenceValue(nestedValue, nestedKey);
    }
    return output;
  }
  if (typeof value === "string") {
    return sanitizeMessage(value);
  }
  return value;
}

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return (
    /^auth(?!or)/.test(normalized) ||
    /(authorization|apikey|secret|token|password|credential|privatekey|clientsecret|accesstoken|refreshtoken)/.test(
      normalized
    )
  );
}

function sanitizeMessage(message: string): string {
  const sanitized = message
    .replace(
      /Authorization\s*:\s*Bearer\s+[^\s;,)]+/gi,
      "Authorization: Bearer [redacted-secret]"
    )
    .replace(/Bearer\s+[^\s;,)]+/gi, "Bearer [redacted-secret]")
    .replace(
      /\b(?:sk|pk|key|api)[_-]?(?:live|test|secret)?_[A-Za-z0-9_-]{6,}\b/gi,
      "[redacted-secret]"
    )
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret|token|password)["']?\s*[:=]\s*)(["'])[^"'\r\n]*\2/gi,
      "$1$2[redacted-secret]$2"
    )
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret|token|password)\s*(?:[=:]|\s)\s*[^\s;,)]+/gi,
      (match) => `${match.split(/[=:\s]/)[0]}=[redacted-secret]`
    )
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-payment]");
  return sanitized.length <= MAX_SAFE_MESSAGE_CHARS
    ? sanitized
    : `${sanitized.slice(0, MAX_SAFE_MESSAGE_CHARS)}…[truncated]`;
}

function normalizeE164ish(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  const digits = digitsOnly(trimmed);
  if (trimmed.startsWith("+") && digits.length > 0) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 0) return `+${digits}`;
  return trimmed;
}

function digitsOnly(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

function findPhoneNumberRecord(
  body: TelnyxListResponse<Record<string, unknown>>,
  phoneNumber: string
): Record<string, unknown> | undefined {
  const expected = digitsOnly(phoneNumber);
  return Array.isArray(body.data)
    ? body.data.find((record) => digitsOnly(stringField(record, "phone_number") ?? "") === expected)
    : undefined;
}

function hasNextPage<T>(
  body: TelnyxListResponse<T>,
  requestedPage: number,
  pageSize: number
): boolean {
  const totalPages = body.meta?.total_pages;
  if (Number.isSafeInteger(totalPages) && (totalPages ?? 0) >= 0) {
    return requestedPage < (totalPages ?? 0);
  }
  return Array.isArray(body.data) && body.data.length === pageSize;
}

function singleRecord<T extends Record<string, unknown>>(body: TelnyxSingleResponse<T>): T {
  return body.data ?? ({} as T);
}

function stringField(record: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function booleanField(record: Record<string, unknown> | undefined, field: string): boolean | undefined {
  const value = record?.[field];
  return typeof value === "boolean" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === "number" ? value : undefined;
}

function objectField(record: Record<string, unknown> | undefined, field: string): Record<string, unknown> | undefined {
  const value = record?.[field];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function messagingCapable(record: Record<string, unknown>): boolean | undefined {
  const products = record.eligible_messaging_products;
  if (Array.isArray(products)) return products.length > 0;
  const features = objectField(record, "features");
  if (!features) return undefined;
  return Boolean(features.sms || features.mms);
}

function messagingHealthReason(record: Record<string, unknown>): string | undefined {
  const health = objectField(record, "health");
  const spamRatio = numberField(health, "spam_ratio");
  const successRatio = numberField(health, "success_ratio");
  if (typeof spamRatio === "number" && spamRatio >= 0.1) {
    return "Messaging profile is enabled, but spam ratio is elevated in cached health data.";
  }
  if (typeof successRatio === "number" && successRatio < 0.8) {
    return "Messaging profile is enabled, but success ratio is low in cached health data.";
  }
  return undefined;
}
