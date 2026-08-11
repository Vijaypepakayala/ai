import { createHash } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { AppMcpServer } from "./appToolMetadata.js";
import { SingleUseConfirmationStore } from "./confirmationStore.js";
import { createBillingService, DEFAULT_AUTO_RECHARGE_POLICY, DEFAULT_MAX_PAGE_SIZE } from "./service.js";
import {
  TelnyxBillingClient,
  sanitizeBillingToolOutput,
  sanitizeBillingValue,
  sanitizeError
} from "./telnyxClient.js";
import type { BillingService } from "./service.js";
import { AUTO_RECHARGE_SETUP_UI_HTML, STORED_PAYMENT_TOP_UP_UI_HTML, USAGE_COST_EXPLORER_UI_HTML } from "./ui.js";

const UI_RESOURCE_URI = "ui://usage-cost-explorer/index.html";
const AUTO_RECHARGE_RESOURCE_URI = "ui://usage-cost-explorer/auto-recharge.html";
const STORED_PAYMENT_RESOURCE_URI = "ui://usage-cost-explorer/stored-payment-top-up.html";
const UI_RESOURCE_DOMAIN = "https://telnyx-developer-kit.telnyx.com";
const INTERNAL_HTTP_STATUS_META_KEY = "telnyx/internal-http-status";
const MAX_TOOL_RESULT_BYTES = 1024 * 1024;
const UI_RESOURCE_CSP = {
  connectDomains: [],
  resourceDomains: [],
  frameDomains: []
};
const UI_RESOURCE_META = {
  ui: {
    domain: UI_RESOURCE_DOMAIN,
    csp: UI_RESOURCE_CSP
  }
};
const storedPaymentConfirmations = new SingleUseConfirmationStore<{
  amount: string;
  credentialFingerprint: string;
}>({
  maxEntriesPerPartition: 3,
  partitionKey: (confirmation) => confirmation.credentialFingerprint,
  logicalKey: (confirmation) =>
    `stored_payment:${confirmation.credentialFingerprint}:${confirmation.amount}`
});
type GuardedMutationAction = "auto_recharge" | "billing_group" | "billing_group_create";
type GuardedMutationConfirmation = {
  action: GuardedMutationAction;
  inputFingerprint: string;
  logicalFingerprint: string;
  stateConfirmationToken: string;
  credentialFingerprint: string;
};
const guardedMutationConfirmations = new SingleUseConfirmationStore<GuardedMutationConfirmation>({
  maxEntriesPerPartition: 3,
  partitionKey: (confirmation) => confirmation.credentialFingerprint,
  logicalKey: (confirmation) =>
    `${confirmation.action}:${confirmation.credentialFingerprint}:${confirmation.logicalFingerprint}`
});
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);
const responseMetaSchema = z
  .object({
    page_number: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional(),
    total_pages: z.number().int().nonnegative().optional(),
    total_results: z.number().int().nonnegative().optional(),
    next_page_url: z.string().nullable().optional(),
    previous_page_url: z.string().nullable().optional()
  })
  .catchall(jsonValueSchema);
const balanceDataSchema = z
  .object({
    record_type: z.string().optional(),
    pending: z.union([z.string(), z.number()]).optional(),
    balance: z.union([z.string(), z.number()]).optional(),
    credit_limit: z.union([z.string(), z.number()]).optional(),
    available_credit: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional()
  })
  .catchall(jsonValueSchema);
const autoRechargePreferencesDataSchema = z
  .object({
    id: z.string().optional(),
    record_type: z.string().optional(),
    threshold_amount: z.union([z.string(), z.number()]).optional(),
    recharge_amount: z.union([z.string(), z.number()]).optional(),
    enabled: z.boolean().optional(),
    invoice_enabled: z.boolean().optional(),
    preference: z.string().optional()
  })
  .catchall(jsonValueSchema);
const billingGroupDataSchema = z
  .object({
    id: z.string().optional(),
    record_type: z.string().optional(),
    name: z.string().optional()
  })
  .catchall(jsonValueSchema);
const storedPaymentTransactionDataSchema = z
  .object({
    id: z.string().optional(),
    record_type: z.string().optional(),
    amount_cents: z.number().optional(),
    processor_status: z.string().optional(),
    amount_currency: z.string().optional(),
    created_at: z.string().optional(),
    auto_recharge: z.boolean().optional(),
    transaction_processing_type: z.string().optional()
  })
  .catchall(jsonValueSchema);
