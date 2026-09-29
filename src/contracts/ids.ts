import { z } from "zod";

/** Calendar date in UTC, YYYY-MM-DD. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
/** Instant in UTC, ISO-8601 with Z. */
export const IsoDateTimeSchema = z.iso.datetime();
/** Billing period (one calendar month), YYYY-MM. */
export const PeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM");

const slug = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9_]{1,40}$`), `expected ${prefix}_<slug>`);

export const CustomerIdSchema = slug("cus");
export const PlanIdSchema = slug("plan");
export const MeterIdSchema = slug("meter");
export const InvoiceIdSchema = slug("inv");
export const LineItemIdSchema = slug("line");
export const LedgerEntryIdSchema = slug("le");
export const CreditRequestIdSchema = slug("cr");
export const CreditMemoIdSchema = slug("cm");

/** Sandbox id: 128 random bits as 32 lowercase hex characters (DECISIONS.md D-3). */
export const SandboxIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "expected 32 hex characters");
/** Idempotency key for a credit request: 64 lowercase hex characters (SHA-256). */
export const IdempotencyKeySchema = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 hex characters");

export type IsoDate = z.infer<typeof IsoDateSchema>;
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type Period = z.infer<typeof PeriodSchema>;
export type CustomerId = z.infer<typeof CustomerIdSchema>;
export type PlanId = z.infer<typeof PlanIdSchema>;
export type MeterId = z.infer<typeof MeterIdSchema>;
export type InvoiceId = z.infer<typeof InvoiceIdSchema>;
export type LineItemId = z.infer<typeof LineItemIdSchema>;
export type LedgerEntryId = z.infer<typeof LedgerEntryIdSchema>;
export type CreditRequestId = z.infer<typeof CreditRequestIdSchema>;
export type CreditMemoId = z.infer<typeof CreditMemoIdSchema>;
export type SandboxId = z.infer<typeof SandboxIdSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
