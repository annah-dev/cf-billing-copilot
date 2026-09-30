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
  it("shapes daily usage on every meter and customer with quieter UTC weekends", () => {
    const data = engine.seed();
    for (const customer of data.customers)
      for (const meter of data.meters)
        for (const period of ["2026-07", "2026-08", "2026-09"]) {
          const rows = data.usage.filter(
            (row) =>
              row.customerId === customer.id &&
              row.meterId === meter.id &&
              row.date.startsWith(period) &&
              !(
                customer.id === "cus_1" &&
                meter.id === "meter_requests" &&
                row.date === "2026-09-18"
              )
          );
          const label = `${customer.id}/${meter.id}/${period}`;
          expect(
            new Set(rows.map((row) => row.quantity)).size,
            label
          ).toBeGreaterThan(1);
          const weekend = rows.filter((row) =>
            [0, 6].includes(new Date(`${row.date}T00:00:00Z`).getUTCDay())
          );
          const weekday = rows.filter((row) => !weekend.includes(row));
          const sum = (items: typeof rows) =>
            items.reduce((total, row) => total + row.quantity, 0);
          expect(sum(weekday) * weekend.length, label).toBeGreaterThan(
            sum(weekend) * weekday.length
          );
          const sorted = rows.map((row) => row.quantity).sort((a, b) => a - b);
          expect(sorted[0], label).toBeGreaterThan(0);
          expect(sorted.at(-1), label).toBeLessThan(
            2 * sorted[Math.trunc(sorted.length / 2)]
          );
        }
  });

  it("makes July quantities and invoices differ from August for every customer and meter", () => {
    const data = engine.seed();
    for (const customer of data.customers) {
      for (const meter of data.meters) {
        const quantity = (period: string) =>
          data.usage
            .filter(
              (row) =>
                row.customerId === customer.id &&
                row.meterId === meter.id &&
                row.date.startsWith(period)
            )
            .reduce((total, row) => total + row.quantity, 0);
        expect(quantity("2026-07")).toBeLessThan(quantity("2026-08"));
      }
      const july = data.invoices.find(
        (bill) => bill.customerId === customer.id && bill.period === "2026-07"
      )!;
      const august = data.invoices.find(
        (bill) => bill.customerId === customer.id && bill.period === "2026-08"
      )!;
      expect(july.total.cents).not.toBe(august.total.cents);
    }
  });

  it("preserves all August and September quantities, plan segments and invoice totals", () => {
    const data = engine.seed();
    const quantities: Record<string, number[][]> = {
      "2026-08": [
        [93000, 930, 930, 2248],
        [155000, 930, 1395, 6200],
        [186000, 1240, 1550, 6820]
      ],
      "2026-09": [
        [102000, 1200, 1500, 7380],
        [150000, 900, 1350, 6000],
        [180000, 1200, 1500, 6600]
      ]
    };
    const totals: Record<string, number[]> = {
      "2026-08": [29918, 40551, 26640],
      "2026-09": [41287, 38771, 26200]
    };
    for (const period of Object.keys(quantities))
      data.customers.forEach((customer, customerIndex) => {
        data.meters.forEach((meter, meterIndex) => {
          const rows = data.usage.filter(
            (row) =>
              row.customerId === customer.id &&
              row.meterId === meter.id &&
              row.date.startsWith(period)
          );
          expect(rows.reduce((total, row) => total + row.quantity, 0)).toBe(
            quantities[period][customerIndex][meterIndex]
          );
        });
        const bill = data.invoices.find(
          (invoice) =>
            invoice.customerId === customer.id && invoice.period === period
        )!;
        expect(bill.total).toEqual(money(totals[period][customerIndex]));
      });
    const changed = data.invoices.find(
      (bill) => bill.customerId === "cus_2" && bill.period === "2026-09"
    )!;
    for (const planId of ["plan_starter", "plan_pro"])
      expect(
        changed.lines
          .filter((line) => line.kind === "usage" && line.planId === planId)
          .map((line) => line.quantity)
      ).toEqual([75000, 450, 675, 3000]);
  });

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
      data.invoices.find(
        (bill) => bill.customerId === "cus_1" && bill.period === "2026-08"
      )?.total
    ).toEqual(money(29918));
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
      "memo_pending",
      "credit_expired",
      "memo_voided"
    ]);
    expect(data.audit.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      data.audit
        .filter(
          (record) => record.subject.id === request.id && record.after?.status
        )
        .map((record) => record.after?.status)
    ).toEqual(["requested", "pending_approval", "expired"]);
    expect(
      data.audit
        .slice(1)
        .every((record) => record.actor === `workflow:${request.id}`)
    ).toBe(true);
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