const balanceEnvelopeSchema = z.object({
  data: balanceDataSchema.optional(),
  meta: responseMetaSchema.optional()
});
const autoRechargeEnvelopeSchema = z.object({
  data: autoRechargePreferencesDataSchema.optional(),
  meta: responseMetaSchema.optional()
});
const billingGroupEnvelopeSchema = z.object({
  data: billingGroupDataSchema.optional(),
  meta: responseMetaSchema.optional()
});
const billingGroupListEnvelopeSchema = z.object({
  data: z.array(billingGroupDataSchema).optional(),
  meta: responseMetaSchema.optional()
});
const storedPaymentTransactionEnvelopeSchema = z.object({
  data: storedPaymentTransactionDataSchema.optional(),
  meta: responseMetaSchema.optional()
});
const usageRecordTypeSchema = z
  .object({
    record_type: z.string().optional(),
    product: z.string().optional(),
    product_dimensions: z.array(z.string()).optional(),
    product_metrics: z.array(z.string()).optional()
  })
  .catchall(jsonValueSchema);
const usageReportOptionsDataSchema = z
  .object({
    product: z.string().optional(),
    products: z.array(z.string()).optional(),
    dimensions: z.array(z.string()).optional(),
    metrics: z.array(z.string()).optional(),
    product_dimensions: z.array(z.string()).optional(),
    product_metrics: z.array(z.string()).optional(),
    record_types: z.array(usageRecordTypeSchema).nullable().optional()
  })
  .catchall(jsonValueSchema);
const usageReportOptionsEnvelopeSchema = z.object({
  data: z.union([usageReportOptionsDataSchema, z.array(usageReportOptionsDataSchema)]).optional(),
  meta: responseMetaSchema.optional()
});
const usageReportRowSchema = z
  .object({
    product: z.string().optional(),
    record_type: z.string().optional(),
    date: z.string().optional(),
    period: z.string().optional(),
    direction: z.string().optional(),
    country: z.string().optional(),
    currency: z.string().optional(),
    billing_group_id: z.string().optional(),
    managed_account_id: z.string().optional(),
    connection_id: z.string().optional(),
    messaging_profile_id: z.string().optional(),
    carrier: z.string().optional(),
    message_type: z.string().optional(),
    call_type: z.string().optional(),
    cost: z.union([z.string(), z.number()]).optional(),
    count: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    units: z.union([z.string(), z.number()]).optional(),
    usage: z.union([z.string(), z.number()]).optional()
  })
  .catchall(jsonValueSchema);
const usageReportEnvelopeSchema = z.object({
  data: z.array(usageReportRowSchema).optional(),
  meta: responseMetaSchema.optional()
});
const warningSchema = z.object({
  source: z.string(),
  message: z.string()
});
const billingOverviewResultSchema = z.object({
  balance: balanceEnvelopeSchema.optional(),
  auto_recharge: autoRechargeEnvelopeSchema.optional(),
  billing_groups: billingGroupListEnvelopeSchema.optional(),
  usage_options: usageReportOptionsEnvelopeSchema.optional(),
  warnings: z.array(warningSchema)
});
const autoRechargeSetupResultSchema = z.object({
  balance: balanceEnvelopeSchema.optional(),
  auto_recharge: autoRechargeEnvelopeSchema.optional(),
  warnings: z.array(warningSchema)
});
const storedPaymentTopUpResultSchema = z.object({
  balance: balanceEnvelopeSchema
});
const mutationStateSchema = z.object({
  resource: z.string().optional(),
  id: z.string().optional(),
  record_type: z.string().optional(),
  name: z.string().optional(),
  threshold_amount: z.union([z.string(), z.number()]).optional(),
  recharge_amount: z.union([z.string(), z.number()]).optional(),
  enabled: z.boolean().optional(),
  invoice_enabled: z.boolean().optional(),
  preference: z.string().optional(),
  transaction: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  transaction_processing_type: z.string().optional()
});
const mutationValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const mutationPreviewSchema = z.object({
  action: z.string(),
  financial_side_effect: z.boolean(),
  policy_version: z.string(),
  before: mutationStateSchema,
  after: mutationStateSchema,
  diff: z.array(
    z.object({
      field: z.string(),
      before: mutationValueSchema.optional(),
      after: mutationValueSchema.optional()
    })
  ),
  confirmation_token: z.string(),
  expires: z.string(),
  instructions: z.string()
});
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
const PREVIEW_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
const ADDITIVE_SIDE_EFFECT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
const DESTRUCTIVE_SIDE_EFFECT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
};
const SERVER_INSTRUCTIONS =
  "Use Streamable HTTP with Accept: application/json, text/event-stream and preserve Mcp-Session-Id. Discovery and UI resource reads do not require a user Telnyx credential; tools/call requires authenticated Telnyx access resolved by the hosting MCP service.";

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
  amount: z
    .string()
    .trim()
    .max(32)
    .regex(/^\d+\.\d{2}$/, 'Amount must include dollars and cents, for example "25.00".')
    .transform((value) => Number(value).toFixed(2))
};

