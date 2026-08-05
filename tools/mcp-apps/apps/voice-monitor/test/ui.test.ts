import { afterEach, describe, expect, it, vi } from "vitest";

import { INITIAL_RESULT_GATE_SOURCE, VOICE_MONITOR_UI_HTML } from "../src/ui.js";

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

describe("Voice Monitor initial result gate", () => {
  it("renders a usable initial result and cancels the delayed duplicate load", async () => {
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
    const payload = { options: {}, active_calls: {} };

    expect(gate.accept(payload)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(payload);
    expect(loadFallback).not.toHaveBeenCalled();
  });

  it("runs one bounded fallback when no usable result arrives", async () => {
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
    expect(gate.accept(undefined)).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(loadFallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFallback).toHaveBeenCalledOnce();
  });
});

describe("Voice Monitor UI initial-result integration", () => {
  it("consumes the launch result, delays fallback, and preserves explicit refresh calls", () => {
    expect(VOICE_MONITOR_UI_HTML).toContain('message.method === "ui/notifications/tool-result"');
    expect(VOICE_MONITOR_UI_HTML).toContain("initialDashboardResult.accept(extractResult(message.params))");
    expect(VOICE_MONITOR_UI_HTML).toContain("loadFallback: loadDashboard");
    expect(VOICE_MONITOR_UI_HTML).toContain("initialDashboardResult.scheduleFallback()");
    expect(VOICE_MONITOR_UI_HTML).not.toMatch(
      /notify\("ui\/notifications\/initialized", \{\}\);[\s\S]{0,120}await loadDashboard\(\)/
    );

    const delay = Number(
      VOICE_MONITOR_UI_HTML.match(/const INITIAL_RESULT_FALLBACK_MS = (\d+);/)?.[1]
    );
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(5000);

    expect(VOICE_MONITOR_UI_HTML).toContain(
      'els.activeCallsButton.addEventListener("click", () => loadActiveCalls()'
    );
    expect(VOICE_MONITOR_UI_HTML).toContain(
      'callTool("voice_monitor_active_calls"'
    );
    expect(VOICE_MONITOR_UI_HTML).toContain("result?.truncated_output");
  });

  it("emits syntactically valid inline JavaScript", () => {
    expect(() => Function(inlineScript(VOICE_MONITOR_UI_HTML))).not.toThrow();
  });
});

function inlineScript(html: string): string {
  return html.match(/<script>([\s\S]*?)<\/script>/i)?.[1] ?? "";
}
