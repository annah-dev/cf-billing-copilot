import {
  EngineError,
  InvoiceSchema,
  money,
  type BillingDataset,
  type Invoice,
  type InvoiceLine,
  type Meter,
  type MeterPrice,
  type Plan,
  type TierCharge
} from "../contracts";
import { calendarDate, month, required } from "./data";
import { add, fraction, identifier, integer, rounded, safe, sum } from "./math";

function validatePrices(plan: Plan, meters: readonly Meter[]): void {
  if (
    new Set(plan.prices.map((price) => price.meterId)).size !==
    plan.prices.length
  ) {
    throw new EngineError("invalid_input", "Duplicate meter prices");
  }
  for (const price of plan.prices) {
    required(
      meters.find((meter) => meter.id === price.meterId),
      "Priced meter"
    );
    let previous = 0;
    price.tiers.forEach((tier, index) => {
      integer(tier.perUnits);
      if (tier.upTo === null) {
        if (index !== price.tiers.length - 1)
          throw new EngineError("invalid_input", "Unbounded tier must be last");
      } else {
        integer(tier.upTo);
        if (tier.upTo <= previous)
          throw new EngineError("invalid_input", "Tier bounds must increase");
        previous = tier.upTo;
      }
    });
    if (price.tiers.at(-1)?.upTo !== null)
      throw new EngineError("invalid_input", "Final tier must be unbounded");
  }
  for (const meter of meters)
    required(
      plan.prices.find((price) => price.meterId === meter.id),
      "Meter price"
    );
}

export function rate(
  quantity: number,
  price: MeterPrice,
  unit: string
): { amount: number; tiers: TierCharge[] } {
  const qty = integer(quantity);
  let lower = 0n;
  let cumulative = fraction(0n);
  let previousRounded = 0;
  const tiers: TierCharge[] = [];
  price.tiers.forEach((tier, tierIndex) => {
    const upper = tier.upTo === null ? qty : integer(tier.upTo);
    const units = qty > lower ? (qty < upper ? qty : upper) - lower : 0n;
    lower = upper;
    if (units === 0n) return;
    cumulative = add(
      cumulative,
      fraction(units * integer(tier.priceCents), integer(tier.perUnits))
    );
    const currentRounded = rounded(cumulative);
    // Allocate the line rounding residual by cumulative differences, never round each tier independently.
    tiers.push({
      tierIndex,
      units: safe(units),
      unitPrice: money(tier.priceCents),
      perUnits: tier.perUnits,
      rateDisplay: `${money(tier.priceCents).display} per ${String(tier.perUnits).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${unit}`,
      amount: money(currentRounded - previousRounded)
    });
    previousRounded = currentRounded;
  });
  return { amount: rounded(cumulative), tiers };
}