export interface UsageCostExplorerServerOptions {
  /** Test/local-development escape hatch; never enable this in hosted mode. */
  allowProcessLocalCreateMutations?: boolean;
  /** Expose the hosted connector OAuth contract. Stdio uses TELNYX_API_KEY instead. */
  hostedOAuthMetadata?: boolean;
}

export function createServer(
  options: UsageCostExplorerServerOptions = {}
): McpServer {
  const server = new AppMcpServer(
    {
      name: "telnyx-usage-cost-explorer",
      version: "0.1.0"
    },
    { instructions: SERVER_INSTRUCTIONS },
    options.hostedOAuthMetadata === true
  );
  const allowProcessLocalCreateMutations =
    resolveProcessLocalCreateMutationMode(options);

  registerReadTool(
    server,
    "billing_overview",
    "Open billing dashboard",
    "Open a single Telnyx billing dashboard with current balance, usage controls, billing groups, and guarded auto-recharge settings.",
    {},
    billingOverviewResultSchema,
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
    "Open a focused app for reviewing and preparing auto recharge. Opening this tool does not enable auto recharge or charge a payment method; a separately confirmed update changes future automatic charges.",
    {},
    autoRechargeSetupResultSchema,
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
    "Open a focused app for reviewing a stored-payment top-up. Opening this tool does not charge a payment method; a separately previewed and confirmed transaction charges the saved method.",
    {},
    storedPaymentTopUpResultSchema,
    async (service) => ({ balance: await service.getBalance() }),
    READ_ONLY_ANNOTATIONS,
    STORED_PAYMENT_RESOURCE_URI
  );

  registerReadTool(
    server,
    "billing_get_balance",
    "Get account balance",
    "Read account balance details from GET /balance.",
    {},
    balanceEnvelopeSchema,
    async (service) => service.getBalance()
  );

  registerReadTool(
    server,
    "billing_get_auto_recharge_preferences",
    "Get auto-recharge preferences",
    "Read auto-recharge preferences from GET /payment/auto_recharge_prefs. This does not mutate billing settings.",
    {},
    autoRechargeEnvelopeSchema,
    async (service) => service.getAutoRechargePreferences()
  );

  registerReadTool(
    server,
    "billing_list_billing_groups",
    "List billing groups",
    "List billing groups from GET /billing_groups. Billing group IDs are preserved for follow-up calls.",
    pagingSchema,
    billingGroupListEnvelopeSchema,
    async (service, input) => service.listBillingGroups({ pageNumber: input.page_number, pageSize: input.page_size })
  );

  registerReadTool(
    server,
    "billing_get_billing_group",
    "Get billing group",
    "Fetch one billing group by ID from GET /billing_groups/{id}.",
    { id: z.string().min(1).describe("Billing group ID, e.g. bg_...") },
    billingGroupEnvelopeSchema,
    async (service, input) => service.getBillingGroup(input.id)
  );

  registerReadTool(
    server,
    "billing_usage_report_options",
    "Discover Usage Reports options (beta)",
    "Discover available products, dimensions, and metrics from GET /usage_reports/options. Usage Reports is beta.",
    { product: z.string().min(1).optional().describe("Optional product to narrow option discovery.") },
    usageReportOptionsEnvelopeSchema,
    async (service, input) => service.usageReportOptions({ product: input.product })
  );

  registerReadTool(
    server,
    "billing_query_usage",
    "Query Usage Reports (beta)",
    "Query the Telnyx Usage Reports beta endpoint and return structured JSON. Requires one product plus dimensions[] and metrics[]. Defaults format=json, managed_accounts=false, caps page size, and limits explicit start/end ranges to 31 days.",
    {
      product: z.string().min(1).describe("Usage Reports beta product."),
      dimensions: z.array(z.string().min(1)).min(1).describe("Required Usage Reports dimensions."),
      metrics: z.array(z.string().min(1)).min(1).describe("Required Usage Reports metrics."),
      start_date: z.string().min(1).optional().describe("Optional YYYY-MM-DD start date; use with end_date, max 31 days."),
      end_date: z.string().min(1).optional().describe("Optional YYYY-MM-DD end date; use with start_date, max 31 days."),
      date_range: z.string().min(1).optional().describe("Optional Telnyx date_range shortcut. Do not combine with explicit dates."),
      filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Optional Usage Reports filters."),
      sort: z.array(z.string().min(1)).optional().describe("Optional sort entries, e.g. -cost."),
      format: z.literal("json").optional().describe("Structured response format; defaults to json."),
      managed_accounts: z.boolean().optional().describe("Defaults to false."),
      ...pagingSchema
    },
    usageReportEnvelopeSchema,
    async (service, input) => service.queryUsage(input)
  );

  registerReadTool(
    server,
    "billing_preview_auto_recharge_update",
    "Preview auto-recharge update",
    "Preview a financial side-effect update to PATCH /payment/auto_recharge_prefs. No mutation occurs; returns a diff and confirmation token.",
    autoRechargePatchSchema,
    mutationPreviewSchema,
    async (service, input, extra) => {
      const credentialFingerprint = requireCredentialFingerprint(extra);
      const preview = await service.previewAutoRechargeUpdate(input);
      const issued = guardedMutationConfirmations.issue({
        action: "auto_recharge",
        inputFingerprint: guardedInputFingerprint("auto_recharge", input),
        logicalFingerprint: guardedLogicalFingerprint("auto_recharge", preview),
        stateConfirmationToken: preview.confirmation_token,
        credentialFingerprint
      });
      return {
        ...preview,
        confirmation_token: issued.token,
        expires: issued.expiresAt,
        instructions:
          "Review the authoritative before/after diff, then pass this one-time confirmation_token with the same requested fields. The token is bound to this credential and is reserved before the PATCH attempt."
      };
    },
    PREVIEW_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_update_auto_recharge_preferences",
    "Confirm auto-recharge update",
    "Guarded financial side-effect that changes future automatic charges: validates the confirmation token from billing_preview_auto_recharge_update, enforces conservative app caps, refetches current preferences, then PATCHes.",
    {
      ...autoRechargePatchSchema,
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_auto_recharge_update for the same requested after-state.")
    },
    autoRechargeEnvelopeSchema,
    async (service, input, extra) => {
      const credentialFingerprint = requireCredentialFingerprint(extra);
      const { confirmation_token, ...requestedInput } = input;
      const reservation = guardedMutationConfirmations.reserveIf(
        confirmation_token,
        (candidate) =>
          candidate.action === "auto_recharge" &&
          candidate.credentialFingerprint === credentialFingerprint &&
          candidate.inputFingerprint === guardedInputFingerprint("auto_recharge", requestedInput)
      );
      if (!reservation) {
        throw new Error(
          "Invalid, expired, credential-mismatched, already-used, or currently in-flight confirmation token. If a prior update was attempted, verify current preferences before creating another preview."
        );
      }
      try {
        const result = await service.updateAutoRechargePreferences({
          ...requestedInput,
          confirmation_token: reservation.value.stateConfirmationToken
        });
        return completeAfterToolResult(result, reservation.complete);
      } catch (error) {
        if (telnyxAuthStatus(error)) {
          reservation.release();
          throw error;
        }
        throw new Error(
          "Auto-recharge update outcome is unknown and the one-time confirmation remains blocked. Preferences may have changed. Verify current auto-recharge preferences and do not retry automatically."
        );
      }
    },
    DESTRUCTIVE_SIDE_EFFECT_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_preview_stored_payment_transaction",
    "Preview stored payment top-up",
    "Preview a financial side-effect transaction to POST /payment/stored_payment_transactions. No mutation occurs; returns a short-lived, one-time confirmation token.",
    storedPaymentSchema,
    mutationPreviewSchema,
    async (service, input, extra) => {
      requireRestartSafeCreateMutations(allowProcessLocalCreateMutations);
      // A syntactically valid KEY_ value is not proof of a real credential.
      // Complete one bounded, read-only request before allocating scarce
      // confirmation capacity so fake-key callers cannot evict real previews.
      await service.getBalance();
      const preview = await service.previewStoredPaymentTransaction(input);
      const amount = String(preview.after.amount);
      const credentialFingerprint = resolvedCredentialFingerprint(extra);
      if (!credentialFingerprint) {
        throw new Error("A resolved Telnyx credential is required to preview a stored-payment transaction.");
      }
      const issued = storedPaymentConfirmations.issue({
        amount,
        credentialFingerprint
      });
      return {
        ...preview,
        confirmation_token: issued.token,
        expires: issued.expiresAt,
        instructions:
          "Review the diff, then pass this one-time confirmation_token with the same amount. A failed or ambiguous charge attempt blocks this logical action; verify transaction history in the Telnyx Portal or account balance and do not retry automatically."
      };
    },
    PREVIEW_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_create_stored_payment_transaction",
    "Confirm stored payment top-up",
    "Guarded, billable financial side-effect: atomically reserves the one-time confirmation token from billing_preview_stored_payment_transaction, then charges the saved payment method with POST /payment/stored_payment_transactions. The reservation is released only after a successful bounded MCP result is produced.",
    {
      ...storedPaymentSchema,
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_stored_payment_transaction for the same amount.")
    },
    storedPaymentTransactionEnvelopeSchema,
    async (service, input, extra) => {
      requireRestartSafeCreateMutations(allowProcessLocalCreateMutations);
      const credentialFingerprint = resolvedCredentialFingerprint(extra);
      const reservation = credentialFingerprint
        ? storedPaymentConfirmations.reserveIf(
            input.confirmation_token,
            (candidate) =>
              candidate.amount === input.amount &&
              candidate.credentialFingerprint === credentialFingerprint
          )
        : undefined;
      if (!reservation) {
        throw new Error(
          "Invalid, expired, credential-mismatched, already-used, or currently in-flight confirmation token. If a prior charge was attempted, its outcome may be unknown: verify transaction history in the Telnyx Portal or account balance and do not retry automatically."
        );
      }
      const preview = await service.previewStoredPaymentTransaction({
        amount: reservation.value.amount
      });
      try {
        const result = await service.createStoredPaymentTransaction({
          amount: reservation.value.amount,
          confirmation_token: preview.confirmation_token
        });
        return completeAfterToolResult(result, reservation.complete);
      } catch (error) {
        if (telnyxAuthStatus(error)) {
          reservation.release();
          throw error;
        }
        throw new Error(
          "Stored-payment transaction outcome is unknown and the one-time confirmation remains blocked. The saved payment method may have been charged. Verify transaction history in the Telnyx Portal or account balance and do not retry automatically."
        );
      }
    },
    DESTRUCTIVE_SIDE_EFFECT_ANNOTATIONS
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
    mutationPreviewSchema,
    async (service, input, extra) => {
      const credentialFingerprint = requireCredentialFingerprint(extra);
      const preview = await service.previewBillingGroupUpdate(input);
      const issued = guardedMutationConfirmations.issue({
        action: "billing_group",
        inputFingerprint: guardedInputFingerprint("billing_group", input),
        logicalFingerprint: guardedLogicalFingerprint("billing_group", preview),
        stateConfirmationToken: preview.confirmation_token,
        credentialFingerprint
      });
      return {
        ...preview,
        confirmation_token: issued.token,
        expires: issued.expiresAt,
        instructions:
          "Review the authoritative before/after diff, then pass this one-time confirmation_token with the same billing group ID and name. The token is bound to this credential and is reserved before the PATCH attempt."
      };
    },
    PREVIEW_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_update_billing_group",
    "Confirm billing group update",
    "Guarded destructive update that replaces an existing billing group name: validates the token from billing_preview_billing_group_update, refetches current group, then PATCHes /billing_groups/{id}.",
    {
      id: z.string().min(1).describe("Billing group ID."),
      name: z.string().min(1).describe("New billing group name."),
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_billing_group_update.")
    },
    billingGroupEnvelopeSchema,
    async (service, input, extra) => {
      const credentialFingerprint = requireCredentialFingerprint(extra);
      const { confirmation_token, ...requestedInput } = input;
      const reservation = guardedMutationConfirmations.reserveIf(
        confirmation_token,
        (candidate) =>
          candidate.action === "billing_group" &&
          candidate.credentialFingerprint === credentialFingerprint &&
          candidate.inputFingerprint === guardedInputFingerprint("billing_group", requestedInput)
      );
      if (!reservation) {
        throw new Error(
          "Invalid, expired, credential-mismatched, already-used, or currently in-flight confirmation token. If a prior update was attempted, verify the current billing group before creating another preview."
        );
      }
      try {
        const result = await service.updateBillingGroup({
          ...requestedInput,
          confirmation_token: reservation.value.stateConfirmationToken
        });
        return completeAfterToolResult(result, reservation.complete);
      } catch (error) {
        if (telnyxAuthStatus(error)) {
          reservation.release();
          throw error;
        }
        throw new Error(
          "Billing-group update outcome is unknown and the one-time confirmation remains blocked. The billing group may have changed. Verify the current billing group and do not retry automatically."
        );
      }
    },
    DESTRUCTIVE_SIDE_EFFECT_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_preview_billing_group_create",
    "Preview billing group creation",
    "Preview adding a billing group with POST /billing_groups. No resource is created; returns a short-lived, one-time confirmation token bound to the credential and exact name.",
    {
      name: z.string().min(1).describe("New billing group name.")
    },
    mutationPreviewSchema,
    async (service, input, extra) => {
      requireRestartSafeCreateMutations(allowProcessLocalCreateMutations);
      const credentialFingerprint = requireCredentialFingerprint(extra);
      const preview = await service.previewBillingGroupCreate(input);
      const issued = guardedMutationConfirmations.issue({
        action: "billing_group_create",
        inputFingerprint: guardedInputFingerprint("billing_group_create", input),
        logicalFingerprint: guardedLogicalFingerprint("billing_group_create", preview),
        stateConfirmationToken: preview.confirmation_token,
        credentialFingerprint
      });
      return {
        ...preview,
        confirmation_token: issued.token,
        expires: issued.expiresAt,
        instructions:
          "Review the diff, then pass this one-time confirmation_token with the exact same billing group name. The token is credential-bound and reserved before POST."
      };
    },
    PREVIEW_ANNOTATIONS
  );

  registerReadTool(
    server,
    "billing_create_billing_group",
    "Create billing group",
    "Guarded additive side effect: atomically reserves the one-time token from billing_preview_billing_group_create, then adds exactly one billing group with POST /billing_groups. This action does not charge a payment method or alter auto-recharge settings.",
    {
      name: z.string().min(1).describe("New billing group name."),
      confirmation_token: z.string().min(1).describe("Token returned by billing_preview_billing_group_create for this exact name.")
    },
    billingGroupEnvelopeSchema,
    async (service, input, extra) => {
      requireRestartSafeCreateMutations(allowProcessLocalCreateMutations);
      const credentialFingerprint = requireCredentialFingerprint(extra);
      const { confirmation_token, ...requestedInput } = input;
      const reservation = guardedMutationConfirmations.reserveIf(
        confirmation_token,
        (candidate) =>
          candidate.action === "billing_group_create" &&
          candidate.credentialFingerprint === credentialFingerprint &&
          candidate.inputFingerprint ===
            guardedInputFingerprint("billing_group_create", requestedInput)
      );
      if (!reservation) {
        throw new Error(
          "Invalid, expired, credential-mismatched, already-used, or currently in-flight confirmation token. If a prior creation was attempted, verify billing groups before creating another preview."
        );
      }
      try {
        const result = await service.createBillingGroup({
          ...requestedInput,
          confirmation_token: reservation.value.stateConfirmationToken
        });
        return completeAfterToolResult(result, reservation.complete);
      } catch (error) {
        if (telnyxAuthStatus(error)) {
          reservation.release();
          throw error;
        }
        throw new Error(
          "Billing-group creation outcome is unknown and the one-time confirmation remains blocked. Verify the billing-group list before trying again."
        );
      }
    },
    ADDITIVE_SIDE_EFFECT_ANNOTATIONS
  );

  registerAppResource(
    server,
    "Billing Dashboard UI",
    UI_RESOURCE_URI,
    {
      description:
        "Interactive billing dashboard for balance, usage, billing groups, and guarded auto-recharge settings.",
      _meta: UI_RESOURCE_META
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: USAGE_COST_EXPLORER_UI_HTML,
          _meta: UI_RESOURCE_META
        }
      ]
    })
  );

  registerAppResource(
    server,
    "Auto Recharge Setup UI",
    AUTO_RECHARGE_RESOURCE_URI,
    {
      description: "Focused auto-recharge setup UI for unblocking low-credit Telnyx accounts without direct MCP payments.",
      _meta: UI_RESOURCE_META
    },
    async () => ({
      contents: [
        {
          uri: AUTO_RECHARGE_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: AUTO_RECHARGE_SETUP_UI_HTML,
          _meta: UI_RESOURCE_META
        }
      ]
    })
  );

  registerAppResource(
    server,
    "Stored Payment Top Up UI",
    STORED_PAYMENT_RESOURCE_URI,
    {
      description: "Focused stored-payment top-up UI for charging a saved portal payment method after explicit confirmation.",
      _meta: UI_RESOURCE_META
    },
    async () => ({
      contents: [
        {
          uri: STORED_PAYMENT_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: STORED_PAYMENT_TOP_UP_UI_HTML,
          _meta: UI_RESOURCE_META
        }
      ]
    })
  );

  return server;
}

