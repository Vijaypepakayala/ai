// Test-only launcher for the live read contract. It permits real Telnyx GETs
// but blocks every mutating method before network I/O, independently of MCP
// schemas, approval gates, and session caps.
import { pathToFileURL } from "node:url";

export function createReadOnlyFetch(networkFetch) {
  return async (input, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error(`Live read-only backstop refused ${method} ${String(input)} before network I/O`);
    }
    return networkFetch(input, init);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  globalThis.fetch = createReadOnlyFetch(globalThis.fetch);
  await import("../dist/cli.js");
}
