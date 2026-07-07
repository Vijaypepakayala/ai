/**
 * telnyx-agent tts-retrieve — Retrieve a previously generated speech record.
 *
 * Shells out to the telnyx CLI's `text-to-speech retrieve-speech` subcommand and
 * surfaces the stored speech data (matched by socket ID) in either
 * human-readable or JSON form.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printSuccess, printError, outputJson } from "../utils/output.ts";

interface TtsSpeechResult {
  id: string;
  status?: string;
  text?: string;
  voice?: string;
  provider?: string;
  audio_url?: string;
  has_audio_data: boolean;
  [key: string]: unknown;
}

/**
 * Extract the speech record (and any embedded audio URL/data) from a telnyx CLI
 * text-to-speech retrieve-speech response. The CLI wraps the API payload in a
 * `data` envelope, but different providers surface audio differently, so we
 * check a few common field names.
 */
function extractSpeech(response: unknown): { speech?: Record<string, unknown>; audioUrl?: string; audioData?: string } {
  const data = (response as Record<string, unknown> | undefined)?.data ?? response;
  if (!data || typeof data !== "object") return {};
  const obj = data as Record<string, unknown>;

  // URL-shaped fields
  for (const key of ["audio_url", "url", "audioUrl"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return { speech: obj, audioUrl: v };
  }

  // Base64-shaped fields
  for (const key of ["data", "audio_data", "audio", "base64"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return { speech: obj, audioData: v };
  }

  return { speech: obj };
}

export async function ttsRetrieveCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const socketId = flags["socket-id"] as string | undefined;

  if (!socketId) {
    printError("--socket-id is required (e.g., --socket-id <socket_id>)");
    process.exit(1);
  }

  try {
    if (!jsonOutput) {
      console.log("\n🔊 Retrieving speech record...\n");
    }

    const args = ["text-to-speech", "retrieve-speech", "--socket-id", socketId];
    const response = await telnyxCli(args);
    const { speech, audioUrl, audioData } = extractSpeech(response);
    const hasAudioData = !!audioData;

    const result: TtsSpeechResult = {
      id: socketId,
      status: typeof speech?.status === "string" ? (speech.status as string) : undefined,
      text: typeof speech?.text === "string" ? (speech.text as string) : undefined,
      voice: typeof speech?.voice === "string" ? (speech.voice as string) : undefined,
      provider: typeof speech?.provider === "string" ? (speech.provider as string) : undefined,
      audio_url: audioUrl,
      has_audio_data: hasAudioData,
    };

    if (jsonOutput) {
      outputJson(result);
    } else {
      const details: Record<string, string | number | boolean> = {
        "Socket ID": socketId,
      };
      if (result.status) details["Status"] = result.status;
      if (result.provider) details["Provider"] = result.provider;
      if (result.voice) details["Voice"] = result.voice;
      if (result.text) details["Text"] = result.text;
      if (audioUrl) {
        details["Audio URL"] = audioUrl;
      } else if (hasAudioData) {
        details["Audio Data"] = `${audioData!.length} bytes (base64)`;
      }
      printSuccess("Speech record retrieved!", details);
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
