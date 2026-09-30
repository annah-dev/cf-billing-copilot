// A stand-in for src/engine used by the agent lane's tests through vi.mock, so these tests do not
// depend on the engine lane's numbers. The dataset is small, parses with the contract schemas, and
// has the one property the credit flow needs: an invoice debit posted twice with the same billing-run
// posting id. Amounts are fixed test data; validateCreditClaim and balance do the minimal cents
// arithmetic a real engine does, which is allowed here because this file is a test double.
import {
  EngineError,
  money,
  type BillingDataset,
  type BillingEngine,
  type ClaimValidation,
  type CreditMemo,
  type Invoice,
  type InvoiceLine,
  type LedgerEntry
} from "../../../src/contracts";

export const ACME = "cus_acme";
export const GLOBEX = "cus_globex";
export const INV_AUG = "inv_acme_2026_08";
export const INV_SEP = "inv_acme_2026_09";
export const INV_GLOBEX_SEP = "inv_globex_2026_09";
export const DUP_ENTRY = "le_acme_2026_09_dup";
export const ORIGINAL_ENTRY = "le_acme_2026_09_charge";
export const DUP_CENTS = 41287;
export const HIST_REQUEST = "cr_hist_acme_2026_08";

const tier = (cents: number) => ({
  tierIndex: 0,
  units: 1000,
  unitPrice: money(cents),
  perUnits: 1000,
  rateDisplay: `${money(cents).display} per 1,000 requests`,
  amount: money(cents)
});

function line(
  id: string,
  kind: InvoiceLine["kind"],
  cents: number,
  meterId: string | null = null
): InvoiceLine {
  return {
    id,
    kind,
    description: `${kind} line`,
    planId: kind === "subscription" ? "plan_starter" : null,
    meterId,
    quantity: meterId ? 1000 : null,
    amount: money(cents),
    tiers: meterId ? [tier(cents)] : []
  };
}

function invoice(
  id: string,
  customerId: string,
  period: string,
  sub: number,
  usage: number,
  tax: number
): Invoice {
  return {
    id,
    customerId,
    period,
    issuedOn: `${period}-28`,
    lines: [
      line(`line_${id.slice(4)}_sub`, "subscription", sub),
      line(`line_${id.slice(4)}_req`, "usage", usage, "meter_requests"),
      line(`line_${id.slice(4)}_tax`, "tax", tax)
    ],
    subtotal: money(sub + usage),
    credits: money(0),
    tax: money(tax),
    total: money(sub + usage + tax)
  };
}

function entry(
  id: string,
  customerId: string,
  at: string,
  kind: LedgerEntry["kind"],
  cents: number,
  invoiceId: string | null,
  reference: string
): LedgerEntry {
  return {
    id,
    customerId,
    at,
    kind,
    amount: money(cents),
    invoiceId,
    reference,
    description: `${kind} ${reference}`
  };
}