export function invoice(
  data: BillingDataset,
  customerId: string,
  period: string,
  overridePlanId?: string
): Invoice {
  const customer = required(
    data.customers.find((item) => item.id === customerId),
    "Customer"
  );
  const billingMonth = month(period);
  const subscriptions =
    overridePlanId === undefined
      ? data.subscriptions.filter((item) => item.customerId === customerId)
      : [
          {
            customerId,
            planId: overridePlanId,
            from: billingMonth.start,
            to: billingMonth.end
          }
        ];
  const segments = subscriptions
    .map((subscription) => {
      calendarDate(subscription.from);
      if (subscription.to !== null) {
        calendarDate(subscription.to);
        if (subscription.to <= subscription.from)
          throw new EngineError(
            "invalid_input",
            "Subscription must end after it starts"
          );
      }
      return {
        ...subscription,
        start:
          subscription.from > billingMonth.start
            ? subscription.from
            : billingMonth.start,
        end:
          subscription.to !== null && subscription.to < billingMonth.end
            ? subscription.to
            : billingMonth.end
      };
    })
    .filter((segment) => segment.start < segment.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  let cursor = billingMonth.start;
  for (const segment of segments) {
    if (segment.start !== cursor)
      throw new EngineError(
        "invalid_input",
        "Subscription coverage has a gap or overlap"
      );
    cursor = segment.end;
  }
  if (cursor !== billingMonth.end)
    throw new EngineError(
      "invalid_input",
      "Subscription must cover the billing month"
    );
  if (new Set(data.meters.map((meter) => meter.id)).size !== data.meters.length)
    throw new EngineError("invalid_input", "Duplicate meter ids");
  const usage = data.usage.filter(
    (record) =>
      record.customerId === customerId &&
      record.date >= billingMonth.start &&
      record.date < billingMonth.end
  );
  for (const record of usage) {
    calendarDate(record.date);
    integer(record.quantity);
    required(
      data.meters.find((meter) => meter.id === record.meterId),
      "Usage meter"
    );
  }
  const invoiceId = identifier("inv", `${customerId}:${period}`);
  const lines: InvoiceLine[] = [];
  const push = (line: Omit<InvoiceLine, "id">) =>
    lines.push({
      ...line,
      id: identifier("line", `${invoiceId}:${lines.length}`)
    });
  for (const segment of segments) {
    const plan = required(
      data.plans.find((item) => item.id === segment.planId),
      "Plan"
    );
    validatePrices(plan, data.meters);
    const days =
      (Date.parse(segment.end) - Date.parse(segment.start)) / 86_400_000;
    const prorated = days !== billingMonth.days;
    push({
      kind: prorated ? "proration" : "subscription",
      description: `${plan.name} fee: ${segment.start} to ${segment.end} (end exclusive); ${days} of ${billingMonth.days} days`,
      planId: plan.id,
      meterId: null,
      quantity: prorated ? days : null,
      amount: money(
        rounded(
          fraction(
            integer(plan.monthlyFeeCents) * integer(days),
            integer(billingMonth.days)
          )
        )
      ),
      tiers: []
    });
    for (const meter of data.meters) {
      const quantity = sum(
        usage
          .filter(
            (record) =>
              record.meterId === meter.id &&
              record.date >= segment.start &&
              record.date < segment.end
          )
          .map((record) => record.quantity)
      );
      const rated = rate(
        quantity,
        required(
          plan.prices.find((price) => price.meterId === meter.id),
          "Meter price"
        ),
        meter.unit
      );
      push({
        kind: "usage",
        description: `${meter.name} on ${plan.name}: ${segment.start} to ${segment.end} (end exclusive)`,
        planId: plan.id,
        meterId: meter.id,
        quantity,
        amount: money(rated.amount),
        tiers: rated.tiers
      });
    }
  }
  const subtotal = sum(lines.map((line) => line.amount.cents));
  // Ledger credits already reduce balance. Preserve only issued invoice discounts;
  // copying a credit memo posting here would remedy the same debit twice.
  const issued = data.invoices.filter(
    (bill) => bill.customerId === customerId && bill.period === period
  );
  if (issued.length > 1)
    throw new EngineError("invalid_input", "Ambiguous invoice for period");
  const credits =
    issued[0]?.lines.filter((line) => line.kind === "credit") ?? [];
  for (const credit of credits) {
    if (credit.amount.cents > 0)
      throw new EngineError(
        "invalid_input",
        "Invoice credit lines must be nonpositive"
      );
    push(credit);
  }
  const creditAmount = -sum(credits.map((credit) => credit.amount.cents));
  const taxable = safe(integer(subtotal) - integer(creditAmount));
  const tax = rounded(
    fraction(
      integer(Math.max(0, taxable)) * integer(customer.taxRateBps),
      10_000n
    )
  );
  push({
    kind: "tax",
    description: `Sales tax: ${customer.taxRateBps} basis points on ${money(Math.max(0, taxable)).display}`,
    planId: null,
    meterId: null,
    quantity: null,
    amount: money(tax),
    tiers: []
  });
  return InvoiceSchema.parse({
    id: invoiceId,
    customerId,
    period,
    issuedOn: billingMonth.end,
    lines,
    subtotal: money(subtotal),
    credits: money(creditAmount),
    tax: money(tax),
    total: money(sum([subtotal, -creditAmount, tax]))
  });
}
