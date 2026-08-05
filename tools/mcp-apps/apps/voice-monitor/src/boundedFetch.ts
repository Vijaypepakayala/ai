const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface BoundedFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

export async function fetchBoundedJson(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit,
  options: BoundedFetchOptions = {}
): Promise<{ response: Response; body: unknown }> {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxResponseBytes = positiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES
  );
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () =>
    controller.abort(options.signal?.reason ?? new Error("Telnyx request was cancelled"));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Telnyx request timed out"));
  }, timeoutMs);

  try {
    const response = await fetchImpl(input, {
      ...init,
      redirect: "error",
      signal: controller.signal
    });
    const body = await readBoundedJson(response, maxResponseBytes);
    return { response, body };
  } catch (error) {
    if (timedOut) throw new Error(`Telnyx request timed out after ${timeoutMs} ms`);
    if (options.signal?.aborted) throw new Error("Telnyx request was cancelled");
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readBoundedJson(response: Response, maxResponseBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    throw new Error(`Telnyx response exceeded the ${maxResponseBytes}-byte limit`);
  }
  if (!response.body) return {};

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        void reader.cancel();
        throw new Error(`Telnyx response exceeded the ${maxResponseBytes}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return {};
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Telnyx response was not valid UTF-8 JSON");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Telnyx response was not valid JSON");
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}
