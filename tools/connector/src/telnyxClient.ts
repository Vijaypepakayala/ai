export interface TelnyxClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Maximum upstream response body read in bytes. Default 256000. */
  maxResponseBytes?: number;
}

export type QueryValue = string | number | Array<string | number> | undefined;

export class TelnyxApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "TelnyxApiError";
    this.status = status;
    this.details = details;
  }
}

export class TelnyxRequestNotDispatchedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelnyxRequestNotDispatchedError";
  }
}

const RETRYABLE_HTTP_REJECTIONS = new Set([408, 421, 425]);

/** A known client rejection proves the mutation did not complete upstream. */
export function isDefinitiveHttpFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

function isRetryableHttpRejection(status: number): boolean {
  return RETRYABLE_HTTP_REJECTIONS.has(status);
}

export class TelnyxClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: TelnyxClientOptions) {
    if (!options.apiKey) {
      throw new Error("A Telnyx API key is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.telnyx.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "telnyx-claude-connector";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 256_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new Error("maxResponseBytes must be a positive safe integer");
    }
    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required");
    }
  }

  async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal } = {}
  ): Promise<unknown> {
    // An already-cancelled caller cannot have dispatched anything. Fail before
    // constructing or invoking fetch so the server can release any reservation
    // instead of treating this as an ambiguous in-flight cancellation.
    if (options.signal?.aborted) {
      throw new TelnyxRequestNotDispatchedError(
        `Telnyx API ${method} ${path} was cancelled before dispatch; no request was sent to Telnyx.`
      );
    }
    let url: URL;
    let serializedBody: string | undefined;
    try {
      url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value === undefined) {
          continue;
        }
        // Arrays become repeated params (?type=a&type=b) — the form the Telnyx
        // API requires for multi-value filters like number_lookup type and
        // filter[features][].
        for (const v of Array.isArray(value) ? value : [value]) {
          url.searchParams.append(key, String(v));
        }
      }
      if (options.body !== undefined) {
        serializedBody = JSON.stringify(options.body);
        if (serializedBody === undefined) {
          throw new TypeError("request body is not JSON-serializable");
        }
      }
    } catch {
      throw new TelnyxRequestNotDispatchedError(
        `Telnyx API ${method} ${path} could not be prepared before dispatch; no request was sent to Telnyx. Correct the request input before retrying.`
      );
    }

    // Hard timeout so a hung upstream can never hang the tool call, combined
    // with the MCP client's cancellation signal when one is provided.
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const timeoutError = () =>
      new TelnyxApiError(
        `Telnyx API ${method} ${path} timed out after ${this.timeoutMs}ms — the request may or may not have reached Telnyx; verify state with a read-only tool before retrying anything billable.`,
        0,
        null
      );
    const callerAbortError = () =>
      new TelnyxApiError(
        `Telnyx API ${method} ${path} was cancelled after dispatch began — the request may or may not have reached Telnyx; verify state with a read-only tool before retrying anything billable or mutating.`,
        0,
        null
      );
    const isMutation = method !== "GET";
    const ambiguousTransportError = (phase: "dispatch" | "response body read") =>
      new TelnyxApiError(
        `Telnyx API ${method} ${path} ${phase} failed after dispatch began — the request may or may not have reached Telnyx; verify state with a read-only tool before retrying anything billable or mutating.`,
        0,
        null
      );

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": this.userAgent
        },
        body: serializedBody,
        signal
      });
    } catch (err) {
      if (timeoutSignal.aborted) {
        throw timeoutError();
      }
      if (options.signal?.aborted) {
        throw callerAbortError();
      }
      // Once fetch has been invoked, a transport failure cannot prove that a
      // mutation was never accepted upstream. Surface the same at-most-once
      // warning used for timeouts/cancellation instead of exposing a generic
      // socket error that invites a duplicate retry.
      if (isMutation) {
        throw ambiguousTransportError("dispatch");
      }
      throw err;
    }

    // Bound the body BEFORE buffering it all: an upstream (or a proxy in
    // front of it) must not be able to force unbounded memory use or a
    // multi-hundred-KB tool error.
    let text = "";
    try {
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        let truncated = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > this.maxResponseBytes) {
            text += decoder.decode(
              value.slice(0, Math.max(0, this.maxResponseBytes - (bytes - value.byteLength)))
            );
            truncated = true;
            void reader.cancel();
            break;
          }
          text += decoder.decode(value, { stream: true });
        }
        if (!truncated) text += decoder.decode();
        if (truncated) text += `… [truncated at ${this.maxResponseBytes} bytes]`;
      }
    } catch (err) {
      if (timeoutSignal.aborted) {
        throw timeoutError();
      }
      if (options.signal?.aborted) {
        throw callerAbortError();
      }
      // A received 4xx (except 429) is a definitive rejection even if its body
      // is unreadable. Every other mutating response-read failure is ambiguous:
      // a 2xx action may have completed, and a 5xx/429 may have reached Telnyx.
      if (isDefinitiveHttpFailure(response.status)) {
        const retryGuidance = isRetryableHttpRejection(response.status)
          ? "This transient rejection is safe to retry unchanged, preferably on a fresh connection."
          : "The request was definitively rejected and should not be retried unchanged.";
        throw new TelnyxApiError(
          `Telnyx API ${method} ${path} was rejected with HTTP ${response.status}; its response body could not be read. ${retryGuidance}`,
          response.status,
          null
        );
      }
      if (isMutation) {
        throw ambiguousTransportError("response body read");
      }
      throw err;
    }
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON bodies (proxy/WAF error pages) are truncated so an incident
        // page can never flood the tool result.
        parsed = { raw: text.length > 800 ? `${text.slice(0, 800)}… [truncated ${text.length} chars]` : text };
      }
    }

    if (!response.ok) {
      // Redact credential-shaped fields recursively before the parsed body is
      // attached to the error (and thus surfaced in the transcript): a proxy
      // or upstream echoing an authorization header must not leak through.
      parsed = redactSecrets(parsed);
      const detail = extractErrorDetail(parsed);
      const retryAfter = response.status === 429 ? response.headers.get("retry-after") : null;
      const retryableRejection = isRetryableHttpRejection(response.status)
        ? " — transient rejection; retrying the same request is permitted, preferably on a fresh connection"
        : "";
      throw new TelnyxApiError(
        `Telnyx API ${method} ${path} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}${
          retryAfter ? ` — rate limited, retry after ${retryAfter}s; do not retry before then` : ""
        }${retryableRejection}`,
        response.status,
        parsed
      );
    }

    // Some 2xx responses (e.g. certain call-control actions) carry no body;
    // return an explicit success marker instead of the JSON literal null.
    if (parsed === null) {
      return { ok: true, http_status: response.status };
    }

    return parsed;
  }
}

