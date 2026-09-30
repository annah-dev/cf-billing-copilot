import { z } from "zod";
import { ActorSchema } from "./credit";
import { IsoDateTimeSchema } from "./ids";

/** Every state change and every refused change writes one of these (append-only). */
export const AuditActionSchema = z.enum([
  "sandbox_created",
  "credit_requested",
  "credit_validated",
  "credit_validation_failed",
  "memo_pending",
  "decision_received",
  "credit_approved",
  "credit_rejected",
  "credit_applied",
  "credit_expired",
  "memo_voided",
  "workflow_restarted",
  "approval_refused_expired",
  "approval_refused_finished",
  "decision_refused_conflict",
  "transition_refused"
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditSubjectSchema = z.object({
  type: z.enum(["sandbox", "credit_request", "credit_memo", "ledger_entry"]),
  id: z.string().min(1)
});
export type AuditSubject = z.infer<typeof AuditSubjectSchema>;

export const AuditRecordSchema = z.object({
  /** Monotonic per Ledger, starting at 1. */
  seq: z.number().int().positive(),
  at: IsoDateTimeSchema,
  actor: ActorSchema,
  action: AuditActionSchema,
  subject: AuditSubjectSchema,
  reason: z.string().min(1),
  /** Relevant fields before and after the change, JSON-serialisable; null when not applicable. */
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable()
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;
