import { execFileSync } from "node:child_process";

export function resolveEdgeBinary(): string {
  return process.env.TELNYX_EDGE_PATH || "telnyx-edge";
}

function runEdge(args: string[]): string {
  return execFileSync(resolveEdgeBinary(), args, {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function hasEdgeCli(): boolean {
  try {
    runEdge(["--help"]);
    return true;
  } catch {
    return false;
  }
}

export function getEdgeHelp(): string {
  return runEdge(["--help"]);
}

/**
 * Resolve the installed telnyx-edge version.
 *
 * Prefers the first-class `--version` flag introduced in v0.2.3. If that is
 * unavailable (older CLI), falls back to parsing `--help` output with the
 * existing semver regex.
 */
export function getEdgeVersion(): string | null {
  try {
    const v = matchVersion(runEdge(["--version"]));
    if (v) return v;
  } catch {
    // older CLI without --version — fall back to --help parsing below
  }
  try {
    return matchVersion(runEdge(["--help"]));
  } catch {
    return null;
  }
}

/**
 * Feature detection for Stateful Actors (Beta, telnyx-edge v0.2.3+).
 *
 * Probes whether the installed CLI exposes the `actors` subcommand rather than
 * relying on version parsing, so canary/preview builds are detected too.
 */
export function supportsStatefulActors(): boolean {
  try {
    runEdge(["actors", "--help"]);
    return true;
  } catch {
    return false;
  }
}

export type EdgeAuthStatus = {
  authenticated: boolean;
  mode: "api_key" | "oauth" | "none" | "unknown";
  raw: string;
};

export function getEdgeAuthStatus(): EdgeAuthStatus {
  const raw = runEdge(["auth", "status"]);
  const text = raw.toLowerCase();
  const authenticated =
    !text.includes("authentication status: none") &&
    !text.includes("not authenticated") &&
    !text.includes("status: ❌") &&
    !text.includes("status: x") &&
    !text.includes("token expired") &&
    !text.includes("⚠️");

  let mode: EdgeAuthStatus["mode"] = "unknown";
  if (
    text.includes("authentication status: none") ||
    text.includes("not authenticated") ||
    text.includes("status: ❌") ||
    text.includes("status: x")
  ) {
    mode = "none";
  } else if (
    text.includes("authentication status: api key") ||
    text.includes("api key")
  ) {
    mode = "api_key";
  } else if (
    text.includes("authentication status: oauth") ||
    text.includes("oauth") ||
    text.includes("browser") ||
    text.includes("logged in")
  ) {
    mode = "oauth";
  }

  return { authenticated, mode, raw };
}

export function supportsApiKeyAuth(): boolean {
  try {
    const out = runEdge(["auth", "api-key", "set", "--help"]);
    return /Set API key for authentication/i.test(out);
  } catch {
    return false;
  }
}

function matchVersion(text: string): string | null {
  const match = text.match(/v?\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}
