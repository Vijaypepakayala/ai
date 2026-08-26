import { describe, expect, it } from "vitest";

import { createBillingService, DEFAULT_AUTO_RECHARGE_POLICY } from "../src/service.js";
import { TelnyxBillingError } from "../src/telnyxClient.js";
import type { BillingServiceClient } from "../src/types.js";

function mutationClient(): { client: BillingServiceClient; calls: string[]; state: { auto: Record<string, unknown>; group: Record<string, unknown> } } {
  const calls: string[] = [];
  const state: { auto: Record<string, unknown>; group: Record<string, unknown> } = {
    auto: { id: "arp_1", record_type: "auto_recharge_pref", threshold_amount: "10.00", recharge_amount: "25.00", enabled: true, invoice_enabled: false, preference: "credit_paypal" },
    group: { id: "bg_keep_for_followup", record_type: "billing_group", name: "Default" }
  };
  const client: BillingServiceClient = {
    async getBalance() { return { data: {} }; },
    async getAutoRechargePreferences() { calls.push("get-auto"); return { data: { ...state.auto } }; },
    async updateAutoRechargePreferences(payload) { calls.push("patch-auto"); state.auto = { ...state.auto, ...payload }; return { data: { ...state.auto } }; },
    async createStoredPaymentTransaction(payload) { calls.push("post-stored-payment"); return { data: { id: "txn_1", record_type: "transaction", amount_cents: Math.round(Number(payload.amount) * 100), processor_status: "submitted_for_settlement", amount_currency: "USD", auto_recharge: false, transaction_processing_type: "stored_payment" } }; },
    async listBillingGroups() { return { data: [] }; },
    async createBillingGroup(payload) { calls.push("post-group"); return { data: { id: "bg_new", record_type: "billing_group", name: payload.name } }; },
    async getBillingGroup(id) { calls.push(`get-group:${id}`); return { data: { ...state.group, id } }; },
    async updateBillingGroup(id, payload) { calls.push(`patch-group:${id}`); state.group = { ...state.group, id, ...payload }; return { data: { ...state.group } }; },
    async getUsageReportOptions() { return { data: {} }; },
    async queryUsageReport() { return { data: [] }; }
  };
  return { client, calls, state };
}

