import type {
  AnalyzeNumberDeps,
  AnalyzeNumberInput,
  BatchAnalyzeInput,
  BatchAnalyzeOptions,
  HealthStatus,
  NumberIntelligenceBatchResult,
  NumberIntelligenceResult,
  NumberIntelligenceSignal,
  NumberIntelligenceSource,
  NumberIntelligenceSourceId,
  OptionalSignals,
  RecommendedAction,
  TelnyxNumberLookupResponse
} from "./types.js";

const UNKNOWN = "unknown";
const DEFAULT_LIVE_SOURCES: NumberIntelligenceSourceId[] = ["owned", "messaging", "voice"];
const ALL_ENRICHMENT_SOURCES: Exclude<NumberIntelligenceSourceId, "lookup">[] = [
  "owned",
  "portability",
  "messaging",
  "voice",
  "reputation"
];
const DEFAULT_MAX_BATCH_SIZE = 25;

export async function analyzeNumber(
  input: AnalyzeNumberInput,
  deps: AnalyzeNumberDeps
): Promise<NumberIntelligenceResult> {
  const normalized = normalizePhoneNumber(input.phone_number);
  const signals: NumberIntelligenceSignal[] = [];
  const sources: NumberIntelligenceSource[] = [];
  const recommendedActions = new Map<string, RecommendedAction>();

  let lookup: TelnyxNumberLookupResponse | undefined;
  let lookupError: Error | undefined;

  try {
    lookup = await deps.lookupClient.lookupNumber(normalized);
    sources.push({
      id: "telnyx.number_lookup",
      label: "Telnyx Number Lookup",
      status: "consulted",
      detail: "GET /v2/number_lookup/{phone_number}?type=carrier&type=caller-name"
    });
  } catch (error) {
    lookupError = error instanceof Error ? error : new Error(String(error));
    sources.push({
      id: "telnyx.number_lookup",
      label: "Telnyx Number Lookup",
      status: "error",
      detail: redactString(lookupError.message, normalized)
    });
  }

  const data = lookup?.data;
  const carrierName = stringOrUnknown(data?.carrier?.name);
  const carrierType = normalizeCarrierType(data?.carrier?.type);
  const country = stringOrUnknown(data?.country_code);
  const callerName = data?.caller_name?.caller_name ?? undefined;
  const optional: OptionalSignals = { ...(deps.optionalSignals ?? {}) };

  await collectSourceSignals(input, deps, normalized, optional, sources, signals);

  if (lookupError) {
    signals.push({
      id: "lookup.error",
      label: "Lookup unavailable",
      status: "warning",
      detail: "Telnyx Number Lookup could not be completed. Retry or verify the number format.",
      value: lookupError.name
    });
    recommendedActions.set("retry_lookup", {
      id: "retry_lookup",
      label: "Retry number lookup",
      rationale: "The primary lookup failed, so carrier, caller name, and capability signals may be incomplete.",
      tool_hint: "number_intelligence_analyze"
    });
  } else if (carrierName !== UNKNOWN || carrierType !== UNKNOWN) {
    signals.push({
      id: "lookup.carrier",
      label: "Carrier lookup",
      status: "info",
      detail: `Carrier ${carrierName}; type ${carrierType}.`,
      value: carrierName
    });
  } else {
    signals.push({
      id: "lookup.carrier",
      label: "Carrier lookup",
      status: "warning",
      detail: "Carrier details were not returned by Number Lookup.",
      value: UNKNOWN
    });
  }

  if (callerName) {
    signals.push({
      id: "lookup.caller_name",
      label: "Caller name",
      status: "info",
      detail: `Caller name returned as ${callerName}.`,
      value: callerName
    });
  } else if (!lookupError) {
    signals.push({
      id: "lookup.caller_name",
      label: "Caller name",
      status: "warning",
      detail: "Caller-name data was not available for this lookup.",
      value: UNKNOWN
    });
  }

  const messagingCapability = inferMessagingCapability(carrierType, optional.messaging);
  const voiceCapability = inferVoiceCapability(carrierType, optional.voice);
  const portability = summarizePortability(optional.portability);
  const ownership = summarizeOwnership(optional.ownership, callerName);
  const reputation = summarizeReputation(optional.reputation);

  addCapabilitySignals(signals, optional, carrierType, messagingCapability, voiceCapability, recommendedActions);
  addOptionalSourceStatuses(sources, optional, input, deps);

  if (optional.portability) {
    if (optional.portability.portable === false || optional.portability.status === "not_portable") {
      signals.push({
        id: "portability.status",
        label: "Portability",
        status: "action_required",
        detail: optional.portability.reason ?? "The number is currently marked not portable.",
        value: false
      });
      recommendedActions.set("review_portability_block", {
        id: "review_portability_block",
        label: "Review portability blocker",
        rationale: optional.portability.reason ?? "Resolve the reported portability issue before starting any port workflow.",
        href: "https://portal.telnyx.com/#/porting",
        tool_hint: "portability_check"
      });
    } else if (optional.portability.portable === true || optional.portability.status === "portable") {
      signals.push({
        id: "portability.status",
        label: "Portability",
        status: "info",
        detail: optional.portability.reason ?? "The number appears portable based on supplied signals.",
        value: true
      });
    }
  }

  if (optional.messaging) {
    if (optional.messaging.configured === false) {
      signals.push({
        id: "messaging.configuration",
        label: "Messaging configuration",
        status: "action_required",
        detail: optional.messaging.reason ?? "Messaging is not configured for this number.",
        value: false
      });
      recommendedActions.set("attach_messaging_profile", {
        id: "attach_messaging_profile",
        label: "Attach or fix messaging profile",
        rationale: optional.messaging.reason ?? "A messaging-capable number needs an active messaging profile before send/receive traffic.",
        href: "https://portal.telnyx.com/#/app/messaging/profiles",
        tool_hint: "messaging_readiness_check"
      });
    } else if (optional.messaging.configured === true) {
      signals.push({
        id: "messaging.configuration",
        label: "Messaging configuration",
        status: "info",
        detail: optional.messaging.reason ?? "Messaging configuration signal is healthy.",
        value: optional.messaging.profileId ?? true
      });
    }
  }

  if (optional.reputation?.status === "bad") {
    signals.push({
      id: "reputation.cached",
      label: "Reputation",
      status: "action_required",
      detail: optional.reputation.reason ?? "Cached reputation signal is bad.",
      value: "bad"
    });
    recommendedActions.set("investigate_reputation", {
      id: "investigate_reputation",
      label: "Investigate reputation before use",
      rationale: "Bad reputation can reduce deliverability or increase answer-rate risk.",
      tool_hint: "cached_reputation_review"
    });
  } else if (optional.reputation?.status === "warning") {
    signals.push({
      id: "reputation.cached",
      label: "Reputation",
      status: "warning",
      detail: optional.reputation.reason ?? "Cached reputation signal needs review.",
      value: "warning"
    });
  }

  if (messagingCapability === "likely_supported") {
    recommendedActions.set("confirm_messaging_profile", {
      id: "confirm_messaging_profile",
      label: "Confirm messaging profile before sending",
      rationale: "Carrier type suggests messaging may be supported; confirm the messaging readiness source or profile configuration before production sends.",
      href: "https://portal.telnyx.com/#/app/messaging/profiles",
      tool_hint: "messaging_readiness_check"
    });
  }

  if (carrierType === "mobile") {
    recommendedActions.set("verify_compliance_use_case", {
      id: "verify_compliance_use_case",
      label: "Verify messaging compliance/use case",
      rationale: "Mobile destinations can require campaign/use-case compliance before production messaging.",
      tool_hint: "compliance_review"
    });
  }

  if (recommendedActions.size === 0 && !lookupError) {
    recommendedActions.set("monitor_before_launch", {
      id: "monitor_before_launch",
      label: "Monitor this number before production use",
      rationale: "No blocking issue was found from available read-only signals; review readiness checks before launch."
    });
  }

  const health = scoreHealth(signals, Boolean(lookupError));
  const normalizedFromLookup = data?.phone_number ? normalizePhoneNumber(data.phone_number) : normalized;
  const redactedInput = redactPhoneNumber(input.phone_number);
  const redactedNormalized = redactPhoneNumber(normalizedFromLookup);
  const redactedNationalFormat = data?.national_format ? redactString(data.national_format, normalizedFromLookup) : undefined;
  const displayLabel =
    redactedNationalFormat && redactedNationalFormat !== redactedNormalized
      ? `${redactedNationalFormat} (${redactedNormalized})`
      : redactedNormalized;

  return {
    input: { phone_number: redactedInput },
    normalized: {
      e164: redactedNormalized,
      e164_validated: false,
      ...(redactedNationalFormat ? { national_format: redactedNationalFormat } : {})
    },
    display: {
      redacted: redactedNormalized,
      label: displayLabel
    },
    summary: {
      type: carrierType,
      carrier: carrierName,
      country,
      ownership,
      portability,
      messaging: messagingCapability,
      voice: voiceCapability,
      reputation
    },
    health,
    signals,
    recommended_actions: Array.from(recommendedActions.values()),
    sources,
    ...(input.include_raw && lookup ? { raw: { telnyx_number_lookup: redactRaw(lookup, normalized) } } : {})
  };
}