export function fakeSeed(): BillingDataset {
  return {
    seedVersion: "fake-1",
    meters: [
      {
        id: "meter_requests",
        name: "Requests",
        unit: "requests",
        product: "Workers"
      }
    ],
    plans: [
      {
        id: "plan_starter",
        name: "Starter",
        monthlyFeeCents: 2000,
        prices: [
          {
            meterId: "meter_requests",
            tiers: [
              { upTo: 1000, priceCents: 0, perUnits: 1000 },
              { upTo: null, priceCents: 30, perUnits: 1000 }
            ]
          }
        ]
      },
      {
        id: "plan_pro",
        name: "Pro",
        monthlyFeeCents: 5000,
        prices: [
          {
            meterId: "meter_requests",
            tiers: [{ upTo: null, priceCents: 20, perUnits: 1000 }]
          }
        ]
      }
    ],
    customers: [
      { id: ACME, name: "Acme Rockets (fictional)", taxRateBps: 825 },
      { id: GLOBEX, name: "Globex Widgets (fictional)", taxRateBps: 0 }
    ],
    subscriptions: [
      {
        customerId: ACME,
        planId: "plan_starter",
        from: "2026-07-01",
        to: null
      },
      { customerId: GLOBEX, planId: "plan_pro", from: "2026-07-01", to: null }
    ],
    usage: [
      {
        customerId: ACME,
        meterId: "meter_requests",
        date: "2026-09-01",
        quantity: 1000
      },
      {
        customerId: ACME,
        meterId: "meter_requests",
        date: "2026-09-02",
        quantity: 5000
      },
      {
        customerId: GLOBEX,
        meterId: "meter_requests",
        date: "2026-09-01",
        quantity: 2000
      }
    ],
    invoices: [
      invoice(INV_AUG, ACME, "2026-08", 2000, 25229, 2771),
      invoice(INV_SEP, ACME, "2026-09", 2000, 36143, 3144),
      invoice(INV_GLOBEX_SEP, GLOBEX, "2026-09", 5000, 10000, 0)
    ],
    ledger: [
      entry(
        "le_acme_2026_08_charge",
        ACME,
        "2026-09-01T00:00:00.000Z",
        "charge",
        30000,
        INV_AUG,
        "run_2026_08_acme"
      ),
      entry(
        "le_acme_2026_08_payment",
        ACME,
        "2026-09-10T00:00:00.000Z",
        "payment",
        30000,
        INV_AUG,
        "pay_2026_08_acme"
      ),
      entry(
        ORIGINAL_ENTRY,
        ACME,
        "2026-09-30T00:00:00.000Z",
        "charge",
        DUP_CENTS,
        INV_SEP,
        "run_2026_09_acme"
      ),
      entry(
        DUP_ENTRY,
        ACME,
        "2026-09-30T00:05:00.000Z",
        "charge",
        DUP_CENTS,
        INV_SEP,
        "run_2026_09_acme"
      ),
      entry(
        "le_globex_2026_09_charge",
        GLOBEX,
        "2026-09-30T00:00:00.000Z",
        "charge",
        15000,
        INV_GLOBEX_SEP,
        "run_2026_09_globex"
      )
    ],
    creditRequests: [
      {
        id: HIST_REQUEST,
        customerId: ACME,
        invoiceId: INV_AUG,
        disputedLedgerEntryId: null,
        idempotencyKey: "a".repeat(64),
        customerReason: "Historical example request",
        validatedAmount: null,
        status: "expired",
        workflowInstanceId: HIST_REQUEST,
        createdAt: "2026-08-05T10:00:00.000Z",
        updatedAt: "2026-08-06T10:00:00.000Z",
        deadline: "2026-08-06T10:00:00.000Z",
        decision: null,
        outcomeReason: "No approver decision within 24 hours"
      }
    ],
    creditMemos: [],
    audit: [
      {
        seq: 1,
        at: "2026-08-05T10:00:00.000Z",
        actor: `customer:${ACME}`,
        action: "credit_requested",
        subject: { type: "credit_request", id: HIST_REQUEST },
        reason: "Historical example request",
        before: null,
        after: { status: "requested" }
      },
      {
        seq: 2,
        at: "2026-08-06T10:00:00.000Z",
        actor: "system",
        action: "credit_expired",
        subject: { type: "credit_request", id: HIST_REQUEST },
        reason: "No approver decision within 24 hours",
        before: { status: "requested" },
        after: { status: "expired" }
      }
    ]
  };
}

function findInvoice(data: BillingDataset, invoiceId: string): Invoice {
  const inv = data.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new EngineError("not_found", `No invoice ${invoiceId}`);
  return inv;
}

function forPeriod(data: BillingDataset, customerId: string, period: string) {
  const inv = data.invoices.find(
    (i) => i.customerId === customerId && i.period === period
  );
  if (!inv) throw new EngineError("not_found", `No invoice for ${period}`);
  return inv;
}

