import {
  AnomalyReportSchema,
  InvoiceComparisonSchema,
  LineExplanationSchema,
  PlanSimulationSchema,
  money,
  type BillingDataset,
  type Invoice,
  type Money
} from "../contracts";
import { month, required, storedInvoice } from "./data";
import {
  difference,
  fraction,
  integer,
  multiple,
  percent,
  rounded,
  sum
} from "./math";
import { invoice } from "./rating";

export function explain(
  data: BillingDataset,
  invoiceId: string,
  lineId: string
) {
  const bill = required(
    data.invoices.find((item) => item.id === invoiceId),
    "Invoice"
  );
  const line = required(
    bill.lines.find((item) => item.id === lineId),
    "Line"
  );
  const steps: { label: string; detail: string; amount: Money | null }[] =
    line.tiers.map((tier) => ({
      label: `Tier ${tier.tierIndex + 1}`,
      detail: `${tier.units} units at ${tier.rateDisplay}; cumulative rounding residual allocated to this tier`,
      amount: tier.amount
    }));
  if (line.kind === "usage")
    steps.unshift({
      label: "Usage",
      detail: `${line.quantity} metered units. ${line.description}. Graduated tiers restart per plan segment; bounds are not prorated.`,
      amount: null
    });
  if (line.kind === "subscription" || line.kind === "proration") {
    const plan = required(
      data.plans.find((item) => item.id === line.planId),
      "Plan"
    );
    steps.push({
      label: "Monthly fee",
      detail: `${plan.name} monthly fee; ${line.kind === "proration" ? `${line.quantity} active days divided by ${month(bill.period).days} calendar days` : "full calendar month"}.`,
      amount: money(plan.monthlyFeeCents)
    });
  }
  if (line.kind === "tax") {
    steps.push({
      label: "Taxable subtotal",
      detail: `Subtotal ${bill.subtotal.display} less invoice discounts ${bill.credits.display}, floored at zero.`,
      amount: money(
        Math.max(0, difference(bill.subtotal.cents, bill.credits.cents))
      )
    });
  }
  return LineExplanationSchema.parse({
    invoiceId,
    line,
    tiers: line.tiers,
    steps: [
      ...steps,
      {
        label: line.kind === "usage" ? "Line total" : line.kind,
        detail: `${line.description}. Exact fractions, rounded once per line to nearest cent; half cents away from zero.`,
        amount: line.amount
      }
    ]
  });
}

function usageTotal(bill: Invoice, meterId: string) {
  const lines = bill.lines.filter(
    (line) => line.kind === "usage" && line.meterId === meterId
  );
  return {
    quantity: sum(lines.map((line) => line.quantity ?? 0)),
    amount: sum(lines.map((line) => line.amount.cents))
  };
}

export function compare(
  data: BillingDataset,
  customerId: string,
  fromPeriod: string,
  toPeriod: string
) {
  const from = storedInvoice(data, customerId, fromPeriod);
  const to = storedInvoice(data, customerId, toPeriod);
  const byMeter = data.meters.map((meter) => {
    const before = usageTotal(from, meter.id);
    const after = usageTotal(to, meter.id);
    const delta = difference(after.amount, before.amount);
    return {
      meterId: meter.id,
      meterName: meter.name,
      product: meter.product,
      fromQuantity: before.quantity,
      toQuantity: after.quantity,
      fromAmount: money(before.amount),
      toAmount: money(after.amount),
      delta: money(delta),
      change: percent(delta, before.amount)
    };
  });
  const otherChanges = (
    ["subscription", "proration", "credit", "tax"] as const
  ).map((kind) => {
    const before = sum(
      from.lines
        .filter((line) => line.kind === kind)
        .map((line) => line.amount.cents)
    );
    const after = sum(
      to.lines
        .filter((line) => line.kind === kind)
        .map((line) => line.amount.cents)
    );
    return {
      label: kind,
      fromAmount: money(before),
      toAmount: money(after),
      delta: money(difference(after, before))
    };
  });
  const delta = difference(to.total.cents, from.total.cents);
  const change = percent(delta, from.total.cents);
  const products = [...new Set(byMeter.map((meter) => meter.product))].map(
    (product) =>
      `${product}: ${money(sum(byMeter.filter((meter) => meter.product === product).map((meter) => meter.delta.cents))).display}`
  );
  return InvoiceComparisonSchema.parse({
    customerId,
    fromPeriod,
    toPeriod,
    fromTotal: from.total,
    toTotal: to.total,
    totalDelta: money(delta),
    totalChange: change,
    byMeter,
    otherChanges,
    summary: `${toPeriod} total ${to.total.display} versus ${fromPeriod} ${from.total.display}: change ${money(delta).display}${change ? ` (${change.display})` : " (percentage unavailable: prior total is zero)"}. Usage by product: ${products.join("; ")}. Other changes: ${otherChanges.map((item) => `${item.label}: ${item.delta.display}`).join("; ")}.`
  });
}