export async function analyzeBatchNumbers(
  input: BatchAnalyzeInput,
  deps: AnalyzeNumberDeps,
  options: BatchAnalyzeOptions = {}
): Promise<NumberIntelligenceBatchResult> {
  const numbers = parseBatchNumbers(input.numbers);
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

  if (numbers.length === 0) {
    throw new Error("Batch analysis requires at least one phone number.");
  }
  if (numbers.length > maxBatchSize) {
    throw new Error(`Batch analysis accepts at most ${maxBatchSize} numbers per request.`);
  }

  const results: NumberIntelligenceResult[] = [];
  for (const phoneNumber of numbers) {
    results.push(
      await analyzeNumber(
        { phone_number: phoneNumber, include_raw: input.include_raw, sources: input.sources },
        deps
      )
    );
  }

  const health_status_counts: Record<HealthStatus, number> = { good: 0, warning: 0, bad: 0, unknown: 0 };
  let action_required_count = 0;
  for (const result of results) {
    health_status_counts[result.health.status] += 1;
    action_required_count += result.signals.filter((signal) => signal.status === "action_required").length;
  }

  return {
    total: results.length,
    aggregate: { health_status_counts, action_required_count },
    results
  };
}

export function normalizePhoneNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+") && digits.length > 0) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length > 0) {
    return `+${digits}`;
  }

  return trimmed;
}

