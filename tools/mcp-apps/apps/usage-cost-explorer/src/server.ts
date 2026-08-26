import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { createBillingService, DEFAULT_AUTO_RECHARGE_POLICY, DEFAULT_MAX_PAGE_SIZE } from "./service.js";
import { TelnyxBillingClient, sanitizeBillingValue, sanitizeError } from "./telnyxClient.js";
import type { BillingService } from "./service.js";
import { AUTO_RECHARGE_SETUP_UI_HTML, STORED_PAYMENT_TOP_UP_UI_HTML, USAGE_COST_EXPLORER_UI_HTML } from "./ui.js";

const UI_RESOURCE_URI = "ui://usage-cost-explorer/index.html";
const AUTO_RECHARGE_RESOURCE_URI = "ui://usage-cost-explorer/auto-recharge.html";
const STORED_PAYMENT_RESOURCE_URI = "ui://usage-cost-explorer/stored-payment-top-up.html";
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const SIDE_EFFECT_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const pagingSchema = {
  page_number: z.number().int().positive().optional().describe("1-based page number. Defaults to 1."),
  page_size: z.number().int().positive().optional().describe(`Page size. Defaults conservatively and is capped at ${DEFAULT_MAX_PAGE_SIZE}.`)
};

const autoRechargeAmountPattern = /^(?:\d+|\d+\.\d+|\.\d+)$/;
const nonBlankStringSchema = z.string().trim().min(1);
const amountSchema = z.union([
  nonBlankStringSchema.regex(autoRechargeAmountPattern, "Auto-recharge amounts must be non-negative numeric strings or numbers."),
  z.number().finite().nonnegative()
]);
const autoRechargePatchSchema = {
  threshold_amount: amountSchema.optional().describe("Auto-recharge threshold amount. Guarded by app cap."),
  recharge_amount: amountSchema.optional().describe("Auto-recharge amount. Guarded by app cap."),
  enabled: z.boolean().optional().describe("Whether auto recharge is enabled."),
  invoice_enabled: z.boolean().optional().describe("Whether invoice-backed preference is enabled."),
  preference: z.enum(["credit_paypal", "ach"]).optional().describe("Telnyx auto-recharge preference value.")
};
const storedPaymentSchema = {
  amount: z.string().trim().regex(/^\d+\.\d{2}$/, 'Amount must include dollars and cents, for example "25.00".')
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telnyx-usage-cost-explorer",
    version: "0.1.0"
  });

  registerReadTool(
    server,
    "billing_overview",
    "Open billing dashboard",
    "Open a single Telnyx billing dashboard with current balance, usage controls, billing groups, and guarded auto-recharge settings.",
    {},
    async (service) => {
      const [balance, auto_recharge, billing_groups, usage_options] = await Promise.all([
        safeDashboardRead("balance", () => service.getBalance()),
        safeDashboardRead("auto_recharge", () => service.getAutoRechargePreferences()),
        safeDashboardRead("billing_groups", () => service.listBillingGroups({ pageNumber: 1, pageSize: 100 })),
        safeDashboardRead("usage_options", () => service.usageReportOptions())
      ]);
      return {
        balance: balance.data,
        auto_recharge: auto_recharge.data,
        billing_groups: billing_groups.data,
        usage_options: usage_options.data,
        warnings: [balance, auto_recharge, billing_groups, usage_options].flatMap((result) => result.warning ? [result.warning] : [])
      };
    },
    READ_ONLY_ANNOTATIONS,
    UI_RESOURCE_URI
  );

  registerReadTool(
    server,
    "billing_auto_recharge_setup",
    "Set up auto recharge",
    "Open a focused app for enabling auto recharge with threshold, recharge amount, and preference so low-credit users can unblock service without direct MCP payments.",
    {},
    async (service) => {
      const [balance, auto_recharge] = await Promise.all([
        safeDashboardRead("balance", () => service.getBalance()),
        safeDashboardRead("auto_recharge", () => service.getAutoRechargePreferences())
      ]);
      return {
        balance: balance.data,
        auto_recharge: auto_recharge.data,
        warnings: [balance, auto_recharge].flatMap((result) => result.warning ? [result.warning] : [])
      };
    },
    READ_ONLY_ANNOTATIONS,
    AUTO_RECHARGE_RESOURCE_URI
  );

  registerReadTool(
    server,
    "billing_stored_payment_top_up",
    "Top up with stored payment",
    "Open a focused app for charging a saved portal payment method through a guarded stored-payment transaction.",
    {},
    async (service) => ({ balance: await service.getBalance() }),
    READ_ONLY_ANNOTATIONS,
    STORED_PAYMENT_RESOURCE_URI
  );

  registerReadTool(server, "billing_get_balance", "Get account balance", "Read account balance details from GET /balance.", {}, async (service) =>
    service.getBalance()
  );

  registerReadTool(
    server,
    "billing_get_auto_recharge_preferences",
    "Get auto-recharge preferences",
    "Read auto-recharge preferences from GET /payment/auto_recharge_prefs. This does not mutate billing settings.",
    {},
    async (service) => service.getAutoRechargePreferences()
  );

  registerReadTool(
    server,
    "billing_list_billing_groups",
    "List billing groups",
    "List billing groups from GET /billing_groups. Billing group IDs are preserved for follow-up calls.",
    pagingSchema,
    async (service, input) => service.listBillingGroups({ pageNumber: input.page_number, pageSize: input.page_size })
  );

  registerReadTool(
    server,
    "billing_get_billing_group",
    "Get billing group",
    "Fetch one billing group by ID from GET /billing_groups/{id}.",
    { id: z.string().min(1).describe("Billing group ID, e.g. bg_...") },
    async (service, input) => service.getBillingGroup(input.id)
  );

  registerReadTool(
    server,
    "billing_usage_report_options",
    "Discover Usage Reports options (beta)",
    "Discover available products, dimensions, and metrics from GET /usage_reports/options. Usage Reports is beta.",
    { product: z.string().min(1).optional().describe("Optional product to narrow option discovery.") },
    async (service, input) => service.usageReportOptions({ product: input.product })
  );

  registerReadTool(
    server,
    "billing_query_usage",
    "Query Usage Reports (beta)",
    "Query the Telnyx Usage Reports beta endpoint. Requires one product plus dimensions[] and metrics[]. Defaults format=json, managed_accounts=false, caps page size, and limits explicit start/end ranges to 31 days.",
    {
      product: z.string().min(1).describe("Usage Reports beta product."),
      dimensions: z.array(z.string().min(1)).min(1).describe("Required Usage Reports dimensions."),
      metrics: z.array(z.string().min(1)).min(1).describe("Required Usage Reports metrics."),
      start_date: z.string().min(1).optional().describe("Optional YYYY-MM-DD start date; use with end_date, max 31 days."),
      end_date: z.string().min(1).optional().describe("Optional YYYY-MM-DD end date; use with start_date, max 31 days."),
      date_range: z.string().min(1).optional().describe("Optional Telnyx date_range shortcut. Do not combine with explicit dates."),
      filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Optional Usage Reports filters."),
      sort: z.array(z.string().min(1)).optional().describe("Optional sort entries, e.g. -cost."),
      format: z.enum(["json", "csv"]).optional().describe("Response format; defaults to json."),
      managed_accounts: z.boolean().optional().describe("Defaults to false."),
      ...pagingSchema
    },
    async (service, input) => service.queryUsage(input)
  );

  registerReadTool(
    server,
    "billing_preview_auto_recharge_update",
    "Preview auto-recharge update",
    "Preview a financial side-effect update to PATCH /payment/auto_recharge_prefs. No mutation occurs; returns a diff and confirmation token.",
    autoRechargePatchSchema,
    async (service, input) => service.previewAutoRechargeUpdate(input)
  );

  registerReadTool(
    server,
    "billing_update_auto_recharge_preferences",
    "Confirm auto-recharge update",
    "Guarded financial side-effect: validates the confirmation token from billing_preview_auto_recharge_update, enforces conservative app caps, refetches current preferences, then PATCHes.",
    {
      ...autoRechargePatchSchema,
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_auto_recharge_update for the same requested after-state.")
    },
    async (service, input) => service.updateAutoRechargePreferences(input),
    SIDE_EFFECT_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_preview_stored_payment_transaction",
    "Preview stored payment top-up",
    "Preview a financial side-effect transaction to POST /payment/stored_payment_transactions. No mutation occurs; returns a confirmation token.",
    storedPaymentSchema,
    async (service, input) => service.previewStoredPaymentTransaction(input)
  );

  registerReadTool(
    server,
    "billing_create_stored_payment_transaction",
    "Confirm stored payment top-up",
    "Guarded financial side-effect: validates the confirmation token from billing_preview_stored_payment_transaction, then POSTs /payment/stored_payment_transactions using the saved payment method on the account.",
    {
      ...storedPaymentSchema,
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_stored_payment_transaction for the same amount.")
    },
    async (service, input) => service.createStoredPaymentTransaction(input),
    SIDE_EFFECT_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_preview_billing_group_update",
    "Preview billing group update",
    "Preview a billing group rename from PATCH /billing_groups/{id}. No mutation occurs; returns a diff and confirmation token.",
    {
      id: z.string().min(1).describe("Billing group ID."),
      name: z.string().min(1).describe("New billing group name.")
    },
    async (service, input) => service.previewBillingGroupUpdate(input)
  );

  registerReadTool(
    server,
    "billing_update_billing_group",
    "Confirm billing group update",
    "Guarded billing group update: validates the token from billing_preview_billing_group_update, refetches current group, then PATCHes /billing_groups/{id}.",
    {
      id: z.string().min(1).describe("Billing group ID."),
      name: z.string().min(1).describe("New billing group name."),
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_billing_group_update.")
    },
    async (service, input) => service.updateBillingGroup(input),
    SIDE_EFFECT_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_create_billing_group",
    "Create billing group",
    "Create a billing group with POST /billing_groups. Requires confirm=true and a non-empty name. This app does not expose direct payments or payment-method management.",
    {
      name: z.string().min(1).describe("New billing group name."),
      confirm: z.boolean().describe("Must be true to create the billing group.")
    },
    async (service, input) => service.createBillingGroup(input),
    SIDE_EFFECT_ANNOTATIONS
  );

  registerAppResource(
    server,
    "Billing Dashboard UI",
    UI_RESOURCE_URI,
    {
      description:
        "Interactive billing dashboard for balance, usage, billing groups, and guarded auto-recharge settings."
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: USAGE_COST_EXPLORER_UI_HTML
        }
      ]
    })
  );

  registerAppResource(
    server,
    "Auto Recharge Setup UI",
    AUTO_RECHARGE_RESOURCE_URI,
    {
      description: "Focused auto-recharge setup UI for unblocking low-credit Telnyx accounts without direct MCP payments."
    },
    async () => ({
      contents: [
        {
          uri: AUTO_RECHARGE_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: AUTO_RECHARGE_SETUP_UI_HTML
        }
      ]
    })
  );

  registerAppResource(
    server,
    "Stored Payment Top Up UI",
    STORED_PAYMENT_RESOURCE_URI,
    {
      description: "Focused stored-payment top-up UI for charging a saved portal payment method after explicit confirmation."
    },
    async () => ({
      contents: [
        {
          uri: STORED_PAYMENT_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: STORED_PAYMENT_TOP_UP_UI_HTML
        }
      ]
    })
  );

  return server;
}

