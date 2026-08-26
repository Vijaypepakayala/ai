import { createHash } from "node:crypto";

import type {
  AutoRechargePolicy,
  AutoRechargeUpdatePayload,
  BillingGroupUpdatePayload,
  BillingServiceClient,
  DiffEntry,
  MutationPreview,
  PageInput,
  StoredPaymentTransactionPayload,
  TelnyxEnvelope,
  UsageQueryInput,
  UsageQueryRequest
} from "./types.js";
import { TelnyxBillingError } from "./telnyxClient.js";

export const DEFAULT_MAX_PAGE_SIZE = 1000;
export const DEFAULT_AUTO_RECHARGE_POLICY: Required<AutoRechargePolicy> = {
  maxThresholdAmount: 5000,
  maxRechargeAmount: 5000,
  version: "usage-cost-explorer-policy-v1"
};

const AUTO_RECHARGE_ACTION = "billing.update_auto_recharge_preferences";
const STORED_PAYMENT_ACTION = "billing.create_stored_payment_transaction";
const BILLING_GROUP_UPDATE_ACTION = "billing.update_billing_group";
const MUTABLE_AUTO_RECHARGE_FIELDS = ["threshold_amount", "recharge_amount", "enabled", "invoice_enabled", "preference"] as const;
const AUTO_RECHARGE_AMOUNT_PATTERN = /^(?:\d+|\d+\.\d+|\.\d+)$/;
const STORED_PAYMENT_AMOUNT_PATTERN = /^\d+\.\d{2}$/;
const DEFAULT_MAX_STORED_PAYMENT_AMOUNT = 5000;
const DEFAULT_AUTO_RECHARGE_STATE = {
  enabled: false,
  invoice_enabled: false,
  preference: "credit_paypal"
} satisfies Record<string, unknown>;

export interface BillingServiceOptions {
  maxPageSize?: number;
  maxStoredPaymentAmount?: number;
  autoRechargePolicy?: Partial<AutoRechargePolicy>;
}

