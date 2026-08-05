import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_RECHARGE_SETUP_UI_HTML,
  INITIAL_RESULT_GATE_SOURCE,
  STORED_PAYMENT_TOP_UP_UI_HTML,
  USAGE_COST_EXPLORER_UI_HTML
} from "../src/ui.js";

type GateOptions = {
  delayMs: number;
  isUsable: (payload: unknown) => boolean;
  render: (payload: unknown) => void;
  loadFallback: () => unknown;
  onFallbackError: (error: unknown) => void;
};

type InitialResultGate = {
  accept: (payload: unknown) => boolean;
  scheduleFallback: () => void;
};

function createGate(options: GateOptions): InitialResultGate {
  const factory = Function(`${INITIAL_RESULT_GATE_SOURCE}; return createInitialResultGate;`)() as
    (gateOptions: GateOptions) => InitialResultGate;
  return factory(options);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Billing UI initial result gate", () => {
  it("renders structured launch content and cancels the duplicate fallback", async () => {
    vi.useFakeTimers();
    const render = vi.fn();
    const loadFallback = vi.fn();
    const gate = createGate({
      delayMs: 1000,
      isUsable: (payload) => Boolean(payload),
      render,
      loadFallback,
      onFallbackError: vi.fn()
    });

    gate.scheduleFallback();
    await vi.advanceTimersByTimeAsync(500);
    const structuredContent = { balance: { data: { balance: "10.00" } } };

    expect(gate.accept(structuredContent)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(structuredContent);
    expect(loadFallback).not.toHaveBeenCalled();
  });

  it("falls back once after the fixed delay when initial content is unusable", async () => {
    vi.useFakeTimers();
    const loadFallback = vi.fn();
    const gate = createGate({
      delayMs: 1000,
      isUsable: (payload) => Boolean(payload),
      render: vi.fn(),
      loadFallback,
      onFallbackError: vi.fn()
    });

    gate.scheduleFallback();
    gate.scheduleFallback();
    expect(gate.accept(null)).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(loadFallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFallback).toHaveBeenCalledOnce();
  });
});

describe("Billing MCP App UI initial-result integration", () => {
  it.each([
    {
      name: "billing dashboard",
      html: USAGE_COST_EXPLORER_UI_HTML,
      gate: "initialOverviewResult",
      launchTool: "billing_overview"
    },
    {
      name: "stored-payment top up",
      html: STORED_PAYMENT_TOP_UP_UI_HTML,
      gate: "initialStoredPaymentResult",
      launchTool: "billing_stored_payment_top_up"
    },
    {
      name: "auto-recharge setup",
      html: AUTO_RECHARGE_SETUP_UI_HTML,
      gate: "initialAutoRechargeResult",
      launchTool: "billing_auto_recharge_setup"
    }
  ])("$name consumes tool-result content before its bounded fallback", ({ html, gate, launchTool }) => {
    expect(html).toContain('message.method === "ui/notifications/tool-result"');
    expect(html).toContain(`${gate}.accept(extractResult(message.params))`);
    expect(html).toContain(`${gate}.scheduleFallback()`);
    expect(html).toContain(`callTool("${launchTool}"`);

    const delay = Number(html.match(/const INITIAL_RESULT_FALLBACK_MS = (\d+);/)?.[1]);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("keeps every explicit refresh wired to a real tool call", () => {
    expect(USAGE_COST_EXPLORER_UI_HTML).toContain(
      'els.refreshButton.addEventListener("click", () => loadOverview().then(loadUsage)'
    );
    expect(STORED_PAYMENT_TOP_UP_UI_HTML).toContain(
      'els.reloadButton.addEventListener("click", () => { setStatus("Reloading balance..."); loadState()'
    );
    expect(AUTO_RECHARGE_SETUP_UI_HTML).toContain(
      'els.reloadButton.addEventListener("click", () => { setStatus("Reloading current state..."); loadState()'
    );
  });

  it("does not consume the one-time usage load before a late overview result populates its selectors", () => {
    const functionBody = USAGE_COST_EXPLORER_UI_HTML.match(
      /function loadInitialUsageOnce\(\) \{([\s\S]*?)\n      \}/
    )?.[1] ?? "";
    const selectionGuard =
      "if (!els.productSelect.value || !els.dimensionSelect.value || !els.metricSelect.value) return;";

    expect(functionBody).toContain(selectionGuard);
    expect(functionBody.indexOf(selectionGuard)).toBeLessThan(
      functionBody.indexOf("initialUsageRequested = true;")
    );
  });

  it.each([
    ["billing dashboard", USAGE_COST_EXPLORER_UI_HTML],
    ["stored-payment top up", STORED_PAYMENT_TOP_UP_UI_HTML],
    ["auto-recharge setup", AUTO_RECHARGE_SETUP_UI_HTML]
  ])("emits syntactically valid inline JavaScript for %s", (_name, html) => {
    expect(() => Function(inlineScript(html))).not.toThrow();
  });
});

function inlineScript(html: string): string {
  return html.match(/<script>([\s\S]*?)<\/script>/i)?.[1] ?? "";
}
