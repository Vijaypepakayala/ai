/**
 * telnyx-agent ai-chat — OpenAI-compatible chat completion.
 *
 * Wraps the current Go CLI command `ai:openai:chat create-completion`.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { outputJson, printError, printSuccess } from "../utils/output.ts";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
}

function parseMessages(raw: string): ChatMessage[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--messages must be a JSON array of {role, content} objects");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("--messages must be a non-empty JSON array of {role, content} objects");
  }
  for (const message of value) {
    if (!message || typeof message !== "object") {
      throw new Error("each --messages item must be an object");
    }
    const role = (message as Record<string, unknown>).role;
    if (!["system", "user", "assistant", "tool"].includes(String(role))) {
      throw new Error("each --messages item must have role system, user, assistant, or tool");
    }
    if (!("content" in message)) {
      throw new Error("each --messages item must include content");
    }
  }
  return value as ChatMessage[];
}

function unwrap(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") return {};
  const object = response as Record<string, unknown>;
  const data = object.data;
  return data && !Array.isArray(data) && typeof data === "object"
    ? (data as Record<string, unknown>)
    : object;
}

function firstChoice(data: Record<string, unknown>): Record<string, unknown> {
  const choices = data.choices;
  return Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
    ? (choices[0] as Record<string, unknown>)
    : {};
}

function choiceContent(choice: Record<string, unknown>): string {
  const message = choice.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : content == null ? "" : JSON.stringify(content);
}

export async function aiChatCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const prompt = flags.message as string | undefined;
  const rawMessages = flags.messages as string | undefined;
  const system = flags.system as string | undefined;

  let messages: ChatMessage[];
  try {
    if (rawMessages) {
      messages = parseMessages(rawMessages);
    } else if (prompt) {
      messages = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });
    } else {
      throw new Error("--message or --messages is required");
    }
  } catch (err) {
    fail(errorMsg(err), jsonOutput);
  }

  try {
    if (!jsonOutput) console.log("\n🤖 Generating chat completion...\n");

    const args = ["ai:openai:chat", "create-completion"];
    for (const message of messages!) args.push("--message", JSON.stringify(message));

    // These names and value types mirror the current generated Go CLI schema.
    const valueFlags = [
      "api-key-ref",
      "best-of",
      "frequency-penalty",
      "guided-json",
      "guided-regex",
      "length-penalty",
      "max-tokens",
      "min-p",
      "model",
      "n",
      "presence-penalty",
      "response-format",
      "seed",
      "stop",
      "temperature",
      "tool-choice",
      "top-logprobs",
      "top-p",
    ];
    for (const flag of valueFlags) {
      const value = flags[flag];
      if (value !== undefined) args.push(`--${flag}`, String(value));
    }
    for (const flag of ["early-stopping", "enable-thinking", "logprobs", "use-beam-search"]) {
      const value = flags[flag];
      if (value !== undefined) args.push(`--${flag}`, String(value));
    }

    const response = await telnyxCli(args);
    const data = unwrap(response);
    const choice = firstChoice(data);
    const content = choiceContent(choice);

    if (jsonOutput) {
      outputJson({ ...data, content });
    } else {
      printSuccess("Chat completion generated", {
        Model: String(data.model ?? flags.model ?? "(API default)"),
        "Finish Reason": String(choice.finish_reason ?? "unknown"),
        Content: content || "(no text content returned)",
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