export function createBillingService(client: BillingServiceClient, options: BillingServiceOptions = {}) {
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const maxStoredPaymentAmount = options.maxStoredPaymentAmount ?? DEFAULT_MAX_STORED_PAYMENT_AMOUNT;
  const autoRechargePolicy: Required<AutoRechargePolicy> = {
    ...DEFAULT_AUTO_RECHARGE_POLICY,
    ...options.autoRechargePolicy,
    version: options.autoRechargePolicy?.version ?? DEFAULT_AUTO_RECHARGE_POLICY.version
  };

  return {
    async getBalance() {
      return client.getBalance();
    },

    async getAutoRechargePreferences() {
      return client.getAutoRechargePreferences();
    },

    async listBillingGroups(input: PageInput = {}) {
      return client.listBillingGroups({
        pageNumber: normalizePositiveInt(input.pageNumber, 1),
        pageSize: capPageSize(input.pageSize, maxPageSize)
      });
    },

    async getBillingGroup(id: string) {
      assertNonEmpty(id, "billing_group_id is required");
      return client.getBillingGroup(id.trim());
    },

    async usageReportOptions(input: { product?: string } = {}) {
      return client.getUsageReportOptions({ product: normalizeOptionalString(input.product) });
    },

    async queryUsage(input: UsageQueryRequest) {
      const normalized = normalizeUsageQuery(input, maxPageSize);
      return client.queryUsageReport(normalized);
    },

    async previewAutoRechargeUpdate(input: AutoRechargeUpdatePayload): Promise<MutationPreview> {
      const patch = normalizeAutoRechargePatch(input);
      enforceAutoRechargePatchPolicy(patch, autoRechargePolicy);
      const before = await getAutoRechargeState(client);
      const after = { ...before, ...patch };
      enforceAutoRechargeAfterStatePolicy(after, autoRechargePolicy);
      return buildPreview(AUTO_RECHARGE_ACTION, true, before, after, autoRechargePolicy.version);
    },

    async updateAutoRechargePreferences(input: AutoRechargeUpdatePayload & { confirmation_token: string }): Promise<TelnyxEnvelope> {
      const { confirmation_token, ...rest } = input;
      assertNonEmpty(confirmation_token, "A confirmation token from billing_preview_auto_recharge_update is required.");
      const patch = normalizeAutoRechargePatch(rest);
      enforceAutoRechargePatchPolicy(patch, autoRechargePolicy);
      const before = await getAutoRechargeState(client);
      const after = { ...before, ...patch };
      enforceAutoRechargeAfterStatePolicy(after, autoRechargePolicy);
      const expected = confirmationToken(AUTO_RECHARGE_ACTION, before, after, autoRechargePolicy.version);
      if (confirmation_token !== expected) {
        throw new Error("Invalid confirmation token. Run billing_preview_auto_recharge_update again against the current preferences.");
      }
      return client.updateAutoRechargePreferences(patch);
    },

    async previewStoredPaymentTransaction(input: StoredPaymentTransactionPayload): Promise<MutationPreview> {
      const amount = normalizeStoredPaymentAmount(input.amount, maxStoredPaymentAmount);
      return buildPreview(
        STORED_PAYMENT_ACTION,
        true,
        { transaction: "not_created" },
        { amount, transaction_processing_type: "stored_payment" },
        autoRechargePolicy.version
      );
    },

    async createStoredPaymentTransaction(input: StoredPaymentTransactionPayload & { confirmation_token: string }): Promise<TelnyxEnvelope> {
      assertNonEmpty(input.confirmation_token, "A confirmation token from billing_preview_stored_payment_transaction is required.");
      const amount = normalizeStoredPaymentAmount(input.amount, maxStoredPaymentAmount);
      const before = { transaction: "not_created" };
      const after = { amount, transaction_processing_type: "stored_payment" };
      const expected = confirmationToken(STORED_PAYMENT_ACTION, before, after, autoRechargePolicy.version);
      if (input.confirmation_token !== expected) {
        throw new Error("Invalid confirmation token. Run billing_preview_stored_payment_transaction again for this amount.");
      }
      return client.createStoredPaymentTransaction({ amount });
    },

    async previewBillingGroupUpdate(input: { id: string; name: string }): Promise<MutationPreview> {
      const id = normalizeRequiredString(input.id, "billing_group_id is required");
      const patch = normalizeBillingGroupPatch({ name: input.name });
      const current = recordFromEnvelope(await client.getBillingGroup(id));
      const before = pickBillingGroupState(current);
      const after = { ...before, ...patch };
      return buildPreview(BILLING_GROUP_UPDATE_ACTION, false, before, after, autoRechargePolicy.version);
    },

    async updateBillingGroup(input: { id: string; name: string; confirmation_token: string }): Promise<TelnyxEnvelope> {
      const id = normalizeRequiredString(input.id, "billing_group_id is required");
      assertNonEmpty(input.confirmation_token, "A confirmation token from billing_preview_billing_group_update is required.");
      const patch = normalizeBillingGroupPatch({ name: input.name });
      const current = recordFromEnvelope(await client.getBillingGroup(id));
      const before = pickBillingGroupState(current);
      const after = { ...before, ...patch };
      const expected = confirmationToken(BILLING_GROUP_UPDATE_ACTION, before, after, autoRechargePolicy.version);
      if (input.confirmation_token !== expected) {
        throw new Error("Invalid confirmation token. Run billing_preview_billing_group_update again against the current billing group.");
      }
      return client.updateBillingGroup(id, patch);
    },

    async createBillingGroup(input: { name: string; confirm?: boolean }): Promise<TelnyxEnvelope> {
      if (input.confirm !== true) {
        throw new Error("billing_create_billing_group requires confirm=true because it creates a billing resource.");
      }
      const name = normalizeRequiredString(input.name, "Billing group name is required.");
      return client.createBillingGroup({ name });
    }
  };
}

export type BillingService = ReturnType<typeof createBillingService>;

