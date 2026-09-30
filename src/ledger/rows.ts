// Row shapes of the Ledger tables and their mapping to contract types. Amounts are stored as
// integer cents and leave as Money built by money() (formatUsd): no arithmetic happens here.
import {
  money,
  type AuditRecord,
  type CreditDecision,
  type CreditMemo,
  type CreditRequest,
  type CreditRequestStatus,
  type InvoiceLine,
  type LedgerEntry
} from "../contracts";

export type RequestRow = {
  id: string;
  idempotency_key: string;
  customer_id: string;
  invoice_id: string;
  disputed_ledger_entry_id: string | null;
  customer_reason: string;
  validated_amount_cents: number | null;
  status: CreditRequestStatus;
  created_at: string;
  updated_at: string;
  deadline: string | null;
  decision_json: string | null;
  outcome_reason: string | null;
};

export type MemoRow = {
  id: string;
  request_id: string;
  disputed_ledger_entry_id: string;
  amount_cents: number;
  status: CreditMemo["status"];
};

export type LedgerRow = {
  id: string;
  customer_id: string;
  at: string;
  kind: LedgerEntry["kind"];
  amount_cents: number;
  invoice_id: string | null;
  reference: string;
  description: string;
};

export type AuditRow = {
  seq: number;
  at: string;
  actor: string;
  action: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  before_json: string | null;
  after_json: string | null;
};

export type LineRow = {
  invoice_id: string;
  idx: number;
  id: string;
  kind: InvoiceLine["kind"];
  description: string;
  plan_id: string | null;
  meter_id: string | null;
  quantity: number | null;
  amount_cents: number;
  tiers_json: string;
};

export function decisionOf(row: RequestRow): CreditDecision | null {
  return row.decision_json
    ? (JSON.parse(row.decision_json) as CreditDecision)
    : null;
}

export function toCreditRequest(row: RequestRow): CreditRequest {
  return {
    id: row.id,
    customerId: row.customer_id,
    invoiceId: row.invoice_id,
    disputedLedgerEntryId: row.disputed_ledger_entry_id,
    idempotencyKey: row.idempotency_key,
    customerReason: row.customer_reason,
    validatedAmount:
      row.validated_amount_cents === null
        ? null
        : money(row.validated_amount_cents),
    status: row.status,
    workflowInstanceId: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deadline: row.deadline,
    decision: decisionOf(row),
    outcomeReason: row.outcome_reason
  };
}

export function toCreditMemo(row: MemoRow): CreditMemo {
  return {
    id: row.id,
    requestId: row.request_id,
    disputedLedgerEntryId: row.disputed_ledger_entry_id,
    amount: money(row.amount_cents),
    status: row.status
  };
}

export function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    at: row.at,
    kind: row.kind,
    amount: money(row.amount_cents),
    invoiceId: row.invoice_id,
    reference: row.reference,
    description: row.description
  };
}

export function toAuditRecord(row: AuditRow): AuditRecord {
  return {
    seq: row.seq,
    at: row.at,
    actor: row.actor,
    action: row.action as AuditRecord["action"],
    subject: {
      type: row.subject_type as AuditRecord["subject"]["type"],
      id: row.subject_id
    },
    reason: row.reason,
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null
  };
}

export function toInvoiceLine(row: LineRow): InvoiceLine {
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    planId: row.plan_id,
    meterId: row.meter_id,
    quantity: row.quantity,
    amount: money(row.amount_cents),
    tiers: JSON.parse(row.tiers_json)
  };
}

/** The fields the credit-request summary tools and the audit before/after snapshots show. */
export function requestSnapshot(row: RequestRow): Record<string, unknown> {
  return {
    status: row.status,
    validatedAmount:
      row.validated_amount_cents === null
        ? null
        : money(row.validated_amount_cents),
    disputedLedgerEntryId: row.disputed_ledger_entry_id,
    deadline: row.deadline,
    decision: decisionOf(row)?.decision ?? null
  };
}
