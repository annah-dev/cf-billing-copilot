import { z } from "zod";
import { MoneySchema } from "./money";
import { InvoiceSchema } from "./billing";
import { CreditRequestSchema } from "./credit";
import { AuditRecordSchema } from "./audit";
import { ToolSchemas } from "./tools";
import {
  CustomerIdSchema,
  IsoDateTimeSchema,
  PlanIdSchema,
  SandboxIdSchema
} from "./ids";

/**
 * HTTP shapes for the chat UI, the /admin page and the eval harness.
 * Routes (docs/ARCHITECTURE.md, "HTTP surface"):
 *   POST /api/sandboxes                                          CreateSandboxResponse
 *   GET  /api/sandboxes/:sid/customers/:cid/panel                PanelResponse
 *   GET  /api/sandboxes/:sid/admin/credit-requests               AdminCreditRequestsResponse  (Bearer approver token)
 *   POST /api/sandboxes/:sid/admin/credit-requests/:rid/decision DecisionRequest -> DecisionResponse (Bearer approver token)
 *   POST /api/sandboxes/:sid/customers/:cid/turn                 TurnRequest -> TurnResponse
 *   WS   /agents/billing-agent/:sid.:cid                          Agents SDK chat channel
 * Every error response is ErrorResponse with the matching HTTP status.
 */

export const ROUTES = {
  sandboxes: "/api/sandboxes",
  panel: (sid: string, cid: string) =>
    `/api/sandboxes/${sid}/customers/${cid}/panel`,
  adminCreditRequests: (sid: string) =>
    `/api/sandboxes/${sid}/admin/credit-requests`,
  decision: (sid: string, rid: string) =>
    `/api/sandboxes/${sid}/admin/credit-requests/${rid}/decision`,
  turn: (sid: string, cid: string) =>
    `/api/sandboxes/${sid}/customers/${cid}/turn`
} as const;

/** Agent instance name: "<sandboxId>.<customerId>" (DECISIONS.md D-3). */
export const agentInstanceName = (sandboxId: string, customerId: string) =>
  `${sandboxId}.${customerId}`;
export const AgentInstanceNameSchema = z
  .string()
  .regex(
    /^[0-9a-f]{32}\.cus_[a-z0-9_]{1,40}$/,
    "expected <sandboxId>.<customerId>"
  );

export const CreateSandboxResponseSchema = z.object({
  sandboxId: SandboxIdSchema,
  /** Shown once; only its SHA-256 is stored (D-4). */
  approverToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, "expected 32 random bytes, base64url"),
  customers: z
    .array(z.object({ customerId: CustomerIdSchema, name: z.string() }))
    .min(1),
  createdAt: IsoDateTimeSchema,
  idleDeletionDays: z.number().int().positive()
});
export type CreateSandboxResponse = z.infer<typeof CreateSandboxResponseSchema>;

export const PanelResponseSchema = z.object({
  sandboxId: SandboxIdSchema,
  customerId: CustomerIdSchema,
  customerName: z.string(),
  plan: z.object({ planId: PlanIdSchema, name: z.string() }),
  balance: MoneySchema,
  /** The latest issued invoice. */
  currentInvoice: InvoiceSchema,
  creditRequests: z.array(CreditRequestSchema),
  /** Newest first. */
  audit: z.array(AuditRecordSchema)
});
export type PanelResponse = z.infer<typeof PanelResponseSchema>;

export const AdminCreditRequestsResponseSchema = z.object({
  sandboxId: SandboxIdSchema,
  /** pending_approval first, then newest first. */
  requests: z.array(CreditRequestSchema.extend({ customerName: z.string() }))
});
export type AdminCreditRequestsResponse = z.infer<
  typeof AdminCreditRequestsResponseSchema
>;

export const DecisionRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1).max(500)
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export const DecisionResponseSchema = z.object({
  request: CreditRequestSchema,
  /** True when an identical decision was already recorded (idempotent retry). */
  alreadyRecorded: z.boolean()
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

export const TurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000)
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const ToolCallRecordSchema = z.object({
  name: z.enum(
    Object.keys(ToolSchemas) as [
      keyof typeof ToolSchemas,
      ...(keyof typeof ToolSchemas)[]
    ]
  ),
  input: z.unknown(),
  /** The validated tool output, or null when the tool failed. */
  output: z.unknown().nullable(),
  error: z.string().nullable()
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const TurnResponseSchema = z.object({
  text: z.string(),
  toolCalls: z.array(ToolCallRecordSchema),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative()
  })
});
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export const ErrorCodeSchema = z.enum([
  "invalid_request", // 400
  "unauthorized", // 401
  "not_found", // 404
  "conflict", // 409
  "rate_limited", // 429, per-IP limiter
  "cap_reached", // 429, a daily cap in DECISIONS.md D-7
  "budget_exhausted", // 429, the daily neuron stop
  "internal" // 500
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Present for cap_reached and budget_exhausted. */
    cap: z
      .object({
        name: z.string(),
        limit: z.number().int().nonnegative(),
        resetsAt: IsoDateTimeSchema
      })
      .optional()
  })
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
