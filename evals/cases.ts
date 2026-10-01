import { engine } from "../src/engine";
import {
  ToolSchemas,
  TurnRequestSchema,
  type Money,
  type ToolCallRecord,
  type ToolName,
  type TurnRequest
} from "../src/contracts";

export type Story =
  | "invoice"
  | "change"
  | "simulation"
  | "anomaly"
  | "credit"
  | "memory";
export interface EvalTurn {
  request: TurnRequest;
  expected: string[];
  phrases: RegExp[];
  fixture: { text: string; toolCalls: ToolCallRecord[] };
}
export interface EvalCase {
  id: string;
  story: Story;
  customerId: string;
  turns: EvalTurn[];
  sandboxGroup?: string;
}

// Only engine outputs supply expected numbers. Fixture prose is synthetic, never model evidence.
export function buildCases(): EvalCase[] {
  const data = engine.seed();
  const invoice = (cid: string, period: string) =>
    engine.buildInvoice(data, cid, period);
  const call = (
    name: ToolName,
    input: unknown,
    output: unknown
  ): ToolCallRecord => ({
    name,
    input: ToolSchemas[name].input.parse(input),
    output: ToolSchemas[name].output.parse(output),
    error: null
  });
  const turn = (
    message: string,
    amounts: Money[],
    toolCalls: ToolCallRecord[],
    detail = "",
    literals: string[] = [],
    phrases: RegExp[] = [],
    confirm = false
  ): EvalTurn => {
    const expected = [
      ...new Set([...amounts.map((m) => m.display), ...literals])
    ];
    return {
      request: TurnRequestSchema.parse({ message, confirm }),
      expected,
      phrases,
      fixture: { text: `${detail} ${expected.join("; ")}.`.trim(), toolCalls }
    };
  };
  const make = (
    id: string,
    story: Story,
    customerId: string,
    ...turns: EvalTurn[]
  ): EvalCase => ({
    id,
    story,
    customerId,
    turns,
    sandboxGroup:
      story === "memory" || id === "duplicate-credit" ? id : "read-only"
  });
  const september = invoice("cus_1", "2026-09");
  const august = invoice("cus_1", "2026-08");
  const report = engine.detectAnomalies(data, "cus_1", september.period);
  const spike = report.anomalies[0];
  if (!spike) throw new Error("Seed must contain the demo anomaly");
  const anomalyCall = call(
    "detectAnomalies",
    { period: september.period },
    report
  );
  const invoiceCall = (bill: typeof september) =>
    call("getInvoice", { period: bill.period }, bill);
  const invoiceAmounts = (bill: typeof september) => [
    ...bill.lines.map((line) => line.amount),
    bill.subtotal,
    bill.credits,
    bill.tax,
    bill.total
  ];
  const usageLine = september.lines.find(
    (line) => line.meterId === "meter_requests"
  )!;
  const usageExplanation = engine.explainLineItem(
    data,
    september.id,
    usageLine.id
  );
  const taxLine = september.lines.find((line) => line.kind === "tax")!;
  const taxExplanation = engine.explainLineItem(data, september.id, taxLine.id);
  const explainCall = (explanation: typeof taxExplanation) =>
    call(
      "explainLineItem",
      {
        invoiceId: explanation.invoiceId,
        lineId: explanation.line.id
      },
      explanation
    );
  const changed = engine.compareInvoices(
    data,
    "cus_1",
    august.period,
    september.period
  );
  const julyChange = engine.compareInvoices(
    data,
    "cus_1",
    "2026-07",
    august.period
  );
  const comparisonCall = (comparison: typeof changed) =>
    call(
      "compareInvoices",
      {
        fromPeriod: comparison.fromPeriod,
        toPeriod: comparison.toPeriod
      },
      comparison
    );
  const pro = engine.simulatePlan(data, "cus_1", september.period, "plan_pro");
  const scale = engine.simulatePlan(
    data,
    "cus_3",
    september.period,
    "plan_scale"
  );
  const simulationCall = (simulation: typeof pro) =>
    call(
      "simulatePlan",
      {
        period: simulation.period,
        planId: simulation.simulatedPlanId
      },
      simulation
    );
  const simulationAmounts = (simulation: typeof pro) => [
    simulation.actualTotal,
    simulation.simulatedTotal,
    simulation.difference
  ];
  const changedPlanInvoice = invoice("cus_2", september.period);
  const proration = changedPlanInvoice.lines.filter(
    (line) => line.kind === "proration"
  );
  const noTax = invoice("cus_3", september.period);
  const validation = engine.validateCreditClaim(
    data,
    {
      customerId: "cus_1",
      invoiceId: september.id,
      disputedLedgerEntryId: null
    },
    data.creditMemos
  );
  if (!validation.valid) throw new Error("Seed duplicate must be creditable");
  // These identifiers/state are fixture scaffolding; the amount comes from claim validation.
  const pending = {
    id: "cr_eval_pending",
    invoiceId: september.id,
    status: "pending_approval" as const,
    validatedAmount: validation.creditableAmount,
    createdAt: "2026-10-03T00:00:00Z",
    deadline: "2026-10-04T00:00:00Z",
    outcomeReason: null
  };
  const creditInput = {
    invoiceId: september.id,
    reason: "The September invoice debit appears twice."
  };
  const creditCall = call("startCreditRequest", creditInput, {
    request: pending,
    existing: false,
    message: "Credit request pending human approval."
  });
  const statusCall = call(
    "getCreditRequestStatus",
    {},
    { requests: [{ request: pending, audit: [] }] }
  );
  const seedHistory = data.creditRequests.find(
    (request) => request.customerId === "cus_1"
  )!;
  const historyCall = call(
    "getCreditRequestStatus",
    {},
    {
      requests: [{ request: seedHistory, audit: data.audit }]
    }
  );
  return [
    make(
      "september-invoice",
      "invoice",
      "cus_1",
      turn(
        "Explain my September 2026 invoice line by line, including subtotal, credits and tax. Mention any unusual usage.",
        invoiceAmounts(september),
        [invoiceCall(september), anomalyCall],
        "Invoice breakdown. Unusual usage spike.",
        [spike.date, spike.multiple.display],
        [/spike|unusual/i]
      )
    ),
    make(
      "august-invoice",
      "invoice",
      "cus_1",
      turn(
        "Explain my August 2026 invoice line by line, including subtotal, credits and tax.",
        invoiceAmounts(august),
        [invoiceCall(august)],
        "Invoice breakdown."
      )
    ),
    make(
      "request-tiers",
      "invoice",
      "cus_1",
      turn(
        "Explain the Edge requests line on my September 2026 invoice: quantity, each tier rate and amount, and line total.",
        [
          usageLine.amount,
          ...usageLine.tiers.flatMap((tier) => [tier.unitPrice, tier.amount])
        ],
        [invoiceCall(september), explainCall(usageExplanation)],
        "Graduated tiers.",
        [String(usageLine.quantity)],
        [/tier/i]
      )
    ),
    make(
      "tax-line",
      "invoice",
      "cus_1",
      turn(
        "Explain the tax line and taxable subtotal on my September 2026 invoice.",
        [
          taxLine.amount,
          ...taxExplanation.steps.flatMap((step) =>
            step.amount ? [step.amount] : []
          )
        ],
        [invoiceCall(september), explainCall(taxExplanation)],
        "Taxable subtotal and tax.",
        [],
        [/tax/i]
      )
    ),
    make(
      "midmonth-plan",
      "invoice",
      "cus_2",
      turn(
        "Explain both prorated subscription fees for my September 2026 plan change, and my total bill.",
        [...proration.map((line) => line.amount), changedPlanInvoice.total],
        [
          invoiceCall(changedPlanInvoice),
          ...proration.map((line) =>
            explainCall(
              engine.explainLineItem(data, changedPlanInvoice.id, line.id)
            )
          )
        ],
        "Prorated Starter and Pro fees.",
        [],
        [/prorat/i, /Starter/i, /Pro/i]
      )
    ),
    make(
      "zero-tax-invoice",
      "invoice",
      "cus_3",
      turn(
        "How many invoice lines are on my September 2026 invoice, including the tax line? Also give the total and tax amount.",
        [noTax.total, noTax.tax],
        [invoiceCall(noTax)],
        `Invoice has ${noTax.lines.length} lines. Invoice total and tax.`,
        [String(noTax.lines.length)],
        [/lines?/i]
      )
    ),
    make(
      "august-september-change",
      "change",
      "cus_1",
      turn(
        "Compare August and September 2026: both totals, dollar and percentage change, every meter's dollar delta, and tax delta.",
        [
          changed.fromTotal,
          changed.toTotal,
          changed.totalDelta,
          ...changed.byMeter.map((meter) => meter.delta),
          ...changed.otherChanges
            .filter((item) => item.label === "tax")
            .map((item) => item.delta)
        ],
        [comparisonCall(changed), anomalyCall],
        "Usage change and unusual spike.",
        [changed.totalChange!.display, spike.date, spike.multiple.display],
        [/spike|unusual/i]
      )
    ),
    make(
      "july-august-change",
      "change",
      "cus_1",
      turn(
        "Compare my July and August 2026 bills: totals, dollar change and percentage change.",
        [julyChange.fromTotal, julyChange.toTotal, julyChange.totalDelta],
        [comparisonCall(julyChange)],
        "Invoice comparison.",
        [julyChange.totalChange!.display]
      )
    ),
    make(
      "pro-simulation",
      "simulation",
      "cus_1",
      turn(
        "What would September 2026 have cost on Pro? Give actual total, simulated total and signed difference.",
        simulationAmounts(pro),
        [simulationCall(pro)],
        "Pro simulation.",
        [],
        [/Pro/i]
      )
    ),
    make(
      "scale-simulation",
      "simulation",
      "cus_3",
      turn(
        "What would September 2026 have cost on Scale? Give actual total, simulated total and signed difference.",
        simulationAmounts(scale),
        [simulationCall(scale)],
        "Scale simulation.",
        [],
        [/Scale/i]
      )
    ),
    make(
      "september-anomaly",
      "anomaly",
      "cus_1",
      turn(
        "Describe the unusual usage in September 2026: date, quantity, baseline, multiplier and estimated excess usage cost.",
        [spike.estimatedExcessCost],
        [anomalyCall],
        "Usage spike.",
        [
          spike.date,
          String(spike.quantity),
          String(spike.baselineQuantity),
          spike.multiple.display
        ],
        [/spike|unusual/i]
      )
    ),
    make(
      "duplicate-credit",
      "credit",
      "cus_1",
      turn(
        "The September 2026 invoice debit was posted twice. I confirm: start a credit request for the duplicate and tell me the amount and approval status.",
        [validation.creditableAmount],
        [invoiceCall(september), creditCall],
        "Credit request pending human approval.",
        [],
        [/pending|requested|await/i, /approv/i],
        true
      )
    ),
    make(
      "remember-plan",
      "memory",
      "cus_1",
      turn(
        "What would September 2026 have cost on Pro? Give actual total, simulated total and signed difference.",
        simulationAmounts(pro),
        [simulationCall(pro)],
        "Pro simulation.",
        [],
        [/Pro/i]
      ),
      turn(
        "I have reopened the chat. Remind me which plan we just considered, its total, and the signed difference from my actual bill.",
        [pro.simulatedTotal, pro.difference],
        [simulationCall(pro)],
        "We considered Pro.",
        [],
        [/Pro/i]
      )
    ),
    make(
      "remember-credit",
      "memory",
      "cus_1",
      turn(
        "The September 2026 invoice debit was posted twice. I confirm: start a credit request for the duplicate and tell me the amount and approval status.",
        [validation.creditableAmount],
        [creditCall],
        "Credit request pending human approval.",
        [],
        [/pending|requested|await/i, /approv/i],
        true
      ),
      turn(
        "I have reopened the chat. What is the status and amount of the credit request we just started?",
        [validation.creditableAmount],
        [statusCall],
        "Credit request pending human approval.",
        [],
        [/pending|requested|await/i, /approv/i]
      )
    ),
    make(
      "expired-credit-history",
      "credit",
      "cus_1",
      turn(
        "Before starting anything new, tell me the status and validated amount of my historical credit request.",
        [seedHistory.validatedAmount!],
        [historyCall],
        "Historical credit request expired.",
        [],
        [/expired/i]
      )
    )
  ];
}
