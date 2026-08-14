import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, requireStartupApiKey } from "../src/server.js";
import { TelnyxClient } from "../src/telnyxClient.js";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function connectedClient(fetchMock: FetchMock, options: { maxResponseBytes?: number } = {}) {
  const telnyx = new TelnyxClient({
    apiKey: "KEYTEST",
    fetch: fetchMock as unknown as typeof fetch,
    ...options
  });
  const server = createServer({ client: telnyx });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function connectedClientWithElicitation(
  fetchMock: FetchMock,
  approve: boolean | (() => boolean),
  onPrompt?: (message: string) => void
) {
  const telnyx = new TelnyxClient({ apiKey: "KEYTEST", fetch: fetchMock as unknown as typeof fetch });
  const server = createServer({ client: telnyx });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: { elicitation: {} } }
  );
  const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    onPrompt?.(request.params.message);
    return {
      action: "accept",
      content: { approve: typeof approve === "function" ? approve() : approve }
    };
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface NumberSearchArgs {
  country_code: string;
  area_code?: string;
  contains?: string;
  features?: Array<"sms" | "mms" | "voice" | "fax" | "emergency">;
  limit: number;
}

async function establishNumberSearchContext(
  client: Client,
  fetchMock: FetchMock,
  arguments_: NumberSearchArgs = { country_code: "US", limit: 10 }
) {
  const result = await client.callTool({
    name: "search_available_numbers",
    arguments: arguments_
  });
  expect(result.isError ?? false).toBe(false);
  // Order assertions should count only the quote/revalidation/order phase.
  fetchMock.mockClear();
}


// After search context is established, order_number reads live inventory
// before approval and revalidates the same quote afterward, so order tests
// answer both reads plus the order request.
function pricingThenOrder(orderResponse: Response = jsonResponse(200, { data: { id: "order1" } })) {
  return vi.fn().mockImplementation(async (url: unknown) => {
    if (String(url).includes("available_phone_numbers")) {
      return jsonResponse(200, {
        data: [{ phone_number: "+13125550100", cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" } }]
      });
    }
    return orderResponse;
  });
}

describe("tool registry", () => {
  it("exposes the curated tool set, every tool titled and annotated", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "call_command",
        "check_messaging_readiness",
        "get_message_status",
        "list_owned_numbers",
        "lookup_number",
        "order_number",
        "place_call",
        "search_available_numbers",
        "send_message"
      ].sort()
    );
    for (const tool of tools) {
      expect(tool.annotations?.title ?? (tool as { title?: string }).title, `${tool.name} title`).toBeTruthy();
      expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBeTypeOf("boolean");
      expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBeTypeOf("boolean");
      expect(tool.annotations?.idempotentHint, `${tool.name} idempotentHint`).toBeTypeOf("boolean");
      expect(tool.annotations?.openWorldHint, `${tool.name} openWorldHint`).toBeTypeOf("boolean");
    }
  });

  it("marks reads read-only and spend/call-mutating tools destructive", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const reader of [
      "search_available_numbers",
      "list_owned_numbers",
      "check_messaging_readiness",
      "get_message_status"
    ]) {
      expect(byName[reader].annotations?.readOnlyHint, reader).toBe(true);
    }
    expect(byName.order_number.annotations?.destructiveHint).toBe(true);
    expect(byName.call_command.annotations?.destructiveHint).toBe(true);
    expect(byName.send_message.annotations?.destructiveHint).toBe(true);
    expect(byName.place_call.annotations?.destructiveHint).toBe(true);
    expect(byName.lookup_number.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false
    });
  });
});

describe("executable startup configuration", () => {
  it.each([undefined, "", "   "])("fails boot for a missing API key value %j", (value) => {
    expect(() => requireStartupApiKey(value)).toThrow(/TELNYX_API_KEY is not set/);
  });

  it("returns a trimmed configured API key without logging it", () => {
    expect(requireStartupApiKey("  KEYTEST  ")).toBe("KEYTEST");
  });
});

interface EndpointDispatchCase {
  tool: string;
  arguments: Record<string, unknown>;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

const ENDPOINT_DISPATCH_CASES: EndpointDispatchCase[] = [
  {
    tool: "search_available_numbers",
    arguments: { country_code: "US", area_code: "312", contains: "55", features: ["sms", "voice"], limit: 2 },
    method: "GET",
    path: "/v2/available_phone_numbers",
    query: {
      "filter[country_code]": "US",
      "filter[national_destination_code]": "312",
      "filter[phone_number][contains]": "55",
      "filter[features][]": "sms,voice",
      "filter[limit]": "2"
    }
  },
  {
    tool: "lookup_number",
    arguments: { phone_number: "+13125550100" },
    method: "GET",
    path: "/v2/number_lookup/%2B13125550100"
  },
  {
    tool: "list_owned_numbers",
    arguments: { page_size: 5, page: 2, phone_number: "+13125550100" },
    method: "GET",
    path: "/v2/phone_numbers",
    query: {
      "page[size]": "5",
      "page[number]": "2",
      "filter[phone_number]": "+13125550100"
    }
  },
  {
    tool: "check_messaging_readiness",
    arguments: { phone_number_id: "123/456" },
    method: "GET",
    path: "/v2/phone_numbers/123%2F456/messaging"
  },
  {
    tool: "get_message_status",
    arguments: { message_id: "00000000-0000-4000-8000-000000000001" },
    method: "GET",
    path: "/v2/messages/00000000-0000-4000-8000-000000000001"
  },
  {
    tool: "send_message",
    arguments: { to: "+15550001111", from: "+15550002222", text: "endpoint matrix" },
    method: "POST",
    path: "/v2/messages",
    body: { to: "+15550001111", from: "+15550002222", text: "endpoint matrix" }
  },
  {
    tool: "place_call",
    arguments: { to: "+15550001111", from: "+15550002222", connection_id: "conn-123" },
    method: "POST",
    path: "/v2/calls",
    body: { to: "+15550001111", from: "+15550002222", connection_id: "conn-123" }
  }
];

describe("complete HTTP endpoint dispatch matrix", () => {
  it.each(ENDPOINT_DISPATCH_CASES)(
    "$tool dispatches the exact method, path, query, and body",
    async ({ tool, arguments: arguments_, method, path, query, body }) => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
      const client = await connectedClient(fetchMock);
      const result = await client.callTool({ name: tool, arguments: arguments_ });

      expect(result.isError ?? false).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [rawUrl, rawInit] = fetchMock.mock.calls[0];
      const url = new URL(String(rawUrl));
      const init = rawInit as RequestInit;
      expect(url.pathname).toBe(path);
      expect(init.method).toBe(method);
      if (query) {
        const actualQuery = Object.fromEntries(
          [...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key).join(",")])
        );
        expect(actualQuery).toEqual(query);
      } else {
        expect([...url.searchParams]).toEqual([]);
      }
      expect(init.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(body);
    }
  );

  it("requires every registered tool to have a direct endpoint-flow test", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const covered = [
      ...ENDPOINT_DISPATCH_CASES.map(({ tool }) => tool),
      // These multi-request/gated flows have dedicated direct tests below.
      "order_number",
      "call_command"
    ];
    expect([...new Set(covered)].sort()).toEqual(tools.map(({ name }) => name).sort());
  });
});

interface CallCommandDispatchCase {
  command: string;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  confirmation?: boolean;
}

const CALL_COMMAND_DISPATCH_CASES: CallCommandDispatchCase[] = [
  { command: "answer", params: {}, body: {} },
  { command: "hangup", params: {}, body: {} },
  { command: "speak", params: { payload: "Hello", voice: "Polly.Joanna-Neural" }, body: { payload: "Hello", voice: "Polly.Joanna-Neural" } },
  { command: "gather_using_speak", params: { payload: "Press one", voice: "Polly.Joanna-Neural" }, body: { payload: "Press one", voice: "Polly.Joanna-Neural" } },
  { command: "playback_start", params: { media_name: "greeting.wav" }, body: { media_name: "greeting.wav" } },
  { command: "playback_stop", params: {}, body: {} },
  {
    command: "bridge",
    params: { call_control_id_to_bridge_with: "cc-target" },
    body: { call_control_id: "cc-target" },
    confirmation: true
  },
  { command: "transfer", params: { to: "+15550003333" }, body: { to: "+15550003333" }, confirmation: true },
  {
    command: "record_start",
    params: { format: "mp3", channels: "dual" },
    body: { format: "mp3", channels: "dual" },
    confirmation: true
  },
  { command: "record_stop", params: {}, body: {} },
  { command: "reject", params: { cause: "CALL_REJECTED" }, body: { cause: "CALL_REJECTED" } }
];

