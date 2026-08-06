import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  isJSONRPCResponse,
  type JSONRPCMessage
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { createServer as createNumberIntelligenceServer } from "../apps/number-intelligence/src/server.js";
import { createServer as createUsageCostServer } from "../apps/usage-cost-explorer/src/server.js";
import { createServer as createVoiceMonitorServer } from "../apps/voice-monitor/src/server.js";

const EXPECTED_UI_METADATA = {
  domain: "https://telnyx-developer-kit.telnyx.com",
  csp: {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: []
  }
};
const EXPECTED_TOOL_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: ["admin"] }
];
const REVIEWED_PUBLIC_APP_TOOLS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../submission/telnyx-developer-kit/app-tool-contract.json", import.meta.url)
    ),
    "utf8"
  )
) as {
  tools: Array<{
    name: string;
    title: string;
    description: string;
    annotations: Record<string, boolean>;
  }>;
};

const fixtures = [
  {
    name: "number intelligence",
    createServer: createNumberIntelligenceServer,
    toolCount: 2,
    resourceCount: 1,
    resourceBoundToolCount: 2
  },
  {
    name: "usage and cost",
    createServer: createUsageCostServer,
    toolCount: 17,
    resourceCount: 3,
    resourceBoundToolCount: 3
  },
  {
    name: "voice monitor",
    createServer: createVoiceMonitorServer,
    toolCount: 6,
    resourceCount: 1,
    resourceBoundToolCount: 1
  }
];