export const fakeEngine: BillingEngine = {
  seed: fakeSeed,
  buildInvoice: (data, customerId, period) =>
    forPeriod(data, customerId, period),
  explainLineItem: (data, invoiceId, lineId) => {
    const inv = findInvoice(data, invoiceId);
    const l = inv.lines.find((x) => x.id === lineId);
    if (!l) throw new EngineError("not_found", `No line ${lineId}`);
    return {
      invoiceId,
      line: l,
      steps: [{ label: "Amount", detail: l.description, amount: l.amount }],
      tiers: l.tiers
    };
  },
  compareInvoices: (data, customerId, fromPeriod, toPeriod) => {
    const from = forPeriod(data, customerId, fromPeriod);
    const to = forPeriod(data, customerId, toPeriod);
    return {
      customerId,
      fromPeriod,
      toPeriod,
      fromTotal: from.total,
      toTotal: to.total,
      totalDelta: money(to.total.cents - from.total.cents),
      totalChange: { basisPoints: 3762, display: "38%" },
      byMeter: [],
      otherChanges: [],
      summary: "Usage went up."
    };
  },
  simulatePlan: (data, customerId, period, planId) => {
    const inv = forPeriod(data, customerId, period);
    if (!data.plans.some((p) => p.id === planId)) {
      throw new EngineError("not_found", `No plan ${planId}`);
    }
    return {
      customerId,
      period,
      actualPlanId: "plan_starter",
      simulatedPlanId: planId,
      actualTotal: inv.total,
      simulatedTotal: money(35000),
      difference: money(35000 - inv.total.cents),
      simulatedLines: inv.lines,
      assumptions: []
    };
  },
  detectAnomalies: (data, customerId, period) => {
    forPeriod(data, customerId, period);
    return {
      customerId,
      period,
      anomalies: [],
      method: "fake: none"
    };
  },
  validateCreditClaim: (
    data,
    claim,
    existingMemos: readonly CreditMemo[]
  ): ClaimValidation => {
    const inv = data.invoices.find(
      (i) => i.id === claim.invoiceId && i.customerId === claim.customerId
    );
    if (!inv) {
      return {
        valid: false,
        reason: "invoice_not_found",
        explanation: "No such invoice for this customer."
      };
    }
    const charges = data.ledger
      .filter((e) => e.invoiceId === inv.id && e.kind === "charge")
      .sort((a, b) => a.at.localeCompare(b.at));
    const duplicates = charges.filter((e, i) =>
      charges.slice(0, i).some((o) => o.reference === e.reference)
    );
    const disputed = claim.disputedLedgerEntryId
      ? charges.find((e) => e.id === claim.disputedLedgerEntryId)
      : duplicates[0];
    if (claim.disputedLedgerEntryId && !disputed) {
      return {
        valid: false,
        reason: "entry_not_on_invoice",
        explanation: "That entry is not a charge on this invoice."
      };
    }
    if (!disputed || !duplicates.includes(disputed)) {
      return {
        valid: false,
        reason: "no_duplicate_found",
        explanation: "No duplicated charge on this invoice."
      };
    }
    const original = charges.find(
      (o) => o.reference === disputed.reference && o.id !== disputed.id
    ) as LedgerEntry;
    const reserved = existingMemos
      .filter(
        (m) => m.disputedLedgerEntryId === disputed.id && m.status !== "void"
      )
      .reduce((sum, m) => sum + m.amount.cents, 0);
    const creditable = disputed.amount.cents - reserved;
    if (creditable <= 0) {
      return {
        valid: false,
        reason: "already_fully_credited",
        explanation: "This charge is already credited or reserved."
      };
    }
    return {
      valid: true,
      disputedLedgerEntryId: disputed.id,
      duplicateOfLedgerEntryId: original.id,
      creditableAmount: money(creditable),
      explanation: `${disputed.id} duplicates ${original.id}.`
    };
  },
  balance: (ledger, customerId) =>
    money(
      ledger
        .filter((e) => e.customerId === customerId)
        .reduce(
          (sum, e) =>
            sum + (e.kind === "charge" ? e.amount.cents : -e.amount.cents),
          0
        )
    )
};
