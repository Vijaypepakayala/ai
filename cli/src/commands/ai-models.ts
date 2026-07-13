/**
 * telnyx-agent ai-models — List models available to Telnyx inference.
 *
 * Wraps the current Go CLI command `ai:openai list-models`.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { outputJson, printError, printSuccess } from "../utils/output.ts";

interface AiModel {
  id?: string;
  owned_by?: string;
  [key: string]: unknown;
}

function extractModels(response: unknown): AiModel[] {
  if (Array.isArray(response)) return response as AiModel[];
  if (!response || typeof response !== "object") return [];
  const object = response as Record<string, unknown>;
  if (Array.isArray(object.data)) return object.data as AiModel[];
  if (Array.isArray(object.models)) return object.models as AiModel[];
  return [];
}

export async function aiModelsCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;

  try {
    if (!jsonOutput) console.log("\n🤖 Listing AI inference models...\n");

    const response = await telnyxCli(["ai:openai", "list-models"]);
    const models = extractModels(response);

    if (jsonOutput) {
      outputJson({ models, count: models.length });
    } else {
      printSuccess("AI inference models retrieved", { Count: models.length });
      for (const model of models) {
        const owner = model.owned_by ? ` — ${model.owned_by}` : "";
        console.log(`  • ${model.id ?? "(unknown)"}${owner}`);
      }
      if (models.length === 0) console.log("  (no models returned)");
      console.log();
    }
  } catch (err) {
    const message = errorMsg(err);
    if (jsonOutput) outputJson({ error: message });
    else printError(message);
    process.exit(1);
  }
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