export function redactPhoneNumber(phoneNumber: string): string {
  const normalized = normalizePhoneNumber(phoneNumber);
  const digits = normalized.replace(/\D/g, "");

  if (digits.length < 4) {
    return "[redacted-number]";
  }

  const visiblePrefix = digits.slice(0, Math.min(4, digits.length - 2));
  const visibleSuffix = digits.slice(-2);
  const stars = "*".repeat(6);
  return `+${visiblePrefix}${stars}${visibleSuffix}`;
}

function stringOrUnknown(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : UNKNOWN;
}

function normalizeCarrierType(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return UNKNOWN;
  }

  return value.toLowerCase().replace(/\s+/g, "_");
}

function inferMessagingCapability(carrierType: string, messaging?: OptionalSignals["messaging"]): string {
  if (messaging?.configured === false) {
    return "misconfigured";
  }
  if (messaging?.configured === true) {
    return "ready";
  }
  if (messaging?.capable === false) {
    return "not_supported";
  }
  if (["mobile", "voip", "fixed_or_mobile", "toll_free"].includes(carrierType)) {
    return "likely_supported";
  }
  if (["landline", "fixed_line", "premium_rate"].includes(carrierType)) {
    return "unlikely_supported";
  }
  return UNKNOWN;
}

function inferVoiceCapability(carrierType: string, voice?: OptionalSignals["voice"]): string {
  if (voice?.configured === false) {
    return "misconfigured";
  }
  if (voice?.configured === true) {
    return "ready";
  }
  if (carrierType === UNKNOWN) {
    return UNKNOWN;
  }
  return "likely_supported";
}

function summarizePortability(portability?: OptionalSignals["portability"]): string {
  if (!portability) {
    return UNKNOWN;
  }
  if (portability.portable === false || portability.status === "not_portable") {
    return "not_portable";
  }
  if (portability.portable === true || portability.status === "portable") {
    return "portable";
  }
  return UNKNOWN;
}

function summarizeOwnership(ownership?: OptionalSignals["ownership"], callerName?: string): string {
  if (ownership?.owned === true) {
    return "owned";
  }
  if (ownership?.owned === false) {
    return "not_owned";
  }
  if (callerName) {
    return callerName;
  }
  return UNKNOWN;
}

function summarizeReputation(reputation?: OptionalSignals["reputation"]): string {
  return reputation?.status ?? UNKNOWN;
}