type ToolShape = Record<string, z.ZodTypeAny>;
type ToolInput<T extends ToolShape> = { [K in keyof T]: z.infer<T[K]> };

function registerReadTool<T extends ToolShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: T,
  run: (service: BillingService, input: ToolInput<T>) => Promise<unknown>,
  annotations: Record<string, boolean> = READ_ONLY_ANNOTATIONS,
  uiResourceUri?: string
): void {
  // The ext-apps wrapper preserves MCP SDK callback typing, but this small
  // helper needs to accept many different zod input shapes. Keep the public
  // schema strongly typed at call sites and narrow the implementation boundary
  // here rather than duplicating the same live-service/error boilerplate for
  // every billing tool.
  (registerAppTool as unknown as (...args: unknown[]) => void)(
    server,
    name,
    {
      title,
      description,
      inputSchema,
      annotations,
      _meta: { ui: uiResourceUri ? { resourceUri: uiResourceUri } : { visibility: ["app"] } }
    },
    async (input: ToolInput<T>, extra: AuthBearingExtra) => {
      const service = createLiveService(extra);
      if (!service) return missingApiKeyResult();
      try {
        const result = await run(service, input);
        return toolResult(result);
      } catch (error) {
        return safeToolError(error);
      }
    }
  );
}

async function safeDashboardRead(name: string, read: () => Promise<unknown>): Promise<{ data?: unknown; warning?: { source: string; message: string } }> {
  try {
    return { data: await read() };
  } catch (error) {
    return { warning: { source: name, message: sanitizeError(error).message } };
  }
}

