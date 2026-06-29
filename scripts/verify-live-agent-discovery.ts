export interface DiscoveryProbe {
  name: string;
  method: string;
  url: string;
  ok: boolean;
  status: number;
  details: string;
  headers?: Record<string, string>;
  bodyExcerpt?: string;
}

export interface DiscoveryVerificationReport {
  timestamp: string;
  probes: DiscoveryProbe[];
}

const JSONRPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const LIVE_WEBHOOKS_URL = "https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks";
const AGENT_USER_AGENT = "OpenAI-Agent/1.0 (+https://openai.com)";
const BOT_CHALLENGE_MARKERS = [
  "Just a moment...",
  "Attention Required!",
  "cf-browser-verification",
  "captcha",
  "verify you are human"
];

export function checkAuthMd(body: string, status: number): DiscoveryProbe {
  const urls = [
    "https://telnyx.com/.well-known/agent-access.json",
    "https://api.telnyx.com/.well-known/oauth-protected-resource",
    "https://api.telnyx.com/v2/mcp"
  ];
  const missing = urls.filter((url) => !body.includes(url));

  return {
    name: "auth.md",
    method: "GET",
    url: "https://telnyx.com/auth.md",
    ok: status === 200 && missing.length === 0,
    status,
    details: missing.length === 0 ? "auth.md referenced onboarding and protected-resource URLs" : `auth.md missing: ${missing.join(", ")}`,
    bodyExcerpt: body.slice(0, 240)
  };
}

export function checkAgentTextSurface(
  name: string,
  url: string,
  status: number,
  contentType: string | null,
  body: string,
  requiredSnippets: string[]
): DiscoveryProbe {
  const missing = requiredSnippets.filter((snippet) => !body.includes(snippet));
  const challengeMarker = BOT_CHALLENGE_MARKERS.find((marker) => body.includes(marker));

  return {
    name,
    method: "GET",
    url,
    ok: status === 200 && missing.length === 0 && challengeMarker === undefined && body.trim().length > 200,
    status,
    details: challengeMarker !== undefined
      ? `surface returned bot challenge marker: ${challengeMarker}`
      : missing.length === 0
        ? `surface was readable to ${AGENT_USER_AGENT} as ${contentType ?? "<unknown>"} without JavaScript`
        : `surface missing: ${missing.join(", ")}`,
    headers: contentType ? { "content-type": contentType } : undefined,
    bodyExcerpt: body.slice(0, 240)
  };
}

export function checkCorsReadAccess(
  name: string,
  url: string,
  status: number,
  allowOrigin: string | null,
  allowMethods: string | null
): DiscoveryProbe {
  const methods = (allowMethods ?? "").toUpperCase();

  return {
    name,
    method: "GET",
    url,
    ok: status === 200 && allowOrigin === "*" && methods.includes("GET") && methods.includes("OPTIONS"),
    status,
    details: status === 200 && allowOrigin === "*" && methods.includes("GET") && methods.includes("OPTIONS")
      ? "public read surface allowed cross-origin GET and OPTIONS"
      : `received Access-Control-Allow-Origin=${allowOrigin ?? "<missing>"} Access-Control-Allow-Methods=${allowMethods ?? "<missing>"}`,
    headers: {
      "access-control-allow-origin": allowOrigin ?? "<missing>",
      "access-control-allow-methods": allowMethods ?? "<missing>"
    }
  };
}

export function checkJsonDocument(name: string, method: string, url: string, status: number, body: unknown, predicate: (body: Record<string, unknown>) => boolean, success: string, failure: string): DiscoveryProbe {
  const record = asRecord(body);
  return {
    name,
    method,
    url,
    ok: status === 200 && predicate(record),
    status,
    details: status === 200 && predicate(record) ? success : failure,
    bodyExcerpt: JSON.stringify(record).slice(0, 240)
  };
}

function hasExpectedAgentAuth(body: Record<string, unknown>): boolean {
  const agentAuth = maybeRecord(body.agent_auth);
  const anonymous = maybeRecord(agentAuth?.anonymous);
  return agentAuth !== null
    && String(agentAuth.skill) === "https://telnyx.com/auth.md"
    && String(agentAuth.register_uri) === "https://api.telnyx.com/v2/bot_signup"
    && String(agentAuth.claim_uri) === "https://api.telnyx.com/v2/bot_signup/resend_magic_link"
    && String(agentAuth.challenge_uri) === "https://api.telnyx.com/v2/bot_challenge"
    && String(agentAuth.agent_access_uri) === "https://telnyx.com/.well-known/agent-access.json"
    && String(agentAuth.signup_guide_uri) === "https://telnyx.com/agent-signup.md"
    && hasExactStringArray(agentAuth.identity_types_supported, ["anonymous"])
    && hasExactStringArray(agentAuth.credential_types_supported, ["api_key"])
    && anonymous !== null
    && hasExactStringArray(anonymous.credential_types_supported, ["api_key"])
    && hasExactStringArray(anonymous.verification_methods_supported, ["email_magic_link"])
    && String(anonymous.required_preflight_uri) === "https://api.telnyx.com/v2/bot_challenge"
    && hasExactStringArray(agentAuth.events_supported, []);
}

