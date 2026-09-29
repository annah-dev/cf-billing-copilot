import { z } from "zod";
import { MoneySchema, MultipleSchema, PercentSchema } from "./money";
import { InvoiceLineSchema, TierChargeSchema } from "./billing";
import {
  CustomerIdSchema,
  InvoiceIdSchema,
  IsoDateSchema,
  LineItemIdSchema,
  MeterIdSchema,
  PeriodSchema,
  PlanIdSchema
} from "./ids";

/** engine.explainLineItem: how one invoice line was computed, step by step. */
export const LineExplanationSchema = z.object({
  invoiceId: InvoiceIdSchema,
  line: InvoiceLineSchema,
  /** Ordered, human-readable steps; each step that involves money carries it. */
  steps: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().min(1),
        amount: MoneySchema.nullable()
      })
    )
    .min(1),
  tiers: z.array(TierChargeSchema)
});
export type LineExplanation = z.infer<typeof LineExplanationSchema>;

/** engine.compareInvoices: what changed between two periods, by product and meter. */
export const InvoiceComparisonSchema = z.object({
  customerId: CustomerIdSchema,
  fromPeriod: PeriodSchema,
  toPeriod: PeriodSchema,
  fromTotal: MoneySchema,
  toTotal: MoneySchema,
  totalDelta: MoneySchema,
  /** Relative change of the total; null when fromTotal is zero. */
  totalChange: PercentSchema.nullable(),
  byMeter: z.array(
    z.object({
      meterId: MeterIdSchema,
      meterName: z.string(),
      product: z.string(),
      fromQuantity: z.number().int().nonnegative(),
      toQuantity: z.number().int().nonnegative(),
      fromAmount: MoneySchema,
      toAmount: MoneySchema,
      delta: MoneySchema,
      change: PercentSchema.nullable()
    })
  ),
  /** Non-usage differences: subscription, proration, credits, tax. */
  otherChanges: z.array(
    z.object({ label: z.string(), fromAmount: MoneySchema, toAmount: MoneySchema, delta: MoneySchema })
  ),
  /** Plain-language summary written by the engine from the numbers above. */
  summary: z.string().min(1)
});
export type InvoiceComparison = z.infer<typeof InvoiceComparisonSchema>;

/** engine.simulatePlan: the same usage re-rated under another plan. */
export const PlanSimulationSchema = z.object({
  customerId: CustomerIdSchema,
  period: PeriodSchema,
  actualPlanId: PlanIdSchema,
  simulatedPlanId: PlanIdSchema,
  actualTotal: MoneySchema,
  simulatedTotal: MoneySchema,
  /** simulatedTotal minus actualTotal: negative means the other plan is cheaper. */
  difference: MoneySchema,
  simulatedLines: z.array(InvoiceLineSchema).min(1),
  assumptions: z.array(z.string())
});
export type PlanSimulation = z.infer<typeof PlanSimulationSchema>;

/** engine.detectAnomalies: unusual single-day usage per meter. */
export const AnomalySchema = z.object({
  meterId: MeterIdSchema,
  meterName: z.string(),
  date: IsoDateSchema,
  quantity: z.number().int().nonnegative(),
  /** Baseline daily quantity the spike is compared with (the engine documents the method). */
  baselineQuantity: z.number().int().nonnegative(),
  multiple: MultipleSchema,
  /** Engine-estimated cost attributable to the excess over baseline. */
  estimatedExcessCost: MoneySchema,
  severity: z.enum(["info", "warning", "critical"])
});
export type Anomaly = z.infer<typeof AnomalySchema>;

export const AnomalyReportSchema = z.object({
  customerId: CustomerIdSchema,
  period: PeriodSchema,
  anomalies: z.array(AnomalySchema),
  method: z.string().min(1)
});
export type AnomalyReport = z.infer<typeof AnomalyReportSchema>;

/** Line id reference used by tools. */
export const LineRefSchema = z.object({ invoiceId: InvoiceIdSchema, lineId: LineItemIdSchema });