async function collectSourceSignals(
  input: AnalyzeNumberInput,
  deps: AnalyzeNumberDeps,
  normalized: string,
  optional: OptionalSignals,
  sources: NumberIntelligenceSource[],
  signals: NumberIntelligenceSignal[]
): Promise<void> {
  const requested = requestedEnrichmentSources(input, deps);

  await collectSingleSource("owned", requested, sources, signals, normalized, async () => {
    const signal = await deps.sources?.owned?.getOwnedNumber?.(normalized);
    if (signal) optional.ownership = signal;
  });

  await collectSingleSource("portability", requested, sources, signals, normalized, async () => {
    const signal = await deps.sources?.portability?.checkPortability?.(normalized);
    if (signal) optional.portability = signal;
  });

  await collectSingleSource("messaging", requested, sources, signals, normalized, async () => {
    const signal = await deps.sources?.messaging?.checkMessagingReadiness?.(normalized);
    if (signal) optional.messaging = signal;
  });

  await collectSingleSource("voice", requested, sources, signals, normalized, async () => {
    const signal = await deps.sources?.voice?.checkVoiceReadiness?.(normalized);
    if (signal) optional.voice = signal;
  });

  await collectSingleSource("reputation", requested, sources, signals, normalized, async () => {
    const signal = await deps.sources?.reputation?.getCachedReputation?.(normalized);
    if (signal) optional.reputation = signal;
  });
}

async function collectSingleSource(
  sourceId: Exclude<NumberIntelligenceSourceId, "lookup">,
  requested: Exclude<NumberIntelligenceSourceId, "lookup">[],
  sources: NumberIntelligenceSource[],
  signals: NumberIntelligenceSignal[],
  normalized: string,
  run: () => Promise<void>
): Promise<void> {
  if (!requested.includes(sourceId)) {
    return;
  }

  try {
    await run();
    sources.push({
      id: sourceStatusId(sourceId),
      label: sourceLabel(sourceId),
      status: "consulted",
      detail: sourceConsultedDetail(sourceId)
    });
  } catch (error) {
    const sourceError = error instanceof Error ? error : new Error(String(error));
    sources.push({
      id: sourceStatusId(sourceId),
      label: sourceLabel(sourceId),
      status: "error",
      detail: redactString(sourceError.message, normalized)
    });
    signals.push({
      id: `source.${sourceStatusId(sourceId)}.error`,
      label: `${sourceLabel(sourceId)} unavailable`,
      status: "warning",
      detail: `${sourceLabel(sourceId)} could not be completed; analysis continues with available sources.`,
      value: sourceError.name
    });
  }
}

function requestedEnrichmentSources(
  input: AnalyzeNumberInput,
  deps: AnalyzeNumberDeps
): Exclude<NumberIntelligenceSourceId, "lookup">[] {
  const selected = input.sources ?? deps.defaultSources ?? (deps.sources ? DEFAULT_LIVE_SOURCES : []);
  const unique = new Set<Exclude<NumberIntelligenceSourceId, "lookup">>();
  for (const sourceId of selected) {
    if (sourceId !== "lookup" && ALL_ENRICHMENT_SOURCES.includes(sourceId)) {
      unique.add(sourceId);
    }
  }
  return Array.from(unique);
}

function sourceStatusId(sourceId: Exclude<NumberIntelligenceSourceId, "lookup">): string {
  return sourceId === "owned" ? "telnyx.owned_numbers" : `telnyx.${sourceId}`;
}

function sourceLabel(sourceId: Exclude<NumberIntelligenceSourceId, "lookup">): string {
  switch (sourceId) {
    case "owned":
      return "Telnyx owned-number configuration";
    case "portability":
      return "Telnyx portability check";
    case "messaging":
      return "Telnyx messaging readiness";
    case "voice":
      return "Telnyx voice readiness";
    case "reputation":
      return "Telnyx cached reputation";
  }
}

function sourceConsultedDetail(sourceId: Exclude<NumberIntelligenceSourceId, "lookup">): string {
  switch (sourceId) {
    case "owned":
      return "GET /v2/phone_numbers?filter[phone_number]=...";
    case "portability":
      return "POST /v2/portability_checks (eligibility only; no port order is created).";
    case "messaging":
      return "GET /v2/phone_numbers/messaging and GET /v2/messaging_profiles/{id} when attached.";
    case "voice":
      return "GET /v2/phone_numbers/voice and GET /v2/connections/{id} when attached.";
    case "reputation":
      return "GET /v2/reputation/numbers/{phone_number}?fresh=false (cached only).";
  }
}

function parseBatchNumbers(numbers: string | string[]): string[] {
  const rawRows = Array.isArray(numbers) ? numbers : numbers.split(/\r?\n/);
  const parsed: string[] = [];

  for (const row of rawRows) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (["phone_number", "phone", "number"].includes(lower)) continue;

    const firstCsvCell = splitCsvRow(trimmed)[0]?.trim();
    if (!firstCsvCell) continue;
    if (["phone_number", "phone", "number"].includes(firstCsvCell.toLowerCase())) continue;
    parsed.push(firstCsvCell);
  }

  return Array.from(new Set(parsed));
}

function splitCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function addCapabilitySignals(
  signals: NumberIntelligenceSignal[],
  optional: OptionalSignals,
  carrierType: string,
  messagingCapability: string,
  voiceCapability: string,
  recommendedActions: Map<string, RecommendedAction>
): void {
  if (messagingCapability === "likely_supported" || messagingCapability === "ready") {
    signals.push({
      id: "messaging.capability",
      label: "Messaging capability",
      status: "info",
      detail: `Carrier type ${carrierType} suggests messaging is ${messagingCapability.replace("_", " ")}.`,
      value: messagingCapability
    });
  } else if (messagingCapability === "unlikely_supported" || messagingCapability === "not_supported") {
    signals.push({
      id: "messaging.capability",
      label: "Messaging capability",
      status: "warning",
      detail: `Carrier type ${carrierType} may not support messaging reliably.`,
      value: messagingCapability
    });
    recommendedActions.set("confirm_sms_capability", {
      id: "confirm_sms_capability",
      label: "Confirm SMS capability before use",
      rationale: "The line type does not clearly support messaging.",
      tool_hint: "messaging_readiness_check"
    });
  }

  if (voiceCapability === "misconfigured") {
    signals.push({
      id: "voice.configuration",
      label: "Voice configuration",
      status: "action_required",
      detail: optional.voice?.reason ?? "Voice is not configured for this number.",
      value: false
    });
    recommendedActions.set("fix_voice_configuration", {
      id: "fix_voice_configuration",
      label: "Fix voice configuration",
      rationale: optional.voice?.reason ?? "Voice traffic may fail until configuration is corrected.",
      tool_hint: "voice_readiness_check"
    });
  }
}

function addOptionalSourceStatuses(
  sources: NumberIntelligenceSource[],
  optional: OptionalSignals,
  input: AnalyzeNumberInput,
  deps: AnalyzeNumberDeps
): void {
  const requested = requestedEnrichmentSources(input, deps);
  for (const sourceId of ALL_ENRICHMENT_SOURCES) {
    const id = sourceStatusId(sourceId);
    if (sources.some((source) => source.id === id)) {
      continue;
    }
    const hasOptionalSignal = sourceId === "owned" ? Boolean(optional.ownership) : Boolean(optional[sourceId]);
    sources.push({
      id,
      label: sourceLabel(sourceId),
      status: hasOptionalSignal ? "consulted" : "unavailable",
      detail: hasOptionalSignal
        ? "Supplied by injected optional signal."
        : requested.includes(sourceId)
          ? "Requested, but no source client is configured."
          : sourceId === "reputation"
            ? "Not queried by default; cached reputation is opt-in and always uses fresh=false."
            : "Not requested for this analysis."
    });
  }
}

function scoreHealth(signals: NumberIntelligenceSignal[], lookupFailed: boolean): NumberIntelligenceResult["health"] {
  if (lookupFailed) {
    return {
      status: "unknown",
      score: 0,
      rationale: "Primary lookup failed; available intelligence is incomplete."
    };
  }

  const actionRequired = signals.filter((signal) => signal.status === "action_required").length;
  const warnings = signals.filter((signal) => signal.status === "warning").length;

  let score = 90 - warnings * 12 - actionRequired * 30;
  score = Math.max(0, Math.min(100, score));

  let status: HealthStatus = "good";
  if (actionRequired > 0) {
    status = actionRequired >= 2 ? "bad" : "warning";
  } else if (warnings > 0) {
    status = "warning";
  }

  return {
    status,
    score,
    rationale:
      status === "good"
        ? "Available read-only signals do not show a blocker."
        : `${actionRequired} action-required signal(s), ${warnings} warning signal(s).`
  };
}

function redactRaw(value: unknown, normalized: string): unknown {
  if (typeof value === "string") {
    return redactString(value, normalized);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactRaw(item, normalized));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactRaw(nestedValue, normalized)])
    );
  }
  return value;
}

function redactString(value: string, normalized: string): string {
  let redacted = value.split(normalized).join(redactPhoneNumber(normalized));
  const compactNormalized = normalized.replace(/\D/g, "");
  if (compactNormalized.length >= 7) {
    redacted = redacted.split(compactNormalized).join(redactPhoneNumber(normalized));
  }

  const digits = redacted.replace(/\D/g, "");
  if (digits.length >= 7 && /(?:\(?\+?\d[\d\s().-]{6,}\d\)?)/.test(redacted)) {
    return redacted.replace(/\(?\+?\d[\d\s().-]{6,}\d\)?/g, (match) => redactPhoneNumber(match));
  }

  return redacted;
}
