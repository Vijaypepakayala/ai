import { randomBytes } from "node:crypto";

export const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_CONFIRMATION_MAX_ENTRIES = 256;

export interface SingleUseConfirmationStoreOptions<T> {
  ttlMs?: number;
  maxEntries?: number;
  maxEntriesPerPartition?: number;
  partitionKey?: (value: T) => string;
  logicalKey?: (value: T) => string;
  now?: () => number;
  generateToken?: () => string;
}

export interface IssuedConfirmation {
  token: string;
  expiresAt: string;
}

type ConfirmationRecord<T> = {
  value: T;
  expiresAtMs: number;
  partition?: string;
  logicalKey?: string;
  status: "pending" | "in_flight";
};

export interface ReservedConfirmation<T> {
  value: T;
  complete: () => void;
  release: () => void;
}

export class SingleUseConfirmationStore<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntriesPerPartition?: number;
  private readonly partitionKey?: (value: T) => string;
  private readonly logicalKey?: (value: T) => string;
  private readonly now: () => number;
  private readonly generateToken: () => string;
  private readonly records = new Map<string, ConfirmationRecord<T>>();

  constructor(options: SingleUseConfirmationStoreOptions<T> = {}) {
    this.ttlMs = positiveInteger(options.ttlMs, DEFAULT_CONFIRMATION_TTL_MS);
    this.maxEntries = positiveInteger(
      options.maxEntries,
      DEFAULT_CONFIRMATION_MAX_ENTRIES
    );
    this.maxEntriesPerPartition =
      options.maxEntriesPerPartition === undefined
        ? undefined
        : positiveInteger(options.maxEntriesPerPartition, 1);
    this.partitionKey = options.partitionKey;
    this.logicalKey = options.logicalKey;
    this.now = options.now ?? Date.now;
    this.generateToken =
      options.generateToken ?? (() => randomBytes(32).toString("hex"));
  }

  issue(value: T): IssuedConfirmation {
    const nowMs = this.now();
    this.pruneExpired(nowMs);

    const partition = this.partitionKey?.(value);
    const logicalKey = this.logicalKey?.(value);
    if (
      logicalKey !== undefined &&
      [...this.records.values()].some((record) => record.logicalKey === logicalKey)
    ) {
      throw new Error(
        "A matching confirmation is already outstanding or its outcome is unresolved. Use the existing preview or verify the prior action before trying again."
      );
    }
    if (
      partition !== undefined &&
      this.maxEntriesPerPartition !== undefined &&
      this.partitionSize(partition) >= this.maxEntriesPerPartition
    ) {
      throw new Error(
        "Too many outstanding confirmations for this credential. Use an existing preview or wait for it to expire."
      );
    }
    if (this.records.size >= this.maxEntries) {
      throw new Error(
        "Confirmation capacity is temporarily full. Preview again later."
      );
    }

    const token = this.uniqueToken();
    const expiresAtMs = nowMs + this.ttlMs;
    this.records.set(token, {
      value,
      expiresAtMs,
      partition,
      logicalKey,
      status: "pending"
    });
    return { token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  consume(token: string): T | undefined {
    return this.consumeIf(token, () => true);
  }

  consumeIf(token: string, predicate: (value: T) => boolean): T | undefined {
    const nowMs = this.now();
    this.pruneExpired(nowMs);
    const record = this.records.get(token);
    if (!record || record.status !== "pending" || !predicate(record.value)) return undefined;

    // Delete synchronously before returning so concurrent confirmations cannot
    // reserve the same nonce while the caller awaits a billable upstream POST.
    this.records.delete(token);
    return record.value;
  }

  reserveIf(
    token: string,
    predicate: (value: T) => boolean
  ): ReservedConfirmation<T> | undefined {
    const nowMs = this.now();
    this.pruneExpired(nowMs);
    const record = this.records.get(token);
    if (!record || record.status !== "pending" || !predicate(record.value)) {
      return undefined;
    }

    // Reserve synchronously before the caller awaits an upstream mutation.
    // Keeping the logical record in-flight blocks duplicate previews as well
    // as same-token replay. An ambiguous failure intentionally leaves a
    // short-lived tombstone; only a known success calls complete().
    const originalExpiresAtMs = record.expiresAtMs;
    record.status = "in_flight";
    record.expiresAtMs = nowMs + this.ttlMs;
    let active = true;
    return {
      value: record.value,
      complete: () => {
        if (!active) return;
        active = false;
        if (this.records.get(token) === record) this.records.delete(token);
      },
      release: () => {
        if (!active) return;
        active = false;
        if (this.records.get(token) !== record) return;
        if (originalExpiresAtMs <= this.now()) {
          this.records.delete(token);
          return;
        }
        record.status = "pending";
        record.expiresAtMs = originalExpiresAtMs;
      }
    };
  }

  private pruneExpired(nowMs: number): void {
    for (const [token, record] of this.records) {
      if (record.expiresAtMs <= nowMs) this.records.delete(token);
    }
  }

  private partitionSize(partition: string): number {
    let size = 0;
    for (const record of this.records.values()) {
      if (record.partition === partition) size += 1;
    }
    return size;
  }

  private uniqueToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = this.generateToken();
      if (token && !this.records.has(token)) return token;
    }
    throw new Error("Could not allocate a unique confirmation token");
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : fallback;
}
