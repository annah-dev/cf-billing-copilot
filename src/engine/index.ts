import { z } from "zod";
import {
  CreditMemoSchema,
  CustomerIdSchema,
  InvoiceIdSchema,
  LedgerEntryIdSchema,
  LedgerEntrySchema,
  LineItemIdSchema,
  PeriodSchema,
  PlanIdSchema,
  type BillingEngine
} from "../contracts";
import { dataset, input } from "./data";
import { invoice } from "./rating";
import { anomalies, compare, explain, simulate } from "./analysis";
import { balance, validateClaim } from "./credit";
import { seed } from "./seed";

const ClaimSchema = z.object({
  customerId: CustomerIdSchema,
  invoiceId: InvoiceIdSchema,
  disputedLedgerEntryId: LedgerEntryIdSchema.nullable()
});

export const engine: BillingEngine = {
  seed,
  buildInvoice: (data, customerId, period) =>
    invoice(
      dataset(data),
      input(CustomerIdSchema, customerId),
      input(PeriodSchema, period)
    ),
  explainLineItem: (data, invoiceId, lineId) =>
    explain(
      dataset(data),
      input(InvoiceIdSchema, invoiceId),
      input(LineItemIdSchema, lineId)
    ),
  compareInvoices: (data, customerId, fromPeriod, toPeriod) =>
    compare(
      dataset(data),
      input(CustomerIdSchema, customerId),
      input(PeriodSchema, fromPeriod),
      input(PeriodSchema, toPeriod)
    ),
  simulatePlan: (data, customerId, period, planId) =>
    simulate(
      dataset(data),
      input(CustomerIdSchema, customerId),
      input(PeriodSchema, period),
      input(PlanIdSchema, planId)
    ),
  detectAnomalies: (data, customerId, period) =>
    anomalies(
      dataset(data),
      input(CustomerIdSchema, customerId),
      input(PeriodSchema, period)
    ),
  validateCreditClaim: (data, claim, existingMemos) =>
    validateClaim(
      dataset(data),
      input(ClaimSchema, claim),
      input(z.array(CreditMemoSchema), existingMemos)
    ),
  balance: (ledger, customerId) =>
    balance(
      input(z.array(LedgerEntrySchema), ledger),
      input(CustomerIdSchema, customerId)
    )
};