export function checkWwwAuthenticate(status: number, header: string | null): DiscoveryProbe {
  const expected = 'Bearer resource_metadata="https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp"';
  return {
    name: "unauthenticated protected MCP bearer challenge",
    method: "POST",
    url: "https://api.telnyx.com/v2/mcp (JSON-RPC method: tools/call)",
    ok: status === 401 && header === expected,
    status,
    details: header === expected ? `challenge matched ${expected}` : `received ${header ?? "<missing>"}`,
    headers: header ? { "www-authenticate": header } : undefined
  };
}

export function checkRobotsForAgents(status: number, body: string): DiscoveryProbe {
  const requiredSnippets = [
    "User-agent: ChatGPT-User",
    "User-agent: Claude-User",
    "User-agent: ora-agent",
    "Allow: /.well-known/",
    "Allow: /ai/",
    "Disallow: /ai/evaluate"
  ];
  const missing = requiredSnippets.filter((snippet) => !body.includes(snippet));

  return {
    name: "robots.txt agent-user-agent allowlist",
    method: "GET",
    url: "https://telnyx.com/robots.txt",
    ok: status === 200 && missing.length === 0,
    status,
    details: missing.length === 0
      ? "robots.txt explicitly allowed major agent user-agents to read the public discovery surfaces"
      : `robots.txt missing: ${missing.join(", ")}`,
    bodyExcerpt: body.slice(0, 240)
  };
}

export function checkWebhookDiscoverability(status: number, body: string): DiscoveryProbe {
  const requiredSnippets = ["Telnyx webhooks", LIVE_WEBHOOKS_URL];
  const missing = requiredSnippets.filter((snippet) => !body.includes(snippet));

  return {
    name: "root llms.txt webhook discoverability",
    method: "GET",
    url: "https://telnyx.com/llms.txt",
    ok: status === 200 && missing.length === 0,
    status,
    details: missing.length === 0
      ? "llms.txt linked the live Telnyx webhooks guide with explicit webhook wording"
      : `llms.txt missing: ${missing.join(", ")}`,
    bodyExcerpt: body.slice(0, 240)
  };
}

export function checkWebhookGuideUrl(status: number, url: string): DiscoveryProbe {
  return {
    name: "live Telnyx webhooks guide",
    method: "GET",
    url,
    ok: status === 200,
    status,
    details: status === 200
      ? "webhook guide resolved successfully"
      : `expected 200 from live webhook guide but received ${status}`
  };
}

