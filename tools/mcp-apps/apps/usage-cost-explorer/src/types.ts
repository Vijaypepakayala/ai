export interface TelnyxClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface TelnyxEnvelope<T = unknown> {
  data?: T;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BalanceData {
  record_type?: string;
  pending?: string | number;
  balance?: string | number;
  credit_limit?: string | number;
  available_credit?: string | number;
  currency?: string;
  [key: string]: unknown;
}

export interface AutoRechargePreferencesData {
  id?: string;
  record_type?: "auto_recharge_pref" | string;
  threshold_amount?: string | number;
  recharge_amount?: string | number;
  enabled?: boolean;
  invoice_enabled?: boolean;
  preference?: string;
  [key: string]: unknown;
}

export interface AutoRechargeUpdatePayload {
  threshold_amount?: string | number;
  recharge_amount?: string | number;
  enabled?: boolean;
  invoice_enabled?: boolean;
  preference?: string;
}

export interface StoredPaymentTransactionPayload {
  amount: string;
}

export interface StoredPaymentTransactionData {
  id?: string;
  record_type?: "transaction" | string;
  amount_cents?: number;
  processor_status?: string;
  amount_currency?: string;
  created_at?: string;
  auto_recharge?: boolean;
  transaction_processing_type?: "stored_payment" | string;
  [key: string]: unknown;
}

export interface BillingGroupData {
  id?: string;
  record_type?: "billing_group" | string;
  name?: string;
  [key: string]: unknown;
}

export interface BillingGroupCreatePayload {
  name: string;
}

export interface BillingGroupUpdatePayload {
  name?: string;
}

export interface PageInput {
  pageNumber?: number;
  pageSize?: number;
}

export interface UsageReportOptionsInput {
  product?: string;
}

export type UsageReportFormat = "json" | "csv";

export interface UsageQueryInput {
  product: string;
  dimensions: string[];
  metrics: string[];
  startDate?: string;
  endDate?: string;
  dateRange?: string;
  filters?: Record<string, string | number | boolean>;
  sort?: string[];
  format: UsageReportFormat;
  managedAccounts: boolean;
  pageNumber: number;
  pageSize: number;
}

export interface UsageQueryRequest {
  product: string;
  dimensions: string[];
  metrics: string[];
  start_date?: string;
  end_date?: string;
  date_range?: string;
  filters?: Record<string, string | number | boolean>;
  sort?: string[];
  format?: UsageReportFormat;
  managed_accounts?: boolean;
  page_number?: number;
  page_size?: number;
}

export interface BillingServiceClient {
  getBalance(): Promise<TelnyxEnvelope<BalanceData>>;
  getAutoRechargePreferences(): Promise<TelnyxEnvelope<AutoRechargePreferencesData>>;
  updateAutoRechargePreferences(payload: AutoRechargeUpdatePayload): Promise<TelnyxEnvelope<AutoRechargePreferencesData>>;
  createStoredPaymentTransaction(payload: StoredPaymentTransactionPayload): Promise<TelnyxEnvelope<StoredPaymentTransactionData>>;
  listBillingGroups(input?: PageInput): Promise<TelnyxEnvelope<BillingGroupData[]>>;
  createBillingGroup(payload: BillingGroupCreatePayload): Promise<TelnyxEnvelope<BillingGroupData>>;
  getBillingGroup(id: string): Promise<TelnyxEnvelope<BillingGroupData>>;
  updateBillingGroup(id: string, payload: BillingGroupUpdatePayload): Promise<TelnyxEnvelope<BillingGroupData>>;
  getUsageReportOptions(input?: UsageReportOptionsInput): Promise<TelnyxEnvelope>;
  queryUsageReport(input: UsageQueryInput): Promise<TelnyxEnvelope>;
}

export interface AutoRechargePolicy {
  maxThresholdAmount: number;
  maxRechargeAmount: number;
  version?: string;
}

export interface DiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export interface MutationPreview {
  action: string;
  financial_side_effect: boolean;
  policy_version: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diff: DiffEntry[];
  confirmation_token: string;
  expires: string;
  instructions: string;
}
