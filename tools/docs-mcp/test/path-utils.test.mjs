import { describe, expect, it } from "vitest";

import {
  normalizeRelativePath,
  skillDirectoryFromRelativePath
} from "../scripts/path-utils.mjs";

describe("portable corpus paths", () => {
  it.each([
    ["skills/telnyx-ai-assistants-python/references/api-details.md", "telnyx-ai-assistants-python"],
    ["skills\\telnyx-ai-assistants-python\\references\\api-details.md", "telnyx-ai-assistants-python"],
    ["skills/telnyx-twilio-migration/SKILL.md", "telnyx-twilio-migration"],
    ["skills\\telnyx-twilio-migration\\SKILL.md", "telnyx-twilio-migration"]
  ])("extracts the containing skill from %s", (relativePath, expected) => {
    expect(skillDirectoryFromRelativePath(relativePath)).toBe(expected);
  });

  it("normalizes all Windows separators for stable cross-platform document IDs", () => {
    expect(normalizeRelativePath("skills\\telnyx-voice-python\\references\\api-details.md"))
      .toBe("skills/telnyx-voice-python/references/api-details.md");
  });

  it.each(["", "guides/webhooks.md", "guides\\webhooks.md", "skills"])(
    "does not invent a skill directory for %s",
    (relativePath) => {
      expect(skillDirectoryFromRelativePath(relativePath)).toBe("");
    }
  );
});
