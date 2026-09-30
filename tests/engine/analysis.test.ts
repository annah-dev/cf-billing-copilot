import { describe, expect, it } from "vitest";
import {
  AnomalyReportSchema,
  InvoiceComparisonSchema,
  LineExplanationSchema,
  PlanSimulationSchema,
  money
} from "../../src/contracts";
import { engine } from "../../src/engine";
import { fixture, postedCredit } from "./fixture";

describe("invoice analysis", () => {
  it("explains every seed line with contract-valid steps and tier money", () => {
    const data = engine.seed();
    for (const invoice of data.invoices)
      for (const line of invoice.lines) {
        const result = engine.explainLineItem(data, invoice.id, line.id);
        expect(LineExplanationSchema.parse(result)).toEqual(result);
        expect(result.line).toEqual(line);
        expect(result.steps.at(-1)?.amount).toEqual(line.amount);
        expect(result.tiers).toEqual(line.tiers);
      }
    expect(() =>
      engine.explainLineItem(data, data.invoices[0].id, "line_missing")
    ).toThrow(/Line not found/);
  });

  it("compares all meters and products and reconciles all deltas to the total", () => {
    const data = engine.seed();
    const result = engine.compareInvoices(data, "cus_1", "2026-08", "2026-09");
    expect(InvoiceComparisonSchema.parse(result)).toEqual(result);
    expect(result.totalChange?.display).toBe("38%");
    expect(result.totalDelta.cents).toBe(11369);
    expect(result.byMeter.map((meter) => meter.delta.cents)).toEqual([
      860, 2160, 2350, 5132
    ]);
    expect(
      result.byMeter.reduce((total, meter) => total + meter.delta.cents, 0) +
        result.otherChanges.reduce(
          (total, change) => total + change.delta.cents,
          0
        )
    ).toBe(result.totalDelta.cents);
    expect(result.summary).toContain("Edge: $32.10");
    expect(result.summary).toContain("Storage: $21.60");
    expect(result.summary).toContain("Compute: $51.32");
  });

  it("handles zero baselines, decreases, and non-usage changes", () => {
    const data = fixture(10);
    data.invoices.push(
      engine.buildInvoice(data, "cus_test", "2026-08"),
      engine.buildInvoice(data, "cus_test", "2026-09")
    );
    const rising = engine.compareInvoices(
      data,
      "cus_test",
      "2026-08",
      "2026-09"
    );
    expect(rising.totalChange).toBeNull();
    expect(rising.byMeter[0].change).toBeNull();
    const falling = engine.compareInvoices(
      data,
      "cus_test",
      "2026-09",
      "2026-08"
    );
    expect(falling.totalChange).toEqual({
      basisPoints: -10000,
      display: "-100%"
    });
    data.ledger.push(postedCredit(5));
    data.customers[0].taxRateBps = 1000;
    data.plans[0].monthlyFeeCents = 30;
    data.invoices[1] = engine.buildInvoice(data, "cus_test", "2026-09");
    const result = engine.compareInvoices(
      data,
      "cus_test",
      "2026-08",
      "2026-09"
    );
    expect(result.otherChanges.map((item) => item.delta.cents)).toEqual([
      30, 0, -5, 5
    ]);
  });

  it("simulates the same usage under Pro with exact credits and tax", () => {
    const data = engine.seed();
    const result = engine.simulatePlan(data, "cus_1", "2026-09", "plan_pro");
    expect(PlanSimulationSchema.parse(result)).toEqual(result);
    expect(result.actualTotal).toEqual(money(41287));
    expect(result.simulatedTotal).toEqual(money(35917));
    expect(result.difference).toEqual(money(-5370));
    const test = fixture(10);
    test.ledger.push(postedCredit(5));
    test.customers[0].taxRateBps = 1000;
    test.invoices.push(engine.buildInvoice(test, "cus_test", "2026-09"));
    const simulated = engine.simulatePlan(
      test,
      "cus_test",
      "2026-09",
      "plan_pro"
    );
    expect(simulated.simulatedTotal.cents).toBe(666);
  });

  it("reports the closing actual plan on a mid-period change and leaves data immutable", () => {
    const data = engine.seed();
    const before = JSON.stringify(data);
    const result = engine.simulatePlan(
      data,
      "cus_2",
      "2026-09",
      "plan_starter"
    );
    expect(result.actualPlanId).toBe("plan_pro");
    expect(
      result.simulatedLines.filter((line) => line.kind === "proration")
    ).toHaveLength(0);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("requires issued invoices for comparison and simulation", () => {
    expect(() =>
      engine.compareInvoices(fixture(), "cus_test", "2026-08", "2026-09")
    ).toThrow(/Invoice not found/);
    expect(() =>
      engine.simulatePlan(fixture(), "cus_test", "2026-09", "plan_pro")
    ).toThrow(/Invoice not found/);
  });
});

describe("anomaly detection", () => {
  it("detects only the seeded 5x spike and estimates marginal graduated cost", () => {
    const data = engine.seed();
    const result = engine.detectAnomalies(data, "cus_1", "2026-09");
    expect(AnomalyReportSchema.parse(result)).toEqual(result);
    expect(result.anomalies).toEqual([
      {
        meterId: "meter_requests",
        meterName: "Edge requests",
        date: "2026-09-18",
        quantity: 15000,
        baselineQuantity: 3000,
        multiple: { hundredths: 500, display: "5x" },
        estimatedExcessCost: money(1160),
        severity: "critical"
      }
    ]);
    for (const customer of data.customers)
      for (const period of ["2026-07", "2026-08", "2026-09"]) {
        if (customer.id !== "cus_1" || period !== "2026-09")
          expect(
            engine.detectAnomalies(data, customer.id, period).anomalies
          ).toHaveLength(0);
      }
  });

  it.each([
    [29, null],
    [30, "info"],
    [40, "warning"],
    [50, "critical"]
  ])(
    "scores quantity %i against a positive median baseline",
    (quantity, severity) => {
      const data = fixture();
      data.usage = Array.from({ length: 30 }, (_, index) => ({
        customerId: "cus_test",
        meterId: "meter_test",
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        quantity: index === 0 ? quantity : 10
      }));
      const result = engine.detectAnomalies(data, "cus_test", "2026-09");
      expect(result.anomalies.map((item) => item.severity)).toEqual(
        severity ? [severity] : []
      );
    }
  );

  it("sums multiple daily records and excludes the candidate from an even median", () => {
    const data = fixture();
    data.usage = Array.from({ length: 31 }, (_, index) => ({
      customerId: "cus_test",
      meterId: "meter_test",
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      quantity: index === 0 ? 20 : index <= 15 ? 10 : 11
    }));
    data.usage.push({ ...data.usage[0], quantity: 20 });
    const result = engine.detectAnomalies(data, "cus_test", "2026-08");
    expect(result.anomalies[0]).toMatchObject({
      baselineQuantity: 11,
      quantity: 40,
      multiple: { hundredths: 364, display: "3.64x" }
    });
    expect(result.anomalies[0].estimatedExcessCost.cents).toBe(29);
  });

  it("does not divide by a zero baseline and treats missing days as zero", () => {
    const result = engine.detectAnomalies(fixture(100), "cus_test", "2026-09");
    expect(result.anomalies).toEqual([]);
    expect(result.method).toContain("missing days are zero");
  });
});
