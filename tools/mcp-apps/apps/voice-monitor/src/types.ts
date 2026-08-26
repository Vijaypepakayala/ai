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

export interface PageInput {
  pageNumber?: number;
  pageSize?: number;
}

export interface ConnectionData {
  id?: string;
  connection_id?: string;
  name?: string;
  connection_name?: string;
  active?: boolean;
  record_type?: string;
  [key: string]: unknown;
}

export interface CallControlApplicationData {
  id?: string;
  application_id?: string;
  application_name?: string;
  name?: string;
  active?: boolean;
  [key: string]: unknown;
}

export interface VoiceNumberData {
  id?: string;
  phone_number?: string;
  number?: string;
  connection_id?: string;
  status?: string;
  active?: boolean;
  [key: string]: unknown;
}

export interface CallEventsInput extends PageInput {
  callLegId?: string;
  applicationSessionId?: string;
  connectionId?: string;
  product?: string;
  failed?: boolean;
  from?: string;
  to?: string;
  name?: string;
  type?: string;
  status?: string;
  occurredAtEq?: string;
  occurredAtGt?: string;
  occurredAtGte?: string;
  occurredAtLt?: string;
  occurredAtLte?: string;
}

export interface RecordingsInput extends PageInput {
  callControlId?: string;
  callLegId?: string;
  callSessionId?: string;
  connectionId?: string;
  createdAtGte?: string;
  createdAtLte?: string;
}

export interface VoiceMonitorClient {
  listConnections(input?: PageInput): Promise<TelnyxEnvelope<ConnectionData[]>>;
  listCallControlApplications(input?: PageInput): Promise<TelnyxEnvelope<CallControlApplicationData[]>>;
  listPhoneNumbers(input?: PageInput): Promise<TelnyxEnvelope<VoiceNumberData[]>>;
  listActiveCalls(connectionId: string, input?: PageInput): Promise<TelnyxEnvelope>;
  listCallEvents(input: CallEventsInput): Promise<TelnyxEnvelope>;
  getCallStatus(callControlId: string): Promise<TelnyxEnvelope>;
  listRecordings(input: RecordingsInput): Promise<TelnyxEnvelope>;
}

export type OptionKind = "connection" | "call_control_application" | "voice_number";

export interface DiscoveryOption {
  kind: OptionKind;
  label: string;
  value: string;
  description?: string;
  active?: boolean;
  connection_id?: string;
  associated_number_count?: number;
  [key: string]: unknown;
}

export interface VoiceMonitorServiceOptions {
  maxPageSize?: number;
  maxDiscoveryConnections?: number;
  maxTimelineWindowHours?: number;
  maxRecordingWindowHours?: number;
  now?: () => Date;
}

export interface ListOptionsInput {
  pageNumber?: number;
  pageSize?: number;
}

export interface ActiveCallsInput {
  connectionId?: string;
  pageNumber?: number;
  pageSize?: number;
  maxConnections?: number;
}

export interface CallTimelineRequest {
  callLegId?: string;
  callSessionId?: string;
  applicationSessionId?: string;
  connectionId?: string;
  product?: string;
  failed?: boolean;
  from?: string;
  to?: string;
  name?: string;
  type?: string;
  status?: string;
  occurredAtEq?: string;
  occurredAtGt?: string;
  occurredAtGte?: string;
  occurredAtLt?: string;
  occurredAtLte?: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface CallStatusRequest {
  callControlId?: string;
}

export interface RecordingsRequest {
  callControlId?: string;
  callLegId?: string;
  callSessionId?: string;
  connectionId?: string;
  occurredAtGte?: string;
  occurredAtLte?: string;
  pageNumber?: number;
  pageSize?: number;
}
