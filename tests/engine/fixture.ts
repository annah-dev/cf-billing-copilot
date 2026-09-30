import { type BillingDataset, money } from "../../src/contracts";
import { engine } from "../../src/engine";

export function fixture(quantity = 0): BillingDataset {
  return {
    seedVersion: "test",
    customers: [
      { id: "cus_test", name: "Synthetic Test Workshop", taxRateBps: 0 }
    ],
    meters: [
      {
        id: "meter_test",
        name: "Test meter",
        unit: "units",
        product: "Test product"
      }
    ],
    plans: [
      {
        id: "plan_basic",
        name: "Basic",
        monthlyFeeCents: 0,
        prices: [
          {
            meterId: "meter_test",
            tiers: [
              { upTo: 100, priceCents: 2, perUnits: 1 },
              { upTo: null, priceCents: 1, perUnits: 1 }
            ]
          }
        ]
      },
      {
        id: "plan_pro",
        name: "Pro",
        monthlyFeeCents: 600,
        prices: [
          {
            meterId: "meter_test",
            tiers: [{ upTo: null, priceCents: 1, perUnits: 1 }]
          }
        ]
      }
    ],
    subscriptions: [
      {
        customerId: "cus_test",
        planId: "plan_basic",
        from: "2026-07-01",
        to: null
      }
    ],
    usage: [
      {
        customerId: "cus_test",
        meterId: "meter_test",
        date: "2026-09-01",
        quantity
      }
    ],
    invoices: [],
    ledger: [],
    creditRequests: [],
    creditMemos: [],
    audit: []
  };
}

export function postedCredit(cents: number, at = "2026-09-10T00:00:00Z") {
  return {
    id: "le_credit_test",
    customerId: "cus_test",
    invoiceId: null,
    at,
    kind: "credit" as const,
    amount: money(cents),
    reference: "synthetic-credit:test",
    description: "Test posted credit"
  };
}

export function invoiceDiscount(data: BillingDataset, cents: number): void {
  const index = data.invoices.findIndex(
    (bill) => bill.customerId === "cus_test" && bill.period === "2026-09"
  );
  const bill =
    index < 0
      ? engine.buildInvoice(data, "cus_test", "2026-09")
      : data.invoices[index];
  bill.lines = bill.lines.filter((line) => line.kind !== "credit");
  bill.lines.push({
    id: "line_discount",
    kind: "credit",
    description: "Synthetic issued invoice discount",
    planId: null,
    meterId: null,
    quantity: null,
    amount: money(-cents),
    tiers: []
  });
  bill.credits = money(cents);
  if (index < 0) data.invoices.push(bill);
  else data.invoices[index] = bill;
  const updated = engine.buildInvoice(data, "cus_test", "2026-09");
  data.invoices[index < 0 ? data.invoices.length - 1 : index] = updated;
}