type ToolShape = Record<string, z.ZodTypeAny>;
type ToolInput<T extends ToolShape> = { [K in keyof T]: z.infer<T[K]> };
const COMPLETE_AFTER_TOOL_RESULT = Symbol("complete-after-tool-result");
type DeferredToolResult = {
  [COMPLETE_AFTER_TOOL_RESULT]: true;
  result: unknown;
  complete: () => void;
};

function registerReadTool<T extends ToolShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: T,
  outputSchema: z.ZodType,
  run: (
    service: BillingService,
    input: ToolInput<T>,
    extra: AuthBearingExtra
  ) => Promise<unknown>,
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
      outputSchema,
      annotations,
      _meta: {
        ui: {
          ...(uiResourceUri ? { resourceUri: uiResourceUri } : {}),
          visibility: ["app"]
        }
      }
    },
    async (input: ToolInput<T>, extra: AuthBearingExtra) => {
      const service = createLiveService(extra);
      if (!service) return missingApiKeyResult();
      try {
        const result = await run(service, input, extra);
        if (!isDeferredToolResult(result)) return toolResult(result, outputSchema);
        const finalized = toolResult(result.result, outputSchema);
        result.complete();
        return finalized;
      } catch (error) {
        return safeToolError(error);
      }
    }
  );
}