async function getAutoRechargeState(client: BillingServiceClient): Promise<Record<string, unknown>> {
  try {
    return pickAutoRechargeState(recordFromEnvelope(await client.getAutoRechargePreferences()));
  } catch (error) {
    if (isMissingAutoRechargePreferences(error)) return { ...DEFAULT_AUTO_RECHARGE_STATE };
    throw error;
  }
}

function isMissingAutoRechargePreferences(error: unknown): boolean {
  return error instanceof TelnyxBillingError && error.status === 404;
}

export function normalizeUsageQuery(input: UsageQueryRequest, maxPageSize = DEFAULT_MAX_PAGE_SIZE): UsageQueryInput {
  const product = normalizeRequiredString(input.product, "Usage report product is required.");
  const dimensions = normalizeStringArray(input.dimensions, "Usage report requires at least one dimension.");
  const metrics = normalizeStringArray(input.metrics, "Usage report requires at least one metric.");
  const hasDateRange = Boolean(normalizeOptionalString(input.date_range));
  const hasExplicitDate = Boolean(normalizeOptionalString(input.start_date) || normalizeOptionalString(input.end_date));

  if (hasDateRange && hasExplicitDate) {
    throw new Error("Use either date_range or start_date/end_date, not both.");
  }
  if (hasExplicitDate) {
    if (!input.start_date || !input.end_date) {
      throw new Error("Both start_date and end_date are required when using explicit dates.");
    }
    enforceMaxDateRange(input.start_date, input.end_date, 31);
  }

  return {
    product,
    dimensions,
    metrics,
    startDate: normalizeOptionalString(input.start_date),
    endDate: normalizeOptionalString(input.end_date),
    dateRange: normalizeOptionalString(input.date_range),
    filters: input.filters,
    sort: input.sort && input.sort.length > 0 ? normalizeStringArray(input.sort, "sort entries must be non-empty strings") : undefined,
    format: input.format ?? "json",
    managedAccounts: input.managed_accounts ?? false,
    pageNumber: normalizePositiveInt(input.page_number, 1),
    pageSize: capPageSize(input.page_size, maxPageSize)
  };
}

function enforceMaxDateRange(startDate: string, endDate: string, maxDays: number): void {
  const start = parseStrictIsoDate(startDate, "start_date");
  const end = parseStrictIsoDate(endDate, "end_date");
  if (end < start) {
    throw new Error("end_date must be on or after start_date.");
  }
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days > maxDays) {
    throw new Error(`Usage Reports beta queries with explicit start_date/end_date are capped at ${maxDays} days by this app.`);
  }
}

function parseStrictIsoDate(value: string, fieldName: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${fieldName} must be a valid ISO date string (YYYY-MM-DD).`);
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${fieldName} must be a valid ISO date string (YYYY-MM-DD).`);
  }
  return date;
}

