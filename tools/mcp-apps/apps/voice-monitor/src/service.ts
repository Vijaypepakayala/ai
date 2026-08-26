import type {
  ActiveCallsInput,
  CallControlApplicationData,
  CallStatusRequest,
  CallTimelineRequest,
  ConnectionData,
  DiscoveryOption,
  ListOptionsInput,
  RecordingsRequest,
  TelnyxEnvelope,
  VoiceMonitorClient,
  VoiceMonitorServiceOptions,
  VoiceNumberData
} from "./types.js";
import { sanitizeVoiceMonitorValue } from "./telnyxClient.js";

export const DEFAULT_MAX_PAGE_SIZE = 100;
export const DEFAULT_MAX_DISCOVERY_CONNECTIONS = 10;
export const DEFAULT_MAX_TIMELINE_WINDOW_HOURS = 168;
export const DEFAULT_MAX_RECORDING_WINDOW_HOURS = 168;

export function createVoiceMonitorService(client: VoiceMonitorClient, options: VoiceMonitorServiceOptions = {}) {
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const maxDiscoveryConnections = options.maxDiscoveryConnections ?? DEFAULT_MAX_DISCOVERY_CONNECTIONS;
  const maxTimelineWindowHours = options.maxTimelineWindowHours ?? DEFAULT_MAX_TIMELINE_WINDOW_HOURS;
  const maxRecordingWindowHours = options.maxRecordingWindowHours ?? DEFAULT_MAX_RECORDING_WINDOW_HOURS;
  const now = options.now ?? (() => new Date());

  return {
    async listOptions(input: ListOptionsInput = {}) {
      const page = normalizePage(input, maxPageSize);
      const warnings: Array<{ source: string; message: string }> = [];

      const [connectionsEnvelope, applicationsEnvelope, phoneNumbersEnvelope] = await Promise.all([
        safeRead("connections", () => client.listConnections(page), warnings),
        safeRead("call_control_applications", () => client.listCallControlApplications(page), warnings),
        safeRead("voice_numbers", () => client.listPhoneNumbers(page), warnings)
      ]);

      const connections = dataArray<ConnectionData>(connectionsEnvelope);
      const phoneNumbers = dataArray<VoiceNumberData>(phoneNumbersEnvelope);
      const numberCounts = countNumbersByConnection(phoneNumbers);
      const connectionOptions = connections.map((connection) => connectionOption(connection, numberCounts));
      const applicationOptions = dataArray<Record<string, unknown>>(applicationsEnvelope).map(applicationOption).filter(Boolean) as DiscoveryOption[];
      const voiceNumberOptions = phoneNumbers.map(voiceNumberOption).filter(Boolean) as DiscoveryOption[];

      return sanitizeVoiceMonitorValue({
        options: {
          connections: connectionOptions,
          call_control_applications: applicationOptions,
          active_call_targets: applicationOptions,
          voice_numbers: voiceNumberOptions
        },
        summary: {
          connection_count: connectionOptions.length,
          call_control_application_count: applicationOptions.length,
          voice_number_count: voiceNumberOptions.length
        },
        warnings,
        limits: {
          page_size: page.pageSize,
          max_discovery_connections: maxDiscoveryConnections
        }
      });
    },

    async activeCalls(input: ActiveCallsInput = {}) {
      const page = normalizePage(input, maxPageSize);
      const requestedConnectionId = normalizeOptionalString(input.connectionId);
      const maxConnections = Math.min(normalizePositiveInt(input.maxConnections, maxDiscoveryConnections), maxDiscoveryConnections);
      const warnings: Array<{ source: string; message: string }> = [];
      const connections = requestedConnectionId ? [requestedConnectionId] : await discoverActiveCallTargetIds(client, page, maxConnections, warnings);
      const allCalls: unknown[] = [];
      const perConnection: Array<{ connection_id: string; active_call_count: number; data: unknown[] }> = [];

      for (const connectionId of connections) {
        try {
          const envelope = await client.listActiveCalls(connectionId, page);
          const calls = dataArray(envelope).map((call) => attachConnectionId(call, connectionId));
          allCalls.push(...calls);
          perConnection.push({ connection_id: connectionId, active_call_count: calls.length, data: calls });
        } catch (error) {
          warnings.push({ source: `active_calls:${connectionId}`, message: errorMessage(error) });
        }
      }

      return sanitizeVoiceMonitorValue({
        connections_consulted: connections,
        truncated_connections: !requestedConnectionId && connections.length === maxConnections,
        total_active_calls: allCalls.length,
        active_calls: allCalls,
        per_connection: perConnection,
        warnings,
        limits: { page_size: page.pageSize, max_connections: maxConnections }
      });
    },

    async callTimeline(input: CallTimelineRequest = {}) {
      const page = normalizePage(input, maxPageSize);
      const normalized = normalizeTimelineInput(input, page, now, maxTimelineWindowHours);
      const envelope = await client.listCallEvents(normalized);
      return sanitizeVoiceMonitorValue({
        ...envelope,
        filters_notice: normalized.notice,
        applied_filters: normalized.appliedFilters
      });
    },

    async callStatus(input: CallStatusRequest) {
      const callControlId = normalizeRequiredString(input.callControlId, "call_control_id is required.");
      return sanitizeVoiceMonitorValue(await client.getCallStatus(callControlId));
    },

    async recordings(input: RecordingsRequest = {}) {
      const page = normalizePage(input, maxPageSize);
      const normalized = normalizeRecordingsInput(input, page, now, maxRecordingWindowHours);
      const envelope = await client.listRecordings(normalized);
      return sanitizeVoiceMonitorValue({ ...envelope, applied_filters: normalized.appliedFilters });
    }
  };
}

