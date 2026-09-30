import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BillingDatasetSchema, money } from "../../src/contracts";
import { engine } from "../../src/engine";

function hash(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function assertIntegers(value: unknown, path = "output"): void {
  if (typeof value === "number")
    expect(Number.isSafeInteger(value), path).toBe(true);
  else if (Array.isArray(value))
    value.forEach((item, index) => assertIntegers(item, `${path}[${index}]`));
  else if (value !== null && typeof value === "object")
    Object.entries(value).forEach(([key, item]) =>
      assertIntegers(item, `${path}.${key}`)
    );
}

describe("deterministic synthetic seed", () => {
  it("produces identical SHA-256 hashes on two independent runs", () => {
    const first = engine.seed();
    const second = engine.seed();
    expect(hash(first)).toBe(hash(second));
    expect(first).not.toBe(second);
    expect(BillingDatasetSchema.parse(first)).toEqual(first);
    console.log(`Seed SHA-256 (both runs): ${hash(first)}`);
  });

  it("reports normalized record count including nested tiers and stays under 2500", () => {
    const data = engine.seed();
    const count =
      Object.values(data).reduce<number>(
        (total, value) => total + (Array.isArray(value) ? value.length : 0),
        0
      ) +
      data.plans.reduce(
        (total, plan) =>
          total +
          plan.prices.length +
          plan.prices.reduce((tiers, price) => tiers + price.tiers.length, 0),
        0
      ) +
      data.invoices.reduce(
        (total, bill) =>
          total +
          bill.lines.length +
          bill.lines.reduce((tiers, line) => tiers + line.tiers.length, 0),
        0
      );
    console.log(
      `Seed normalized records (includes nested prices, tiers, lines, tier charges): ${count}`
    );
    expect(count).toBeLessThan(2500);
    expect(data.usage).toHaveLength(1104);
    expect(data.customers).toHaveLength(3);
    expect(data.meters).toHaveLength(4);
    expect(data.plans).toHaveLength(3);
    expect(data.invoices).toHaveLength(9);
    for (const customer of data.customers) {
      for (const period of ["2026-07", "2026-08", "2026-09"]) {
        expect(
          data.invoices.filter(
            (bill) => bill.customerId === customer.id && bill.period === period
          )
        ).toHaveLength(1);
      }
      for (const meter of data.meters) {
        const rows = data.usage.filter(
          (row) => row.customerId === customer.id && row.meterId === meter.id
        );
        expect(rows).toHaveLength(92);
        expect(new Set(rows.map((row) => row.date)).size).toBe(92);
      }
    }
  });

  it("rebuilds every invoice and produces the demo total and 38 percent change", () => {
    const data = engine.seed();
    for (const invoice of data.invoices)
      expect(
        engine.buildInvoice(data, invoice.customerId, invoice.period)
      ).toEqual(invoice);
    expect(
      data.invoices.find(
        (bill) => bill.customerId === "cus_1" && bill.period === "2026-09"
      )?.total
    ).toEqual(money(41287));
    expect(
      engine.compareInvoices(data, "cus_1", "2026-08", "2026-09").totalChange
        ?.display
    ).toBe("38%");
    const changed = data.invoices.find(
      (bill) => bill.customerId === "cus_2" && bill.period === "2026-09"
    )!;
    expect(
      changed.lines
        .filter((line) => line.kind === "proration")
        .map((line) => [line.planId, line.quantity])
    ).toEqual([
      ["plan_starter", 15],
      ["plan_pro", 15]
    ]);
  });

  it("contains exactly one duplicate debit and a coherent expired request, void memo and audit trail", () => {
    const data = engine.seed();
    const duplicates = data.ledger.filter(
      (entry, index) =>
        entry.kind === "charge" &&
        data.ledger
          .slice(0, index)
          .some(
            (earlier) =>
              earlier.kind === "charge" &&
              earlier.reference === entry.reference &&
              earlier.customerId === entry.customerId &&
              earlier.invoiceId === entry.invoiceId &&
              earlier.amount.cents === entry.amount.cents
          )
    );
    expect(duplicates.map((entry) => entry.id)).toEqual([
      "le_duplicate_september"
    ]);
    const request = data.creditRequests[0];
    expect(data.creditRequests).toHaveLength(1);
    expect(request).toMatchObject({
      status: "expired",
      decision: null,
      disputedLedgerEntryId: duplicates[0].id,
      validatedAmount: duplicates[0].amount
    });
    expect(Date.parse(request.updatedAt) - Date.parse(request.createdAt)).toBe(
      86400000
    );
    expect(data.creditMemos).toEqual([
      {
        id: "cm_historical_void",
        requestId: request.id,
        disputedLedgerEntryId: duplicates[0].id,
        amount: duplicates[0].amount,
        status: "void"
      }
    ]);
    expect(data.audit.map((record) => record.action)).toEqual([
      "credit_requested",
      "credit_validated",
      "memo_pending",
      "credit_expired",
      "memo_voided"
    ]);
    expect(data.audit.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(data.audit.map((record) => record.at)).toEqual(
      [...data.audit.map((record) => record.at)].sort()
    );
    expect(
      engine.validateCreditClaim(
        data,
        {
          customerId: request.customerId,
          invoiceId: request.invoiceId,
          disputedLedgerEntryId: request.disputedLedgerEntryId
        },
        data.creditMemos
      )
    ).toMatchObject({ valid: true, creditableAmount: money(41287) });
  });

  it("every engine output contains only safe integer numeric fields", () => {
    const data = engine.seed();
    const bill = data.invoices.find(
      (item) => item.customerId === "cus_1" && item.period === "2026-09"
    )!;
    const outputs = [
      data,
      engine.buildInvoice(data, "cus_1", "2026-09"),
      ...bill.lines.map((line) =>
        engine.explainLineItem(data, bill.id, line.id)
      ),
      engine.compareInvoices(data, "cus_1", "2026-08", "2026-09"),
      engine.simulatePlan(data, "cus_1", "2026-09", "plan_pro"),
      engine.detectAnomalies(data, "cus_1", "2026-09"),
      engine.validateCreditClaim(
        data,
        {
          customerId: "cus_1",
          invoiceId: bill.id,
          disputedLedgerEntryId: null
        },
        []
      ),
      engine.balance(data.ledger, "cus_1")
    ];
    outputs.forEach((output) => assertIntegers(output));
  });
});
