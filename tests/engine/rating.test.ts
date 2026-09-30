import { describe, expect, it } from "vitest";
import { EngineError, InvoiceSchema, money } from "../../src/contracts";
import { engine } from "../../src/engine";
import { fixture, postedCredit, invoiceDiscount } from "./fixture";

const build = (data = fixture(), period = "2026-09") =>
  engine.buildInvoice(data, "cus_test", period);

describe("invoice rating", () => {
  it("posts a duplicate-debit remedy once without discounting the next invoice or its tax", () => {
    const data = fixture(100);
    data.customers[0].taxRateBps = 825;
    const september = build(data);
    data.invoices.push(september);
    data.usage.push({ ...data.usage[0], date: "2026-10-01" });
    const charge = {
      ...postedCredit(217, "2026-10-01T00:00:00Z"),
      id: "le_original",
      invoiceId: september.id,
      kind: "charge" as const,
      reference: "billing-run:test:september"
    };
    data.ledger.push(charge, {
      ...charge,
      id: "le_duplicate",
      at: "2026-10-01T00:01:00Z"
    });
    data.ledger.push({
      ...postedCredit(50, "2026-10-02T00:00:00Z"),
      invoiceId: september.id
    });
    expect(engine.balance(data.ledger, "cus_test").cents).toBe(384);
    const october = build(data, "2026-10");
    expect(october.total).toEqual(money(217));
    expect(october.tax).toEqual(money(17));
    data.ledger.push({
      ...charge,
      id: "le_october",
      invoiceId: october.id,
      amount: october.total,
      at: "2026-11-01T00:00:00Z",
      reference: "billing-run:test:october"
    });
    expect(engine.balance(data.ledger, "cus_test").cents).toBe(601);
  });
  it.each([
    [99, 198],
    [100, 200],
    [101, 201]
  ])("rates tier boundary quantity %i as %i cents", (quantity, cents) => {
    const result = build(fixture(quantity));
    expect(result.total).toEqual(money(cents));
    expect(InvoiceSchema.parse(result)).toEqual(result);
    expect(
      result.lines
        .filter((line) => line.kind === "usage")[0]
        .tiers.reduce((total, tier) => total + tier.amount.cents, 0)
    ).toBe(cents);
  });

  it("rounds exact fractions once per line and reconciles tier residuals", () => {
    const data = fixture(2);
    data.plans[0].prices[0].tiers = [
      { upTo: 1, priceCents: 1, perUnits: 2 },
      { upTo: null, priceCents: 1, perUnits: 2 }
    ];
    const result = build(data);
    expect(result.total.cents).toBe(1);
    expect(result.lines[1].tiers.map((tier) => tier.amount.cents)).toEqual([
      1, 0
    ]);
  });

  it.each([
    [1, 3, 0],
    [1, 2, 1],
    [2, 3, 1],
    [3, 2, 2]
  ])("rounds %i cents per %i units to %i", (priceCents, perUnits, cents) => {
    const data = fixture(1);
    data.plans[0].prices[0].tiers = [{ upTo: null, priceCents, perUnits }];
    expect(build(data).total.cents).toBe(cents);
  });

  it("keeps large intermediate products exact and rejects unsafe results", () => {
    const data = fixture(1_000_000_000_001);
    data.plans[0].prices[0].tiers = [
      { upTo: null, priceCents: 100_000_000, perUnits: 1_000_000_000 }
    ];
    expect(build(data).total.cents).toBe(100_000_000_000);
    data.plans[0].prices[0].tiers[0].perUnits = 1;
    expect(() => build(data)).toThrow(EngineError);
  });

  it("rates zero usage with zero usage amount and no tiers", () => {
    const result = build();
    expect(result.total).toEqual(money(0));
    expect(result.lines[1]).toMatchObject({
      kind: "usage",
      quantity: 0,
      amount: money(0),
      tiers: []
    });
  });

  it.each([
    ["2026-09-01", [600]],
    ["2026-09-30", [290, 20]],
    ["2026-09-16", [150, 300]]
  ])("prorates a plan change on %s", (change, expected) => {
    const data = fixture();
    data.plans[0].monthlyFeeCents = 300;
    data.subscriptions = [
      {
        customerId: "cus_test",
        planId: "plan_basic",
        from: "2026-07-01",
        to: change
      },
      { customerId: "cus_test", planId: "plan_pro", from: change, to: null }
    ];
    const result = build(data);
    expect(
      result.lines
        .filter((line) => line.kind !== "usage" && line.kind !== "tax")
        .map((line) => line.amount.cents)
    ).toEqual(expected);
    expect(result.total.cents).toBe(expected.reduce((a, b) => a + b, 0));
  });

  it("uses exclusive plan boundaries and restarts usage tiers per segment", () => {
    const data = fixture(101);
    data.subscriptions[0].to = "2026-09-16";
    data.subscriptions.push({
      customerId: "cus_test",
      planId: "plan_pro",
      from: "2026-09-16",
      to: null
    });
    data.usage.push({ ...data.usage[0], date: "2026-09-16", quantity: 101 });
    const result = build(data);
    expect(
      result.lines
        .filter((line) => line.kind === "usage")
        .map((line) => [line.planId, line.quantity, line.amount.cents])
    ).toEqual([
      ["plan_basic", 101, 201],
      ["plan_pro", 101, 101]
    ]);
  });

  it("uses actual calendar days including leap February and UTC boundaries", () => {
    const data = fixture();
    data.plans[0].monthlyFeeCents = 290;
    data.subscriptions = [
      {
        customerId: "cus_test",
        planId: "plan_basic",
        from: "2028-02-01",
        to: "2028-02-29"
      },
      {
        customerId: "cus_test",
        planId: "plan_pro",
        from: "2028-02-29",
        to: null
      }
    ];
    expect(
      build(data, "2028-02")
        .lines.filter((line) => line.kind === "proration")
        .map((line) => [line.quantity, line.amount.cents])
    ).toEqual([
      [28, 280],
      [1, 21]
    ]);
  });

  it("rounds tax once after issued invoice discounts and ignores ledger credits, payments and memos", () => {
    const data = fixture(100);
    data.customers[0].taxRateBps = 825;
    data.ledger.push(postedCredit(50), {
      ...postedCredit(100),
      id: "le_payment",
      kind: "payment"
    });
    invoiceDiscount(data, 50);
    data.creditMemos.push(
      {
        id: "cm_void",
        requestId: "cr_test",
        disputedLedgerEntryId: "le_test",
        amount: money(100),
        status: "void"
      },
      {
        id: "cm_pending",
        requestId: "cr_other",
        disputedLedgerEntryId: "le_test",
        amount: money(100),
        status: "pending"
      }
    );
    const result = build(data);
    expect([
      result.subtotal.cents,
      result.credits.cents,
      result.tax.cents,
      result.total.cents
    ]).toEqual([200, 50, 12, 162]);
    expect(
      result.lines.reduce((total, line) => total + line.amount.cents, 0)
    ).toBe(162);
    invoiceDiscount(data, 300);
    expect(build(data).total.cents).toBe(-100);
    expect(build(data).tax.cents).toBe(0);
  });

  it("excludes credits and usage outside the period and other customers", () => {
    const data = fixture(10);
    data.ledger.push(postedCredit(10, "2026-10-01T00:00:00Z"), {
      ...postedCredit(20),
      id: "le_other",
      customerId: "cus_other"
    });
    data.usage.push(
      { ...data.usage[0], date: "2026-10-01", quantity: 1000 },
      { ...data.usage[0], customerId: "cus_other", quantity: 1000 }
    );
    expect(build(data).total.cents).toBe(20);
  });

  it.each([
    "gap",
    "overlap",
    "backwards",
    "invalid-date",
    "unordered-tier",
    "bounded-last",
    "unbounded-first",
    "missing-price",
    "duplicate-price",
    "unknown-meter",
    "fractional",
    "bad-period"
  ])("rejects %s input with EngineError", (defect) => {
    const data = fixture(1);
    if (defect === "gap") data.subscriptions[0].from = "2026-09-02";
    if (defect === "overlap")
      data.subscriptions.push({ ...data.subscriptions[0] });
    if (defect === "backwards") data.subscriptions[0].to = "2026-06-01";
    if (defect === "invalid-date") data.usage[0].date = "2026-09-31";
    if (defect === "unordered-tier")
      data.plans[0].prices[0].tiers.unshift({
        upTo: 200,
        priceCents: 1,
        perUnits: 1
      });
    if (defect === "bounded-last") data.plans[0].prices[0].tiers[1].upTo = 200;
    if (defect === "unbounded-first")
      data.plans[0].prices[0].tiers[0].upTo = null;
    if (defect === "missing-price")
      data.plans[0].prices[0].meterId = "meter_missing";
    if (defect === "duplicate-price")
      data.plans[0].prices.push(data.plans[0].prices[0]);
    if (defect === "unknown-meter") data.usage[0].meterId = "meter_missing";
    if (defect === "fractional") data.usage[0].quantity = 1.5;
    expect(() =>
      build(data, defect === "bad-period" ? "2026-13" : "2026-09")
    ).toThrow(EngineError);
  });

  it("returns typed missing-entity errors", () => {
    expect(() =>
      engine.buildInvoice(fixture(), "cus_missing", "2026-09")
    ).toThrowError(expect.objectContaining({ code: "not_found" }));
  });
});