export type VoiceMonitorService = ReturnType<typeof createVoiceMonitorService>;

type Page = { pageNumber: number; pageSize: number };
type TimelineClientInput = Parameters<VoiceMonitorClient["listCallEvents"]>[0] & { notice?: string; appliedFilters?: Record<string, unknown> };
type RecordingsClientInput = Parameters<VoiceMonitorClient["listRecordings"]>[0] & { appliedFilters?: Record<string, unknown> };

async function safeRead<T>(source: string, read: () => Promise<T>, warnings: Array<{ source: string; message: string }>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    warnings.push({ source, message: errorMessage(error) });
    return undefined;
  }
}

async function discoverActiveCallTargetIds(
  client: VoiceMonitorClient,
  page: Page,
  maxConnections: number,
  warnings: Array<{ source: string; message: string }>
): Promise<string[]> {
  const envelope = await safeRead("call_control_applications", () => client.listCallControlApplications({ pageNumber: page.pageNumber, pageSize: maxConnections }), warnings);
  return dataArray<CallControlApplicationData>(envelope)
    .map((application) => normalizeOptionalString(valueAsString(application.id ?? application.application_id)))
    .filter((value): value is string => Boolean(value))
    .slice(0, maxConnections);
}

function normalizeTimelineInput(input: CallTimelineRequest, page: Page, now: () => Date, maxWindowHours: number): TimelineClientInput {
  const applicationSessionId = normalizeOptionalString(input.applicationSessionId ?? input.callSessionId);
  const callLegId = normalizeOptionalString(input.callLegId);
  const hasLegOrSession = Boolean(callLegId || applicationSessionId);
  let occurredAtGte = normalizeOptionalString(input.occurredAtGte);
  let occurredAtLte = normalizeOptionalString(input.occurredAtLte);
  let notice: string | undefined;

  if (!hasLegOrSession && !input.occurredAtEq && !input.occurredAtGt && !input.occurredAtLt && !occurredAtGte && !occurredAtLte) {
    const end = now();
    const start = new Date(end.getTime() - 24 * 3_600_000);
    occurredAtGte = start.toISOString();
    occurredAtLte = end.toISOString();
    notice = "No call_leg_id or application_session_id was supplied; defaulted to the last 24 hours for Telnyx call_events filtering.";
  }

  enforceWindow(occurredAtGte, occurredAtLte, hasLegOrSession ? maxWindowHours : Math.min(24, maxWindowHours), "Call timeline");

  const normalized: TimelineClientInput = {
    callLegId,
    applicationSessionId,
    connectionId: normalizeOptionalString(input.connectionId),
    product: normalizeOptionalString(input.product),
    failed: input.failed,
    from: normalizeOptionalString(input.from),
    to: normalizeOptionalString(input.to),
    name: normalizeOptionalString(input.name),
    type: normalizeOptionalString(input.type),
    status: normalizeOptionalString(input.status),
    occurredAtEq: normalizeOptionalString(input.occurredAtEq),
    occurredAtGt: normalizeOptionalString(input.occurredAtGt),
    occurredAtGte,
    occurredAtLt: normalizeOptionalString(input.occurredAtLt),
    occurredAtLte,
    pageNumber: page.pageNumber,
    pageSize: page.pageSize,
    notice
  };
  normalized.appliedFilters = compactRecord({
    call_leg_id: normalized.callLegId,
    application_session_id: normalized.applicationSessionId,
    connection_id: normalized.connectionId,
    product: normalized.product,
    failed: normalized.failed,
    from: normalized.from,
    to: normalized.to,
    name: normalized.name,
    type: normalized.type,
    status: normalized.status,
    occurred_at_eq: normalized.occurredAtEq,
    occurred_at_gt: normalized.occurredAtGt,
    occurred_at_gte: normalized.occurredAtGte,
    occurred_at_lt: normalized.occurredAtLt,
    occurred_at_lte: normalized.occurredAtLte,
    page_number: normalized.pageNumber,
    page_size: normalized.pageSize
  });
  return normalized;
}

