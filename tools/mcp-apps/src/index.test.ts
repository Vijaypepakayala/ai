import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { assertSecureStartupConfig, getHostname, isMainModule } from "./index.js";

describe("hosted HTTP entrypoint", () => {
  const oldHostname = process.env.MCP_APPS_HOST;

  afterEach(() => {
    if (oldHostname === undefined) delete process.env.MCP_APPS_HOST;
    else process.env.MCP_APPS_HOST = oldHostname;
  });

  it("recognizes a relative argv script path as the current ESM module", () => {
    const absolute = resolve("dist/src/index.js");
    expect(isMainModule(pathToFileURL(absolute).href, "dist/src/index.js")).toBe(true);
  });

  it("does not start when imported by another module", () => {
    const absolute = resolve("dist/src/index.js");
    expect(isMainModule(pathToFileURL(absolute).href, "dist/src/other.js")).toBe(false);
    expect(isMainModule(pathToFileURL(absolute).href, undefined)).toBe(false);
  });

  it("binds all interfaces by default only when protected by the internal token", () => {
    delete process.env.MCP_APPS_HOST;
    expect(getHostname()).toBe("0.0.0.0");
    expect(() => assertSecureStartupConfig(getHostname(), undefined, false)).toThrow(
      /MCP_APPS_INTERNAL_TOKEN is required/
    );
    expect(() => assertSecureStartupConfig(getHostname(), "service-token", false)).not.toThrow();
  });

  it.each(["localhost", "127.0.0.1", "127.42.0.7", "::1", "[::1]"])(
    "allows explicit tokenless development when bound to %s",
    (hostname) => {
      expect(() => assertSecureStartupConfig(hostname, undefined, true)).not.toThrow();
    }
  );

  it.each(["0.0.0.0", "192.0.2.10", "::", "mcp-apps.internal"])(
    "rejects tokenless development when bound to %s",
    (hostname) => {
      expect(() => assertSecureStartupConfig(hostname, undefined, true)).toThrow(
        /MCP_APPS_INTERNAL_TOKEN is required/
      );
    }
  );
});