describe("complete Call Control action dispatch matrix", () => {
  it.each(CALL_COMMAND_DISPATCH_CASES)(
    "$command dispatches its exact action route and translated body",
    async ({ command, params, body, confirmation }) => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
      const client = confirmation
        ? await connectedClientWithElicitation(fetchMock, true)
        : await connectedClient(fetchMock);
      const result = await client.callTool({
        name: "call_command",
        arguments: { call_control_id: "cc-source", command, params }
      });

      expect(result.isError ?? false).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [rawUrl, rawInit] = fetchMock.mock.calls[0];
      expect(new URL(String(rawUrl)).pathname).toBe(`/v2/calls/cc-source/actions/${command}`);
      const init = rawInit as RequestInit;
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual(body);
    }
  );

  it("requires every command exposed by the tool schema to have a dispatch case", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const callCommand = tools.find(({ name }) => name === "call_command");
    const schema = callCommand?.inputSchema as {
      properties?: { command?: { enum?: string[] } };
    };
    expect(CALL_COMMAND_DISPATCH_CASES.map(({ command }) => command).sort())
      .toEqual([...(schema.properties?.command?.enum ?? [])].sort());
  });
});

describe("live harness write safety", () => {
  it("builds fresh, disables number-order POSTs, and never passes an unexercised quote gate", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> };
    const liveHarness = readFileSync(
      new URL("../test-live/live-contract.mjs", import.meta.url),
      "utf8"
    );
    const readOnlyLauncher = readFileSync(
      new URL("../test-live/read-only-cli.mjs", import.meta.url),
      "utf8"
    );
    const liveWriteHarness = readFileSync(
      new URL("../test-live/live-write.mjs", import.meta.url),
      "utf8"
    );
    expect(packageJson.scripts?.["pretest:live"]).toBe("npm run build");
    expect(packageJson.scripts?.["pretest:live:write"]).toBe("npm run build");
    expect(liveHarness).toContain('args: ["test-live/read-only-cli.mjs"]');
    expect(liveHarness).toContain('TELNYX_CONNECTOR_MAX_ORDER_NUMBER: "1"');
    expect(liveHarness).toContain('TELNYX_CONNECTOR_MAX_SEND_MESSAGE: "0"');
    expect(liveHarness).toContain('TELNYX_CONNECTOR_MAX_PLACE_CALL: "0"');
    expect(liveHarness).toContain('TELNYX_CONNECTOR_MAX_CALL_COMMAND: "0"');
    expect(readOnlyLauncher).toContain('method !== "GET"');
    expect(readOnlyLauncher).toMatch(/throw new Error\(`Live read-only backstop refused/);
    expect(liveHarness).toContain("MAX_LIVE_QUOTE_CANDIDATES = 5");
    expect(liveHarness).toContain(".slice(0, MAX_LIVE_QUOTE_CANDIDATES)");
    expect(liveHarness).toContain("bounded live candidates turned over before authoritative pricing");
    expect(liveHarness).toContain("not exercised: documented US inventory search returned no orderable number");
    expect(liveHarness).toContain('detail: "not exercised: the live test account has no owned number"');
    expect(liveHarness).not.toMatch(/ok:\s*true[^\n]*skipped:\s*no inventory/i);
    expect(liveWriteHarness).toContain('TELNYX_TEST_FROM_NUMBER');
    expect(liveWriteHarness).toContain('TELNYX_TEST_TO_NUMBER');
    expect(liveWriteHarness).toContain('TELNYX_TEST_SENDER_COMPLIANCE_OK !== "yes"');
    expect(liveWriteHarness).toContain('TELNYX_CONNECTOR_MAX_SEND_MESSAGE: "1"');
    expect(liveWriteHarness).toContain('phone_number: from');
  });

  it("the live read-only launcher blocks mutation before invoking network fetch", async () => {
    const { createReadOnlyFetch } = await import("../test-live/read-only-cli.mjs");
    const networkFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    const guardedFetch = createReadOnlyFetch(networkFetch);

    await expect(guardedFetch("https://api.telnyx.com/v2/number_orders", { method: "POST" }))
      .rejects.toThrow(/refused POST.*before network I\/O/);
    expect(networkFetch).not.toHaveBeenCalled();

    await expect(guardedFetch("https://api.telnyx.com/v2/available_phone_numbers", { method: "GET" }))
      .resolves.toBeInstanceOf(Response);
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it("the zero order cap blocks quote lookup, approval, and POST", async () => {
    process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER = "0";
    try {
      const fetchMock = pricingThenOrder();
      const onPrompt = vi.fn();
      const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
      await establishNumberSearchContext(client, fetchMock);

      const result = await client.callTool({
        name: "order_number",
        arguments: { phone_number: "+13125550100" }
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain("used 0/0");
      expect(onPrompt).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("available_phone_numbers")
      )).toHaveLength(0);
      expect(fetchMock.mock.calls.every((call) =>
        !String(call[0]).includes("number_orders")
      )).toBe(true);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER;
    }
  });
});

describe("send_message", () => {
  it("posts the exact body and omits messaging_profile_id unless given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "m1" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "+15550001111", from: "+15550002222", text: "hi" }
    });
    expect(result.isError ?? false).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ to: "+15550001111", from: "+15550002222", text: "hi" });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer KEYTEST" });
  });

  it("surfaces Telnyx error codes instead of swallowing them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { errors: [{ code: "40310", title: "Invalid phone number" }] })
      );
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "+1555000", from: "+15550002222", text: "hi" }
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("40310");
    expect(text).toContain("HTTP 400");
  });
});

describe("order_number spend gate", () => {
  it("rejects the removed model-attested confirm input before any network request", async () => {
    const fetchMock = pricingThenOrder();
    const client = await connectedClient(fetchMock);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100", confirm: true }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/unrecognized key.*confirm/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the exact live quote but fails closed without elicitation", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        return jsonResponse(200, {
          data: [{
            phone_number: "+13125550100",
            cost_information: { monthly_cost: "9999.00", upfront_cost: "5000.00", currency: "USD" }
          }]
        });
      }
      return jsonResponse(200, { data: { id: "must-not-order" } });
    });
    const client = await connectedClient(fetchMock);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain("Live authoritative quote");
    expect(text).toContain("monthly_cost: 9999");
    expect(text).toContain("upfront_cost: 5000");
    expect(text).toContain("elicitation");
    expect(text).toContain("NOT ordered");
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("orders only after approval through MCP elicitation", async () => {
    const fetchMock = pricingThenOrder();
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError ?? false).toBe(false);
    const orderCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("number_orders"));
    expect(orderCall).toBeTruthy();
    expect(JSON.parse((orderCall![1] as RequestInit).body as string)).toEqual({
      phone_numbers: [{ phone_number: "+13125550100" }]
    });
  });
});

describe("order_number atomic flow guards", () => {
  it("allows one same-DID flow, refuses the concurrent duplicate, and blocks a retry after dispatch", async () => {
    const quoteStarted = deferred();
    const releaseQuote = deferred();
    let liveQuoteReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        const isLiveQuote = new URL(String(url)).searchParams.get("filter[limit]") === "50";
        if (isLiveQuote && ++liveQuoteReads === 1) {
          quoteStarted.resolve();
          await releaseQuote.promise;
        }
        return jsonResponse(200, {
          data: [{
            phone_number: "+13125550100",
            cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
          }]
        });
      }
      return jsonResponse(200, { data: { id: "order1" } });
    });
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);

    const active = client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    await quoteStarted.promise;
    const duplicate = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(duplicate.isError).toBe(true);
    expect((duplicate.content as Array<{ text: string }>)[0].text).toContain("already in progress");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onPrompt).not.toHaveBeenCalled();

    releaseQuote.resolve();
    const ordered = await active;
    expect(ordered.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("available_phone_numbers"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);

    const retry = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(retry.isError).toBe(true);
    expect((retry.content as Array<{ text: string }>)[0].text).toContain("already dispatched");
    expect((retry.content as Array<{ text: string }>)[0].text).toContain("list_owned_numbers");
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);
  });

  it("keeps the dispatched-DID refusal authoritative after search provenance is evicted", async () => {
    const fetchMock = pricingThenOrder();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);

    const ordered = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(ordered.isError ?? false).toBe(false);

    const replacementInventory = Array.from({ length: 501 }, (_, index) => ({
      phone_number: `+1415555${String(index).padStart(4, "0")}`,
      cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
    }));
    fetchMock.mockImplementation(async () => jsonResponse(200, { data: replacementInventory }));
    await establishNumberSearchContext(client, fetchMock, { country_code: "US", limit: 50 });

    const retry = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(retry.isError).toBe(true);
    expect((retry.content as Array<{ text: string }>)[0].text).toContain("already dispatched");
    expect((retry.content as Array<{ text: string }>)[0].text).toContain("Verify ownership");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPrompt).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent distinct-DID quote and approval flows before GET or prompt", async () => {
    process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER = "1";
    try {
      const records = Array.from({ length: 8 }, (_, index) => ({
        phone_number: `+13125550${String(index).padStart(3, "0")}`,
        cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
      }));
      const quoteStarted = deferred();
      const releaseQuote = deferred();
      let liveQuoteReads = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
        if (String(url).includes("available_phone_numbers")) {
          const isLiveQuote = new URL(String(url)).searchParams.get("filter[limit]") === "50";
          if (isLiveQuote && ++liveQuoteReads === 1) {
            quoteStarted.resolve();
            await releaseQuote.promise;
          }
          return jsonResponse(200, { data: records });
        }
        return jsonResponse(200, { data: { id: "order1" } });
      });
      const onPrompt = vi.fn();
      const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
      await establishNumberSearchContext(client, fetchMock);

      const active = client.callTool({
        name: "order_number",
        arguments: { phone_number: records[0].phone_number }
      });
      await quoteStarted.promise;
      const refused = await Promise.all(records.slice(1).map((record) => client.callTool({
        name: "order_number",
        arguments: { phone_number: record.phone_number }
      })));
      expect(refused).toHaveLength(7);
      expect(refused.every((result) => result.isError === true)).toBe(true);
      expect(refused.every((result) =>
        (result.content as Array<{ text: string }>)[0].text.includes("concurrent number-order")
      )).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onPrompt).not.toHaveBeenCalled();

      releaseQuote.resolve();
      expect((await active).isError ?? false).toBe(false);
      expect(onPrompt).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("available_phone_numbers"))).toHaveLength(2);
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER;
    }
  });

  it("blocks a different DID before quote or approval after the order budget is spent", async () => {
    process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER = "1";
    try {
      const records = ["+13125550100", "+13125550101"].map((phone_number) => ({
        phone_number,
        cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
      }));
      const fetchMock = vi.fn().mockImplementation(async (url: unknown) =>
        String(url).includes("available_phone_numbers")
          ? jsonResponse(200, { data: records })
          : jsonResponse(200, { data: { id: "order1" } })
      );
      const onPrompt = vi.fn();
      const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
      await establishNumberSearchContext(client, fetchMock);

      const ordered = await client.callTool({
        name: "order_number",
        arguments: { phone_number: records[0].phone_number }
      });
      expect(ordered.isError ?? false).toBe(false);
      const callsAfterOrder = fetchMock.mock.calls.length;

      const capped = await client.callTool({
        name: "order_number",
        arguments: { phone_number: records[1].phone_number }
      });
      expect(capped.isError).toBe(true);
      expect((capped.content as Array<{ text: string }>)[0].text).toContain("used 1/1");
      expect(onPrompt).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterOrder);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER;
    }
  });

  it("releases the in-flight guard after a human decline so a later approved attempt can proceed", async () => {
    const decisions = [false, true];
    const fetchMock = pricingThenOrder();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(
      fetchMock,
      () => decisions.shift() ?? false,
      onPrompt
    );
    await establishNumberSearchContext(client, fetchMock);

    const declined = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(declined.isError).toBe(true);
    const retry = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(retry.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("available_phone_numbers"))).toHaveLength(3);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);
  });

  it("retains an at-most-once marker after an ambiguous order dispatch", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        return jsonResponse(200, {
          data: [{
            phone_number: "+13125550100",
            cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
          }]
        });
      }
      throw new Error("socket closed after request dispatch");
    });
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);

    const ambiguous = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(ambiguous.isError).toBe(true);
    const callsAfterDispatch = fetchMock.mock.calls.length;
    const retry = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(retry.isError).toBe(true);
    expect((retry.content as Array<{ text: string }>)[0].text).toContain("already dispatched");
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDispatch);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);
  });

  it("releases both the order reservation and DID guard after a definitive 4xx", async () => {
    process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER = "1";
    try {
      let orderAttempts = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
        if (String(url).includes("available_phone_numbers")) {
          return jsonResponse(200, {
            data: [{
              phone_number: "+13125550100",
              cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
            }]
          });
        }
        orderAttempts++;
        return orderAttempts === 1
          ? jsonResponse(400, { errors: [{ code: "10001", title: "Order rejected" }] })
          : jsonResponse(200, { data: { id: "order2" } });
      });
      const onPrompt = vi.fn();
      const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
      await establishNumberSearchContext(client, fetchMock);

      const rejected = await client.callTool({
        name: "order_number",
        arguments: { phone_number: "+13125550100" }
      });
      expect(rejected.isError).toBe(true);
      const retry = await client.callTool({
        name: "order_number",
        arguments: { phone_number: "+13125550100" }
      });
      expect(retry.isError ?? false).toBe(false);
      expect(onPrompt).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(2);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_ORDER_NUMBER;
    }
  });
});

describe("call_command allowlist", () => {
  it("rejects commands outside the allowlist at the schema layer", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "delete_account" }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes an allowlisted command to the per-call actions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "speak",
        params: { payload: "Hello", voice: "Polly.Joanna-Neural" }
      }
    });
    expect(result.isError ?? false).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/calls/cc1/actions/speak");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      payload: "Hello",
      voice: "Polly.Joanna-Neural"
    });
  });

  it("forwards documented speak playback and voice controls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "speak",
        params: {
          payload: "Hello both call legs",
          voice: "Telnyx.KokoroTTS.af",
          loop: "2",
          service_level: "premium",
          stop: "current",
          target_legs: "both",
          voice_settings: { speed: 1.1 }
        }
      }
    });
    expect(result.isError ?? false).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/calls/cc1/actions/speak");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      payload: "Hello both call legs",
      voice: "Telnyx.KokoroTTS.af",
      loop: 2,
      service_level: "premium",
      stop: "current",
      target_legs: "both",
      voice_settings: { speed: 1.1 }
    });
  });

  it("forwards documented gather_using_speak retry and voice options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "gather_using_speak",
        params: {
          payload: "Enter your PIN",
          voice: "Telnyx.KokoroTTS.af",
          invalid_payload: "That PIN was invalid",
          maximum_tries: 3,
          payload_type: "text",
          service_level: "premium",
          voice_settings: { speed: 1.1 }
        }
      }
    });
    expect(result.isError ?? false).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/calls/cc1/actions/gather_using_speak");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      payload: "Enter your PIN",
      voice: "Telnyx.KokoroTTS.af",
      invalid_payload: "That PIN was invalid",
      maximum_tries: 3,
      payload_type: "text",
      service_level: "premium",
      voice_settings: { speed: 1.1 }
    });
  });

  it.each([
    ["zero minimum digits", { minimum_digits: 0 }],
    ["too many maximum digits", { maximum_digits: 129 }],
    ["minimum above maximum", { minimum_digits: 5, maximum_digits: 4 }]
  ])("rejects gather_using_speak with %s before transport", async (_case, options) => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "gather_using_speak",
        params: { payload: "Enter digits", voice: "Telnyx.KokoroTTS.af", ...options }
      }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lookup_number", () => {
  it("requests carrier data only when asked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
    const client = await connectedClient(fetchMock);
    await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100", types: ["carrier", "caller-name"] }
    });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.telnyx.com/v2/number_lookup/%2B13125550100?type=carrier&type=caller-name"
    );
  });
});

describe("query param forms (live-verified API shapes)", () => {
  it("passes features as repeated filter[features][] params, not comma-joined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    const client = await connectedClient(fetchMock);
    await client.callTool({
      name: "search_available_numbers",
      arguments: { country_code: "US", features: ["sms", "voice"], limit: 5 }
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("filter%5Bfeatures%5D%5B%5D=sms");
    expect(url).toContain("filter%5Bfeatures%5D%5B%5D=voice");
    expect(url).not.toContain("sms%2Cvoice");
  });

  it("filters owned numbers by exact E.164 via filter[phone_number]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    const client = await connectedClient(fetchMock);
    await client.callTool({
      name: "list_owned_numbers",
      arguments: { page_size: 5, phone_number: "+13125551234" }
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("filter%5Bphone_number%5D=%2B13125551234");
    expect(url).not.toContain("contains");
  });

  it("accepts reject as an allowlisted call command", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "reject", params: { cause: "USER_BUSY" } }
    });
    expect(result.isError ?? false).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.telnyx.com/v2/calls/cc1/actions/reject"
    );
  });
});

describe("call_command strict per-command params (security)", () => {
  it("exposes no model-attested confirmation input", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const callCommand = tools.find((tool) => tool.name === "call_command");
    expect(JSON.stringify(callCommand?.inputSchema)).not.toContain("confirm");
  });

  it("rejects webhook_url smuggled into transfer params and never calls the API", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "transfer",
        params: { to: "+15550009999", webhook_url: "https://evil.example/hook" }
      }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("webhook_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("continues to reject custom SIP headers from transfer params", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "transfer",
        params: { to: "+15550009999", custom_headers: [{ name: "X-Injected", value: "true" }] }
      }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("custom_headers");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for transfer when the client lacks elicitation", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "transfer", params: { to: "+15550009999" } }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("elicitation support");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards documented transfer answer-time URL and DTMF controls after disclosing them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const params = {
      to: "+15550009999",
      from: "+15550008888",
      audio_url: "https://media.example/transfer.mp3",
      send_digits_on_answer: "12w3W#A",
      timeout_secs: 45,
      time_limit_secs: 3_600
    };
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "transfer",
        params
      }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("use caller ID +15550008888"));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("wait up to 45 seconds for an answer"));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("limit the transferred call to 3600 seconds"));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("play audio URL https://media.example/transfer.mp3 after answer"));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("send DTMF sequence 12w3W#A after answer"));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.telnyx.com/v2/calls/cc1/actions/transfer"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(params);
  });

  it("forwards an uploaded transfer media name after disclosing it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const params = { to: "+15550009999", media_name: "transfer-greeting.wav" };
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "transfer", params }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("play uploaded media transfer-greeting.wav after answer"));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(params);
  });

  it.each([
    ["non-URL audio", { audio_url: "not-a-url" }],
    ["non-HTTP audio", { audio_url: "file:///tmp/transfer.mp3" }],
    ["credential-bearing audio URL", { audio_url: "https://user:secret@media.example/transfer.mp3" }],
    ["blank media name", { media_name: "" }],
    ["both audio sources", { audio_url: "https://media.example/transfer.mp3", media_name: "transfer.wav" }],
    ["empty answer digits", { send_digits_on_answer: "" }],
    ["invalid answer digits", { send_digits_on_answer: "12,3" }],
    ["too many answer digits", { send_digits_on_answer: "1".repeat(65) }],
    ["short timeout", { timeout_secs: 4 }],
    ["long timeout", { timeout_secs: 601 }],
    ["short time limit", { time_limit_secs: 29 }],
    ["long time limit", { time_limit_secs: 14_401 }]
  ])("rejects transfer %s before approval or transport", async (_case, options) => {
    const fetchMock = vi.fn();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "transfer",
        params: { to: "+15550009999", ...options }
      }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).not.toContain("Internal error");
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects record_start without its required format/channels", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "record_start", params: {} }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires approval before starting a recording", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "record_start",
        params: { format: "mp3", channels: "dual" }
      }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("elicitation support");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { max_length: 14_401 },
    { custom_file_name: "x".repeat(41) },
    { timeout_secs: -1 },
    { transcription_engine: "A" },
    {
      transcription: true,
      transcription_engine: "deepgram/nova-3",
      transcription_language: "fr-FR"
    },
    {
      transcription: true,
      transcription_min_speaker_count: 4,
      transcription_max_speaker_count: 2
    }
  ])("rejects unsafe or inconsistent record_start options before approval: %j", async (options) => {
    const fetchMock = vi.fn();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "record_start",
        params: { format: "mp3", channels: "dual", ...options }
      }
    });
    expect(result.isError).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("place_call exposes no webhook override", () => {
  it("has no webhook_url in the input schema", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const placeCall = tools.find((t) => t.name === "place_call");
    expect(JSON.stringify(placeCall?.inputSchema)).not.toContain("webhook_url");
  });
});

describe("session velocity caps", () => {
  it("caps send_message per session via env override", async () => {
    process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE = "1";
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "m1" } }));
      const client = await connectedClient(fetchMock);
      const args = { to: "+15550001111", from: "+15550002222", text: "hi" };
      const first = await client.callTool({ name: "send_message", arguments: args });
      expect(first.isError ?? false).toBe(false);
      const second = await client.callTool({ name: "send_message", arguments: args });
      expect(second.isError).toBe(true);
      expect((second.content as Array<{ text: string }>)[0].text).toContain("Session limit");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE;
    }
  });

  it.each(["1junk", " 1", "0 ", "1.5", "9007199254740992"])(
    "fails closed when the send cap is malformed (%j)",
    async (configuredCap) => {
      process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE = configuredCap;
      try {
        await expect(connectedClient(vi.fn())).rejects.toThrow(
          /TELNYX_CONNECTOR_MAX_SEND_MESSAGE must be a non-negative safe integer/
        );
      } finally {
        delete process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE;
      }
    }
  );

  it("counts only billable lookups against the lookup cap", async () => {
    process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP = "1";
    try {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { data: {} })));
      const client = await connectedClient(fetchMock);
      await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier"] }
      });
      const free = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100" }
      });
      expect(free.isError ?? false).toBe(false);
      const capped = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier"] }
      });
      expect(capped.isError).toBe(true);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP;
    }
  });

  it("counts every unique requested lookup type against the lookup cap", async () => {
    process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP = "1";
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
      const client = await connectedClient(fetchMock);
      const overCap = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier", "caller-name"] }
      });
      expect(overCap.isError).toBe(true);
      expect((overCap.content as Array<{ text: string }>)[0].text).toContain("request needs 2 units");
      expect(fetchMock).not.toHaveBeenCalled();

      const withinCap = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier"] }
      });
      expect(withinCap.isError ?? false).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP;
    }
  });

  it("deduplicates lookup types before reserving budget and dispatching", async () => {
    process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP = "1";
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
      const client = await connectedClient(fetchMock);
      const first = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier", "carrier"] }
      });
      expect(first.isError ?? false).toBe(false);
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        "https://api.telnyx.com/v2/number_lookup/%2B13125550100?type=carrier"
      );

      const capped = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["caller-name"] }
      });
      expect(capped.isError).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP;
    }
  });

  it("releases every lookup-type unit after a definitive failure", async () => {
    process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP = "2";
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(400, { errors: [{ detail: "invalid request" }] }))
        .mockResolvedValueOnce(jsonResponse(200, { data: {} }));
      const client = await connectedClient(fetchMock);
      const first = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier", "caller-name"] }
      });
      expect(first.isError).toBe(true);

      const retry = await client.callTool({
        name: "lookup_number",
        arguments: { phone_number: "+13125550100", types: ["carrier", "caller-name"] }
      });
      expect(retry.isError ?? false).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP;
    }
  });

  it("atomically reserves multi-type lookup budget across concurrent calls", async () => {
    process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP = "2";
    try {
      const gate = deferred();
      const fetchMock = vi.fn().mockImplementation(async () => {
        await gate.promise;
        return jsonResponse(200, { data: {} });
      });
      const client = await connectedClient(fetchMock);
      const args = {
        phone_number: "+13125550100",
        types: ["carrier", "caller-name"]
      };
      const firstPromise = client.callTool({ name: "lookup_number", arguments: args });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const second = await client.callTool({ name: "lookup_number", arguments: args });
      expect(second.isError).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      gate.resolve();
      const first = await firstPromise;
      expect(first.isError ?? false).toBe(false);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_BILLABLE_LOOKUP;
    }
  });
});

describe("robustness (code-review findings)", () => {
  it("sends media-only MMS without text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "m1" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "+15550001111", from: "+15550002222", media_urls: ["https://ex.com/a.jpg"] }
    });
    expect(result.isError ?? false).toBe(false);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.media_urls).toEqual(["https://ex.com/a.jpg"]);
    expect("text" in body).toBe(false);
  });

  it.each([
    "not-a-url",
    "file:///tmp/message.jpg",
    "https://user:secret@media.example/message.jpg"
  ])("rejects unsafe MMS media URL %s before transport", async (mediaUrl) => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "+15550001111", from: "+15550002222", media_urls: [mediaUrl] }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).not.toContain("Internal error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid client timeout %j at construction",
    (timeoutMs) => {
      expect(() => new TelnyxClient({ apiKey: "KEYTEST", timeoutMs })).toThrow(
        "timeoutMs must be a positive safe integer"
      );
    }
  );

  it("refuses a message with neither text nor media", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "+15550001111", from: "+15550002222" }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Retry-After on 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ code: "10011", title: "Rate limited" }] }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "7" }
      })
    );
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("retry after 7s");
  });

  it("truncates non-JSON error bodies instead of dumping them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("<html>" + "x".repeat(5000) + "</html>", { status: 502 }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("HTTP 502");
    expect(text).toContain("[truncated");
    expect(text.length).toBeLessThan(2500);
  });

  it("returns an explicit success marker for empty 2xx bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "hangup", params: {} }
    });
    expect(result.isError ?? false).toBe(false);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ ok: true, http_status: 204 });
  });

  it("paginates owned numbers via page[number] and emits compact JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [], meta: { total_pages: 3 } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "list_owned_numbers",
      arguments: { page_size: 25, page: 2 }
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("page%5Bnumber%5D=2");
    expect((result.content as Array<{ text: string }>)[0].text).not.toContain("\n  ");
  });

  it("marks oversized results as truncated instead of cutting JSON silently", async () => {
    const big = { data: Array.from({ length: 3000 }, (_, i) => ({ id: i, blob: "y".repeat(30) })) };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, big));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "list_owned_numbers",
      arguments: { page_size: 100 }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("[TRUNCATED");
    expect(text.length).toBeLessThan(61_000);
  });

  it("aborts a hung request at the configured timeout", async () => {
    const { TelnyxClient: TC } = await import("../src/telnyxClient.js");
    const hangingFetch = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const c = new TC({ apiKey: "K", fetch: hangingFetch as unknown as typeof fetch, timeoutMs: 60 });
    await expect(c.request("GET", "/v2/phone_numbers")).rejects.toThrow(/timed out after 60ms/);
  });

  it("preserves timeout context when response headers arrive before the body stalls", async () => {
    const headersThenHangingBody = (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        }
      });
      return Promise.resolve(new Response(body, { status: 202 }));
    };
    const c = new TelnyxClient({
      apiKey: "K",
      fetch: headersThenHangingBody as unknown as typeof fetch,
      timeoutMs: 60
    });
    await expect(c.request("POST", "/v2/messages", { body: { text: "hello" } })).rejects.toThrow(
      /request may or may not have reached Telnyx/
    );
  });

  it("preserves ambiguous-dispatch context when the caller aborts an in-flight write", async () => {
    const fetchStarted = deferred();
    const hangingFetch = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        fetchStarted.resolve();
        init?.signal?.addEventListener("abort", () => reject(new Error("caller aborted")));
      });
    const c = new TelnyxClient({ apiKey: "K", fetch: hangingFetch as unknown as typeof fetch });
    const controller = new AbortController();
    const pending = c.request("POST", "/v2/messages", {
      body: { text: "hello" },
      signal: controller.signal
    });
    await fetchStarted.promise;
    controller.abort();
    await expect(pending).rejects.toThrow(
      /cancelled after dispatch began.*request may or may not have reached Telnyx/
    );
  });

  it("does not invoke transport for a caller signal aborted before dispatch", async () => {
    const fetchMock = vi.fn();
    const c = new TelnyxClient({ apiKey: "K", fetch: fetchMock as unknown as typeof fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(
      c.request("POST", "/v2/messages", {
        body: { text: "hello" },
        signal: controller.signal
      })
    ).rejects.toThrow(/cancelled before dispatch; no request was sent to Telnyx/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves ambiguous-dispatch context when the caller aborts a response body read", async () => {
    const headersReturned = deferred();
    const headersThenHangingBody = (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          init?.signal?.addEventListener("abort", () => controller.error(new Error("caller aborted")));
        }
      });
      headersReturned.resolve();
      return Promise.resolve(new Response(body, { status: 202 }));
    };
    const c = new TelnyxClient({
      apiKey: "K",
      fetch: headersThenHangingBody as unknown as typeof fetch
    });
    const controller = new AbortController();
    const pending = c.request("POST", "/v2/messages", {
      body: { text: "hello" },
      signal: controller.signal
    });
    await headersReturned.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toThrow(
      /cancelled after dispatch began.*request may or may not have reached Telnyx/
    );
  });
});

describe("elicitation-backed confirmation", () => {
  it("a HUMAN decline via elicitation vetoes the purchase", async () => {
    const fetchMock = pricingThenOrder();
    const client = await connectedClientWithElicitation(fetchMock, false);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("invalid initial pricing fails before any human prompt or order request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{
        phone_number: "+13125550100",
        cost_information: { monthly_cost: null, currency: "USD" }
      }]
    }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("a differently numbered inventory record fails before any human prompt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: { monthly_cost: "1.10", currency: "USD" }
        }]
      }))
      .mockResolvedValue(jsonResponse(200, {
        data: [{
          phone_number: "+13125550199",
          cost_information: { monthly_cost: "1.10", currency: "USD" }
        }]
      }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("an oversized many-charge quote is refused before any human prompt", async () => {
    const costInformation: Record<string, string> = {
      monthly_cost: "1.10",
      currency: "USD"
    };
    for (let i = 0; i < 1_000; i++) {
      costInformation[`fee_${String(i).padStart(4, "0")}_cost`] = "0.01";
    }
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, {
      data: [{ phone_number: "+13125550100", cost_information: costInformation }]
    }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(text).toContain("Refusing to truncate pricing");
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("a human approval via elicitation authorizes the order", async () => {
    const fetchMock = pricingThenOrder();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt.mock.calls[0][0]).toContain("+13125550100");
    expect(onPrompt.mock.calls[0][0]).toContain("monthly_cost: 1.1");
    expect(onPrompt.mock.calls[0][0]).toContain("currency: USD");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("a HUMAN decline prevents record_start", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, false);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "record_start",
        params: { format: "wav", channels: "single" }
      }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a HUMAN approval authorizes exactly one record_start request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "record_start",
        params: { format: "wav", channels: "dual" }
      }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledWith(
      expect.stringMatching(/recording.*approve only after every participant.*notice.*consent.*applicable jurisdiction/i)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/calls/cc1/actions/record_start");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      format: "wav",
      channels: "dual"
    });
  });

  it("translates the bridge SDK alias to the raw REST target field after human approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc-source",
        command: "bridge",
        params: {
          call_control_id_to_bridge_with: "cc-target",
          command_id: "bridge-once"
        }
      }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("cc-target"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/calls/cc-source/actions/bridge");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      call_control_id: "cc-target",
      command_id: "bridge-once"
    });
  });

  it("rejects the raw REST bridge target key at the tool boundary before approval or transport", async () => {
    const fetchMock = vi.fn();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc-source",
        command: "bridge",
        params: { call_control_id: "cc-target" }
      }
    });
    expect(result.isError).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "queue",
      { queue: "support" },
      "queue support",
      "removes that call from the queue even if bridging fails"
    ],
    [
      "video room",
      { video_room_id: "4a6201c6-1a69-4c48-a601-3349bc2ad412", video_room_context: "customer-42" },
      "video room 4a6201c6-1a69-4c48-a601-3349bc2ad412",
      "with context customer-42"
    ]
  ])("bridges to a documented %s target after human approval", async (_kind, params, promptTarget, promptDetail) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc-source", command: "bridge", params }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining(promptTarget));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining(promptDetail));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(params);
  });

  it.each([
    ["no target", {}],
    ["multiple targets", { call_control_id_to_bridge_with: "cc-target", queue: "support" }],
    ["orphaned video context", { queue: "support", video_room_context: "customer-42" }],
    ["malformed video-room ID", { video_room_id: "not-a-uuid" }]
  ])("rejects bridge params with %s before approval or transport", async (_case, params) => {
    const fetchMock = vi.fn();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc-source", command: "bridge", params }
    });
    expect(result.isError).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards documented bounded, beeped, tracked, and transcribed recording options after disclosure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const params = {
      format: "mp3",
      channels: "dual",
      custom_file_name: "support-call",
      max_length: 600,
      play_beep: true,
      recording_track: "both",
      timeout_secs: 30,
      transcription: true,
      transcription_engine: "A",
      transcription_language: "en-US",
      transcription_max_speaker_count: 4,
      transcription_min_speaker_count: 2,
      transcription_profanity_filter: true,
      transcription_speaker_diarization: true,
      trim: "trim-silence"
    };
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "record_start", params }
    });
    expect(result.isError ?? false).toBe(false);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    const prompt = String(onPrompt.mock.calls[0][0]);
    expect(prompt).toContain("maximum 600 seconds");
    expect(prompt).toContain("file name support-call");
    expect(prompt).toContain("start beep enabled");
    expect(prompt).toContain("post-recording transcription enabled (A; en-US");
    expect(prompt).toContain("minimum 2 speakers");
    expect(prompt).toContain("maximum 4 speakers");
    expect(prompt).toContain("profanity filter enabled");
    expect(prompt).toContain("speaker diarization enabled");
    expect(prompt).toContain("uses billable transcription");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/calls/cc1/actions/record_start");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(params);
  });

  it("an oversized approval prompt is refused without elicitation or POST", async () => {
    const fetchMock = vi.fn();
    const onPrompt = vi.fn();
    const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "transfer",
        params: { to: `sip:${"x".repeat(5_000)}@example.com` }
      }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("approval prompt");
    expect(onPrompt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("elicitation failure is authoritative (round-3 CRITICAL)", () => {
  it("REFUSES when elicitation is advertised but errors", async () => {
    const fetchMock = pricingThenOrder();
    const telnyx = new TelnyxClient({ apiKey: "KEYTEST", fetch: fetchMock as unknown as typeof fetch });
    const server = createServer({ client: telnyx });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    client.setRequestHandler(ElicitRequestSchema, async () => {
      throw new Error("client elicitation UI crashed");
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("NOT approved");
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("propagates call cancellation into elicitation and releases the order flow", async () => {
    const fetchMock = pricingThenOrder();
    const telnyx = new TelnyxClient({ apiKey: "KEYTEST", fetch: fetchMock as unknown as typeof fetch });
    const server = createServer({ client: telnyx });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    const promptStarted = deferred();
    const promptAborted = deferred();
    let promptCount = 0;
    client.setRequestHandler(ElicitRequestSchema, async (_request, extra) => {
      promptCount++;
      if (promptCount === 1) {
        promptStarted.resolve();
        await new Promise<never>((_resolve, reject) => {
          const abort = () => {
            promptAborted.resolve();
            reject(new Error("elicitation request aborted"));
          };
          if (extra.signal?.aborted) abort();
          else extra.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      return { action: "accept", content: { approve: true } };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await establishNumberSearchContext(client, fetchMock);

    const controller = new AbortController();
    const pending = client.callTool(
      { name: "order_number", arguments: { phone_number: "+13125550100" } },
      undefined,
      { signal: controller.signal }
    );
    await promptStarted.promise;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await promptAborted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes("number_orders"))).toBe(true);

    const retry = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(retry.isError ?? false).toBe(false);
    expect(promptCount).toBe(2);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("available_phone_numbers"))).toHaveLength(3);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);
  });

  it("releases the order flow when cancellation occurs during elicitation readiness", async () => {
    const fetchMock = pricingThenOrder();
    const telnyx = new TelnyxClient({ apiKey: "KEYTEST", fetch: fetchMock as unknown as typeof fetch });
    const server = createServer({ client: telnyx });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "0.0.1" },
      { capabilities: { elicitation: {} } }
    );
    const { ElicitRequestSchema, PingRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    const pingStarted = deferred();
    const releasePing = deferred();
    let promptCount = 0;
    client.setRequestHandler(PingRequestSchema, async () => {
      pingStarted.resolve();
      await releasePing.promise;
      return {};
    });
    client.setRequestHandler(ElicitRequestSchema, async () => {
      promptCount++;
      return { action: "accept", content: { approve: true } };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await establishNumberSearchContext(client, fetchMock);

    const controller = new AbortController();
    const cancelled = client.callTool(
      { name: "order_number", arguments: { phone_number: "+13125550100" } },
      undefined,
      { signal: controller.signal }
    );
    await pingStarted.promise;
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(promptCount).toBe(0);
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes("number_orders"))).toBe(true);

    let retrySettled = false;
    const retry = client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    }).finally(() => {
      retrySettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(retrySettled).toBe(false);

    releasePing.resolve();
    const ordered = await retry;
    expect(ordered.isError ?? false).toBe(false);
    expect(promptCount).toBe(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("number_orders"))).toHaveLength(1);
  });
});

describe("caps count successes only (round-3 HIGH)", () => {
  it("a definitively-failed (4xx) call does not burn the session budget", async () => {
    process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE = "1";
    try {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve(jsonResponse(400, { errors: [{ code: "40310", title: "Invalid phone number" }] }))
        )
        .mockImplementation(() => Promise.resolve(jsonResponse(200, { data: { id: "m1" } })));
      const client = await connectedClient(fetchMock);
      const args = { to: "+15550001111", from: "+15550002222", text: "hi" };
      const failed = await client.callTool({ name: "send_message", arguments: args });
      expect(failed.isError).toBe(true);
      const ok = await client.callTool({ name: "send_message", arguments: args });
      expect(ok.isError ?? false).toBe(false);
      const capped = await client.callTool({ name: "send_message", arguments: args });
      expect(capped.isError).toBe(true);
      expect((capped.content as Array<{ text: string }>)[0].text).toContain("Session limit");
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE;
    }
  });

  it("caps call_command (billable speak loops bounded)", async () => {
    process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND = "1";
    try {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { data: { result: "ok" } })));
      const client = await connectedClient(fetchMock);
      const args = { call_control_id: "cc1", command: "speak", params: { payload: "x", voice: "Polly.Joanna-Neural" } };
      const first = await client.callTool({ name: "call_command", arguments: args });
      expect(first.isError ?? false).toBe(false);
      const capped = await client.callTool({ name: "call_command", arguments: args });
      expect(capped.isError).toBe(true);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND;
    }
  });

  it.each([
    ["transfer", { to: "+15550001111" }],
    ["bridge", { call_control_id_to_bridge_with: "cc2" }],
    ["record_start", { format: "wav", channels: "single" }]
  ])("blocks confirmation-gated %s before approval when the call-command cap is zero", async (command, params) => {
    process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND = "0";
    try {
      const fetchMock = vi.fn();
      const onPrompt = vi.fn();
      const client = await connectedClientWithElicitation(fetchMock, true, onPrompt);
      const result = await client.callTool({
        name: "call_command",
        arguments: { call_control_id: "cc1", command, params }
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain("used 0/0");
      expect(onPrompt).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND;
    }
  });

  it("releases a call-command reservation when the human declines approval", async () => {
    process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND = "1";
    try {
      const decisions = [false, true];
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
      const onPrompt = vi.fn();
      const client = await connectedClientWithElicitation(
        fetchMock,
        () => decisions.shift() ?? false,
        onPrompt
      );
      const args = {
        call_control_id: "cc1",
        command: "transfer",
        params: { to: "+15550001111" }
      };

      const declined = await client.callTool({ name: "call_command", arguments: args });
      expect(declined.isError).toBe(true);
      const approved = await client.callTool({ name: "call_command", arguments: args });
      expect(approved.isError ?? false).toBe(false);
      expect(onPrompt).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND;
    }
  });

  it("keeps protective stop and termination commands available after the call-command cap is exhausted", async () => {
    process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND = "1";
    try {
      const fetchMock = vi
        .fn()
        .mockImplementation(() => Promise.resolve(jsonResponse(200, { data: { result: "ok" } })));
      const client = await connectedClient(fetchMock);
      const speak = {
        call_control_id: "cc1",
        command: "speak",
        params: { payload: "x", voice: "Polly.Joanna-Neural" }
      };

      expect((await client.callTool({ name: "call_command", arguments: speak })).isError ?? false).toBe(false);
      const capped = await client.callTool({ name: "call_command", arguments: speak });
      expect(capped.isError).toBe(true);
      expect((capped.content as Array<{ text: string }>)[0].text).toContain("Session limit");

      const protective = [
        { command: "hangup", params: {} },
        { command: "reject", params: { cause: "CALL_REJECTED" } },
        { command: "record_stop", params: {} },
        { command: "playback_stop", params: { stop: "all" } }
      ];
      for (const action of protective) {
        const result = await client.callTool({
          name: "call_command",
          arguments: { call_control_id: "cc1", ...action }
        });
        expect(result.isError ?? false, `${action.command} must remain available`).toBe(false);
      }

      const stillCapped = await client.callTool({ name: "call_command", arguments: speak });
      expect(stillCapped.isError).toBe(true);
      expect((stillCapped.content as Array<{ text: string }>)[0].text).toContain("Session limit");
      expect(fetchMock).toHaveBeenCalledTimes(5);
      for (const command of ["hangup", "reject", "record_stop", "playback_stop"]) {
        expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith(`/actions/${command}`))).toBe(true);
      }
      const playbackStopRequest = fetchMock.mock.calls.find((call) =>
        String(call[0]).endsWith("/actions/playback_stop")
      );
      expect(JSON.parse(String(playbackStopRequest?.[1]?.body))).toMatchObject({ stop: "all" });
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND;
    }
  });

  it("does not let a protective 4xx release an exhausted amplifying-command reservation", async () => {
    process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND = "1";
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { data: { result: "ok" } }))
        .mockResolvedValueOnce(jsonResponse(400, { errors: [{ code: "90018", title: "Call already ended" }] }))
        .mockResolvedValue(jsonResponse(200, { data: { result: "unexpected" } }));
      const client = await connectedClient(fetchMock);
      const speak = {
        call_control_id: "cc1",
        command: "speak",
        params: { payload: "x", voice: "Polly.Joanna-Neural" }
      };

      expect((await client.callTool({ name: "call_command", arguments: speak })).isError ?? false).toBe(false);
      const ended = await client.callTool({
        name: "call_command",
        arguments: { call_control_id: "cc1", command: "hangup", params: {} }
      });
      expect(ended.isError).toBe(true);

      const stillCapped = await client.callTool({ name: "call_command", arguments: speak });
      expect(stillCapped.isError).toBe(true);
      expect((stillCapped.content as Array<{ text: string }>)[0].text).toContain("Session limit");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND;
    }
  });

  it("still releases a capped call-command reservation on a definitive 4xx", async () => {
    process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND = "1";
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(400, { errors: [{ code: "90018", title: "Call not active" }] }))
        .mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
      const client = await connectedClient(fetchMock);
      const speak = {
        call_control_id: "cc1",
        command: "speak",
        params: { payload: "x", voice: "Polly.Joanna-Neural" }
      };

      expect((await client.callTool({ name: "call_command", arguments: speak })).isError).toBe(true);
      expect((await client.callTool({ name: "call_command", arguments: speak })).isError ?? false).toBe(false);
      const capped = await client.callTool({ name: "call_command", arguments: speak });
      expect(capped.isError).toBe(true);
      expect((capped.content as Array<{ text: string }>)[0].text).toContain("Session limit");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_CALL_COMMAND;
    }
  });
});

describe("round-3 schema corrections", () => {
  it.each(["current", "all"])("playback_stop forwards documented stop mode %s", async (stop) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "playback_stop", params: { stop } }
    });
    expect(result.isError ?? false).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ stop });
  });

  it("playback_stop rejects an unknown stop mode before transport", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "playback_stop", params: { stop: "queue" } }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("playback_start accepts media_name without audio_url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "playback_start", params: { media_name: "greeting" } }
    });
    expect(result.isError ?? false).toBe(false);
  });

  it("playback_start forwards documented stop and target-leg controls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "playback_start",
        params: { media_name: "greeting", stop: "all", target_legs: "both" }
      }
    });
    expect(result.isError ?? false).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      media_name: "greeting",
      stop: "all",
      target_legs: "both"
    });
  });

  it.each([undefined, "self"])(
    "playback_start accepts overlay on the self leg target %j",
    async (targetLegs) => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
      const client = await connectedClient(fetchMock);
      const params = {
        media_name: "greeting",
        overlay: true,
        ...(targetLegs === undefined ? {} : { target_legs: targetLegs })
      };
      const result = await client.callTool({
        name: "call_command",
        arguments: { call_control_id: "cc1", command: "playback_start", params }
      });

      expect(result.isError ?? false).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(params);
    }
  );

  it.each(["opposite", "both"])(
    "playback_start rejects overlay on the non-self target leg %s before transport",
    async (targetLegs) => {
      const fetchMock = vi.fn();
      const client = await connectedClient(fetchMock);
      const result = await client.callTool({
        name: "call_command",
        arguments: {
          call_control_id: "cc1",
          command: "playback_start",
          params: { media_name: "greeting", overlay: true, target_legs: targetLegs }
        }
      });

      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain(
        "target_legs: must be omitted or self when overlay is enabled"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("playback_start still permits both target legs when overlay is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "playback_start",
        params: { media_name: "greeting", overlay: false, target_legs: "both" }
      }
    });

    expect(result.isError ?? false).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      media_name: "greeting",
      overlay: false,
      target_legs: "both"
    });
  });

  it.each([
    ["stop", "queue"],
    ["target_legs", "caller"]
  ])("playback_start rejects invalid %s value before transport", async (field, value) => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "playback_start",
        params: { media_name: "greeting", [field]: value }
      }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("playback_start normalizes documented finite string loop values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "playback_start",
        params: { media_name: "greeting", loop: "3" }
      }
    });
    expect(result.isError ?? false).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      media_name: "greeting",
      loop: 3
    });
  });

  it.each(["0", "101", "forever", 0, 101, 1.5])(
    "playback_start rejects invalid loop value %j before transport",
    async (loop) => {
      const fetchMock = vi.fn();
      const client = await connectedClient(fetchMock);
      const result = await client.callTool({
        name: "call_command",
        arguments: {
          call_control_id: "cc1",
          command: "playback_start",
          params: { media_name: "greeting", loop }
        }
      });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("playback_start with no source is refused", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "playback_start", params: {} }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["blank media name", { media_name: "" }],
    ["blank inline content", { playback_content: "" }],
    ["non-HTTP audio URL", { audio_url: "javascript:alert(1)" }],
    ["audio URL with media name", { audio_url: "https://media.example/greeting.mp3", media_name: "greeting" }],
    ["audio URL with inline content", { audio_url: "https://media.example/greeting.mp3", playback_content: "SUQz" }],
    ["media name with inline content", { media_name: "greeting", playback_content: "SUQz" }],
    [
      "all three audio sources",
      { audio_url: "https://media.example/greeting.mp3", media_name: "greeting", playback_content: "SUQz" }
    ]
  ])("playback_start rejects %s before transport", async (_case, params) => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: { call_control_id: "cc1", command: "playback_start", params }
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("record_stop accepts a specific recording_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { result: "ok" } }));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "call_command",
      arguments: {
        call_control_id: "cc1",
        command: "record_stop",
        params: { recording_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }
      }
    });
    expect(result.isError ?? false).toBe(false);
  });

});

describe("truncation safety", () => {
  it("never ends the truncated head with a lone high surrogate", async () => {
    const emoji = "📞";
    const big = { data: Array.from({ length: 12000 }, () => emoji + "x") };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, big));
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({ name: "list_owned_numbers", arguments: { page_size: 5 } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("[TRUNCATED");
    const head = text.split("\n…[TRUNCATED")[0];
    expect(/[\uD800-\uDBFF]$/.test(head)).toBe(false);
  });
});

describe("cancellation wiring", () => {
  it("a client-side cancel aborts the in-flight fetch", async () => {
    let fetchSignal: AbortSignal | undefined;
    let sawAbort = false;
    const fetchMock = vi.fn().mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal ?? undefined;
          fetchSignal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(new Error("aborted"));
          });
        })
    );
    const client = await connectedClient(fetchMock);
    const controller = new AbortController();
    const call = client
      .callTool({ name: "list_owned_numbers", arguments: { page_size: 5 } }, undefined, {
        signal: controller.signal
      })
      .catch((e) => e);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();
    await call;
    expect(sawAbort).toBe(true);
  });
});

describe("cap reservation is atomic (Oliver P1)", () => {
  it("8 concurrent sends against cap=1 produce exactly 1 upstream call", async () => {
    process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE = "1";
    try {
      let fetches = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        fetches++;
        await new Promise((r) => setTimeout(r, 30));
        return jsonResponse(200, { data: { id: "m1" } });
      });
      const client = await connectedClient(fetchMock);
      const args = { to: "+15550001111", from: "+15550002222", text: "hi" };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => client.callTool({ name: "send_message", arguments: args }))
      );
      const ok = results.filter((r) => !(r.isError ?? false)).length;
      expect(ok, "only one call may pass a cap of 1").toBe(1);
      expect(fetches, "only one upstream request may be dispatched").toBe(1);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE;
    }
  });

  it("a definitive 4xx failure releases the reservation, an ambiguous 5xx does not", async () => {
    process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE = "2";
    try {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(async () =>
          jsonResponse(400, { errors: [{ code: "40310", title: "Invalid phone number" }] })
        )
        .mockImplementationOnce(async () => jsonResponse(503, { errors: [{ code: "10007" }] }))
        .mockImplementation(async () => jsonResponse(200, { data: { id: "m1" } }));
      const client = await connectedClient(fetchMock);
      const args = { to: "+15550001111", from: "+15550002222", text: "hi" };
      await client.callTool({ name: "send_message", arguments: args }); // 400 -> released
      await client.callTool({ name: "send_message", arguments: args }); // 503 -> kept (ambiguous)
      const third = await client.callTool({ name: "send_message", arguments: args }); // 1 left
      expect(third.isError ?? false).toBe(false);
      const fourth = await client.callTool({ name: "send_message", arguments: args });
      expect(fourth.isError, "budget exhausted after one ambiguous + one success").toBe(true);
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE;
    }
  });
});

describe("order pricing is authoritative (Oliver P1)", () => {
  it("refuses an unseen number before any quote, prompt, or order request", async () => {
    const fetchMock = vi.fn();
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("search_available_numbers");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds remembered search results and evicts the oldest association", async () => {
    const records = Array.from({ length: 501 }, (_, index) => ({
      phone_number: `+1312555${String(index).padStart(4, "0")}`,
      cost_information: { monthly_cost: "1.10", currency: "USD" }
    }));
    const first = records[0].phone_number;
    const last = records.at(-1)!.phone_number;
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { data: records }));
    const client = await connectedClient(fetchMock);
    await establishNumberSearchContext(client, fetchMock);

    const evicted = await client.callTool({
      name: "order_number",
      arguments: { phone_number: first }
    });
    expect(evicted.isError).toBe(true);
    expect((evicted.content as Array<{ text: string }>)[0].text).toContain("search_available_numbers");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => jsonResponse(200, { data: [records.at(-1)] }));
    const retained = await client.callTool({
      name: "order_number",
      arguments: { phone_number: last }
    });
    expect(retained.isError).toBe(true);
    expect((retained.content as Array<{ text: string }>)[0].text).toContain("elicitation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses GB search context and exact-matches a target that is not the first row", async () => {
    const selected = "+442079460100";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{
        phone_number: selected,
        cost_information: { monthly_cost: "2.00", upfront_cost: "1.00", currency: "GBP" }
      }]
    }));
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock, {
      country_code: "GB",
      area_code: "20",
      contains: "946",
      features: ["voice"],
      limit: 5
    });
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        return jsonResponse(200, {
          data: [
            {
              phone_number: "+442079460099",
              cost_information: { monthly_cost: "2.00", upfront_cost: "1.00", currency: "GBP" }
            },
            {
              phone_number: selected,
              cost_information: { monthly_cost: "2.00", upfront_cost: "1.00", currency: "GBP" }
            }
          ]
        });
      }
      return jsonResponse(200, { data: { id: "order-gb" } });
    });

    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: selected }
    });
    expect(result.isError ?? false).toBe(false);
    const quoteUrls = fetchMock.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.pathname.endsWith("/available_phone_numbers"));
    expect(quoteUrls).toHaveLength(2);
    for (const url of quoteUrls) {
      expect(url.searchParams.get("filter[country_code]")).toBe("GB");
      expect(url.searchParams.get("filter[national_destination_code]")).toBe("20");
      expect(url.searchParams.get("filter[phone_number][contains]")).toBe("946");
      expect(url.searchParams.getAll("filter[features][]")).toEqual(["voice"]);
      expect(url.searchParams.get("filter[limit]")).toBe("50");
      expect(url.searchParams.has("filter[phone_number]")).toBe(false);
    }
  });

  it("re-queries live inventory and quotes the API's cost, not model input", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        return jsonResponse(200, {
          data: [{ phone_number: "+13125550100", cost_information: { monthly_cost: "1.10", upfront_cost: "1.00", currency: "USD" } }]
        });
      }
      return jsonResponse(200, { data: { id: "order1" } });
    });
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError ?? false).toBe(false);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0], "must price before ordering").toContain("available_phone_numbers");
    expect(urls[1], "must revalidate after approval").toContain("available_phone_numbers");
    expect(urls[2]).toContain("number_orders");
    const receipt = (result.content as Array<{ text: string }>).map((c) => c.text).join(" ");
    expect(receipt).toContain("monthly_cost: 1.1");
    expect(receipt).toContain("upfront_cost: 1");
  });

  it("treats equivalent decimal and currency formatting as the same approved quote", async () => {
    let quoteReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        if (new URL(String(url)).searchParams.get("filter[limit]") === "50") quoteReads++;
        return jsonResponse(200, {
          data: [{
            phone_number: "+13125550100",
            cost_information: quoteReads <= 1
              ? { monthly_cost: "01.100", upfront_cost: ".50", currency: " usd " }
              : { monthly_cost: "1.1", upfront_cost: "0.5", currency: "USD" }
          }]
        });
      }
      return jsonResponse(200, { data: { id: "order1" } });
    });
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError ?? false).toBe(false);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("number_orders"))).toHaveLength(1);
  });

  it("refuses when the number is not in live inventory (no order attempted)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: { monthly_cost: "1.10", currency: "USD" }
        }]
      }))
      .mockResolvedValue(jsonResponse(200, { data: [] }));
    const client = await connectedClient(fetchMock);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("not currently available");
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it.each([
    ["missing cost_information", undefined],
    ["null cost_information", null],
    ["empty cost_information", {}],
    ["missing monthly cost", { currency: "USD" }],
    ["null monthly cost", { monthly_cost: null, currency: "USD" }],
    ["blank monthly cost", { monthly_cost: "   ", currency: "USD" }],
    ["NaN monthly cost", { monthly_cost: "NaN", currency: "USD" }],
    ["infinite monthly cost", { monthly_cost: "Infinity", currency: "USD" }],
    ["negative monthly cost", { monthly_cost: "-1.00", currency: "USD" }],
    ["missing currency", { monthly_cost: "1.10" }],
    ["null currency", { monthly_cost: "1.10", currency: null }],
    ["blank currency", { monthly_cost: "1.10", currency: " " }],
    ["invalid currency", { monthly_cost: "1.10", currency: "US" }],
    ["null upfront cost", { monthly_cost: "1.10", upfront_cost: null, currency: "USD" }],
    ["blank upfront cost", { monthly_cost: "1.10", upfront_cost: "", currency: "USD" }],
    ["infinite upfront cost", { monthly_cost: "1.10", upfront_cost: "Infinity", currency: "USD" }],
    ["negative upfront cost", { monthly_cost: "1.10", upfront_cost: "-0.01", currency: "USD" }]
  ])("refuses %s and never attempts an order", async (_label, costInformation) => {
    const record: Record<string, unknown> = { phone_number: "+13125550100" };
    if (costInformation !== undefined) record.cost_information = costInformation;
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { data: [record] }));
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("valid current pricing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it.each([
    ["monthly cost changes", { monthly_cost: "2.20", upfront_cost: "0.00", currency: "USD" }],
    ["upfront cost changes", { monthly_cost: "1.10", upfront_cost: "1.00", currency: "USD" }],
    ["currency changes", { monthly_cost: "1.10", upfront_cost: "0.00", currency: "EUR" }],
    ["a new charge appears", { monthly_cost: "1.10", upfront_cost: "0.00", setup_cost: "0.25", currency: "USD" }]
  ])("refuses when %s after approval and never attempts an order", async (_label, changedCost) => {
    let quoteReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (!String(url).includes("available_phone_numbers")) {
        throw new Error("order endpoint must not be called");
      }
      if (new URL(String(url)).searchParams.get("filter[limit]") === "50") quoteReads++;
      return jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: quoteReads <= 1
            ? { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
            : changedCost
        }]
      });
    });
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("changed or disappeared");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("refuses when the approved number disappears and never attempts an order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("changed or disappeared");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("refuses when post-approval revalidation fails and never attempts an order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{
          phone_number: "+13125550100",
          cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
        }]
      }))
      .mockRejectedValueOnce(new Error("inventory temporarily unavailable"));
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("Could not revalidate");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it.each([
    ["initial pricing", false],
    ["post-approval revalidation", true]
  ])("bounds and redacts a large %s exception without ordering", async (_label, afterApproval) => {
    const bearer = "order-path.secret.signature";
    const basic = "b3JkZXI6cGF0aC1zZWNyZXQ=";
    const failure = new Error(
      `inventory failure Bearer ${bearer}; Basic ${basic}; ${"x".repeat(100_000)}`
    );
    const validInventory = jsonResponse(200, {
      data: [{
        phone_number: "+13125550100",
        cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
      }]
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(validInventory);
    if (afterApproval) {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {
          data: [{
            phone_number: "+13125550100",
            cost_information: { monthly_cost: "1.10", upfront_cost: "0.00", currency: "USD" }
          }]
        }))
        .mockRejectedValueOnce(failure);
    } else {
      fetchMock.mockRejectedValueOnce(failure);
    }
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(text).toContain("TRUNCATED");
    expect(text).not.toContain(bearer);
    expect(text).not.toContain(basic);
    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("Basic [redacted]");
    expect(fetchMock).toHaveBeenCalledTimes(afterApproval ? 2 : 1);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("number_orders"))).toBe(true);
  });

  it("ignores incidental non-charge metadata while binding approval to every charge", async () => {
    let quoteReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("available_phone_numbers")) {
        if (new URL(String(url)).searchParams.get("filter[limit]") === "50") quoteReads++;
        return jsonResponse(200, {
          data: [{
            phone_number: "+13125550100",
            cost_information: {
              monthly_cost: "1.10",
              upfront_cost: "0.00",
              currency: "USD",
              future_metadata: quoteReads <= 1 ? null : { source: "inventory-v2" }
            }
          }]
        });
      }
      return jsonResponse(200, { data: { id: "order1" } });
    });
    const client = await connectedClientWithElicitation(fetchMock, true);
    await establishNumberSearchContext(client, fetchMock);
    const result = await client.callTool({
      name: "order_number",
      arguments: { phone_number: "+13125550100" }
    });
    expect(result.isError ?? false).toBe(false);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("available_phone_numbers"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("number_orders"))).toHaveLength(1);
  });

  it("exposes only the strict phone_number input for purchases", async () => {
    const client = await connectedClient(vi.fn());
    const { tools } = await client.listTools();
    const order = tools.find((t) => t.name === "order_number");
    expect(order?.inputSchema).toMatchObject({
      type: "object",
      required: ["phone_number"],
      additionalProperties: false
    });
    const schema = JSON.stringify(order?.inputSchema);
    expect(schema).not.toContain("stated_monthly_cost");
    expect(schema).not.toContain("confirm");
  });
});

describe("error bodies are bounded and redacted (Oliver P2)", () => {
  it("redacts credential-shaped fields and inline keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        errors: [{ code: "10009", detail: "nope" }],
        authorization: "Bearer KEY019SECRET123456",
        nested: { api_key: "KEY019ABCDEF", note: "raw KEY019DEADBEEF inline", safe: "hello" }
      })
    );
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).not.toMatch(/KEY019SECRET|KEY019ABCDEF|KEY019DEADBEEF/);
    expect(text).toContain("[redacted]");
    expect(text).toContain("safe");
  });

  it("truncates a huge upstream error instead of forwarding it whole", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { errors: [{ code: "10009", detail: "x".repeat(400_000) }] })
    );
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text.length).toBeLessThan(20_000);
    expect(text).toMatch(/TRUNCATED|truncated/);
  });

  it("bounds and redacts a large parseable JSON error below the response-body cap", async () => {
    const bearer = "parseable-bearer.secret.signature";
    const basic = "cGFyc2VhYmxlOnNlY3JldA==";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        errors: [{
          code: "10009",
          detail: `proxy echoed Bearer ${bearer}; Basic ${basic}; ${"x".repeat(180_000)}`
        }]
      })
    );
    const client = await connectedClient(fetchMock);
    const result = await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text.length).toBeLessThanOrEqual(8_000);
    expect(text).toMatch(/TRUNCATED|truncated/);
    expect(text).not.toContain(bearer);
    expect(text).not.toContain(basic);
    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("Basic [redacted]");
  });

  it("redacts structured and generic credentials when JSON is truncated before parsing", async () => {
    const authorizationSecret = "KEY019AUTHORIZATIONSECRET";
    const bearer = "eyJhbGciOiJIUzI1NiJ9.super-secret.signature";
    const basic = "dXNlcjpzdXBlci1zZWNyZXQ=";
    const body = JSON.stringify({
      authorization: `Bearer ${authorizationSecret}`,
      message: `proxy echoed Bearer ${bearer}; Basic ${basic}`,
      padding: "x".repeat(2_000)
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, { status: 502, headers: { "Content-Type": "application/json" } })
    );
    const client = await connectedClient(fetchMock, { maxResponseBytes: 220 });
    const result = await client.callTool({
      name: "lookup_number",
      arguments: { phone_number: "+13125550100" }
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text).not.toContain(authorizationSecret);
    expect(text).not.toContain(bearer);
    expect(text).not.toContain(basic);
    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("Basic [redacted]");
    expect(text).toContain("truncated at 220 bytes");
    expect(text.length).toBeLessThan(1_000);
  });
});

describe("missing API key", () => {
  it("returns a clear tool error, not a crash, when no key is configured", async () => {
    const server = createServer({ apiKey: "" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({
      name: "list_owned_numbers",
      arguments: { page_size: 5 }
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("TELNYX_API_KEY");
  });

  it("does not burn a write cap when configuration prevents dispatch", async () => {
    process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE = "1";
    try {
      const server = createServer({ apiKey: "" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "0.0.1" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const args = { to: "+15550001111", from: "+15550002222", text: "hi" };
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await client.callTool({ name: "send_message", arguments: args });
        expect(result.isError).toBe(true);
        expect((result.content as Array<{ text: string }>)[0].text).toContain("TELNYX_API_KEY");
        expect((result.content as Array<{ text: string }>)[0].text).not.toContain("Session limit");
      }
    } finally {
      delete process.env.TELNYX_CONNECTOR_MAX_SEND_MESSAGE;
    }
  });
});