export async function verifyLiveAgentDiscovery(): Promise<DiscoveryVerificationReport> {
  const probes: DiscoveryProbe[] = [];

  const robotsResponse = await fetchDocument("https://telnyx.com/robots.txt");
  probes.push(checkRobotsForAgents(robotsResponse.status, robotsResponse.body));

  const agentsStart = await fetchDocument("https://telnyx.com/agents/start");
  probes.push(checkAgentTextSurface(
    "agent fast path discoverability",
    "https://telnyx.com/agents/start",
    agentsStart.status,
    agentsStart.contentType,
    agentsStart.body,
    [
      "https://telnyx.com/.well-known/agent-access.json",
      "https://api.telnyx.com/v2/mcp",
      "https://telnyx.com/.well-known/openapi.json",
      LIVE_WEBHOOKS_URL
    ]
  ));
  probes.push(checkCorsReadAccess(
    "agent fast path CORS",
    "https://telnyx.com/agents/start",
    agentsStart.status,
    agentsStart.headers.get("access-control-allow-origin"),
    agentsStart.headers.get("access-control-allow-methods")
  ));

  const llmsTxtResponse = await fetchDocument("https://telnyx.com/llms.txt");
  probes.push(checkWebhookDiscoverability(llmsTxtResponse.status, llmsTxtResponse.body));
  probes.push(checkAgentTextSurface(
    "llms.txt text accessibility",
    "https://telnyx.com/llms.txt",
    llmsTxtResponse.status,
    llmsTxtResponse.contentType,
    llmsTxtResponse.body,
    [
      "https://telnyx.com/agents/start",
      "https://telnyx.com/agent-signup.md",
      "https://api.telnyx.com/v2/mcp"
    ]
  ));

  const webhookGuide = await fetch(LIVE_WEBHOOKS_URL, {
    headers: {
      Accept: "text/html, text/plain;q=0.9, application/json;q=0.8",
      "User-Agent": AGENT_USER_AGENT
    }
  });
  probes.push(checkWebhookGuideUrl(webhookGuide.status, LIVE_WEBHOOKS_URL));

  const authMdResponse = await fetchDocument("https://telnyx.com/auth.md");
  probes.push(checkAuthMd(authMdResponse.body, authMdResponse.status));
  probes.push(checkAgentTextSurface(
    "auth.md text accessibility",
    "https://telnyx.com/auth.md",
    authMdResponse.status,
    authMdResponse.contentType,
    authMdResponse.body,
    [
      "https://telnyx.com/.well-known/agent-access.json",
      "https://api.telnyx.com/.well-known/oauth-protected-resource",
      "https://api.telnyx.com/v2/mcp"
    ]
  ));
  probes.push(checkCorsReadAccess(
    "auth.md CORS",
    "https://telnyx.com/auth.md",
    authMdResponse.status,
    authMdResponse.headers.get("access-control-allow-origin"),
    authMdResponse.headers.get("access-control-allow-methods")
  ));

  const agentAccess = await fetchJson("https://telnyx.com/.well-known/agent-access.json");
  probes.push(checkJsonDocument(
    "agent access manifest",
    "GET",
    "https://telnyx.com/.well-known/agent-access.json",
    agentAccess.status,
    agentAccess.body,
    (body) => {
      const provider = maybeRecord(body.provider);
      return String(provider?.name) === "Telnyx" && JSON.stringify(body).includes("agent-signup.md");
    },
    "agent-access manifest resolved and linked the signup flow",
    "agent-access manifest was missing the provider marker or signup flow"
  ));

  const mcpDiscovery = await fetchJson("https://telnyx.com/.well-known/mcp");
  probes.push(checkJsonDocument(
    "MCP discovery",
    "GET",
    "https://telnyx.com/.well-known/mcp",
    mcpDiscovery.status,
    mcpDiscovery.body,
    (body) => Array.isArray(body.servers) && String(asRecord((body.servers as unknown[])[0]).endpoint) === "https://api.telnyx.com/v2/mcp",
    "MCP discovery advertised the Telnyx streamable-http endpoint",
    "MCP discovery did not advertise the expected endpoint"
  ));

  const authServer = await fetchJson("https://api.telnyx.com/.well-known/oauth-authorization-server");
  probes.push(checkJsonDocument(
    "OAuth authorization server",
    "GET",
    "https://api.telnyx.com/.well-known/oauth-authorization-server",
    authServer.status,
    authServer.body,
    (body) => String(body.issuer) === "https://api.telnyx.com" && Array.isArray(body.protected_resources) && hasExpectedAgentAuth(body),
    "authorization-server metadata included issuer, protected resources, and the expected agent_auth block",
    "authorization-server metadata was missing issuer, protected resources, or the expected agent_auth block"
  ));

  const mcpProtectedResource = await fetchJson("https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp");
  probes.push(checkJsonDocument(
    "MCP protected resource",
    "GET",
    "https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp",
    mcpProtectedResource.status,
    mcpProtectedResource.body,
    (body) => String(body.resource) === "https://api.telnyx.com/v2/mcp" && hasExpectedAgentAuth(body),
    "protected-resource metadata matched the MCP endpoint and exposed agent_auth discovery",
    "protected-resource metadata did not match the MCP endpoint or was missing agent_auth discovery"
  ));

  const unauthenticatedMcp = await fetch("https://api.telnyx.com/v2/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      "User-Agent": AGENT_USER_AGENT
    },
    body: JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      id: 1,
      method: "tools/call",
      params: {
        name: "list_api_endpoints",
        arguments: {}
      }
    })
  });
  probes.push(checkWwwAuthenticate(unauthenticatedMcp.status, unauthenticatedMcp.headers.get("www-authenticate")));

  return {
    timestamp: new Date().toISOString(),
    probes
  };
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": AGENT_USER_AGENT
    }
  });
  return {
    status: response.status,
    body: JSON.parse(await response.text())
  };
}

async function fetchDocument(url: string): Promise<{ status: number; body: string; contentType: string | null; headers: Headers }> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/markdown, text/plain;q=0.9, text/html;q=0.8, application/json;q=0.7",
      "User-Agent": AGENT_USER_AGENT
    }
  });

  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type"),
    headers: response.headers
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected object but received ${typeof value}`);
  }
  return value;
}

function maybeRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value;
}

function hasExactStringArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => typeof entry === "string" && entry === expected[index]);
}

async function main(): Promise<void> {
  const report = await verifyLiveAgentDiscovery();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.probes.every((probe) => probe.ok) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