function completeAfterToolResult(
  result: unknown,
  complete: () => void
): DeferredToolResult {
  return {
    [COMPLETE_AFTER_TOOL_RESULT]: true,
    result,
    complete
  };
}

function isDeferredToolResult(result: unknown): result is DeferredToolResult {
  return Boolean(
    result &&
      typeof result === "object" &&
      COMPLETE_AFTER_TOOL_RESULT in result &&
      (result as DeferredToolResult)[COMPLETE_AFTER_TOOL_RESULT] === true
  );
}

async function safeDashboardRead(name: string, read: () => Promise<unknown>): Promise<{ data?: unknown; warning?: { source: string; message: string } }> {
  try {
    return { data: await read() };
  } catch (error) {
    if (telnyxAuthStatus(error)) throw error;
    return { warning: { source: name, message: sanitizeError(error).message } };
  }
}

type AuthBearingExtra = { authInfo?: { token?: string }; signal?: AbortSignal };

function createLiveService(extra?: AuthBearingExtra): BillingService | undefined {
  const apiKey = resolvedApiKey(extra);
  if (!apiKey) return undefined;
  const client = new TelnyxBillingClient({
    apiKey,
    baseUrl: process.env.TELNYX_API_BASE_URL,
    signal: extra?.signal
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

function resolvedApiKey(extra?: AuthBearingExtra): string | undefined {
  return extra?.authInfo?.token ?? process.env.TELNYX_API_KEY;
}

function resolvedCredentialFingerprint(extra?: AuthBearingExtra): string | undefined {
  const apiKey = resolvedApiKey(extra);
  if (!apiKey) return undefined;
  return createHash("sha256")
    .update("usage-cost-explorer:stored-payment-credential:v1\0")
    .update(apiKey)
    .digest("hex");
}

function requireCredentialFingerprint(extra?: AuthBearingExtra): string {
  const fingerprint = resolvedCredentialFingerprint(extra);
  if (!fingerprint) {
    throw new Error("A resolved Telnyx credential is required for guarded billing confirmations.");
  }
  return fingerprint;
}

function guardedInputFingerprint(
  action: GuardedMutationAction,
  input: Record<string, unknown>
): string {
  const normalized =
    action === "billing_group"
      ? {
          id: normalizeFingerprintString(input.id),
          name: normalizeFingerprintString(input.name)
        }
      : action === "billing_group_create"
        ? { name: normalizeFingerprintString(input.name) }
        : Object.fromEntries(
          ["enabled", "invoice_enabled", "preference", "recharge_amount", "threshold_amount"]
            .filter((field) => input[field] !== undefined)
            .sort()
            .map((field) => [
              field,
              typeof input[field] === "string" ? normalizeFingerprintString(input[field]) : input[field]
            ])
        );
  return createHash("sha256")
    .update(`usage-cost-explorer:${action}:input:v1\0`)
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function guardedLogicalFingerprint(
  action: GuardedMutationAction,
  preview: { after: Record<string, unknown>; confirmation_token: string }
): string {
  if (action !== "auto_recharge") return preview.confirmation_token;
  const canonicalAfter = Object.fromEntries(
    Object.entries(preview.after)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        (key === "threshold_amount" || key === "recharge_amount") &&
        typeof value === "string" &&
        Number.isFinite(Number(value))
          ? Number(value).toString()
          : value
      ])
  );
  return createHash("sha256")
    .update(`usage-cost-explorer:${action}:logical-state:v1\0`)
    .update(JSON.stringify(canonicalAfter))
    .digest("hex");
}

function normalizeFingerprintString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProcessLocalCreateMutationMode(
  options: UsageCostExplorerServerOptions
): boolean {
  if (options.allowProcessLocalCreateMutations !== undefined) {
    return options.allowProcessLocalCreateMutations;
  }
  if (process.env.NODE_ENV === "test") return true;
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.USAGE_COST_EXPLORER_ALLOW_UNSAFE_PROCESS_LOCAL_CREATE_MUTATIONS ===
      "true"
  );
}

function requireRestartSafeCreateMutations(enabled: boolean): void {
  if (enabled) return;
  throw new Error(
    "Stored-payment and billing-group creation are disabled in hosted mode because this build has no durable shared confirmation coordinator or upstream idempotency key. Keep these create actions disabled until restart- and multi-instance-safe coordination is deployed."
  );
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toolResult(
  result: unknown,
  outputSchema: z.ZodType
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const sanitizedResult =
    outputSchema === mutationPreviewSchema
      ? sanitizeBillingToolOutput(result)
      : sanitizeBillingValue(result);
  const structuredContent = asStructuredContent(outputSchema.parse(sanitizedResult));
  const fullResult = {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent
  };
  if (serializedBytes(fullResult) <= MAX_TOOL_RESULT_BYTES) return fullResult;

  const structuredOnlyResult = {
    content: [{ type: "text" as const, text: "The result is available in structuredContent." }],
    structuredContent
  };
  if (serializedBytes(structuredOnlyResult) <= MAX_TOOL_RESULT_BYTES) return structuredOnlyResult;
  throw new Error(
    "Tool output exceeded the safe size limit. Narrow the date range, filters, or page size and try again."
  );
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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

function safeToolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, number>;
} {
  const status = telnyxAuthStatus(error);
  const message =
    status === 401
      ? "Telnyx authentication failed. Reconnect or provide a valid Telnyx credential."
      : status === 403
        ? "The Telnyx credential does not have permission to access this billing operation."
        : sanitizeError(error).message;
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    ...(status ? { _meta: { [INTERNAL_HTTP_STATUS_META_KEY]: status } } : {})
  };
}

function telnyxAuthStatus(error: unknown): 401 | 403 | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 ? status : undefined;
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
