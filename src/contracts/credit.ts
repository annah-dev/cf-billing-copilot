import { z } from "zod";
import { MoneySchema } from "./money";
import {
  CreditMemoIdSchema,
  CreditRequestIdSchema,
  CustomerIdSchema,
  IdempotencyKeySchema,
  InvoiceIdSchema,
  IsoDateTimeSchema,
  LedgerEntryIdSchema
} from "./ids";

/** docs/ARCHITECTURE.md, "State machine for credit_requests.status". */
export const CreditRequestStatusSchema = z.enum([
  "requested",
  "pending_approval",
  "approved",
  "applied",
  "rejected",
  "expired"
]);
export type CreditRequestStatus = z.infer<typeof CreditRequestStatusSchema>;

export const TERMINAL_CREDIT_STATUSES: readonly CreditRequestStatus[] = [
  "applied",
  "rejected",
  "expired"
];

/** Allowed transitions; anything else is refused and audited. */
export const CREDIT_TRANSITIONS: Readonly<
  Record<CreditRequestStatus, readonly CreditRequestStatus[]>
> = {
  requested: ["pending_approval", "rejected"],
  pending_approval: ["approved", "rejected", "expired"],
  approved: ["applied"],
  applied: [],
  rejected: [],
  expired: []
};

/** Actor strings recorded in audit records and decisions. */
export const ActorSchema = z.union([
  z.string().regex(/^customer:cus_[a-z0-9_]{1,40}$/),
  z.string().regex(/^approver:[0-9a-f]{32}$/),
  z.literal("system"),
  z.literal("system:sweeper"),
  z.string().regex(/^workflow:cr_[a-z0-9_]{1,40}$/)
]);
export type Actor = z.infer<typeof ActorSchema>;

/** First writer wins and is immutable (DECISIONS.md D-12). */
export const CreditDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(500),
  actor: ActorSchema,
  at: IsoDateTimeSchema
});
export type CreditDecision = z.infer<typeof CreditDecisionSchema>;

export const CreditRequestSchema = z.object({
  id: CreditRequestIdSchema,
  customerId: CustomerIdSchema,
  invoiceId: InvoiceIdSchema,
  disputedLedgerEntryId: LedgerEntryIdSchema.nullable(),
  idempotencyKey: IdempotencyKeySchema,
  /** The customer's own words, as captured by the agent. */
  customerReason: z.string().min(1).max(500),
  /** Set by validation (engine.validateCreditClaim); null until then or when invalid. */
  validatedAmount: MoneySchema.nullable(),
  status: CreditRequestStatusSchema,
  /** Equal to id (the Workflow instance id is derived from the request id). */
  workflowInstanceId: CreditRequestIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** When the approval wait times out. Null until pending_approval. */
  deadline: IsoDateTimeSchema.nullable(),
  decision: CreditDecisionSchema.nullable(),
  /** Why the request is rejected or expired, when it is. */
  outcomeReason: z.string().nullable()
});
export type CreditRequest = z.infer<typeof CreditRequestSchema>;

export const CreditMemoSchema = z.object({
  id: CreditMemoIdSchema,
  requestId: CreditRequestIdSchema,
  disputedLedgerEntryId: LedgerEntryIdSchema,
  amount: MoneySchema,
  status: z.enum(["pending", "applied", "void"])
});
export type CreditMemo = z.infer<typeof CreditMemoSchema>;

/** Output of engine.validateCreditClaim. */
export const ClaimValidationSchema = z.discriminatedUnion("valid", [
  z.object({
    valid: z.literal(true),
    disputedLedgerEntryId: LedgerEntryIdSchema,
    /** The earlier entry the disputed one duplicates. */
    duplicateOfLedgerEntryId: LedgerEntryIdSchema,
    /** Engine-computed amount still creditable for the disputed entry (after pending and applied memos). */
    creditableAmount: MoneySchema,
    explanation: z.string().min(1)
  }),
  z.object({
    valid: z.literal(false),
    reason: z.enum([
      "no_duplicate_found",
      "already_fully_credited",
      "entry_not_on_invoice",
      "invoice_not_found"
    ]),
    explanation: z.string().min(1)
  })
]);
export type ClaimValidation = z.infer<typeof ClaimValidationSchema>;