export function simulate(
  data: BillingDataset,
  customerId: string,
  period: string,
  planId: string
) {
  const actual = storedInvoice(data, customerId, period);
  const simulated = invoice(data, customerId, period, planId);
  const closingLine = required(
    [...actual.lines]
      .reverse()
      .find(
        (line) =>
          line.kind === "usage" ||
          line.kind === "subscription" ||
          line.kind === "proration"
      ),
    "Actual plan line"
  );
  return PlanSimulationSchema.parse({
    customerId,
    period,
    actualPlanId: required(closingLine.planId ?? undefined, "Actual plan"),
    simulatedPlanId: planId,
    actualTotal: actual.total,
    simulatedTotal: simulated.total,
    difference: money(difference(simulated.total.cents, actual.total.cents)),
    simulatedLines: simulated.lines,
    assumptions: [
      "Same daily usage; selected plan in force for the whole UTC calendar month.",
      "Graduated tiers restart at zero; monthly fee is charged in full.",
      "Same issued invoice discounts and customer tax rate; tax recomputed after discounts. Ledger credits affect balance only.",
      "Actual total is the immutable issued invoice; actualPlanId identifies its closing plan when plans changed."
    ]
  });
}

export function anomalies(
  data: BillingDataset,
  customerId: string,
  period: string
) {
  required(
    data.customers.find((customer) => customer.id === customerId),
    "Customer"
  );
  const dates = month(period).dates;
  const rated = invoice(data, customerId, period);
  const results = [];
  for (const meter of data.meters) {
    const daily = dates.map((date) =>
      sum(
        data.usage
          .filter(
            (record) =>
              record.customerId === customerId &&
              record.meterId === meter.id &&
              record.date === date
          )
          .map((record) => record.quantity)
      )
    );
    for (let index = 0; index < dates.length; index++) {
      const peers = daily
        .filter((_, peerIndex) => peerIndex !== index)
        .sort((a, b) => a - b);
      const middle = Math.trunc(peers.length / 2);
      const baseline =
        peers.length % 2
          ? peers[middle]
          : rounded(
              fraction(integer(peers[middle - 1]) + integer(peers[middle]), 2n)
            );
      const quantity = daily[index];
      if (baseline === 0 || integer(quantity) < 3n * integer(baseline))
        continue;
      let excess = difference(quantity, baseline);
      const corrected = data.usage.map((record) => {
        if (
          record.customerId !== customerId ||
          record.meterId !== meter.id ||
          record.date !== dates[index]
        )
          return record;
        const removed = Math.min(excess, record.quantity);
        excess -= removed;
        return { ...record, quantity: record.quantity - removed };
      });
      const correctedInvoice = invoice(
        { ...data, usage: corrected },
        customerId,
        period
      );
      const cost = difference(
        usageTotal(rated, meter.id).amount,
        usageTotal(correctedInvoice, meter.id).amount
      );
      results.push({
        meterId: meter.id,
        meterName: meter.name,
        date: dates[index],
        quantity,
        baselineQuantity: baseline,
        multiple: multiple(quantity, baseline),
        estimatedExcessCost: money(cost),
        severity:
          integer(quantity) >= 5n * integer(baseline)
            ? "critical"
            : integer(quantity) >= 4n * integer(baseline)
              ? "warning"
              : "info"
      });
    }
  }
  return AnomalyReportSchema.parse({
    customerId,
    period,
    anomalies: results,
    method:
      "Leave-one-day-out median of other daily totals in the same UTC month and meter; missing days are zero, even medians round half away from zero. Flag >=3x a positive baseline (>=4x warning, >=5x critical); zero baselines are not scored. Excess cost is the difference in rounded usage charges when that day's excess is removed, retaining the actual plan history; excludes fee, tax and credits."
  });
}
