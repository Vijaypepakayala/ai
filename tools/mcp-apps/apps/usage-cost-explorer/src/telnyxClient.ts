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

const DEFAULT_BASE_URL = "https://api.telnyx.com/v2";

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

  constructor(options: TelnyxClientOptions) {
    if (!options.apiKey) {
      throw new Error("Telnyx API key is required for live Usage & Billing Explorer calls");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
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

    const response = await this.fetchImpl(url.toString(), { ...init, headers });
    const body = await parseJson(response);

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

export function sanitizeBillingValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBillingValue);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSafeAppTokenKey(key)) output[key] = sanitizeBillingValue(nested);
      else if (isSecretKey(key)) output[key] = "[redacted-secret]";
      else output[key] = sanitizeBillingValue(nested);
    }
    return output;
  }
  if (typeof value === "string") return sanitizeMessage(value);
  return value;
}

function isSafeAppTokenKey(key: string): boolean {
  return key === "confirmation_token";
}

function isSecretKey(key: string): boolean {
  return /(^|_)(auth|authorization|api_?key|secret|token|password|card|bank|payment_method|paypal|ach|x402)($|_)/i.test(key);
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/Authorization\s*:\s*Bearer\s+[^\s;,)]+/gi, "Authorization: Bearer [redacted-secret]")
    .replace(/Bearer\s+[^\s;,)]+/gi, "Bearer [redacted-secret]")
    .replace(/\b(?:sk|pk|key|api)[_-]?(?:live|test|secret)?_[A-Za-z0-9_\-]{6,}\b/gi, "[redacted-secret]")
    .replace(/\b(?:api[_-]?key|secret|token|password)\s*(?:[=:]|\s)\s*[^\s;,)]+/gi, (match) => `${match.split(/[=:\s]/)[0]}=[redacted-secret]`)
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-payment]");
}
