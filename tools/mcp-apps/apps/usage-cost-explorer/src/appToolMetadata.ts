import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  Transport,
  TransportSendOptions
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  isJSONRPCResponse,
  type JSONRPCMessage,
  type MessageExtraInfo
} from "@modelcontextprotocol/sdk/types.js";

const APP_TOOL_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: ["admin"] }
] as const;
const APP_TOOL_VISIBILITY = ["app"] as const;

/**
 * MCP SDK 1.30 does not yet serialize the top-level securitySchemes extension.
 * Decorate tools/list on the hosted transport boundary so the connector emits
 * its OAuth contract and compatibility metadata mirror without mislabeling stdio.
 */
export class AppMcpServer extends McpServer {
  constructor(
    serverInfo: ConstructorParameters<typeof McpServer>[0],
    options: ConstructorParameters<typeof McpServer>[1],
    private readonly exposeHostedOAuthMetadata = false
  ) {
    super(serverInfo, options);
  }

  override async connect(transport: Transport): Promise<void> {
    await super.connect(
      this.exposeHostedOAuthMetadata
        ? new AppToolMetadataTransport(transport)
        : transport
    );
  }
}

class AppToolMetadataTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(
    message: T,
    extra?: MessageExtraInfo
  ) => void;

  constructor(private readonly transport: Transport) {}

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose?.();
    this.transport.onerror = (error) => this.onerror?.(error);
    this.transport.onmessage = (message, extra) => {
      this.onmessage?.(message, extra);
    };
    await this.transport.start();
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions
  ): Promise<void> {
    const outgoing = isJSONRPCResponse(message)
      ? addAppToolMetadata(message)
      : message;
    await this.transport.send(outgoing, options);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }
}

function addAppToolMetadata(message: JSONRPCMessage): JSONRPCMessage {
  if (!isJSONRPCResponse(message)) return message;
  const result = message.result as Record<string, unknown>;
  if (!Array.isArray(result.tools)) return message;

  const tools = result.tools.map((tool) => {
    if (!tool || Array.isArray(tool) || typeof tool !== "object") return tool;
    const descriptor = tool as Record<string, unknown>;
    const metadata =
      descriptor._meta &&
      !Array.isArray(descriptor._meta) &&
      typeof descriptor._meta === "object"
        ? (descriptor._meta as Record<string, unknown>)
        : {};
    const ui =
      metadata.ui &&
      !Array.isArray(metadata.ui) &&
      typeof metadata.ui === "object"
        ? (metadata.ui as Record<string, unknown>)
        : {};
    const securitySchemes = APP_TOOL_SECURITY_SCHEMES.map((scheme) => ({
      type: scheme.type,
      scopes: [...scheme.scopes]
    }));

    return {
      ...descriptor,
      securitySchemes,
      _meta: {
        ...metadata,
        securitySchemes,
        ui: {
          ...ui,
          visibility: [...APP_TOOL_VISIBILITY]
        }
      }
    };
  });

  return {
    ...message,
    result: {
      ...result,
      tools
    }
  };
}
