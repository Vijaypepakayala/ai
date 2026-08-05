import { describe, expect, it } from "vitest";

import { NUMBER_INTELLIGENCE_UI_HTML } from "../src/ui.js";

const SECURITY_META_MARKERS = [
  '<meta name="color-scheme" content="light dark" />',
  '<meta http-equiv="Content-Security-Policy"',
  "default-src 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'"
];

describe("Number Intelligence UI resource", () => {
  it("includes ORA scanner security metadata", () => {
    expect(NUMBER_INTELLIGENCE_UI_HTML).toMatch(/^<!doctype html>/i);
    expect(NUMBER_INTELLIGENCE_UI_HTML).toContain("Number Intelligence");
    for (const marker of SECURITY_META_MARKERS) {
      expect(NUMBER_INTELLIGENCE_UI_HTML).toContain(marker);
    }
    expect(contentSecurityPolicy(NUMBER_INTELLIGENCE_UI_HTML)).not.toMatch(/https?:|wss?:|\*\./i);
    expect(NUMBER_INTELLIGENCE_UI_HTML).toContain("result.requested_total");
    expect(NUMBER_INTELLIGENCE_UI_HTML).toContain("result.queried_total");
    expect(NUMBER_INTELLIGENCE_UI_HTML).toContain("result.truncated");
    expect(NUMBER_INTELLIGENCE_UI_HTML).toMatch(
      /<\/form>\s*<div class="billing-notice" role="note" aria-label="Billable lookup notice">/
    );
    expect(NUMBER_INTELLIGENCE_UI_HTML).toContain(
      "Each submitted number triggers one Telnyx Number Lookup that may incur a charge."
    );
    expect(NUMBER_INTELLIGENCE_UI_HTML).toContain(
      "Batch analysis accepts at most 25 unique numbers and can trigger up to 25 billable lookups; confirm the submitted count before running it."
    );
  });
});

function contentSecurityPolicy(html: string): string {
  return html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] ?? "";
}
