import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { TelnyxAPIClient, TelnyxAPIError } from "../src/shared/api-client.js";

describe("TelnyxAPIClient", () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  it("sends Idempotency-Key on writes", async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.telnyx.com/v2/messages");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], "idem-123");
      return new Response(JSON.stringify({ data: { id: "msg-123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = new TelnyxAPIClient("test-key");
    const result = await client.post("/messages", { text: "hello" }, { idempotencyKey: "idem-123" });
    assert.equal(result.data.id, "msg-123");
  });

  it("polls until a terminal status and respects Retry-After", async () => {
    const seenMethods: string[] = [];
    let callCount = 0;
    const delays: number[] = [];

    globalThis.fetch = async (_input, init) => {
      seenMethods.push(String(init?.method));
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ data: { status: "queued" } }), {
          status: 202,
          headers: {
            "content-type": "application/json",
            "retry-after": "0.01",
          },
        });
      }

      return new Response(JSON.stringify({ data: { status: "completed" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number) => {
      delays.push(Number(_timeout ?? 0));
      if (typeof handler === "function") handler();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      const client = new TelnyxAPIClient("test-key", { timeout: 100 });
      const result = await client.poll("/messages/msg-123");
      assert.equal(result.data.status, "completed");
      assert.deepEqual(seenMethods, ["GET", "GET"]);
      assert.equal(callCount, 2);
      assert.ok(delays.some((delay) => delay === 10));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("surfaces retry_after_seconds on API errors", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ errors: [{ detail: "Rate limited" }] }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "3",
        },
      });

    const client = new TelnyxAPIClient("test-key");
    await assert.rejects(
      () => client.get("/messages"),
      (error: unknown) =>
        error instanceof TelnyxAPIError &&
        error.statusCode === 429 &&
        error.retryAfterSeconds === 3,
    );
  });
});
