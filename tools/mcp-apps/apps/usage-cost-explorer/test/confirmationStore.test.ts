import { describe, expect, it } from "vitest";

import { SingleUseConfirmationStore } from "../src/confirmationStore.js";

describe("SingleUseConfirmationStore", () => {
  it("consumes a nonce once and expires unused nonces", () => {
    let nowMs = Date.parse("2026-07-30T00:00:00.000Z");
    let tokenNumber = 0;
    const store = new SingleUseConfirmationStore<string>({
      ttlMs: 1000,
      now: () => nowMs,
      generateToken: () => `token-${++tokenNumber}`
    });

    const first = store.issue("first");
    expect(first.expiresAt).toBe("2026-07-30T00:00:01.000Z");
    expect(store.consumeIf(first.token, (value) => value === "different")).toBeUndefined();
    expect(store.consume(first.token)).toBe("first");
    expect(store.consume(first.token)).toBeUndefined();

    const second = store.issue("second");
    nowMs += 1000;
    expect(store.consume(second.token)).toBeUndefined();
  });

  it("fails closed instead of evicting another live nonce at global capacity", () => {
    let tokenNumber = 0;
    const store = new SingleUseConfirmationStore<string>({
      maxEntries: 2,
      generateToken: () => `token-${++tokenNumber}`
    });

    const first = store.issue("first");
    const second = store.issue("second");
    expect(() => store.issue("third")).toThrow(/capacity is temporarily full/i);
    expect(store.consume(second.token)).toBe("second");
    expect(store.consume(first.token)).toBe("first");
    expect(store.issue("third").token).toBe("token-3");
  });

  it("caps outstanding nonces per credential partition without affecting peers", () => {
    let tokenNumber = 0;
    const store = new SingleUseConfirmationStore<{ credential: string }>({
      maxEntries: 10,
      maxEntriesPerPartition: 2,
      partitionKey: (value) => value.credential,
      generateToken: () => `token-${++tokenNumber}`
    });

    const first = store.issue({ credential: "credential-a" });
    store.issue({ credential: "credential-a" });
    expect(() => store.issue({ credential: "credential-a" })).toThrow(
      /too many outstanding confirmations/i
    );

    expect(store.issue({ credential: "credential-b" }).token).toBe("token-3");
    expect(store.consume(first.token)).toEqual({ credential: "credential-a" });
    expect(store.issue({ credential: "credential-a" }).token).toBe("token-4");
  });

  it("deduplicates logical previews and keeps an ambiguous in-flight tombstone", () => {
    let nowMs = Date.parse("2026-07-30T00:00:00.000Z");
    let tokenNumber = 0;
    const store = new SingleUseConfirmationStore<{ credential: string; action: string }>({
      ttlMs: 1000,
      now: () => nowMs,
      generateToken: () => `token-${++tokenNumber}`,
      logicalKey: (value) => `${value.credential}:${value.action}`
    });

    const first = store.issue({ credential: "credential-a", action: "top-up-25" });
    expect(() =>
      store.issue({ credential: "credential-a", action: "top-up-25" })
    ).toThrow(/matching confirmation is already outstanding/i);

    const reservation = store.reserveIf(
      first.token,
      (value) => value.action === "top-up-25"
    );
    expect(reservation?.value).toEqual({
      credential: "credential-a",
      action: "top-up-25"
    });
    expect(store.reserveIf(first.token, () => true)).toBeUndefined();
    expect(() =>
      store.issue({ credential: "credential-a", action: "top-up-25" })
    ).toThrow(/outcome is unresolved/i);

    nowMs += 1000;
    expect(
      store.issue({ credential: "credential-a", action: "top-up-25" }).token
    ).toBe("token-2");
  });

  it("releases a logical action only after a known successful completion", () => {
    let tokenNumber = 0;
    const store = new SingleUseConfirmationStore<{ logical: string }>({
      generateToken: () => `token-${++tokenNumber}`,
      logicalKey: (value) => value.logical
    });
    const issued = store.issue({ logical: "rename" });
    const reservation = store.reserveIf(issued.token, () => true);
    reservation?.complete();

    expect(store.issue({ logical: "rename" }).token).toBe("token-2");
  });

  it("makes a reservation retryable after a known precondition failure", () => {
    let nowMs = 0;
    const store = new SingleUseConfirmationStore<string>({
      ttlMs: 1000,
      now: () => nowMs
    });
    const issued = store.issue("retryable");
    nowMs = 900;
    const first = store.reserveIf(issued.token, () => true);
    first?.release();

    const second = store.reserveIf(issued.token, () => true);
    expect(second?.value).toBe("retryable");
    second?.release();
    nowMs = 1000;
    expect(store.reserveIf(issued.token, () => true)).toBeUndefined();
  });
});
