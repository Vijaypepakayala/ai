import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");

function walkMarkdownFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function targetMarkdownFiles(): string[] {
  return walkMarkdownFiles(SKILLS_DIR).filter((filePath) =>
    filePath.includes("-javascript/") ||
    filePath.includes("/sdk-reference/javascript/")
  );
}

function findCamelCaseParameterRows(content: string): string[] {
  const offenders: string[] = [];
  let inParameterTable = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("| Parameter |")) {
      inParameterTable = true;
      continue;
    }

    if (inParameterTable && !line.startsWith("|")) {
      inParameterTable = false;
      continue;
    }

    if (!inParameterTable) continue;

    const match = line.match(/^\| `([^`]+)` \|/);
    if (match && /[A-Z]/.test(match[1])) {
      offenders.push(match[1]);
    }
  }

  return offenders;
}

describe("javascript skill parameter tables", () => {
  for (const filePath of targetMarkdownFiles()) {
    it(`${filePath.replace(`${ROOT}/`, "")} uses snake_case parameter names`, () => {
      const content = readFileSync(filePath, "utf8");
      const offenders = findCamelCaseParameterRows(content);

      assert.deepEqual(
        offenders,
        [],
        `Found camelCase parameter names in ${filePath}: ${offenders.join(", ")}`
      );
    });
  }
});
