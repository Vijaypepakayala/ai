/**
 * telnyx-agent ai-embed — OpenAI-compatible text embeddings.
 *
 * Wraps the current Go CLI command `ai:openai:embeddings create-embeddings`.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { outputJson, printError, printSuccess } from "../utils/output.ts";

interface Embedding {
  embedding?: unknown[];
  index?: number;
  [key: string]: unknown;
}

function extractData(response: unknown): Record<string, unknown> {
  return response && typeof response === "object" ? (response as Record<string, unknown>) : {};
}

export async function aiEmbedCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const input = flags.input as string | undefined;
  const model = flags.model as string | undefined;

  if (!input) fail("--input is required", jsonOutput);
  if (!model) fail("--model is required", jsonOutput);

  try {
    if (!jsonOutput) console.log("\n🧠 Generating embeddings...\n");

    const args = [
      "ai:openai:embeddings",
      "create-embeddings",
      "--input",
      input,
      "--model",
      model,
    ];
    for (const flag of ["dimensions", "encoding-format", "user"]) {
      const value = flags[flag];
      if (value !== undefined) args.push(`--${flag}`, String(value));
    }

    const response = await telnyxCli(args);
    const payload = extractData(response);
    const embeddings = Array.isArray(payload.data) ? (payload.data as Embedding[]) : [];

    if (jsonOutput) {
      outputJson({
        model: payload.model ?? model,
        object: payload.object,
        count: embeddings.length,
        embeddings,
        ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
      });
    } else {
      const firstVector = embeddings[0]?.embedding;
      printSuccess("Embeddings generated", {
        Model: String(payload.model ?? model),
        Count: embeddings.length,
        Dimensions: Array.isArray(firstVector) ? firstVector.length : flags.dimensions ?? "unknown",
      });
    }
  } catch (err) {
    fail(errorMsg(err), jsonOutput);
  }
}

function fail(message: string, jsonOutput: boolean): never {
  if (jsonOutput) outputJson({ error: message });
  else printError(message);
  process.exit(1);
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
