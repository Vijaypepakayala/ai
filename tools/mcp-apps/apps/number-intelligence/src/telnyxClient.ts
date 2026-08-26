import type {
  MessagingSignalInput,
  OwnershipSignalInput,
  PortabilitySignalInput,
  ReputationSignalInput,
  TelnyxClientOptions,
  TelnyxNumberLookupResponse,
  VoiceSignalInput
} from "./types.js";

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

  constructor(options: TelnyxClientOptions) {
    if (!options.apiKey) {
      throw new Error("Telnyx API key is required for live number intelligence");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.telnyx.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;

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

    const response = await this.fetchImpl(url.toString(), {
      ...init,
      headers
    });

    const body = await parseJson(response);

    if (!response.ok) {
      throw new TelnyxNumberLookupError(
        extractTelnyxErrorMessage(body) ?? `Telnyx request failed with status ${response.status}`,
        response.status,
        body
      );
    }

    return body as T;
  }
}

export class TelnyxNumberLookupClient extends TelnyxBaseClient {
  async lookupNumber(phoneNumber: string): Promise<TelnyxNumberLookupResponse> {
    const url = this.url(`/v2/number_lookup/${encodeURIComponent(normalizeE164ish(phoneNumber))}`);
    url.searchParams.append("type", "carrier");
    url.searchParams.append("type", "caller-name");

    return this.request<TelnyxNumberLookupResponse>(url, { method: "GET" });
  }
}

export class TelnyxReadOnlyClient extends TelnyxNumberLookupClient {
  async getOwnedNumber(phoneNumber: string): Promise<OwnershipSignalInput> {
    const url = this.url("/v2/phone_numbers");
    url.searchParams.set("filter[phone_number]", digitsOnly(phoneNumber));
    url.searchParams.set("page[size]", "1");
    url.searchParams.set("page[number]", "1");
    url.searchParams.set("handle_messaging_profile_error", "true");

    const body = await this.request<TelnyxListResponse<Record<string, unknown>>>(url, { method: "GET" });
    const record = firstRecord(body);
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

  async checkPortability(phoneNumber: string): Promise<PortabilitySignalInput> {
    const normalized = normalizeE164ish(phoneNumber);
    const url = this.url("/v2/portability_checks");
    const body = await this.request<TelnyxListResponse<Record<string, unknown>>>(url, {
      method: "POST",
      body: JSON.stringify({ phone_numbers: [normalized] })
    });
    const record = firstRecord(body);
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
    const url = this.url("/v2/phone_numbers/messaging");
    url.searchParams.set("filter[phone_number]", normalized);
    url.searchParams.set("page[size]", "1");
    url.searchParams.set("page[number]", "1");

    const body = await this.request<TelnyxListResponse<Record<string, unknown>>>(url, { method: "GET" });
    const record = firstRecord(body);
    if (!record) {
      return { configured: false, capable: false, reason: "No Telnyx messaging settings record was found for this number." };
    }

    const profileId = stringField(record, "messaging_profile_id");
    const capable = messagingCapable(record);
    if (!profileId) {
      return { configured: false, capable, reason: "Messaging settings exist but no messaging profile is attached." };
    }

    const profileUrl = this.url(`/v2/messaging_profiles/${encodeURIComponent(profileId)}`);
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
    const url = this.url("/v2/phone_numbers/voice");
    url.searchParams.set("filter[phone_number]", digitsOnly(phoneNumber));
    url.searchParams.set("page[size]", "1");
    url.searchParams.set("page[number]", "1");

    const body = await this.request<TelnyxListResponse<Record<string, unknown>>>(url, { method: "GET" });
    const record = firstRecord(body);
    if (!record) {
      return { configured: false, reason: "No Telnyx voice settings record was found for this number." };
    }

    const connectionId = stringField(record, "connection_id");
    if (!connectionId) {
      return { configured: false, reason: "Voice settings exist but no connection is assigned." };
    }

    const connectionUrl = this.url(`/v2/connections/${encodeURIComponent(connectionId)}`);
    const connectionBody = await this.request<TelnyxSingleResponse<Record<string, unknown>>>(connectionUrl, { method: "GET" });
    const connection = singleRecord(connectionBody);
    const active = booleanField(connection, "active");

    if (active === false) {
      return { configured: false, connectionId, reason: "Voice connection is assigned but inactive." };
    }

    return { configured: true, connectionId, reason: "Active voice connection is assigned." };
  }

  async getCachedReputation(phoneNumber: string): Promise<ReputationSignalInput> {
    const url = this.url(`/v2/reputation/numbers/${encodeURIComponent(normalizeE164ish(phoneNumber))}`);
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

interface TelnyxListResponse<T> {
  data?: T[];
}

interface TelnyxSingleResponse<T> {
  data?: T;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
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

function firstRecord<T>(body: TelnyxListResponse<T>): T | undefined {
  return Array.isArray(body.data) ? body.data[0] : undefined;
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
