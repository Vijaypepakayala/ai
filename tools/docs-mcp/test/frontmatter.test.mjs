import { describe, expect, it } from "vitest";

import {
  frontmatterDescription,
  frontmatterMetadataValue
} from "../scripts/frontmatter.mjs";

describe.each(["\n", "\r\n"])("frontmatter with %j line endings", (newline) => {
  const document = [
    "---",
    "name: migration",
    "description: >-",
    "  Migrate Twilio applications safely.",
    "metadata:",
    "  product: migration",
    "  language: 'python'",
    "---",
    "# Migration"
  ].join(newline);

  it("parses descriptions and metadata identically", () => {
    expect(frontmatterDescription(document)).toBe("Migrate Twilio applications safely.");
    expect(frontmatterMetadataValue(document, "product")).toBe("migration");
    expect(frontmatterMetadataValue(document, "language")).toBe("python");
  });
});
