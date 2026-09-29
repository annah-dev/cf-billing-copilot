import { z } from "zod";
import { CentsSchema, MoneySchema } from "./money";
import {
  CustomerIdSchema,
  InvoiceIdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  LedgerEntryIdSchema,
  LineItemIdSchema,
  MeterIdSchema,
  PeriodSchema,
  PlanIdSchema
} from "./ids";

// ---- Catalog ---------------------------------------------------------------

export const MeterSchema = z.object({
  id: MeterIdSchema,
  name: z.string().min(1),
  /** Unit of the quantity, for example "requests" or "GB-day". */
  unit: z.string().min(1),
  /** Product grouping used by compareInvoices, for example "Workers". */
  product: z.string().min(1)
});
export type Meter = z.infer<typeof MeterSchema>;

/**
 * One graduated tier. Units in (previous upTo, upTo] are charged at
 * priceCents per perUnits units. upTo null means unbounded (last tier only).
 * Prices are integers: a fractional-cent unit price is expressed through perUnits
 * (for example 30 cents per 1,000,000 requests). Rounding of the resulting
 * fractional cents is the engine's documented rule, applied once per line.
 */
export const TierSchema = z.object({
  upTo: z.number().int().positive().nullable(),
  priceCents: CentsSchema.nonnegative(),
  perUnits: z.number().int().positive()
});
export type Tier = z.infer<typeof TierSchema>;

export const MeterPriceSchema = z.object({
  meterId: MeterIdSchema,
  tiers: z.array(TierSchema).min(1)
});
export type MeterPrice = z.infer<typeof MeterPriceSchema>;

export const PlanSchema = z.object({
  id: PlanIdSchema,
  name: z.string().min(1),
  monthlyFeeCents: CentsSchema.nonnegative(),
  prices: z.array(MeterPriceSchema).min(1)
});
export type Plan = z.infer<typeof PlanSchema>;

// ---- Customers and usage ----------------------------------------------------

export const CustomerSchema = z.object({
  id: CustomerIdSchema,
  /** Fictional company name. Synthetic data only. */
  name: z.string().min(1),
  /** Sales tax rate in basis points (825 = 8.25%). */
  taxRateBps: z.number().int().min(0).max(10_000)
});
export type Customer = z.infer<typeof CustomerSchema>;

/** Plan history. A mid-period change produces proration lines. `to` is exclusive. */
export const SubscriptionSchema = z.object({
  customerId: CustomerIdSchema,
  planId: PlanIdSchema,
  from: IsoDateSchema,
  to: IsoDateSchema.nullable()
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const UsageRecordSchema = z.object({
  customerId: CustomerIdSchema,
  meterId: MeterIdSchema,
  date: IsoDateSchema,
  quantity: z.number().int().nonnegative()
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

// ---- Invoices -----------------------------------------------------------------

export const TierChargeSchema = z.object({
  tierIndex: z.number().int().nonnegative(),
  units: z.number().int().nonnegative(),
  priceCents: CentsSchema.nonnegative(),
  perUnits: z.number().int().positive(),
  amount: MoneySchema
});
export type TierCharge = z.infer<typeof TierChargeSchema>;

export const InvoiceLineKindSchema = z.enum([
  "subscription",
  "proration",
  "usage",
  "credit",
  "tax"
]);
export type InvoiceLineKind = z.infer<typeof InvoiceLineKindSchema>;

export const InvoiceLineSchema = z.object({
  id: LineItemIdSchema,
  kind: InvoiceLineKindSchema,
  description: z.string().min(1),
  planId: PlanIdSchema.nullable(),
  meterId: MeterIdSchema.nullable(),
  /** Metered quantity for usage lines, days for proration lines, null otherwise. */
  quantity: z.number().int().nonnegative().nullable(),
  /** Signed: credits are negative. */
  amount: MoneySchema,
  tiers: z.array(TierChargeSchema)
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoiceSchema = z.object({
  id: InvoiceIdSchema,
  customerId: CustomerIdSchema,
  period: PeriodSchema,
  issuedOn: IsoDateSchema,
  lines: z.array(InvoiceLineSchema).min(1),
  subtotal: MoneySchema,
  credits: MoneySchema,
  tax: MoneySchema,
  total: MoneySchema
});
export type Invoice = z.infer<typeof InvoiceSchema>;

// ---- Ledger --------------------------------------------------------------------

/**
 * Append-only customer ledger. amount is always positive; kind gives the direction
 * (charge increases what the customer owes, payment and credit decrease it).
 */
export const LedgerEntryKindSchema = z.enum(["charge", "payment", "credit"]);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKindSchema>;

export const LedgerEntrySchema = z.object({
  id: LedgerEntryIdSchema,
  customerId: CustomerIdSchema,
  at: IsoDateTimeSchema,
  kind: LedgerEntryKindSchema,
  amount: MoneySchema.refine((m) => m.cents > 0, { message: "ledger amounts are positive" }),
  invoiceId: InvoiceIdSchema.nullable(),
  /** External reference, for example a card-processor charge id. Duplicates share it. */
  reference: z.string().min(1),
  description: z.string().min(1)
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