const SECRET_KEY_RE = /(authorization|api[-_]?key|token|secret|password|private[-_]?key|credential|cookie|bearer)/i;
const MAX_REDACT_DEPTH = 8;
const MAX_EXTRACTED_ERROR_DETAIL_CHARS = 2_000;

/** Recursively replace credential-shaped values with a marker. */
function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return "[redacted: depth]";
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return typeof value === "string" ? redactCredentialText(value) : value;
}

export function redactCredentialText(value: string): string {
  return value
    // Truncation can make structured JSON unparseable, leaving credentials in
    // a raw preview with no sensitive key for recursive redaction to inspect.
    // Scrub standard auth schemes wherever they occur, regardless of field.
    .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [redacted]")
    .replace(/\b(Basic)\s+[A-Za-z0-9+/]+={0,2}/gi, "$1 [redacted]")
    .replace(/\bKEY[0-9A-Za-z_-]{6,}/gi, "[redacted-key]");
}

function boundExtractedDetail(value: string): string {
  if (value.length <= MAX_EXTRACTED_ERROR_DETAIL_CHARS) return value;
  const marker = `\n…[truncated upstream error detail: ${value.length} chars total]`;
  let head = value.slice(0, Math.max(0, MAX_EXTRACTED_ERROR_DETAIL_CHARS - marker.length));
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return `${head}${marker}`;
}

function extractErrorDetail(parsed: unknown): string | null {
  if (parsed && typeof parsed === "object" && "errors" in parsed) {
    const errors = (parsed as { errors?: Array<{ code?: string; title?: string; detail?: string }> }).errors;
    const first = errors?.[0];
    if (first) {
      return boundExtractedDetail(
        redactCredentialText([first.code, first.title, first.detail].filter(Boolean).join(" — "))
      );
    }
  }
  return null;
}
