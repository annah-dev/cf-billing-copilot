import { z } from "zod";
import {
  CustomerSchema,
  InvoiceSchema,
  LedgerEntrySchema,
  MeterSchema,
  PlanSchema,
  SubscriptionSchema,
  UsageRecordSchema,
  type Invoice,
  type LedgerEntry
} from "./billing";
import { AuditRecordSchema } from "./audit";
import type { Money } from "./money";
import { CreditMemoSchema, CreditRequestSchema, type ClaimValidation, type CreditMemo } from "./credit";
import type {
  AnomalyReport,
  InvoiceComparison,
  LineExplanation,
  PlanSimulation
} from "./analysis";
import type { CustomerId, InvoiceId, LedgerEntryId, LineItemId, Period, PlanId } from "./ids";

/**
 * Everything the engine needs, as plain data. The Ledger Durable Object stores
 * exactly this shape (plus its own credit-flow tables) and passes slices of it
 * to the engine. The engine never does I/O.
 */
export const BillingDatasetSchema = z.object({
  seedVersion: z.string().min(1),
  meters: z.array(MeterSchema).min(1),
  plans: z.array(PlanSchema).min(1),
  customers: z.array(CustomerSchema).min(1),
  subscriptions: z.array(SubscriptionSchema).min(1),
  usage: z.array(UsageRecordSchema),
  invoices: z.array(InvoiceSchema),
  ledger: z.array(LedgerEntrySchema),
  /** Historical credit requests in the seed (for example the expired one, D-6). */
  creditRequests: z.array(CreditRequestSchema),
  creditMemos: z.array(CreditMemoSchema),
  /** Audit records that belong to the seeded history. */
  audit: z.array(AuditRecordSchema)
});
export type BillingDataset = z.infer<typeof BillingDatasetSchema>;

export class EngineError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_input" | "unsupported",
    message: string
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/**
 * The billing engine: pure, deterministic, integer cents only, no Cloudflare
 * imports. Implemented in src/engine/ by the engine lane. Functions throw
 * EngineError for missing data or invalid input, never return partial results.
 */
export interface BillingEngine {
  /** The deterministic synthetic dataset (3 customers, July to September 2026). */
  seed(): BillingDataset;

  /** Rate one customer's usage for one period under the subscriptions in force. */
  buildInvoice(data: BillingDataset, customerId: CustomerId, period: Period): Invoice;

  explainLineItem(data: BillingDataset, invoiceId: InvoiceId, lineId: LineItemId): LineExplanation;

  compareInvoices(
    data: BillingDataset,
    customerId: CustomerId,
    fromPeriod: Period,
    toPeriod: Period
  ): InvoiceComparison;

  /** Re-rate the customer's usage for the period as if they had been on planId all period. */
  simulatePlan(data: BillingDataset, customerId: CustomerId, period: Period, planId: PlanId): PlanSimulation;

  detectAnomalies(data: BillingDataset, customerId: CustomerId, period: Period): AnomalyReport;

  /**
   * Check a double-charge claim against the ledger. existingMemos are the pending
   * and applied memos already reserved, so creditableAmount never lets pending plus
   * applied credits exceed the disputed amount.
   */
  validateCreditClaim(
    data: BillingDataset,
    claim: { customerId: CustomerId; invoiceId: InvoiceId; disputedLedgerEntryId: LedgerEntryId | null },
    existingMemos: readonly CreditMemo[]
  ): ClaimValidation;

  /** Current balance owed from the ledger (charges minus payments and credits). */
  balance(ledger: readonly LedgerEntry[], customerId: CustomerId): Money;
}