function normalizeRecordingsInput(input: RecordingsRequest, page: Page, now: () => Date, maxWindowHours: number): RecordingsClientInput {
  let createdAtGte = normalizeOptionalString(input.occurredAtGte);
  let createdAtLte = normalizeOptionalString(input.occurredAtLte);
  const hasSpecificId = Boolean(input.callControlId || input.callLegId || input.callSessionId || input.connectionId);
  if (!hasSpecificId && !createdAtGte && !createdAtLte) {
    const end = now();
    createdAtLte = end.toISOString();
    createdAtGte = new Date(end.getTime() - 24 * 3_600_000).toISOString();
  }
  enforceWindow(createdAtGte, createdAtLte, maxWindowHours, "Recording search");
  const normalized: RecordingsClientInput = {
    callControlId: normalizeOptionalString(input.callControlId),
    callLegId: normalizeOptionalString(input.callLegId),
    callSessionId: normalizeOptionalString(input.callSessionId),
    connectionId: normalizeOptionalString(input.connectionId),
    createdAtGte,
    createdAtLte,
    pageNumber: page.pageNumber,
    pageSize: page.pageSize
  };
  normalized.appliedFilters = compactRecord({
    call_control_id: normalized.callControlId,
    call_leg_id: normalized.callLegId,
    call_session_id: normalized.callSessionId,
    connection_id: normalized.connectionId,
    created_at_gte: normalized.createdAtGte,
    created_at_lte: normalized.createdAtLte,
    page_number: normalized.pageNumber,
    page_size: normalized.pageSize
  });
  return normalized;
}

function enforceWindow(startText: string | undefined, endText: string | undefined, maxHours: number, label: string): void {
  if (!startText || !endText) return;
  const start = parseIsoDateTime(startText, "start time");
  const end = parseIsoDateTime(endText, "end time");
  if (end < start) throw new Error(`${label} end time must be on or after start time.`);
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours > maxHours) {
    throw new Error(`${label} windows are capped at ${maxHours} hours by this app.`);
  }
}

function parseIsoDateTime(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid ISO date-time string.`);
  return date;
}

function connectionOption(connection: ConnectionData, counts: Map<string, number>): DiscoveryOption {
  const value = String(connection.id ?? connection.connection_id ?? "").trim();
  const label = String(connection.connection_name ?? connection.name ?? (value || "Unnamed connection"));
  return {
    kind: "connection",
    label,
    value,
    description: [connection.record_type, connection.active === false ? "inactive" : connection.active === true ? "active" : undefined].filter(Boolean).join("; ") || undefined,
    active: typeof connection.active === "boolean" ? connection.active : undefined,
    associated_number_count: value ? counts.get(value) ?? 0 : 0
  };
}

function applicationOption(application: Record<string, unknown>): DiscoveryOption | undefined {
  const value = normalizeOptionalString(valueAsString(application.id ?? application.application_id));
  if (!value) return undefined;
  return {
    kind: "call_control_application",
    value,
    label: normalizeOptionalString(valueAsString(application.application_name ?? application.name)) ?? value,
    active: typeof application.active === "boolean" ? application.active : undefined,
    description: typeof application.record_type === "string" ? application.record_type : undefined
  };
}

function voiceNumberOption(phoneNumber: VoiceNumberData): DiscoveryOption | undefined {
  const rawNumber = normalizeOptionalString(phoneNumber.phone_number ?? phoneNumber.number);
  const value = normalizeOptionalString(phoneNumber.id);
  if (!value && !rawNumber) return undefined;
  const redacted = sanitizedString("phone_number", rawNumber ?? value ?? "voice number");
  return {
    kind: "voice_number",
    value: value ?? redacted,
    label: redacted,
    connection_id: normalizeOptionalString(phoneNumber.connection_id),
    active: typeof phoneNumber.active === "boolean" ? phoneNumber.active : phoneNumber.status ? phoneNumber.status === "active" : undefined,
    description: phoneNumber.status ? `status: ${phoneNumber.status}` : undefined
  };
}

function countNumbersByConnection(phoneNumbers: VoiceNumberData[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const number of phoneNumbers) {
    const connectionId = normalizeOptionalString(number.connection_id);
    if (connectionId) counts.set(connectionId, (counts.get(connectionId) ?? 0) + 1);
  }
  return counts;
}

function dataArray<T = unknown>(envelope: TelnyxEnvelope<T[] | T> | undefined): T[] {
  const data = envelope?.data;
  if (Array.isArray(data)) return data;
  if (data === undefined || data === null) return [];
  return [data as T];
}

function attachConnectionId(call: unknown, connectionId: string): unknown {
  if (call && typeof call === "object" && !Array.isArray(call)) {
    return { connection_id: connectionId, ...(call as Record<string, unknown>) };
  }
  return { connection_id: connectionId, value: call };
}

function normalizePage(input: { pageNumber?: number; pageSize?: number }, maxPageSize: number): Page {
  return {
    pageNumber: normalizePositiveInt(input.pageNumber, 1),
    pageSize: Math.min(normalizePositiveInt(input.pageSize, Math.min(DEFAULT_MAX_PAGE_SIZE, maxPageSize)), maxPageSize)
  };
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeRequiredString(value: string | undefined, message: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : value === undefined || value === null ? undefined : String(value);
}

function sanitizedString(key: string, value: string): string {
  const sanitized = sanitizeVoiceMonitorValue({ [key]: value }) as Record<string, unknown>;
  return String(sanitized[key] ?? value);
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
