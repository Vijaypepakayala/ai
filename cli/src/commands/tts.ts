/**
 * telnyx-agent tts — Text-to-speech generation.
 *
 * Shells out to the telnyx CLI's `text-to-speech generate-speech` subcommand
 * and surfaces the resulting base64-encoded audio data to the caller in
 * either human-readable or JSON form.
 *
 * Supported providers: telnyx, aws, azure, elevenlabs, minimax, resemble, rime, xai
 *
 * The API's `output_type` enum is `binary_output | base64_output`. This
 * wrapper only supports `base64_output` (exposed as the friendly alias
 * `base64`) because `binary_output` returns raw audio bytes, which cannot be
 * transported through the JSON pipeline used to parse telnyx CLI output.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printSuccess, printError, outputJson } from "../utils/output.ts";

const VALID_PROVIDERS = ["telnyx", "aws", "azure", "elevenlabs", "minimax", "resemble", "rime", "xai"] as const;
// Friendly alias → documented API enum value. `binary_output` is deliberately
// unsupported: it returns raw audio bytes that would corrupt JSON parsing.
const OUTPUT_TYPE_MAP: Record<string, string> = {
  base64: "base64_output",
  base64_output: "base64_output",
};
const VALID_TEXT_TYPES = ["text", "ssml"] as const;

interface TtsResult {
  text: string;
  voice: string;
  provider: string;
  output_type: string;
  audio_data?: string;
  has_audio_data: boolean;
}

/**
 * Extract base64 audio data from a telnyx CLI text-to-speech response. With
 * `output_type=base64_output`, POST /text-to-speech/speech returns
 * `{ "base64_audio": "..." }` (no `data` envelope), but we also tolerate an
 * envelope and a few legacy field names as a safety net.
 */
function extractAudio(response: unknown): { audioData?: string } {
  const data = (response as Record<string, unknown> | undefined)?.data ?? response;
  const obj = (data ?? {}) as Record<string, unknown>;

  for (const key of ["base64_audio", "audio_data", "audio", "base64"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return { audioData: v };
  }

  return {};
}

export async function ttsCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const text = flags.text as string;
  const voice = (flags.voice as string | undefined) ?? "";
  const language = (flags.language as string) || "en";
  const provider = (flags.provider as string) || "telnyx";
  const outputTypeFlag = (flags["output-type"] as string) || "base64";
  const textType = (flags["text-type"] as string) || "text";
  const disableCache = flags["disable-cache"] === true;

  if (!text) {
    printError("--text is required (e.g., --text \"Hello world\")");
    process.exit(1);
  }

  if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
    printError(
      `Invalid --provider "${provider}". Valid: ${VALID_PROVIDERS.join(", ")}`,
    );
    process.exit(1);
  }

  const outputType = OUTPUT_TYPE_MAP[outputTypeFlag];
  if (!outputType) {
    printError(
      `Invalid --output-type "${outputTypeFlag}". Valid: base64 (binary_output is not supported by this wrapper — it returns raw audio bytes)`,
    );
    process.exit(1);
  }

  if (!VALID_TEXT_TYPES.includes(textType as (typeof VALID_TEXT_TYPES)[number])) {
    printError(
      `Invalid --text-type "${textType}". Valid: ${VALID_TEXT_TYPES.join(", ")}`,
    );
    process.exit(1);
  }

  try {
    if (!jsonOutput) {
      console.log("\n🔊 Generating speech...\n");
    }

    const args = ["text-to-speech", "generate-speech", "--text", text];
    if (voice) args.push("--voice", voice);
    args.push("--language", language);
    args.push("--provider", provider);
    args.push("--output-type", outputType);
    args.push("--text-type", textType);
    if (disableCache) args.push("--disable-cache");

    const response = await telnyxCli(args);
    const { audioData } = extractAudio(response);
    const hasAudioData = !!audioData;

    const result: TtsResult = {
      text,
      voice,
      provider,
      output_type: outputType,
      audio_data: audioData,
      has_audio_data: hasAudioData,
    };

    if (jsonOutput) {
      outputJson(result);
    } else {
      const details: Record<string, string | number | boolean> = {
        Provider: provider,
        "Output Type": outputType,
        "Text Type": textType,
        Language: language,
      };
      if (voice) details["Voice"] = voice;
      if (hasAudioData) {
        details["Audio Data"] = `${audioData!.length} chars (base64)`;
      }
      printSuccess("Speech generated!", details);
    }
  } catch (err) {
    const msg = errorMsg(err);
    if (jsonOutput) {
      outputJson({ error: msg });
    } else {
      printError(msg);
    }
    process.exit(1);
  }
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