function normalizeAutoRechargePatch(input: AutoRechargeUpdatePayload): AutoRechargeUpdatePayload {
  const patch: AutoRechargeUpdatePayload = {};
  for (const field of MUTABLE_AUTO_RECHARGE_FIELDS) {
    const value = input[field];
    if (value !== undefined) {
      (patch as Record<string, unknown>)[field] = typeof value === "string" ? normalizeAutoRechargeStringField(value, field) : value;
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("At least one auto-recharge preference field is required.");
  }
  return patch;
}

function normalizeAutoRechargeStringField(value: string, field: (typeof MUTABLE_AUTO_RECHARGE_FIELDS)[number]): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} must not be blank.`);
  }
  return normalized;
}

function enforceAutoRechargePatchPolicy(patch: AutoRechargeUpdatePayload, policy: Required<AutoRechargePolicy>): void {
  enforceAutoRechargeAmountPolicy(patch as Record<string, unknown>, policy);
}

function enforceAutoRechargeAfterStatePolicy(after: Record<string, unknown>, policy: Required<AutoRechargePolicy>): void {
  if (after.enabled === true) {
    enforceAutoRechargeAmountPolicy(after, policy);
  }
}

function enforceAutoRechargeAmountPolicy(values: Record<string, unknown>, policy: Required<AutoRechargePolicy>): void {
  const threshold = amountValue(values.threshold_amount);
  if (threshold !== undefined && threshold > policy.maxThresholdAmount) {
    throw new Error(`threshold_amount exceeds app guardrail max of ${policy.maxThresholdAmount}. This is an app guardrail, not a Telnyx API policy.`);
  }
  const recharge = amountValue(values.recharge_amount);
  if (recharge !== undefined && recharge > policy.maxRechargeAmount) {
    throw new Error(`recharge_amount exceeds app guardrail max of ${policy.maxRechargeAmount}. This is an app guardrail, not a Telnyx API policy.`);
  }
}

function amountValue(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  let amount: number;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!AUTO_RECHARGE_AMOUNT_PATTERN.test(normalized)) {
      throw new Error("Auto-recharge amounts must be non-negative numeric strings or numbers.");
    }
    amount = Number(normalized);
  } else if (typeof value === "number") {
    amount = value;
  } else {
    throw new Error("Auto-recharge amounts must be non-negative numeric strings or numbers.");
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Auto-recharge amounts must be non-negative numeric strings or numbers.");
  }
  return amount;
}

function normalizeStoredPaymentAmount(value: string, maxAmount: number): string {
  const amount = normalizeRequiredString(value, "Stored payment amount is required.");
  if (!STORED_PAYMENT_AMOUNT_PATTERN.test(amount)) {
    throw new Error('Stored payment amount must include dollars and cents, for example "25.00".');
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Stored payment amount must be greater than 0.");
  }
  if (numericAmount > maxAmount) {
    throw new Error(`Stored payment amount exceeds app guardrail max of ${maxAmount}. This is an app guardrail, not a Telnyx API policy.`);
  }
  return amount;
}

function normalizeBillingGroupPatch(input: BillingGroupUpdatePayload): BillingGroupUpdatePayload {
  const name = normalizeRequiredString(input.name, "Billing group name is required.");
  return { name };
}

function buildPreview(
  action: string,
  financialSideEffect: boolean,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  policyVersion: string
): MutationPreview {
  return {
    action,
    financial_side_effect: financialSideEffect,
    policy_version: policyVersion,
    before,
    after,
    diff: diff(before, after),
    confirmation_token: confirmationToken(action, before, after, policyVersion),
    expires: "stateless-token-valid-while-resource-unchanged",
    instructions: "Review the diff, then pass confirmation_token with the same requested fields to the update tool."
  };
}

function confirmationToken(action: string, before: Record<string, unknown>, after: Record<string, unknown>, policyVersion: string): string {
  return createHash("sha256").update(stableJson({ action, before, after, policyVersion })).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>): DiffEntry[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields]
    .sort()
    .filter((field) => stableJson(before[field]) !== stableJson(after[field]))
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

function recordFromEnvelope(envelope: TelnyxEnvelope): Record<string, unknown> {
  const data = envelope.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function pickAutoRechargeState(current: Record<string, unknown>): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const key of ["id", "record_type", ...MUTABLE_AUTO_RECHARGE_FIELDS]) {
    if (current[key] !== undefined) state[key] = current[key];
  }
  return state;
}

function pickBillingGroupState(current: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(current.id !== undefined ? { id: current.id } : {}),
    ...(current.record_type !== undefined ? { record_type: current.record_type } : {}),
    ...(current.name !== undefined ? { name: current.name } : {})
  };
}

function normalizeStringArray(values: string[] | undefined, message: string): string[] {
  const normalized = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalized.length === 0) throw new Error(message);
  return [...new Set(normalized)];
}

function normalizeRequiredString(value: string | undefined, message: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function assertNonEmpty(value: string | undefined, message: string): void {
  if (!value || value.trim().length === 0) throw new Error(message);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function capPageSize(value: number | undefined, maxPageSize: number): number {
  const normalized = normalizePositiveInt(value, Math.min(100, maxPageSize));
  return Math.min(normalized, maxPageSize);
}
