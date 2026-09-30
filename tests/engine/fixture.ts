import { type BillingDataset, money } from "../../src/contracts";

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
