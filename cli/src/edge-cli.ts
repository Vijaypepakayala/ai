import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/**
 * Invoke help for a command path. A successful invocation is the capability
 * signal; output wording is only inspected when probing for a flag or manifest
 * feature that does not have its own command.
 */
export function getEdgeCommandHelp(commandPath: readonly string[]): string | null {
  try {
    return runEdge([...commandPath, "--help"]);
  } catch {
    return null;
  }
}

export function supportsEdgeCommand(commandPath: readonly string[]): boolean {
  return getEdgeCommandHelp(commandPath) !== null;
}

export function hasEdgeCli(): boolean {
  return supportsEdgeCommand([]);
}

export function getEdgeHelp(): string {
  return runEdge(["--help"]);
}

/**
 * Resolve the installed telnyx-edge version.
 *
 * Prefers the first-class `--version` flag introduced in v0.2.3. If that is
 * unavailable, parses the supplied root help output or invokes root help once.
 */
export function getEdgeVersion(rootHelp?: string): string | null {
  try {
    const version = matchVersion(runEdge(["--version"]));
    if (version) return version;
  } catch {
    // Older CLI without --version — fall back to root help below.
  }

  if (rootHelp !== undefined) return matchVersion(rootHelp);
  return matchVersion(getEdgeCommandHelp([]) ?? "");
}

/**
 * Feature detection for Stateful Actors.
 *
 * `new-func --help` must both succeed and expose `--actor`. This probes the
 * scaffolding workflow directly without assigning it a version minimum.
 */
export function supportsStatefulActors(): boolean {
  const help = getEdgeCommandHelp(["new-func"]);
  return help !== null && /--actor\b/i.test(help);
}

export type EdgeCapabilities = {
  reset_func_supported: boolean;
  types_supported: boolean;
  storage_kv_supported: boolean;
  revisions_supported: boolean;
  rollback_supported: boolean;
  inspect_supported: boolean;
  bindings_supported: boolean;
  secrets_supported: boolean;
  cloud_storage_supported: boolean;
  stateful_actors_supported: boolean;
};

/** Probe the installed command surface instead of inferring it from a version. */
export function getEdgeCapabilities(): EdgeCapabilities {
  const typesHelp = getEdgeCommandHelp(["types"]);

  return {
    reset_func_supported: supportsEdgeCommand(["reset-func"]),
    types_supported: typesHelp !== null,
    storage_kv_supported: supportsEdgeCommand(["storage", "kv"]),
    revisions_supported: supportsEdgeCommand(["revisions"]),
    rollback_supported: supportsEdgeCommand(["rollback"]),
    inspect_supported: supportsEdgeCommand(["inspect"]),
    bindings_supported: supportsEdgeCommand(["bindings"]),
    secrets_supported: supportsEdgeCommand(["secrets"]),
    // Cloud Storage has no standalone command, and early builds that support
    // it do not consistently advertise it in `types --help`. Probe `types`
    // against an isolated manifest so edge-doctor never writes to the user's
    // project or relies on release-note/version assumptions.
    cloud_storage_supported: typesHelp !== null && supportsCloudStorageTypes(typesHelp),
    stateful_actors_supported: supportsStatefulActors(),
  };
}

function supportsCloudStorageTypes(typesHelp: string): boolean {
  if (/storage\.cloudstorage|CloudStorageBucket|cloud storage/i.test(typesHelp)) return true;

  const projectDir = mkdtempSync(join(tmpdir(), "telnyx-edge-cloud-storage-probe-"));
  try {
    writeFileSync(
      join(projectDir, "func.toml"),
      '[storage.cloudstorage.EDGE_DOCTOR_PROBE]\nbucket_name = "probe"\nregion = "us-east-1"\n',
    );
    runEdge(["types", "--from-dir", projectDir]);
    const declarations = readFileSync(join(projectDir, "telnyx-env.d.ts"), "utf8");
    return /CloudStorageBucket|EDGE_DOCTOR_PROBE/.test(declarations);
  } catch {
    return false;
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
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
  return supportsEdgeCommand(["auth", "api-key", "set"]);
}

function matchVersion(text: string): string | null {
  const match = text.match(/v?\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}
