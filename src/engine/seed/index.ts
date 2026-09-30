import {
  BillingDatasetSchema,
  money,
  type BillingDataset,
  type Plan,
  type AuditAction
} from "../../contracts";
import { month } from "../data";
import { invoice } from "../rating";

function plan(
  id: string,
  name: string,
  fee: number,
  prices: readonly number[]
): Plan {
  const meters = [
    "meter_requests",
    "meter_storage",
    "meter_transfer",
    "meter_compute"
  ];
  const bounds = [100_000, 500, 1_000, 10_000];
  const denominators = [1_000, 1, 1, 1];
  return {
    id,
    name,
    monthlyFeeCents: fee,
    prices: meters.map((meterId, index) => ({
      meterId,
      tiers: [
        {
          upTo: bounds[index],
          priceCents: prices[index * 2],
          perUnits: denominators[index]
        },
        {
          upTo: null,
          priceCents: prices[index * 2 + 1],
          perUnits: index === 3 ? 2 : denominators[index]
        }
      ]
    }))
  };
}

export function seed(): BillingDataset {
  const data: BillingDataset = {
    seedVersion: "engine-v1",
    meters: [
      {
        id: "meter_requests",
        name: "Edge requests",
        unit: "requests",
        product: "Edge"
      },
      {
        id: "meter_storage",
        name: "Object storage",
        unit: "GB-day",
        product: "Storage"
      },
      {
        id: "meter_transfer",
        name: "Data transfer",
        unit: "GB",
        product: "Edge"
      },
      {
        id: "meter_compute",
        name: "Compute time",
        unit: "CPU-minute",
        product: "Compute"
      }
    ],
    plans: [
      plan("plan_starter", "Starter", 3_000, [100, 80, 10, 8, 5, 4, 1, 1]),
      plan("plan_pro", "Pro", 5_000, [70, 50, 8, 6, 4, 3, 1, 1]),
      plan("plan_scale", "Scale", 9_000, [50, 30, 6, 4, 3, 2, 0, 0])
    ],
    customers: [
      { id: "cus_1", name: "Velvet Comet Workshop", taxRateBps: 825 },
      { id: "cus_2", name: "Paper Nebula Foundry", taxRateBps: 500 },
      { id: "cus_3", name: "Amber Kite Observatory", taxRateBps: 0 }
    ],
    subscriptions: [
      {
        customerId: "cus_1",
        planId: "plan_starter",
        from: "2026-07-01",
        to: null
      },
      {
        customerId: "cus_2",
        planId: "plan_starter",
        from: "2026-07-01",
        to: "2026-09-16"
      },
      { customerId: "cus_2", planId: "plan_pro", from: "2026-09-16", to: null },
      {
        customerId: "cus_3",
        planId: "plan_scale",
        from: "2026-07-01",
        to: null
      }
    ],
    usage: [],
    invoices: [],
    ledger: [],
    creditRequests: [],
    creditMemos: [],
    audit: []
  };
  for (const period of ["2026-07", "2026-08", "2026-09"]) {
    const dates = month(period).dates;
    for (
      let customerIndex = 0;
      customerIndex < data.customers.length;
      customerIndex++
    ) {
      const customerId = data.customers[customerIndex].id;
      dates.forEach((date, day) => {
        const september = period === "2026-09";
        const quantities =
          customerIndex === 0
            ? [
                september && date === "2026-09-18" ? 15_000 : 3_000,
                september ? 40 : 30,
                september ? 50 : 30,
                september
                  ? 246
                  : Math.trunc(2_248 / dates.length) +
                    (day < 2_248 % dates.length ? 1 : 0)
              ]
            : [
                4_000 + customerIndex * 1_000,
                20 + customerIndex * 10,
                40 + customerIndex * 5,
                180 + customerIndex * 20
              ];
        data.meters.forEach((meter, meterIndex) =>
          data.usage.push({
            customerId,
            meterId: meter.id,
            date,
            quantity: quantities[meterIndex]
          })
        );
      });
      const bill = invoice(data, customerId, period);
      data.invoices.push(bill);
      const key = `${customerIndex + 1}_${period.replace("-", "_")}`;
      const reference = `billing-run:${customerId}:${period}`;
      const charge = {
        id: `le_charge_${key}`,
        customerId,
        at: `${bill.issuedOn}T00:00:00Z`,
        kind: "charge" as const,
        amount: bill.total,
        invoiceId: bill.id,
        reference,
        description: `${period} invoice debit`
      };
      data.ledger.push(charge);
      if (period !== "2026-09")
        data.ledger.push({
          ...charge,
          id: `le_payment_${key}`,
          at: `${bill.issuedOn}T00:30:00Z`,
          kind: "payment",
          reference: `synthetic-payment:${key}`,
          description: `${period} invoice paid`
        });
      if (customerIndex === 0 && period === "2026-09")
        data.ledger.push({
          ...charge,
          id: "le_duplicate_september",
          at: `${bill.issuedOn}T00:01:00Z`,
          description:
            "Billing run retry without an idempotency key posted the invoice debit again"
        });
    }
  }
  const duplicate = data.ledger.find(
    (entry) => entry.id === "le_duplicate_september"
  )!;
  const requestId = "cr_historical_expired";
  data.creditRequests.push({
    id: requestId,
    customerId: duplicate.customerId,
    invoiceId: duplicate.invoiceId!,
    disputedLedgerEntryId: duplicate.id,
    idempotencyKey: "0".repeat(64),
    customerReason: "The September invoice debit appears twice.",
    validatedAmount: duplicate.amount,
    status: "expired",
    workflowInstanceId: requestId,
    createdAt: "2026-10-01T01:00:00Z",
    updatedAt: "2026-10-02T01:00:00Z",
    deadline: "2026-10-02T01:00:00Z",
    decision: null,
    outcomeReason: "no approver decision within 24 hours"
  });
  data.creditMemos.push({
    id: "cm_historical_void",
    requestId,
    disputedLedgerEntryId: duplicate.id,
    amount: duplicate.amount,
    status: "void"
  });
  const audit = (
    action: AuditAction,
    at: string,
    subject: { type: "credit_request" | "credit_memo"; id: string },
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string
  ) => {
    data.audit.push({
      seq: data.audit.length + 1,
      at,
      actor:
        action === "credit_requested"
          ? "customer:cus_1"
          : `workflow:${requestId}`,
      action,
      subject,
      reason,
      before,
      after
    });
  };
  const requestSubject = { type: "credit_request" as const, id: requestId };
  const memoSubject = {
    type: "credit_memo" as const,
    id: "cm_historical_void"
  };
  audit(
    "credit_requested",
    "2026-10-01T01:00:00Z",
    requestSubject,
    null,
    { status: "requested" },
    "Customer requested duplicate-debit validation"
  );
  audit(
    "credit_validated",
    "2026-10-01T01:00:01Z",
    requestSubject,
    { validatedAmount: null },
    { validatedAmount: money(duplicate.amount.cents) },
    "Matching invoice debit and posting reference found"
  );
  audit(
    "memo_pending",
    "2026-10-01T01:00:02Z",
    requestSubject,
    { status: "requested" },
    { status: "pending_approval", deadline: "2026-10-02T01:00:00Z" },
    "Pending memo reserves the duplicated debit; begin the approval wait"
  );
  audit(
    "memo_pending",
    "2026-10-01T01:00:02Z",
    memoSubject,
    null,
    { status: "pending", amount: duplicate.amount },
    "Reserved duplicated debit in the same transaction as the request transition"
  );
  audit(
    "credit_expired",
    "2026-10-02T01:00:00Z",
    requestSubject,
    { status: "pending_approval" },
    { status: "expired" },
    "no approver decision within 24 hours"
  );
  audit(
    "memo_voided",
    "2026-10-02T01:00:00Z",
    memoSubject,
    { status: "pending" },
    { status: "void" },
    "Expired request releases reservation without moving money"
  );
  return BillingDatasetSchema.parse(data);
}
