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
export const DEFAULT_MAX_AGGREGATE_OUTPUT_BYTES = 1024 * 1024;
const MIN_AGGREGATE_OUTPUT_BYTES = 4096;
const ACTIVE_CALL_OUTPUT_LIMIT_WARNING =
  "The active-call response reached its output byte limit. Returned calls may be a subset of a queried response; later connections were not queried.";

export function createVoiceMonitorService(client: VoiceMonitorClient, options: VoiceMonitorServiceOptions = {}) {
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const maxDiscoveryConnections = options.maxDiscoveryConnections ?? DEFAULT_MAX_DISCOVERY_CONNECTIONS;
  const maxTimelineWindowHours = options.maxTimelineWindowHours ?? DEFAULT_MAX_TIMELINE_WINDOW_HOURS;
  const maxRecordingWindowHours = options.maxRecordingWindowHours ?? DEFAULT_MAX_RECORDING_WINDOW_HOURS;
  const maxAggregateOutputBytes = options.maxAggregateOutputBytes ?? DEFAULT_MAX_AGGREGATE_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxAggregateOutputBytes) || maxAggregateOutputBytes < MIN_AGGREGATE_OUTPUT_BYTES) {
    throw new Error(`Voice Monitor aggregate output byte limit must be at least ${MIN_AGGREGATE_OUTPUT_BYTES}.`);
  }
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
      const connectionOptions = connections
        .map((connection) => connectionOption(connection, numberCounts))
        .filter(Boolean) as DiscoveryOption[];
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
      const connectionsConsulted: string[] = [];
      const allCalls: unknown[] = [];
      const perConnection: Array<{ connection_id: string; active_call_count: number }> = [];
      let truncatedOutput = false;

      for (const connectionId of connections) {
        if (
          !activeCallsResultFits(
            [...connectionsConsulted, connectionId],
            allCalls,
            perConnection,
            warnings,
            page,
            maxConnections,
            maxAggregateOutputBytes
          )
        ) {
          truncatedOutput = true;
          break;
        }
        connectionsConsulted.push(connectionId);

        try {
          const envelope = await client.listActiveCalls(connectionId, page);
          const calls = sanitizeVoiceMonitorValue(
            dataArray(envelope).map((call) => attachConnectionId(call, connectionId))
          ) as unknown[];
          let includedCallCount = 0;

          if (
            !activeCallsResultFits(
              connectionsConsulted,
              allCalls,
              [...perConnection, { connection_id: connectionId, active_call_count: 0 }],
              warnings,
              page,
              maxConnections,
              maxAggregateOutputBytes
            )
          ) {
            truncatedOutput = true;
            break;
          }

          if (
            activeCallsResultFits(
              connectionsConsulted,
              [...allCalls, ...calls],
              [...perConnection, { connection_id: connectionId, active_call_count: calls.length }],
              warnings,
              page,
              maxConnections,
              maxAggregateOutputBytes
            )
          ) {
            includedCallCount = calls.length;
          } else {
            truncatedOutput = true;
            let low = 0;
            let high = calls.length;
            while (low < high) {
              const midpoint = Math.ceil((low + high) / 2);
              const prefix = calls.slice(0, midpoint);
              if (
                activeCallsResultFits(
                  connectionsConsulted,
                  [...allCalls, ...prefix],
                  [...perConnection, { connection_id: connectionId, active_call_count: midpoint }],
                  warnings,
                  page,
                  maxConnections,
                  maxAggregateOutputBytes
                )
              ) {
                low = midpoint;
              } else {
                high = midpoint - 1;
              }
            }
            includedCallCount = low;
          }

          allCalls.push(...calls.slice(0, includedCallCount));
          perConnection.push({ connection_id: connectionId, active_call_count: includedCallCount });
          if (includedCallCount < calls.length) break;
        } catch (error) {
          if (isTelnyxAuthFailure(error)) throw error;
          const warning = { source: `active_calls:${connectionId}`, message: errorMessage(error) };
          if (
            !activeCallsResultFits(
              connectionsConsulted,
              allCalls,
              perConnection,
              [...warnings, warning],
              page,
              maxConnections,
              maxAggregateOutputBytes
            )
          ) {
            truncatedOutput = true;
            break;
          }
          warnings.push(warning);
        }
      }

      if (truncatedOutput) {
        warnings.push({ source: "active_calls", message: ACTIVE_CALL_OUTPUT_LIMIT_WARNING });
      }

      return sanitizeVoiceMonitorValue({
        connections_consulted: connectionsConsulted,
        truncated_connections: !requestedConnectionId && connections.length === maxConnections,
        truncated_output: truncatedOutput,
        total_active_calls: allCalls.length,
        active_calls: allCalls,
        per_connection: perConnection,
        warnings,
        limits: {
          page_size: page.pageSize,
          max_connections: maxConnections,
          max_output_bytes: maxAggregateOutputBytes
        }
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

function activeCallsResultFits(
  connectionsConsulted: string[],
  activeCalls: unknown[],
  perConnection: Array<{ connection_id: string; active_call_count: number }>,
  warnings: Array<{ source: string; message: string }>,
  page: Page,
  maxConnections: number,
  maxOutputBytes: number
): boolean {
  const candidate = sanitizeVoiceMonitorValue({
    connections_consulted: connectionsConsulted,
    truncated_connections: false,
    truncated_output: true,
    total_active_calls: activeCalls.length,
    active_calls: activeCalls,
    per_connection: perConnection,
    warnings: [
      ...warnings,
      { source: "active_calls", message: ACTIVE_CALL_OUTPUT_LIMIT_WARNING }
    ],
    limits: {
      page_size: page.pageSize,
      max_connections: maxConnections,
      max_output_bytes: maxOutputBytes
    }
  });
  return serializedBytes(candidate) <= maxOutputBytes;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

type Page = { pageNumber: number; pageSize: number };
type TimelineClientInput = Parameters<VoiceMonitorClient["listCallEvents"]>[0] & { notice?: string; appliedFilters?: Record<string, unknown> };
type RecordingsClientInput = Parameters<VoiceMonitorClient["listRecordings"]>[0] & { appliedFilters?: Record<string, unknown> };

async function safeRead<T>(source: string, read: () => Promise<T>, warnings: Array<{ source: string; message: string }>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (isTelnyxAuthFailure(error)) throw error;
    warnings.push({ source, message: errorMessage(error) });
    return undefined;
  }
}

function isTelnyxAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
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
  const occurredAtEq = normalizeOptionalString(input.occurredAtEq);
  const occurredAtGt = normalizeOptionalString(input.occurredAtGt);
  let occurredAtGte = normalizeOptionalString(input.occurredAtGte);
  const occurredAtLt = normalizeOptionalString(input.occurredAtLt);
  let occurredAtLte = normalizeOptionalString(input.occurredAtLte);
  let notice: string | undefined;

  if (!hasLegOrSession && !occurredAtEq && !occurredAtGt && !occurredAtLt && !occurredAtGte && !occurredAtLte) {
    const end = now();
    const start = new Date(end.getTime() - 24 * 3_600_000);
    occurredAtGte = start.toISOString();
    occurredAtLte = end.toISOString();
    notice = "No call_leg_id or application_session_id was supplied; defaulted to the last 24 hours for Telnyx call_events filtering.";
  }

  const timelineWindowHours = hasLegOrSession ? maxWindowHours : Math.min(24, maxWindowHours);
  const boundedWindow = enforceBoundedWindow(
    {
      equal: occurredAtEq,
      lowerExclusive: occurredAtGt,
      lowerInclusive: occurredAtGte,
      upperExclusive: occurredAtLt,
      upperInclusive: occurredAtLte
    },
    timelineWindowHours,
    "Call timeline"
  );
  if (!occurredAtGte && boundedWindow.synthesizedStart) {
    occurredAtGte = boundedWindow.synthesizedStart;
  }
  if (!occurredAtLte && boundedWindow.synthesizedEnd) {
    occurredAtLte = boundedWindow.synthesizedEnd;
  }
  if (!notice && (boundedWindow.synthesizedStart || boundedWindow.synthesizedEnd)) {
    notice = `Added the missing time bound so the Call timeline query stays within ${timelineWindowHours} hours.`;
  }

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
    occurredAtEq,
    occurredAtGt,
    occurredAtGte,
    occurredAtLt,
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
  const boundedWindow = enforceBoundedWindow(
    { lowerInclusive: createdAtGte, upperInclusive: createdAtLte },
    maxWindowHours,
    "Recording search"
  );
  if (!createdAtGte && boundedWindow.synthesizedStart) {
    createdAtGte = boundedWindow.synthesizedStart;
  }
  if (!createdAtLte && boundedWindow.synthesizedEnd) {
    createdAtLte = boundedWindow.synthesizedEnd;
  }
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

interface TimeWindowInput {
  equal?: string;
  lowerExclusive?: string;
  lowerInclusive?: string;
  upperExclusive?: string;
  upperInclusive?: string;
}

interface BoundedWindow {
  synthesizedStart?: string;
  synthesizedEnd?: string;
}

function enforceBoundedWindow(input: TimeWindowInput, maxHours: number, label: string): BoundedWindow {
  const equality = input.equal ? parseIsoDateTime(input.equal, "equality time") : undefined;
  const lowerBounds = [
    equality,
    input.lowerExclusive ? parseIsoDateTime(input.lowerExclusive, "exclusive start time") : undefined,
    input.lowerInclusive ? parseIsoDateTime(input.lowerInclusive, "start time") : undefined
  ].filter((value): value is Date => Boolean(value));
  const upperBounds = [
    equality,
    input.upperExclusive ? parseIsoDateTime(input.upperExclusive, "exclusive end time") : undefined,
    input.upperInclusive ? parseIsoDateTime(input.upperInclusive, "end time") : undefined
  ].filter((value): value is Date => Boolean(value));

  if (lowerBounds.length === 0 && upperBounds.length === 0) return {};

  let synthesizedStart: string | undefined;
  let synthesizedEnd: string | undefined;
  if (lowerBounds.length === 0) {
    const earliestUpper = new Date(Math.min(...upperBounds.map((value) => value.getTime())));
    const start = new Date(earliestUpper.getTime() - maxHours * 3_600_000);
    synthesizedStart = start.toISOString();
    lowerBounds.push(start);
  }
  if (upperBounds.length === 0) {
    const latestLower = new Date(Math.max(...lowerBounds.map((value) => value.getTime())));
    const end = new Date(latestLower.getTime() + maxHours * 3_600_000);
    synthesizedEnd = end.toISOString();
    upperBounds.push(end);
  }

  const start = new Date(Math.max(...lowerBounds.map((value) => value.getTime())));
  const end = new Date(Math.min(...upperBounds.map((value) => value.getTime())));
  if (end < start) throw new Error(`${label} end time must be on or after start time.`);
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours > maxHours) {
    throw new Error(`${label} windows are capped at ${maxHours} hours by this app.`);
  }
  return { synthesizedStart, synthesizedEnd };
}

function parseIsoDateTime(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid ISO date-time string.`);
  return date;
}

function connectionOption(
  connection: ConnectionData,
  counts: Map<string, number>
): DiscoveryOption | undefined {
  const value = String(connection.id ?? connection.connection_id ?? "").trim();
  if (!value) return undefined;
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
    return { ...(call as Record<string, unknown>), connection_id: connectionId };
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
