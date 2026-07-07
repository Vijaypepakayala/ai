/**
 * telnyx-agent tts — Text-to-speech generation.
 *
 * Shells out to the telnyx CLI's `text-to-speech generate-speech` subcommand
 * and surfaces the resulting audio URL (or base64-encoded audio data) to the
 * caller in either human-readable or JSON form.
 *
 * Supported providers: telnyx, aws, azure, elevenlabs, minimax, resemble, rime
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printSuccess, printError, outputJson } from "../utils/output.ts";

const VALID_PROVIDERS = ["telnyx", "aws", "azure", "elevenlabs", "minimax", "resemble", "rime"] as const;
const VALID_OUTPUT_TYPES = ["url", "base64"] as const;
const VALID_TEXT_TYPES = ["text", "ssml"] as const;

interface TtsResult {
  text: string;
  voice: string;
  provider: string;
  output_type: string;
  audio_url?: string;
  has_audio_data: boolean;
}

/**
 * Extract the audio URL (or base64 data) from a telnyx CLI text-to-speech
 * response. The CLI wraps the API payload in a `data` envelope, but different
 * providers surface audio differently, so we check a few common field names.
 */
function extractAudio(response: unknown): { audioUrl?: string; audioData?: string } {
  const data = (response as Record<string, unknown> | undefined)?.data ?? response;
  const obj = (data ?? {}) as Record<string, unknown>;

  // URL-shaped fields
  for (const key of ["audio_url", "url", "audioUrl"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return { audioUrl: v };
  }

  // Base64-shaped fields
  for (const key of ["data", "audio_data", "audio", "base64"]) {
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
  const outputType = (flags["output-type"] as string) || "url";
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

  if (!VALID_OUTPUT_TYPES.includes(outputType as (typeof VALID_OUTPUT_TYPES)[number])) {
    printError(
      `Invalid --output-type "${outputType}". Valid: ${VALID_OUTPUT_TYPES.join(", ")}`,
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
    const { audioUrl, audioData } = extractAudio(response);
    const hasAudioData = !!audioData;

    const result: TtsResult = {
      text,
      voice,
      provider,
      output_type: outputType,
      audio_url: audioUrl,
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
      if (audioUrl) {
        details["Audio URL"] = audioUrl;
      } else if (hasAudioData) {
        details["Audio Data"] = `${audioData!.length} bytes (base64)`;
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
