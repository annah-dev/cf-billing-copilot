import { z } from "zod";
import { MoneySchema } from "./money";
import { InvoiceSchema } from "./billing";
import { CreditRequestSchema } from "./credit";
import { AuditRecordSchema } from "./audit";
import {
  AnomalyReportSchema,
  InvoiceComparisonSchema,
  LineExplanationSchema,
  PlanSimulationSchema
} from "./analysis";
import {
  CreditRequestIdSchema,
  CustomerIdSchema,
  InvoiceIdSchema,
  LedgerEntryIdSchema,
  LineItemIdSchema,
  PeriodSchema,
  PlanIdSchema
} from "./ids";

/**
 * Tool inputs and outputs for the chat agent. Inputs never carry a customer id:
 * the BillingAgent instance is bound to one customer, so the model cannot ask
 * about anyone else. Keep descriptions short; the model context is 24k tokens.
 * Every tool validates its input with the schema below and its output before
 * returning it (the output schemas are what the eval harness checks against).
 */

const InvoiceSummarySchema = z.object({
  invoiceId: InvoiceIdSchema,
  period: PeriodSchema,
  total: MoneySchema
});

const CreditRequestSummarySchema = CreditRequestSchema.pick({
  id: true,
  invoiceId: true,
  status: true,
  validatedAmount: true,
  createdAt: true,
  deadline: true,
  outcomeReason: true
});

export const ToolSchemas = {
  getAccount: {
    description:
      "Customer account: name, current plan, balance, invoices, open credit requests.",
    input: z.object({}),
    output: z.object({
      customerId: CustomerIdSchema,
      customerName: z.string(),
      plan: z.object({ planId: PlanIdSchema, name: z.string() }),
      availablePlans: z.array(
        z.object({ planId: PlanIdSchema, name: z.string() })
      ),
      balance: MoneySchema,
      invoices: z.array(InvoiceSummarySchema),
      openCreditRequests: z.array(CreditRequestSummarySchema)
    })
  },
  getInvoice: {
    description:
      "One invoice with every line. Give a period (YYYY-MM) or an invoice id.",
    input: z
      .object({
        period: PeriodSchema.optional(),
        invoiceId: InvoiceIdSchema.optional()
      })
      .refine((v) => (v.period === undefined) !== (v.invoiceId === undefined), {
        message: "give exactly one of period or invoiceId"
      }),
    output: InvoiceSchema
  },
  explainLineItem: {
    description:
      "Step-by-step computation of one invoice line (tiers, proration, tax).",
    input: z.object({ invoiceId: InvoiceIdSchema, lineId: LineItemIdSchema }),
    output: LineExplanationSchema
  },
  compareInvoices: {
    description:
      "What changed between two monthly invoices, by product and meter.",
    input: z.object({ fromPeriod: PeriodSchema, toPeriod: PeriodSchema }),
    output: InvoiceComparisonSchema
  },
  simulatePlan: {
    description:
      "Re-rate one month's usage under another plan and show the difference.",
    input: z.object({ period: PeriodSchema, planId: PlanIdSchema }),
    output: PlanSimulationSchema
  },
  detectAnomalies: {
    description: "Unusual single-day usage spikes in one month.",
    input: z.object({ period: PeriodSchema }),
    output: AnomalyReportSchema
  },
  startCreditRequest: {
    description:
      "Start a credit request for a suspected double charge. The customer confirms first. A human approves.",
    input: z.object({
      invoiceId: InvoiceIdSchema,
      disputedLedgerEntryId: LedgerEntryIdSchema.optional(),
      reason: z.string().min(1).max(500)
    }),
    output: z.object({
      request: CreditRequestSummarySchema,
      /** True when this call found an existing request for the same claim (idempotent retry). */
      existing: z.boolean(),
      message: z.string()
    })
  },
  getCreditRequestStatus: {
    description: "Status and audit trail of the customer's credit requests.",
    input: z.object({ requestId: CreditRequestIdSchema.optional() }),
    output: z.object({
      requests: z.array(
        z.object({
          request: CreditRequestSummarySchema,
          audit: z.array(AuditRecordSchema)
        })
      )
    })
  }
} as const;

export type ToolName = keyof typeof ToolSchemas;
export const TOOL_NAMES = Object.keys(ToolSchemas) as ToolName[];
export type ToolInput<N extends ToolName> = z.infer<
  (typeof ToolSchemas)[N]["input"]
>;
export type ToolOutput<N extends ToolName> = z.infer<
  (typeof ToolSchemas)[N]["output"]
>;
