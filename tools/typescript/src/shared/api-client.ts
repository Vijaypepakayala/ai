/**
 * Telnyx API client using native fetch (Node 18+).
 */

export class TelnyxAPIError extends Error {
  readonly statusCode: number;
  readonly detail: string;
  readonly errors: Record<string, unknown>[];
  readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    detail: string,
    errors: Record<string, unknown>[] = [],
    retryAfterSeconds?: number,
  ) {
    super(`Telnyx API error ${statusCode}: ${detail}`);
    this.name = "TelnyxAPIError";
    this.statusCode = statusCode;
    this.detail = detail;
    this.errors = errors;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface TelnyxAPIClientOptions {
  baseUrl?: string;
  timeout?: number;
}

export interface TelnyxRequestOptions {
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface TelnyxPollOptions {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  intervalMs?: number;
  timeoutMs?: number;
  isDone?: (response: Record<string, unknown>) => boolean;
}

type ResponseMeta = {
  body: Record<string, unknown>;
  statusCode: number;
  retryAfterMs?: number;
};

export class TelnyxAPIClient {
  readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    apiKey: string,
    options: TelnyxAPIClientOptions = {},
  ) {
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.telnyx.com/v2").replace(
      /\/$/,
      "",
    );
    this.timeout = options.timeout ?? 30000;
  }

  private getHeaders(options: TelnyxRequestOptions = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    return {
      ...headers,
      ...options.headers,
    };
  }

  private async handleResponse(
    response: Response,
  ): Promise<ResponseMeta> {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
    const retryAfterMs = retryAfterSeconds === undefined ? undefined : retryAfterSeconds * 1000;

    if (response.status >= 400) {
      let detail: string;
      let errors: Record<string, unknown>[] = [];
      try {
        const body = (await response.json()) as Record<string, unknown>;
        const bodyErrors = body.errors as Record<string, unknown>[] | undefined;
        if (bodyErrors && bodyErrors.length > 0) {
          errors = bodyErrors;
          detail = (bodyErrors[0].detail as string) ?? response.statusText;
        } else {
          detail = response.statusText;
        }
      } catch {
        detail = response.statusText;
      }
      throw new TelnyxAPIError(response.status, detail, errors, retryAfterSeconds);
    }

    if (response.status === 204) {
      return { body: {}, statusCode: response.status, retryAfterMs };
    }

    return {
      body: (await response.json()) as Record<string, unknown>,
      statusCode: response.status,
      retryAfterMs,
    };
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: {
      params?: Record<string, unknown>;
      json?: Record<string, unknown>;
      request?: TelnyxRequestOptions;
    } = {},
  ): Promise<ResponseMeta> {
    let url = `${this.baseUrl}${path}`;

    if (options.params && Object.keys(options.params).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            searchParams.append(key, String(item));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
      url += `?${searchParams.toString()}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(options.request),
        body: options.json ? JSON.stringify(options.json) : undefined,
        signal: controller.signal,
      });
      return await this.handleResponse(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.request("GET", path, { params });
    return response.body;
  }

  async post(
    path: string,
    json?: Record<string, unknown>,
    options: TelnyxRequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request("POST", path, { json, request: options });
    return response.body;
  }

  async put(
    path: string,
    json?: Record<string, unknown>,
    options: TelnyxRequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request("PUT", path, { json, request: options });
    return response.body;
  }

  async patch(
    path: string,
    json?: Record<string, unknown>,
    options: TelnyxRequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request("PATCH", path, { json, request: options });
    return response.body;
  }

  async delete(path: string, options: TelnyxRequestOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.request("DELETE", path, { request: options });
    return response.body;
  }

  async poll(
    path: string,
    options: TelnyxPollOptions = {},
  ): Promise<Record<string, unknown>> {
    const isDone = options.isDone ?? defaultIsDone;
    const intervalMs = options.intervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? this.timeout;
    const startedAt = Date.now();

    while (true) {
      const response = await this.request("GET", path, {
        params: options.params,
        request: { headers: options.headers },
      });

      if (isDone(response.body)) {
        return response.body;
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(`Timed out polling ${path} after ${timeoutMs}ms`);
      }

      const delayMs = response.retryAfterMs ?? intervalMs;
      await sleep(Math.min(delayMs, timeoutMs - elapsedMs));
    }
  }
}

function defaultIsDone(response: Record<string, unknown>): boolean {
  const data = asRecord(response.data);
  const status = firstString(data?.status, response.status, data?.operation_status);
  if (!status) return true;

  return ["completed", "failed", "canceled", "cancelled", "error", "succeeded"].includes(
    status.toLowerCase(),
  );
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
