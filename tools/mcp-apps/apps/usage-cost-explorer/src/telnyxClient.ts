import type {
  AutoRechargePreferencesData,
  AutoRechargeUpdatePayload,
  BillingGroupCreatePayload,
  BillingGroupData,
  BillingGroupUpdatePayload,
  BalanceData,
  PageInput,
  StoredPaymentTransactionData,
  StoredPaymentTransactionPayload,
  TelnyxClientOptions,
  TelnyxEnvelope,
  UsageQueryInput,
  UsageReportOptionsInput
} from "./types.js";
import { fetchBoundedJson } from "./boundedFetch.js";

const DEFAULT_BASE_URL = "https://api.telnyx.com/v2";
const MAX_SAFE_MESSAGE_CHARS = 4096;

export class TelnyxBillingError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "TelnyxBillingError";
    this.status = status;
    this.details = details;
  }
}

export class TelnyxBillingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number | undefined;
  private readonly maxResponseBytes: number | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(options: TelnyxClientOptions) {
    if (!options.apiKey) {
      throw new Error("Telnyx API key is required for live Usage & Billing Explorer calls");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
    this.signal = options.signal;
    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
  }

  async getBalance(): Promise<TelnyxEnvelope<BalanceData>> {
    return this.request(this.url("/balance"), { method: "GET" });
  }

  async getAutoRechargePreferences(): Promise<TelnyxEnvelope<AutoRechargePreferencesData>> {
    return this.request(this.url("/payment/auto_recharge_prefs"), { method: "GET" });
  }

  async updateAutoRechargePreferences(payload: AutoRechargeUpdatePayload): Promise<TelnyxEnvelope<AutoRechargePreferencesData>> {
    return this.request(this.url("/payment/auto_recharge_prefs"), {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  async createStoredPaymentTransaction(payload: StoredPaymentTransactionPayload): Promise<TelnyxEnvelope<StoredPaymentTransactionData>> {
    return this.request(this.url("/payment/stored_payment_transactions"), {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listBillingGroups(input: PageInput = {}): Promise<TelnyxEnvelope<BillingGroupData[]>> {
    const url = this.url("/billing_groups");
    if (input.pageNumber !== undefined) url.searchParams.set("page[number]", String(input.pageNumber));
    if (input.pageSize !== undefined) url.searchParams.set("page[size]", String(input.pageSize));
    return this.request(url, { method: "GET" });
  }

  async createBillingGroup(payload: BillingGroupCreatePayload): Promise<TelnyxEnvelope<BillingGroupData>> {
    return this.request(this.url("/billing_groups"), { method: "POST", body: JSON.stringify(payload) });
  }

  async getBillingGroup(id: string): Promise<TelnyxEnvelope<BillingGroupData>> {
    return this.request(this.url(`/billing_groups/${encodeURIComponent(id)}`), { method: "GET" });
  }

  async updateBillingGroup(id: string, payload: BillingGroupUpdatePayload): Promise<TelnyxEnvelope<BillingGroupData>> {
    return this.request(this.url(`/billing_groups/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  async getUsageReportOptions(input: UsageReportOptionsInput = {}): Promise<TelnyxEnvelope> {
    const url = this.url("/usage_reports/options");
    if (input.product) url.searchParams.set("product", input.product);
    return this.request(url, { method: "GET" });
  }

  async queryUsageReport(input: UsageQueryInput): Promise<TelnyxEnvelope> {
    const url = this.url("/usage_reports");
    url.searchParams.set("product", input.product);
    url.searchParams.set("dimensions", input.dimensions.join(","));
    url.searchParams.set("metrics", input.metrics.join(","));
    if (input.startDate) url.searchParams.set("start_date", input.startDate);
    if (input.endDate) url.searchParams.set("end_date", input.endDate);
    if (input.dateRange) url.searchParams.set("date_range", input.dateRange);
    if (input.filters) {
      for (const [key, value] of Object.entries(input.filters)) {
        url.searchParams.append(`filter[${key}]`, String(value));
      }
    }
    if (input.sort) {
      url.searchParams.set("sort", input.sort.join(","));
    }
    url.searchParams.set("format", input.format);
    url.searchParams.set("page[number]", String(input.pageNumber));
    url.searchParams.set("page[size]", String(input.pageSize));
    url.searchParams.set("managed_accounts", String(input.managedAccounts));
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
      const sanitizedDetails = sanitizeBillingValue(body);
      const message = sanitizeMessage(extractTelnyxErrorMessage(sanitizedDetails) ?? `Telnyx request failed with status ${response.status}`);
      throw new TelnyxBillingError(message, response.status, sanitizedDetails);
    }

    return body as T;
  }
}

export function sanitizeError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const sanitized = new Error(sanitizeMessage(source.message));
  sanitized.name = source.name;
  return sanitized;
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

export function sanitizeBillingValue(value: unknown): unknown {
  return sanitizeBillingValueInternal(value, "", 0, false);
}

export function sanitizeBillingToolOutput(value: unknown): unknown {
  return sanitizeBillingValueInternal(value, "", 0, true);
}

function sanitizeBillingValueInternal(
  value: unknown,
  key: string,
  depth: number,
  allowRootConfirmationToken: boolean
): unknown {
  if (Array.isArray(value)) {
    return value.map((nested) =>
      sanitizeBillingValueInternal(
        nested,
        key,
        depth + 1,
        allowRootConfirmationToken
      )
    );
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSafeAppTokenKey(key, depth + 1, allowRootConfirmationToken)) {
        output[key] = sanitizeBillingValueInternal(
          nested,
          key,
          depth + 1,
          allowRootConfirmationToken
        );
      }
      else if (isSecretKey(key)) output[key] = "[redacted-secret]";
      else {
        output[key] = sanitizeBillingValueInternal(
          nested,
          key,
          depth + 1,
          allowRootConfirmationToken
        );
      }
    }
    return output;
  }
  if (typeof value === "string") return sanitizeMessage(value);
  return value;
}

function isSafeAppTokenKey(
  key: string,
  depth: number,
  allowRootConfirmationToken: boolean
): boolean {
  return allowRootConfirmationToken && depth === 1 && key === "confirmation_token";
}

function isSecretKey(key: string): boolean {
  const tokens = keyTokens(key);
  const joined = tokens.join("");
  const sensitiveTokens = new Set([
    "auth",
    "authorization",
    "apikey",
    "secret",
    "token",
    "password",
    "credential",
    "privatekey",
    "clientsecret",
    "accesstoken",
    "refreshtoken",
    "card",
    "bank",
    "paymentmethod",
    "paypal",
    "ach",
    "x402"
  ]);
  return (
    sensitiveTokens.has(joined) ||
    tokens.some((token) => sensitiveTokens.has(token)) ||
    hasTokenPair(tokens, "api", "key") ||
    hasTokenPair(tokens, "access", "token") ||
    hasTokenPair(tokens, "refresh", "token") ||
    hasTokenPair(tokens, "client", "secret") ||
    hasTokenPair(tokens, "private", "key") ||
    hasTokenPair(tokens, "payment", "method")
  );
}

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasTokenPair(tokens: string[], left: string, right: string): boolean {
  return tokens.some((token, index) => token === left && tokens[index + 1] === right);
}

function sanitizeMessage(message: string): string {
  const sanitized = message
    .replace(/Authorization\s*:\s*Bearer\s+[^\s;,)]+/gi, "Authorization: Bearer [redacted-secret]")
    .replace(/Bearer\s+[^\s;,)]+/gi, "Bearer [redacted-secret]")
    .replace(/\b(?:sk|pk|key|api)[_-]?(?:live|test|secret)?_[A-Za-z0-9_\-]{6,}\b/gi, "[redacted-secret]")
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret|token|password)["']?\s*[:=]\s*)(["'])[^"'\r\n]*\2/gi,
      "$1$2[redacted-secret]$2"
    )
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret|token|password)\s*(?:[=:]|\s)\s*[^\s;,)]+/gi, (match) => `${match.split(/[=:\s]/)[0]}=[redacted-secret]`)
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-payment]");
  return truncateSafeMessage(sanitized);
}

function truncateSafeMessage(message: string): string {
  return message.length <= MAX_SAFE_MESSAGE_CHARS
    ? message
    : `${message.slice(0, MAX_SAFE_MESSAGE_CHARS)}…[truncated]`;
}