describe.each(fixtures)("$name MCP wire metadata", ({
  createServer,
  toolCount,
  resourceCount,
  resourceBoundToolCount
}) => {
  it("serializes auth, app visibility, output schemas, review annotations, UI origins, and CSP", async () => {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client(
      { name: "telnyx-mcp-apps-metadata-test", version: "1.0.0" },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      const wireMessages: JSONRPCMessage[] = [];
      const clientOnMessage = clientTransport.onmessage;
      clientTransport.onmessage = (message, extra) => {
        wireMessages.push(message);
        clientOnMessage?.(message, extra);
      };

      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(toolCount);
      for (const tool of tools.tools) {
        expect(tool.outputSchema).toMatchObject({ type: "object" });
        expectConstrainedOutputSchema(tool.outputSchema, tool.name);
        expect(tool.annotations).toMatchObject({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean)
        });
      }

      const wireTools = extractWireTools(wireMessages);
      expect(wireTools).toHaveLength(toolCount);
      const resourceBoundTools: Record<string, unknown>[] = [];
      for (const tool of wireTools) {
        expect(tool.securitySchemes).toEqual(EXPECTED_TOOL_SECURITY_SCHEMES);
        const metadata = asRecord(tool._meta);
        expect(metadata.securitySchemes).toEqual(tool.securitySchemes);
        const ui = asRecord(metadata.ui);
        expect(ui.visibility).toEqual(["app"]);
        if (typeof ui.resourceUri === "string") {
          resourceBoundTools.push(tool);
        }
      }
      expect(resourceBoundTools).toHaveLength(resourceBoundToolCount);
      expect(
        new Set(
          resourceBoundTools.map(
            (tool) => asRecord(asRecord(tool._meta).ui).resourceUri
          )
        ).size
      ).toBe(resourceCount);

      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(resourceCount);
      for (const resource of resources.resources) {
        const ui = (resource._meta as {
          ui?: {
            domain?: string;
            csp?: {
              connectDomains?: string[];
              resourceDomains?: string[];
              frameDomains?: string[];
            };
          };
        } | undefined)?.ui;
        expect(ui).toEqual(EXPECTED_UI_METADATA);

        const read = await client.readResource({ uri: resource.uri });
        expect(read.contents).toHaveLength(1);
        expect(read.contents[0]).toMatchObject({
          uri: resource.uri,
          mimeType: "text/html;profile=mcp-app"
        });
        expect(read.contents[0]?.text).toEqual(expect.any(String));
        const contentUi = (read.contents[0]?._meta as {
          ui?: {
            domain?: string;
            csp?: {
              connectDomains?: string[];
              resourceDomains?: string[];
              frameDomains?: string[];
            };
          };
        } | undefined)?.ui;
        expect(contentUi).toEqual(EXPECTED_UI_METADATA);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

it("keeps the two public app servers byte-for-byte aligned with the reviewed tool contract", async () => {
  const actualTools: Array<{
    name: string;
    title?: string;
    description?: string;
    annotations?: Record<string, boolean>;
  }> = [];

  for (const createServer of [
    createNumberIntelligenceServer,
    createVoiceMonitorServer
  ]) {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client(
      { name: "telnyx-reviewed-contract-test", version: "1.0.0" },
      { capabilities: {} }
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      actualTools.push(
        ...listed.tools.map(({ name, title, description, annotations }) => ({
          name,
          title,
          description,
          annotations
        }))
      );
    } finally {
      await client.close();
      await server.close();
    }
  }

  expect(actualTools).toEqual(REVIEWED_PUBLIC_APP_TOOLS.tools);
});

function extractWireTools(messages: JSONRPCMessage[]): Record<string, unknown>[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !isJSONRPCResponse(message)) continue;
    const result = asRecord(message.result);
    if (!Array.isArray(result.tools)) continue;
    return result.tools.map(asRecord);
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function expectConstrainedOutputSchema(schema: unknown, toolName: string, path = "$"): void {
  expect(schema, `${toolName} ${path} must be a JSON Schema object`).toBeTypeOf("object");
  expect(schema, `${toolName} ${path} must not be an unconstrained schema`).not.toEqual({});
  if (!schema || Array.isArray(schema) || typeof schema !== "object") return;

  const record = schema as Record<string, unknown>;
  if (record.type === "object") {
    const properties =
      record.properties && !Array.isArray(record.properties) && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : {};
    const additionalProperties = record.additionalProperties;
    const hasNamedProperties = Object.keys(properties).length > 0;
    const hasTypedAdditionalProperties =
      !!additionalProperties &&
      !Array.isArray(additionalProperties) &&
      typeof additionalProperties === "object" &&
      Object.keys(additionalProperties as Record<string, unknown>).length > 0;
    expect(
      hasNamedProperties || hasTypedAdditionalProperties,
      `${toolName} ${path} object schemas must not be wildcard-only`
    ).toBe(true);
    if (path === "$") {
      expect(
        hasNamedProperties,
        `${toolName} top-level output schemas must declare named properties`
      ).toBe(true);
      expect(
        additionalProperties,
        `${toolName} top-level output schemas must reject undeclared properties`
      ).toBe(false);
    } else if (!hasTypedAdditionalProperties) {
      expect(
        additionalProperties,
        `${toolName} ${path} object schemas must reject undeclared properties`
      ).toBe(false);
    }
  }
  if (record.type === "array") {
    expect(record.items, `${toolName} ${path} arrays must constrain their items`).toBeDefined();
  }

  for (const keyword of ["properties", "$defs", "definitions"]) {
    const children = record[keyword];
    if (!children || Array.isArray(children) || typeof children !== "object") continue;
    for (const [name, child] of Object.entries(children)) {
      expectConstrainedOutputSchema(child, toolName, `${path}.${keyword}.${name}`);
    }
  }
  for (const keyword of ["items", "additionalProperties", "not", "if", "then", "else"]) {
    const child = record[keyword];
    if (child && typeof child === "object") {
      expectConstrainedOutputSchema(child, toolName, `${path}.${keyword}`);
    }
  }
  for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const children = record[keyword];
    if (!Array.isArray(children)) continue;
    children.forEach((child, index) =>
      expectConstrainedOutputSchema(child, toolName, `${path}.${keyword}[${index}]`)
    );
  }
}
