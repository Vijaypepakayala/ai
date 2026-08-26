export type SignalStatus = "info" | "warning" | "action_required";
export type SourceStatus = "consulted" | "unavailable" | "error";
export type HealthStatus = "good" | "warning" | "bad" | "unknown";

export interface AnalyzeNumberInput {
  phone_number: string;
  include_raw?: boolean;
  sources?: NumberIntelligenceSourceId[];
}

export type NumberIntelligenceSourceId = "lookup" | "owned" | "portability" | "messaging" | "voice" | "reputation";

export interface TelnyxCarrierInfo {
  name?: string | null;
  type?: string | null;
  mobile_country_code?: string | null;
  mobile_network_code?: string | null;
  error_code?: string | null;
}

export interface TelnyxCallerNameInfo {
  caller_name?: string | null;
  error_code?: string | null;
}

export interface TelnyxNumberLookupData {
  phone_number?: string | null;
  national_format?: string | null;
  country_code?: string | null;
  carrier?: TelnyxCarrierInfo | null;
  caller_name?: TelnyxCallerNameInfo | null;
  [key: string]: unknown;
}

export interface TelnyxNumberLookupResponse {
  data: TelnyxNumberLookupData;
  [key: string]: unknown;
}

export interface NumberLookupClient {
  lookupNumber(phoneNumber: string): Promise<TelnyxNumberLookupResponse>;
}

export interface TelnyxClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface PortabilitySignalInput {
  portable?: boolean;
  reason?: string;
  status?: "portable" | "not_portable" | "unknown";
}

export interface MessagingSignalInput {
  configured?: boolean;
  reason?: string;
  profileId?: string;
  capable?: boolean;
}

export interface OwnershipSignalInput {
  owned?: boolean;
  numberId?: string;
  reason?: string;
}

export interface ReputationSignalInput {
  status?: "good" | "warning" | "bad" | "unknown";
  reason?: string;
}

export interface VoiceSignalInput {
  configured?: boolean;
  reason?: string;
  connectionId?: string;
}

export interface OptionalSignals {
  portability?: PortabilitySignalInput;
  messaging?: MessagingSignalInput;
  ownership?: OwnershipSignalInput;
  reputation?: ReputationSignalInput;
  voice?: VoiceSignalInput;
}

export interface AnalyzeNumberDeps {
  lookupClient: NumberLookupClient;
  optionalSignals?: OptionalSignals;
  sources?: NumberIntelligenceSourceClients;
  defaultSources?: NumberIntelligenceSourceId[];
}

export interface NumberIntelligenceSignal {
  id: string;
  label: string;
  status: SignalStatus;
  detail: string;
  value?: string | boolean | number | null;
}

export interface RecommendedAction {
  id: string;
  label: string;
  rationale: string;
  href?: string;
  tool_hint?: string;
}

export interface NumberIntelligenceSource {
  id: string;
  label: string;
  status: SourceStatus;
  detail?: string;
}

export interface NumberIntelligenceSummary {
  type: string;
  carrier: string;
  country: string;
  ownership: string;
  portability: string;
  messaging: string;
  voice: string;
  reputation: string;
}

export interface NumberIntelligenceResult {
  input: { phone_number: string };
  normalized: { e164: string; e164_validated: boolean; national_format?: string };
  display: { redacted: string; label: string };
  summary: NumberIntelligenceSummary;
  health: { status: HealthStatus; score: number; rationale: string };
  signals: NumberIntelligenceSignal[];
  recommended_actions: RecommendedAction[];
  sources: NumberIntelligenceSource[];
  raw?: Record<string, unknown>;
}

export interface OwnedNumberSource {
  getOwnedNumber?(phoneNumber: string): Promise<OwnershipSignalInput>;
}

export interface PortingSource {
  checkPortability?(phoneNumber: string): Promise<PortabilitySignalInput>;
}

export interface MessagingReadinessSource {
  checkMessagingReadiness?(phoneNumber: string): Promise<MessagingSignalInput>;
}

export interface ReputationSource {
  getCachedReputation?(phoneNumber: string): Promise<ReputationSignalInput>;
}

export interface VoiceReadinessSource {
  checkVoiceReadiness?(phoneNumber: string): Promise<VoiceSignalInput>;
}

export interface NumberIntelligenceSourceClients {
  owned?: OwnedNumberSource;
  portability?: PortingSource;
  messaging?: MessagingReadinessSource;
  voice?: VoiceReadinessSource;
  reputation?: ReputationSource;
}

export interface BatchAnalyzeInput {
  numbers: string | string[];
  include_raw?: boolean;
  sources?: NumberIntelligenceSourceId[];
}

export interface BatchAnalyzeOptions {
  maxBatchSize?: number;
}

export interface NumberIntelligenceBatchResult {
  total: number;
  aggregate: {
    health_status_counts: Record<HealthStatus, number>;
    action_required_count: number;
  };
  results: NumberIntelligenceResult[];
}