describe("guarded auto-recharge updates", () => {
  it("previews a before/after diff and token without mutating", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);

    const preview = await service.previewAutoRechargeUpdate({ threshold_amount: "20.00", recharge_amount: "50.00", enabled: true });

    expect(preview.action).toBe("billing.update_auto_recharge_preferences");
    expect(preview.financial_side_effect).toBe(true);
    expect(preview.diff).toEqual(
      expect.arrayContaining([
        { field: "threshold_amount", before: "10.00", after: "20.00" },
        { field: "recharge_amount", before: "25.00", after: "50.00" }
      ])
    );
    expect(preview.confirmation_token).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toEqual(["get-auto"]);
  });

  it("requires a valid preview token and patches only after the current state still matches", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);
    const update = { threshold_amount: "20.00", recharge_amount: "50.00", enabled: false };
    const preview = await service.previewAutoRechargeUpdate(update);

    await expect(service.updateAutoRechargePreferences({ ...update, confirmation_token: "bad-token" })).rejects.toThrow("confirmation token");
    const result = await service.updateAutoRechargePreferences({ ...update, confirmation_token: preview.confirmation_token });

    expect(result.data).toMatchObject({ threshold_amount: "20.00", recharge_amount: "50.00", enabled: false });
    expect(calls).toEqual(["get-auto", "get-auto", "get-auto", "patch-auto"]);
  });

  it("rejects amounts above conservative app guardrail caps before patching", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client, { autoRechargePolicy: { maxThresholdAmount: 100, maxRechargeAmount: 200 } });

    await expect(service.previewAutoRechargeUpdate({ threshold_amount: "101.00" })).rejects.toThrow("threshold_amount exceeds app guardrail");
    await expect(service.previewAutoRechargeUpdate({ recharge_amount: String(DEFAULT_AUTO_RECHARGE_POLICY.maxRechargeAmount + 1) })).rejects.toThrow("recharge_amount exceeds app guardrail");
    expect(calls).toEqual([]);
  });

  it("rejects blank auto-recharge string fields before previewing or patching", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);
    const blankInputs = [
      { input: { threshold_amount: "   " }, message: "threshold_amount must not be blank" },
      { input: { recharge_amount: "\t\n" }, message: "recharge_amount must not be blank" },
      { input: { preference: "   " }, message: "preference must not be blank" }
    ] as const;

    for (const { input, message } of blankInputs) {
      await expect(service.previewAutoRechargeUpdate(input)).rejects.toThrow(message);
      await expect(service.updateAutoRechargePreferences({ ...input, confirmation_token: "token" })).rejects.toThrow(message);
    }
    expect(calls).toEqual([]);
  });

  it("rejects non-numeric amount strings before fetching current preferences", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);

    await expect(service.previewAutoRechargeUpdate({ threshold_amount: "not-a-number" })).rejects.toThrow("Auto-recharge amounts");
    await expect(service.previewAutoRechargeUpdate({ recharge_amount: "NaN" })).rejects.toThrow("Auto-recharge amounts");
    await expect(service.updateAutoRechargePreferences({ threshold_amount: "Infinity", confirmation_token: "token" })).rejects.toThrow("Auto-recharge amounts");
    expect(calls).toEqual([]);
  });

  it("rejects enabling auto-recharge when existing amounts exceed caps", async () => {
    const { client, state, calls } = mutationClient();
    state.auto = { ...state.auto, enabled: false, threshold_amount: "10.00", recharge_amount: "100000.00" };
    const service = createBillingService(client, { autoRechargePolicy: { maxThresholdAmount: 5000, maxRechargeAmount: 5000 } });

    await expect(service.previewAutoRechargeUpdate({ enabled: true })).rejects.toThrow("recharge_amount exceeds app guardrail");
    expect(calls).toEqual(["get-auto"]);
  });

  it("treats missing auto-recharge preferences as an unconfigured setup state", async () => {
    const { client, calls, state } = mutationClient();
    client.getAutoRechargePreferences = async () => {
      calls.push("get-auto");
      throw new TelnyxBillingError("Resource not found: The requested resource or URL could not be found.", 404, {});
    };
    client.updateAutoRechargePreferences = async (payload) => {
      calls.push("patch-auto");
      state.auto = { ...payload };
      return { data: { ...state.auto } };
    };
    const service = createBillingService(client);
    const update = { enabled: true, invoice_enabled: false, threshold_amount: "10.00", recharge_amount: "25.00", preference: "credit_paypal" };

    const preview = await service.previewAutoRechargeUpdate(update);
    const result = await service.updateAutoRechargePreferences({ ...update, confirmation_token: preview.confirmation_token });

    expect(preview.before).toEqual({ enabled: false, invoice_enabled: false, preference: "credit_paypal" });
    expect(preview.diff).toEqual(
      expect.arrayContaining([
        { field: "enabled", before: false, after: true },
        { field: "threshold_amount", before: undefined, after: "10.00" },
        { field: "recharge_amount", before: undefined, after: "25.00" }
      ])
    );
    expect(result.data).toMatchObject(update);
    expect(calls).toEqual(["get-auto", "get-auto", "patch-auto"]);
  });

  it("still surfaces non-404 auto-recharge lookup failures", async () => {
    const { client } = mutationClient();
    client.getAutoRechargePreferences = async () => {
      throw new TelnyxBillingError("Telnyx request failed with status 500", 500, {});
    };
    const service = createBillingService(client);

    await expect(service.previewAutoRechargeUpdate({ enabled: true })).rejects.toThrow("status 500");
  });

  it("previews and confirms stored payment transactions with amount-specific tokens", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);
    const preview = await service.previewStoredPaymentTransaction({ amount: "25.00" });

    expect(preview.action).toBe("billing.create_stored_payment_transaction");
    expect(preview.financial_side_effect).toBe(true);
    expect(preview.after).toMatchObject({ amount: "25.00", transaction_processing_type: "stored_payment" });
    await expect(service.createStoredPaymentTransaction({ amount: "30.00", confirmation_token: preview.confirmation_token })).rejects.toThrow("confirmation token");

    const result = await service.createStoredPaymentTransaction({ amount: "25.00", confirmation_token: preview.confirmation_token });

    expect(result.data).toMatchObject({ amount_cents: 2500, transaction_processing_type: "stored_payment" });
    expect(calls).toEqual(["post-stored-payment"]);
  });

  it("rejects invalid stored payment amounts before posting", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client, { maxStoredPaymentAmount: 50 });

    await expect(service.previewStoredPaymentTransaction({ amount: "25" })).rejects.toThrow("dollars and cents");
    await expect(service.previewStoredPaymentTransaction({ amount: "0.00" })).rejects.toThrow("greater than 0");
    await expect(service.previewStoredPaymentTransaction({ amount: "50.01" })).rejects.toThrow("guardrail max");
    await expect(service.createStoredPaymentTransaction({ amount: "10.00", confirmation_token: "bad-token" })).rejects.toThrow("confirmation token");
    expect(calls).toEqual([]);
  });
});

describe("guarded billing group mutations", () => {
  it("previews and confirms billing group rename tokens", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);

    const preview = await service.previewBillingGroupUpdate({ id: "bg_keep_for_followup", name: "Production" });
    const result = await service.updateBillingGroup({ id: "bg_keep_for_followup", name: "Production", confirmation_token: preview.confirmation_token });

    expect(preview.financial_side_effect).toBe(false);
    expect(preview.diff).toEqual([{ field: "name", before: "Default", after: "Production" }]);
    expect(result.data).toMatchObject({ id: "bg_keep_for_followup", name: "Production" });
    expect(calls).toEqual(["get-group:bg_keep_for_followup", "get-group:bg_keep_for_followup", "patch-group:bg_keep_for_followup"]);
  });

  it("invalidates billing group tokens when current resource has changed", async () => {
    const { client, state } = mutationClient();
    const service = createBillingService(client);
    const preview = await service.previewBillingGroupUpdate({ id: "bg_keep_for_followup", name: "Production" });
    state.group.name = "Changed elsewhere";

    await expect(service.updateBillingGroup({ id: "bg_keep_for_followup", name: "Production", confirmation_token: preview.confirmation_token })).rejects.toThrow("confirmation token");
  });

  it("requires explicit confirm=true and a valid name for billing group creation", async () => {
    const { client, calls } = mutationClient();
    const service = createBillingService(client);

    await expect(service.createBillingGroup({ name: "New group", confirm: false })).rejects.toThrow("confirm=true");
    await expect(service.createBillingGroup({ name: "   ", confirm: true })).rejects.toThrow("name is required");
    const result = await service.createBillingGroup({ name: "New group", confirm: true });

    expect(result.data).toMatchObject({ id: "bg_new", name: "New group" });
    expect(calls).toEqual(["post-group"]);
  });
});