type AuthBearingExtra = { authInfo?: { token?: string } };

function createLiveService(extra?: AuthBearingExtra): BillingService | undefined {
  const apiKey = extra?.authInfo?.token ?? process.env.TELNYX_API_KEY;
  if (!apiKey) return undefined;
  const client = new TelnyxBillingClient({
    apiKey,
    baseUrl: process.env.TELNYX_API_BASE_URL
  });
  return createBillingService(client, {
    autoRechargePolicy: {
      maxThresholdAmount: envNumber("USAGE_COST_EXPLORER_MAX_AUTO_RECHARGE_THRESHOLD", DEFAULT_AUTO_RECHARGE_POLICY.maxThresholdAmount),
      maxRechargeAmount: envNumber("USAGE_COST_EXPLORER_MAX_AUTO_RECHARGE_AMOUNT", DEFAULT_AUTO_RECHARGE_POLICY.maxRechargeAmount),
      version: DEFAULT_AUTO_RECHARGE_POLICY.version
    },
    maxStoredPaymentAmount: envNumber("USAGE_COST_EXPLORER_MAX_STORED_PAYMENT_AMOUNT", 5000)
  });
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toolResult(result: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const structuredContent = asStructuredContent(sanitizeBillingValue(result));
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}

function asStructuredContent(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  return { result };
}

function missingApiKeyResult(): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: "TELNYX_API_KEY is not set. Provide a Telnyx API key with least-privilege billing/usage access to run live Usage & Billing Explorer tools."
      }
    ]
  };
}

function safeToolError(error: unknown): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return {
    isError: true,
    content: [{ type: "text", text: sanitizeError(error).message }]
  };
}

async function main(): Promise<void> {
  await import("dotenv/config");
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
