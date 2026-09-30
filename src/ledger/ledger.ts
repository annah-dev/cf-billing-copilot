// The system of record for one sandbox (DECISIONS.md D-1, D-12; docs/ARCHITECTURE.md "Data model",
// "Ledger invariants", "Recovery"). Every credit state change is one method that checks the current
// state, writes the new state and appends its audit record in one transactionSync. The engine does
// all money math; this class only stores integer cents and hands the engine plain data.
import { DurableObject } from "cloudflare:workers";
import {
  CREDIT_TRANSITIONS,
  EngineError,
  TERMINAL_CREDIT_STATUSES,
  money,
  type Actor,
  type AuditAction,
  type AuditRecord,
  type BillingDataset,
  type CreditDecision,
  type CreditRequest,
  type CreditRequestStatus,
  type Customer,
  type Invoice,
  type Meter,
  type Plan,
  type Subscription,
  type ToolOutput,
  type UsageRecord
} from "../contracts";
import { engine } from "../engine";
import {
  DAY_MS,
  durationMs,
  getConfig,
  hexDigestsEqual,
  iso,
  nextUtcMidnight,
  utcDay
} from "../http/config";
import { capMessage, refusal, type Refusal, type Result } from "../http/errors";
import { LIVE_INSTANCE_STATES, createParams } from "../workflows/params";
import { SCHEMA_STATEMENTS, TABLES } from "./schema";
import {
  decisionOf,
  requestSnapshot,
  toAuditRecord,
  toCreditMemo,
  toCreditRequest,
  toInvoiceLine,
  toLedgerEntry,
  type AuditRow,
  type LedgerRow,
  type LineRow,
  type MemoRow,
  type RequestRow
} from "./rows";

/** A request left in `requested` or with an unacted decision this long is re-driven (Recovery). */
export const RECOVERY_DELAY_MS = 5 * 60_000;
/** The sweeper expires a pending request this long after its deadline. */
export const SWEEP_GRACE_MS = 60 * 60_000;

type Statics = Omit<
  BillingDataset,
  "ledger" | "creditRequests" | "creditMemos" | "audit"
>;

/** What a Workflow step or the sweeper gets back from a credit transition. Plain data. */
export type StepResult = {
  outcome: "done" | "already" | "refused" | "missing";
  status: CreditRequestStatus | null;
  decision: CreditDecision["decision"] | null;
};

type AuditInput = {
  actor: Actor;
  action: AuditAction;
  subject: AuditRecord["subject"];
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  customerId: string | null;
  requestId: string | null;
};

export class Ledger extends DurableObject<Env> {
  private statics: Statics | undefined;

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** Kept from the foundation: a binding smoke check that never writes. */
  ping(): string {
    return "ledger";
  }

  // ---- Seeding and admission ------------------------------------------------------------------

  /** True once POST /api/sandboxes seeded this object. A read only: no table is created here. */
  private isSeeded(): boolean {
    return (
      this.sql
        .exec<{
          n: number;
        }>(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'meta'"
        )
        .one().n === 1
    );
  }

  private meta(key: string): string | null {
    const rows = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray();
    return rows[0]?.value ?? null;
  }

  /**
   * Create the schema and load the engine's seed. Only POST /api/sandboxes calls this, once, for a
   * freshly generated sandbox id. Returns the rows written, measured by SQLite (D-7 sizing).
   */
  async seed(input: { sandboxId: string; tokenHash: string }): Promise<
    Result<{
      customers: { customerId: string; name: string }[];
      createdAt: string;
      rowsWritten: number;
    }>
  > {
    if (this.isSeeded()) {
      return refusal(409, "conflict", "Sandbox already exists");
    }
    const data = engine.seed();
    const nowMs = Date.now();
    const createdAt = iso(nowMs);
    const idleMs = getConfig(this.env).SANDBOX_IDLE_DAYS * DAY_MS;
    let rowsWritten = 0;
    const run = (query: string, ...bindings: SqlStorageValue[]) => {
      rowsWritten += this.sql.exec(query, ...bindings).rowsWritten;
    };
    this.ctx.storage.transactionSync(() => {
      for (const statement of SCHEMA_STATEMENTS) run(statement);
      const meta: [string, string][] = [
        ["admitted", "1"],
        ["sandbox_id", input.sandboxId],
        ["seed_version", data.seedVersion],
        ["token_hash", input.tokenHash],
        ["created_at", createdAt],
        ["last_activity_at", String(nowMs)]
      ];
      for (const [k, v] of meta) {
        run("INSERT INTO meta (key, value) VALUES (?, ?)", k, v);
      }
      for (const c of data.customers) {
        run(
          "INSERT INTO customers (id, name, tax_rate_bps) VALUES (?, ?, ?)",
          c.id,
          c.name,
          c.taxRateBps
        );
      }
      for (const m of data.meters) {
        run(
          "INSERT INTO meters (id, name, unit, product) VALUES (?, ?, ?, ?)",
          m.id,
          m.name,
          m.unit,
          m.product
        );
      }
      for (const p of data.plans) {
        run(
          "INSERT INTO plans (id, name, monthly_fee_cents) VALUES (?, ?, ?)",
          p.id,
          p.name,
          p.monthlyFeeCents
        );
        for (const price of p.prices) {
          price.tiers.forEach((t, i) =>
            run(
              "INSERT INTO plan_tiers (plan_id, meter_id, tier_index, up_to, price_cents, per_units) VALUES (?, ?, ?, ?, ?, ?)",
              p.id,
              price.meterId,
              i,
              t.upTo,
              t.priceCents,
              t.perUnits
            )
          );
        }
      }
      for (const s of data.subscriptions) {
        run(
          "INSERT INTO subscriptions (customer_id, from_date, plan_id, to_date) VALUES (?, ?, ?, ?)",
          s.customerId,
          s.from,
          s.planId,
          s.to
        );
      }
      for (const u of data.usage) {
        run(
          "INSERT INTO usage_daily (customer_id, meter_id, date, quantity) VALUES (?, ?, ?, ?)",
          u.customerId,
          u.meterId,
          u.date,
          u.quantity
        );
      }
      for (const inv of data.invoices) {
        run(
          "INSERT INTO invoices (id, customer_id, period, issued_on, subtotal_cents, credits_cents, tax_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          inv.id,
          inv.customerId,
          inv.period,
          inv.issuedOn,
          inv.subtotal.cents,
          inv.credits.cents,
          inv.tax.cents,
          inv.total.cents
        );
        inv.lines.forEach((l, i) =>
          run(
            "INSERT INTO invoice_lines (invoice_id, idx, id, kind, description, plan_id, meter_id, quantity, amount_cents, tiers_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            inv.id,
            i,
            l.id,
            l.kind,
            l.description,
            l.planId,
            l.meterId,
            l.quantity,
            l.amount.cents,
            JSON.stringify(l.tiers)
          )
        );
      }
      for (const e of data.ledger) {
        run(
          "INSERT INTO ledger_entries (id, customer_id, at, kind, amount_cents, invoice_id, reference, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          e.id,
          e.customerId,
          e.at,
          e.kind,
          e.amount.cents,
          e.invoiceId,
          e.reference,
          e.description
        );
      }
      for (const r of data.creditRequests) {
        run(
          "INSERT INTO credit_requests (id, idempotency_key, customer_id, invoice_id, disputed_ledger_entry_id, customer_reason, validated_amount_cents, status, created_at, updated_at, deadline, decision_json, outcome_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          r.id,
          r.idempotencyKey,
          r.customerId,
          r.invoiceId,
          r.disputedLedgerEntryId,
          r.customerReason,
          r.validatedAmount?.cents ?? null,
          r.status,
          r.createdAt,
          r.updatedAt,
          r.deadline,
          r.decision ? JSON.stringify(r.decision) : null,
          r.outcomeReason
        );
      }
      for (const m of data.creditMemos) {
        run(
          "INSERT INTO credit_memos (id, request_id, disputed_ledger_entry_id, amount_cents, status) VALUES (?, ?, ?, ?, ?)",
          m.id,
          m.requestId,
          m.disputedLedgerEntryId,
          m.amount.cents,
          m.status
        );
      }
      const requestOwner = new Map(
        data.creditRequests.map((r) => [r.id, r.customerId])
      );
      const memoRequest = new Map(
        data.creditMemos.map((m) => [m.id, m.requestId])
      );
      for (const a of data.audit) {
        const requestId =
          a.subject.type === "credit_request"
            ? a.subject.id
            : a.subject.type === "credit_memo"
              ? (memoRequest.get(a.subject.id) ?? null)
              : null;
        run(
          "INSERT INTO audit_log (seq, at, actor, action, subject_type, subject_id, reason, before_json, after_json, customer_id, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          a.seq,
          a.at,
          a.actor,
          a.action,
          a.subject.type,
          a.subject.id,
          a.reason,
          a.before ? JSON.stringify(a.before) : null,
          a.after ? JSON.stringify(a.after) : null,
          requestId ? (requestOwner.get(requestId) ?? null) : null,
          requestId
        );
      }
      rowsWritten += this.appendAudit(
        {
          actor: "system",
          action: "sandbox_created",
          subject: { type: "sandbox", id: input.sandboxId },
          reason: `Sandbox seeded from engine seed ${data.seedVersion}`,
          before: null,
          after: { customers: data.customers.length },
          customerId: null,
          requestId: null
        },
        nowMs
      );
      run(
        "INSERT INTO timers (kind, subject, due_at) VALUES ('idle', 'sandbox', ?)",
        nowMs + idleMs
      );
    });
    await this.armAlarm();
    this.statics = undefined;
    return {
      ok: true,
      customers: data.customers.map((c) => ({
        customerId: c.id,
        name: c.name
      })),
      createdAt,
      rowsWritten
    };
  }

  /**
   * Admission for every sandbox-scoped route (docs/ARCHITECTURE.md, "Admission"): the sandbox was
   * created by POST /api/sandboxes, the customer is seeded, the approver token matches (admin
   * routes), and the sandbox is under its daily API request cap. Refusals write nothing; an
   * admitted request increments the counter and records activity.
   */
  gate(input: { customerId?: string; tokenHash?: string }): Result<object> {
    if (!this.isSeeded()) return refusal(404, "not_found", "Not found");
    if (input.customerId !== undefined && !this.customer(input.customerId)) {
      return refusal(404, "not_found", "Not found");
    }
    if (input.tokenHash !== undefined) {
      const stored = this.meta("token_hash") ?? "";
      if (!hexDigestsEqual(stored, input.tokenHash)) {
        return refusal(401, "unauthorized", "Missing or wrong approver token");
      }
    }
    const limit = getConfig(this.env).API_REQUESTS_PER_SANDBOX_DAY;
    return this.consume("api", limit, "sandbox API requests");
  }

  /** The per-sandbox chat message cap (D-7), consumed by the agent before any model call. */
  consumeMessage(): Result<object> {
    if (!this.isSeeded()) return refusal(404, "not_found", "Not found");
    const limit = getConfig(this.env).MESSAGES_PER_SANDBOX_DAY;
    return this.consume("messages", limit, "chat messages");
  }

  /** Increment a daily counter unless it is at its limit. At the limit nothing is written. */
  private consume(name: string, limit: number, what: string): Result<object> {
    const nowMs = Date.now();
    const day = utcDay(nowMs);
    const row = this.sql
      .exec<{
        day: string;
        count: number;
      }>("SELECT day, count FROM counters WHERE name = ?", name)
      .toArray()[0];
    const used = row && row.day === day ? row.count : 0;
    if (used >= limit) {
      return refusal(429, "cap_reached", capMessage(what, limit), {
        name,
        limit,
        resetsAt: nextUtcMidnight(nowMs)
      });
    }
    this.sql.exec(
      "INSERT INTO counters (name, day, count) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET day = excluded.day, count = excluded.count",
      name,
      day,
      used + 1
    );
    this.sql.exec(
      "UPDATE meta SET value = ? WHERE key = 'last_activity_at'",
      String(nowMs)
    );
    return { ok: true };
  }

  // ---- Reads (engine outputs; the caller validates them against the tool schemas) --------------

  private customer(id: string): Customer | undefined {
    return this.loadStatics().customers.find((c) => c.id === id);
  }

  private loadStatics(): Statics {
    if (this.statics) return this.statics;
    const meters = this.sql
      .exec<{
        id: string;
        name: string;
        unit: string;
        product: string;
      }>("SELECT id, name, unit, product FROM meters ORDER BY id")
      .toArray() as Meter[];
    const tiers = this.sql
      .exec<{
        plan_id: string;
        meter_id: string;
        up_to: number | null;
        price_cents: number;
        per_units: number;
      }>(
        "SELECT plan_id, meter_id, up_to, price_cents, per_units FROM plan_tiers ORDER BY plan_id, meter_id, tier_index"
      )
      .toArray();
    const plans: Plan[] = this.sql
      .exec<{
        id: string;
        name: string;
        monthly_fee_cents: number;
      }>("SELECT id, name, monthly_fee_cents FROM plans ORDER BY id")
      .toArray()
      .map((p) => {
        const meterIds = [
          ...new Set(
            tiers.filter((t) => t.plan_id === p.id).map((t) => t.meter_id)
          )
        ];
        return {
          id: p.id,
          name: p.name,
          monthlyFeeCents: p.monthly_fee_cents,
          prices: meterIds.map((meterId) => ({
            meterId,
            tiers: tiers
              .filter((t) => t.plan_id === p.id && t.meter_id === meterId)
              .map((t) => ({
                upTo: t.up_to,
                priceCents: t.price_cents,
                perUnits: t.per_units
              }))
          }))
        };
      });
    const customers: Customer[] = this.sql
      .exec<{
        id: string;
        name: string;
        tax_rate_bps: number;
      }>("SELECT id, name, tax_rate_bps FROM customers ORDER BY id")
      .toArray()
      .map((c) => ({ id: c.id, name: c.name, taxRateBps: c.tax_rate_bps }));
    const subscriptions: Subscription[] = this.sql
      .exec<{
        customer_id: string;
        plan_id: string;
        from_date: string;
        to_date: string | null;
      }>(
        "SELECT customer_id, plan_id, from_date, to_date FROM subscriptions ORDER BY customer_id, from_date"
      )
      .toArray()
      .map((s) => ({
        customerId: s.customer_id,
        planId: s.plan_id,
        from: s.from_date,
        to: s.to_date
      }));
    const usage: UsageRecord[] = this.sql
      .exec<{
        customer_id: string;
        meter_id: string;
        date: string;
        quantity: number;
      }>(
        "SELECT customer_id, meter_id, date, quantity FROM usage_daily ORDER BY customer_id, meter_id, date"
      )
      .toArray()
      .map((u) => ({
        customerId: u.customer_id,
        meterId: u.meter_id,
        date: u.date,
        quantity: u.quantity
      }));
    const lines = this.sql
      .exec<LineRow>("SELECT * FROM invoice_lines ORDER BY invoice_id, idx")
      .toArray();
    const invoices: Invoice[] = this.sql
      .exec<{
        id: string;
        customer_id: string;
        period: string;
        issued_on: string;
        subtotal_cents: number;
        credits_cents: number;
        tax_cents: number;
        total_cents: number;
      }>("SELECT * FROM invoices ORDER BY customer_id, period")
      .toArray()
      .map((i) => ({
        id: i.id,
        customerId: i.customer_id,
        period: i.period,
        issuedOn: i.issued_on,
        lines: lines.filter((l) => l.invoice_id === i.id).map(toInvoiceLine),
        subtotal: money(i.subtotal_cents),
        credits: money(i.credits_cents),
        tax: money(i.tax_cents),
        total: money(i.total_cents)
      }));
    this.statics = {
      seedVersion: this.meta("seed_version") ?? "unknown",
      meters,
      plans,
      customers,
      subscriptions,
      usage,
      invoices
    };
    return this.statics;
  }

  private ledgerRows(customerId?: string): LedgerRow[] {
    return customerId
      ? this.sql
          .exec<LedgerRow>(
            "SELECT id, customer_id, at, kind, amount_cents, invoice_id, reference, description FROM ledger_entries WHERE customer_id = ? ORDER BY at, id",
            customerId
          )
          .toArray()
      : this.sql
          .exec<LedgerRow>(
            "SELECT id, customer_id, at, kind, amount_cents, invoice_id, reference, description FROM ledger_entries ORDER BY at, id"
          )
          .toArray();
  }

  private requestRow(id: string): RequestRow | undefined {
    return this.sql
      .exec<RequestRow>("SELECT * FROM credit_requests WHERE id = ?", id)
      .toArray()[0];
  }

  private memoRows(): MemoRow[] {
    return this.sql.exec<MemoRow>("SELECT * FROM credit_memos").toArray();
  }

  /** The engine's input: immutable seed data plus the current ledger and credit tables. */
  private dataset(): BillingDataset {
    return {
      ...this.loadStatics(),
      ledger: this.ledgerRows().map(toLedgerEntry),
      creditRequests: this.sql
        .exec<RequestRow>("SELECT * FROM credit_requests ORDER BY created_at")
        .toArray()
        .map(toCreditRequest),
      creditMemos: this.memoRows().map(toCreditMemo),
      audit: []
    };
  }

  /** Run an engine read and turn EngineError into a refusal the tool can report. */
  private read<T>(fn: () => T): Result<{ value: T }> {
    if (!this.isSeeded()) return refusal(404, "not_found", "Not found");
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      if (err instanceof EngineError) {
        return refusal(
          err.code === "not_found" ? 404 : 400,
          err.code === "not_found" ? "not_found" : "invalid_request",
          err.message
        );
      }
      throw err;
    }
  }

  private ownedInvoice(customerId: string, invoiceId: string): Invoice {
    const invoice = this.loadStatics().invoices.find(
      (i) => i.id === invoiceId && i.customerId === customerId
    );
    if (!invoice) {
      throw new EngineError(
        "not_found",
        `No invoice ${invoiceId} for this customer`
      );
    }
    return invoice;
  }

  private currentPlan(customerId: string): { planId: string; name: string } {
    const subs = this.loadStatics().subscriptions.filter(
      (s) => s.customerId === customerId
    );
    const current = subs.find((s) => s.to === null) ?? subs[subs.length - 1];
    const plan = this.loadStatics().plans.find((p) => p.id === current?.planId);
    if (!current || !plan) {
      throw new EngineError("not_found", "No subscription for this customer");
    }
    return { planId: plan.id, name: plan.name };
  }

  private requestsFor(customerId: string): RequestRow[] {
    return this.sql
      .exec<RequestRow>(
        "SELECT * FROM credit_requests WHERE customer_id = ? ORDER BY created_at DESC, id",
        customerId
      )
      .toArray();
  }

  account(customerId: string): Result<{ value: ToolOutput<"getAccount"> }> {
    return this.read(() => {
      const customer = this.customer(customerId);
      if (!customer) throw new EngineError("not_found", "Unknown customer");
      const s = this.loadStatics();
      return {
        customerId,
        customerName: customer.name,
        plan: this.currentPlan(customerId),
        availablePlans: s.plans.map((p) => ({ planId: p.id, name: p.name })),
        balance: engine.balance(
          this.ledgerRows(customerId).map(toLedgerEntry),
          customerId
        ),
        invoices: s.invoices
          .filter((i) => i.customerId === customerId)
          .map((i) => ({ invoiceId: i.id, period: i.period, total: i.total })),
        openCreditRequests: this.requestsFor(customerId)
          .filter((r) => !TERMINAL_CREDIT_STATUSES.includes(r.status))
          .map((r) => summary(toCreditRequest(r)))
      };
    });
  }

  invoice(
    customerId: string,
    query: { period?: string; invoiceId?: string }
  ): Result<{ value: Invoice }> {
    return this.read(() => {
      if (query.invoiceId)
        return this.ownedInvoice(customerId, query.invoiceId);
      const invoice = this.loadStatics().invoices.find(
        (i) => i.customerId === customerId && i.period === query.period
      );
      if (!invoice) {
        const periods = this.loadStatics()
          .invoices.filter((i) => i.customerId === customerId)
          .map((i) => i.period);
        throw new EngineError(
          "not_found",
          `No invoice for ${query.period}. Invoices exist for: ${periods.join(", ")}`
        );
      }
      return invoice;
    });
  }

  explainLine(customerId: string, invoiceId: string, lineId: string) {
    return this.read(() => {
      this.ownedInvoice(customerId, invoiceId);
      return engine.explainLineItem(this.dataset(), invoiceId, lineId);
    });
  }

  compare(customerId: string, fromPeriod: string, toPeriod: string) {
    return this.read(() =>
      engine.compareInvoices(this.dataset(), customerId, fromPeriod, toPeriod)
    );
  }

  simulate(customerId: string, period: string, planId: string) {
    return this.read(() =>
      engine.simulatePlan(this.dataset(), customerId, period, planId)
    );
  }

  anomalies(customerId: string, period: string) {
    return this.read(() =>
      engine.detectAnomalies(this.dataset(), customerId, period)
    );
  }

  private auditFor(where: string, ...bindings: SqlStorageValue[]) {
    return this.sql
      .exec<AuditRow>(
        `SELECT seq, at, actor, action, subject_type, subject_id, reason, before_json, after_json FROM audit_log WHERE ${where}`,
        ...bindings
      )
      .toArray()
      .map(toAuditRecord);
  }

  creditStatus(
    customerId: string,
    requestId?: string
  ): Result<{ value: ToolOutput<"getCreditRequestStatus"> }> {
    return this.read(() => {
      const rows = this.requestsFor(customerId).filter(
        (r) => requestId === undefined || r.id === requestId
      );
      if (requestId !== undefined && rows.length === 0) {
        throw new EngineError(
          "not_found",
          `No credit request ${requestId} for this customer`
        );
      }
      return {
        requests: rows.map((r) => ({
          request: summary(toCreditRequest(r)),
          audit: this.auditFor("request_id = ? ORDER BY seq", r.id)
        }))
      };
    });
  }

  /** The chat side panel (PanelResponse without sandboxId, which the Worker adds). */
  panel(customerId: string) {
    return this.read(() => {
      const customer = this.customer(customerId);
      if (!customer) throw new EngineError("not_found", "Unknown customer");
      const invoices = this.loadStatics().invoices.filter(
        (i) => i.customerId === customerId
      );
      const currentInvoice = invoices[invoices.length - 1];
      if (!currentInvoice) {
        throw new EngineError("not_found", "No invoice for this customer");
      }
      return {
        customerId,
        customerName: customer.name,
        plan: this.currentPlan(customerId),
        balance: engine.balance(
          this.ledgerRows(customerId).map(toLedgerEntry),
          customerId
        ),
        currentInvoice,
        creditRequests: this.requestsFor(customerId).map(toCreditRequest),
        audit: this.auditFor(
          "customer_id = ? ORDER BY seq DESC LIMIT 50",
          customerId
        )
      };
    });
  }

  /** Every credit request in the sandbox for /admin: pending_approval first, then newest first. */
  adminList() {
    return this.read(() => {
      const names = new Map(
        this.loadStatics().customers.map((c) => [c.id, c.name])
      );
      return this.sql
        .exec<RequestRow>(
          "SELECT * FROM credit_requests ORDER BY (status = 'pending_approval') DESC, created_at DESC, id"
        )
        .toArray()
        .map((r) => ({
          ...toCreditRequest(r),
          customerName: names.get(r.customer_id) ?? r.customer_id
        }));
    });
  }

  // ---- Audit ----------------------------------------------------------------------------------

  /** Insert one audit record. The only write path to audit_log. Returns rows written. */
  private appendAudit(a: AuditInput, nowMs: number): number {
    return this.sql.exec(
      "INSERT INTO audit_log (at, actor, action, subject_type, subject_id, reason, before_json, after_json, customer_id, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      iso(nowMs),
      a.actor,
      a.action,
      a.subject.type,
      a.subject.id,
      a.reason,
      a.before ? JSON.stringify(a.before) : null,
      a.after ? JSON.stringify(a.after) : null,
      a.customerId,
      a.requestId
    ).rowsWritten;
  }

  /** Refusals are audited once per request, action and reason, so repeats cannot amplify writes. */
  private auditRefusalOnce(a: AuditInput, nowMs: number): void {
    const seen = this.sql
      .exec(
        "SELECT 1 FROM audit_log WHERE subject_id = ? AND action = ? AND reason = ? LIMIT 1",
        a.subject.id,
        a.action,
        a.reason
      )
      .toArray();
    if (seen.length === 0) this.appendAudit(a, nowMs);
  }

  private requestAudit(
    row: RequestRow,
    actor: Actor,
    action: AuditAction,
    reason: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
  ): AuditInput {
    return {
      actor,
      action,
      subject: { type: "credit_request", id: row.id },
      reason,
      before,
      after,
      customerId: row.customer_id,
      requestId: row.id
    };
  }

  // ---- Timers and the single alarm -------------------------------------------------------------

  private setTimer(kind: string, subject: string, dueAt: number): void {
    this.sql.exec(
      "INSERT INTO timers (kind, subject, due_at) VALUES (?, ?, ?) ON CONFLICT (kind, subject) DO UPDATE SET due_at = excluded.due_at",
      kind,
      subject,
      dueAt
    );
  }

  private clearTimer(kind: string, subject: string): void {
    this.sql.exec(
      "DELETE FROM timers WHERE kind = ? AND subject = ?",
      kind,
      subject
    );
  }

  /** Point the one alarm at the earliest timer; a later timer never postpones an earlier one. */
  private async armAlarm(): Promise<void> {
    if (!this.isSeeded()) return;
    const next = this.sql
      .exec<{
        due: number | null;
      }>("SELECT min(due_at) AS due FROM timers")
      .one().due;
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const current = await this.ctx.storage.getAlarm();
    if (current !== next) await this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    await this.processTimers(Date.now());
  }

  /** Process every timer due at nowMs, then re-arm the alarm. Tests call this with a chosen time. */
  async processTimers(nowMs: number): Promise<{ processed: string[] }> {
    if (!this.isSeeded()) return { processed: [] };
    const due = this.sql
      .exec<{
        kind: string;
        subject: string;
      }>(
        "SELECT kind, subject FROM timers WHERE due_at <= ? ORDER BY due_at, kind, subject",
        nowMs
      )
      .toArray();
    const processed: string[] = [];
    for (const t of due) {
      processed.push(`${t.kind}:${t.subject}`);
      if (t.kind === "idle") {
        if (await this.idleCheck(nowMs)) return { processed };
        continue;
      }
      try {
        await this.recoverRequest(t.subject, nowMs);
      } catch (err) {
        console.error("recovery failed", t.subject, err);
        this.setTimer("recover", t.subject, nowMs + RECOVERY_DELAY_MS);
      }
    }
    await this.armAlarm();
    return { processed };
  }

  /** Delete the sandbox after SANDBOX_IDLE_DAYS without activity; otherwise re-arm. */
  private async idleCheck(nowMs: number): Promise<boolean> {
    const idleMs = getConfig(this.env).SANDBOX_IDLE_DAYS * DAY_MS;
    const last = Number(this.meta("last_activity_at") ?? "0");
    if (last + idleMs > nowMs) {
      this.setTimer("idle", "sandbox", last + idleMs);
      return false;
    }
    await this.deleteSandboxData();
    return true;
  }

  /**
   * Delete every row, measuring rows written per statement (deletion is billed as writes, D-7),
   * then drop the object's storage and alarm. Returns the rows written by the DELETE statements.
   */
  async deleteSandboxData(): Promise<{ rowsWritten: number }> {
    let rowsWritten = 0;
    this.tx(() => {
      for (const table of TABLES) {
        rowsWritten += this.sql.exec(`DELETE FROM ${table}`).rowsWritten;
      }
    });
    this.statics = undefined;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return { rowsWritten };
  }

  // ---- Credit requests: creation (the agent's only write) --------------------------------------

  /**
   * Record a `requested` credit request. Moves no money. A retried idempotency key returns the
   * recorded request; a second open request for the same charge returns the first (D-12).
   */
  async createCreditRequest(input: {
    customerId: string;
    invoiceId: string;
    disputedLedgerEntryId: string | null;
    reason: string;
    idempotencyKey: string;
  }): Promise<Result<{ request: CreditRequest; existing: boolean }>> {
    if (!this.isSeeded()) return refusal(404, "not_found", "Not found");
    const nowMs = Date.now();
    const result = this.ctx.storage.transactionSync(
      (): Result<{ request: CreditRequest; existing: boolean }> => {
        const byKey = this.sql
          .exec<RequestRow>(
            "SELECT * FROM credit_requests WHERE idempotency_key = ?",
            input.idempotencyKey
          )
          .toArray()[0];
        if (byKey) {
          if (byKey.customer_id !== input.customerId) {
            return refusal(409, "conflict", "Idempotency key already used");
          }
          return { ok: true, request: toCreditRequest(byKey), existing: true };
        }
        try {
          this.ownedInvoice(input.customerId, input.invoiceId);
        } catch (err) {
          if (err instanceof EngineError) {
            return refusal(404, "not_found", err.message);
          }
          throw err;
        }
        if (input.disputedLedgerEntryId !== null) {
          const entry = this.ledgerRows(input.customerId).find(
            (e) => e.id === input.disputedLedgerEntryId
          );
          if (!entry) {
            return refusal(
              404,
              "not_found",
              `No ledger entry ${input.disputedLedgerEntryId} for this customer`
            );
          }
        }
        const open = this.requestsFor(input.customerId).find(
          (r) =>
            !TERMINAL_CREDIT_STATUSES.includes(r.status) &&
            r.invoice_id === input.invoiceId &&
            (input.disputedLedgerEntryId === null ||
              r.disputed_ledger_entry_id === null ||
              r.disputed_ledger_entry_id === input.disputedLedgerEntryId)
        );
        if (open) {
          return { ok: true, request: toCreditRequest(open), existing: true };
        }
        const limit = getConfig(this.env).CREDIT_REQUESTS_PER_SANDBOX_DAY;
        const cap = this.consume("credit_requests", limit, "credit requests");
        if (!cap.ok) return cap;
        const id = `cr_${input.idempotencyKey.slice(0, 24)}`;
        const at = iso(nowMs);
        this.sql.exec(
          "INSERT INTO credit_requests (id, idempotency_key, customer_id, invoice_id, disputed_ledger_entry_id, customer_reason, validated_amount_cents, status, created_at, updated_at, deadline, decision_json, outcome_reason) VALUES (?, ?, ?, ?, ?, ?, NULL, 'requested', ?, ?, NULL, NULL, NULL)",
          id,
          input.idempotencyKey,
          input.customerId,
          input.invoiceId,
          input.disputedLedgerEntryId,
          input.reason,
          at,
          at
        );
        const row = this.requestRow(id) as RequestRow;
        this.appendAudit(
          this.requestAudit(
            row,
            `customer:${input.customerId}`,
            "credit_requested",
            input.reason,
            null,
            requestSnapshot(row)
          ),
          nowMs
        );
        this.setTimer("recover", id, nowMs + RECOVERY_DELAY_MS);
        return { ok: true, request: toCreditRequest(row), existing: false };
      }
    );
    await this.armAlarm();
    return result;
  }

  // ---- Credit requests: transitions (Workflow steps and the sweeper) ---------------------------

  private stepResult(
    outcome: StepResult["outcome"],
    row: RequestRow | undefined
  ): StepResult {
    return {
      outcome,
      status: row?.status ?? null,
      decision: row ? (decisionOf(row)?.decision ?? null) : null
    };
  }

  /**
   * The one transition primitive; callers run it inside their transactionSync. Reaching an
   * already-reached target returns "already" with no audit record (a replayed Workflow step); a
   * move the state machine forbids is refused and the refusal audited once; otherwise `write` runs
   * and the audit record is appended in the same transaction.
   */
  private transition(
    requestId: string,
    to: CreditRequestStatus,
    actor: Actor,
    action: AuditAction,
    nowMs: number,
    write: (row: RequestRow) => { reason: string }
  ): StepResult {
    const row = this.requestRow(requestId);
    if (!row) return this.stepResult("missing", row);
    // "Reached" includes having moved past the target on the approve path (approved -> applied),
    // so a replayed approve step after the credit was applied is not a refusal.
    if (row.status === to || (to === "approved" && row.status === "applied")) {
      return this.stepResult("already", row);
    }
    if (!CREDIT_TRANSITIONS[row.status].includes(to)) {
      this.auditRefusalOnce(
        this.requestAudit(
          row,
          actor,
          "transition_refused",
          `Refused ${row.status} -> ${to} (${action})`,
          requestSnapshot(row),
          null
        ),
        nowMs
      );
      return this.stepResult("refused", row);
    }
    const before = requestSnapshot(row);
    const { reason } = write(row);
    this.sql.exec(
      "UPDATE credit_requests SET status = ?, updated_at = ? WHERE id = ?",
      to,
      iso(nowMs),
      requestId
    );
    const after = this.requestRow(requestId) as RequestRow;
    this.appendAudit(
      this.requestAudit(
        after,
        actor,
        action,
        reason,
        before,
        requestSnapshot(after)
      ),
      nowMs
    );
    if (TERMINAL_CREDIT_STATUSES.includes(to)) {
      this.clearTimer("recover", requestId);
    }
    return this.stepResult("done", after);
  }

  private tx<T>(fn: () => T): T {
    return this.ctx.storage.transactionSync(fn);
  }

  private rejectInvalid(
    requestId: string,
    actor: Actor,
    nowMs: number,
    claim: { reason: string; explanation: string }
  ): StepResult {
    return this.transition(
      requestId,
      "rejected",
      actor,
      "credit_validation_failed",
      nowMs,
      () => {
        this.sql.exec(
          "UPDATE credit_requests SET outcome_reason = ? WHERE id = ?",
          claim.explanation,
          requestId
        );
        return { reason: `${claim.reason}: ${claim.explanation}` };
      }
    );
  }

  private activeMemos(excludingRequest?: string) {
    return this.memoRows()
      .filter((m) => m.status !== "void" && m.request_id !== excludingRequest)
      .map(toCreditMemo);
  }

  /** Workflow step "validate": engine.validateCreditClaim against the ledger. */
  validate(requestId: string, actor: Actor): StepResult {
    if (!this.isSeeded()) return this.stepResult("missing", undefined);
    const nowMs = Date.now();
    return this.tx(() => {
      const row = this.requestRow(requestId);
      if (!row) return this.stepResult("missing", row);
      if (row.status !== "requested" || row.validated_amount_cents !== null) {
        return this.stepResult("already", row);
      }
      const claim = engine.validateCreditClaim(
        this.dataset(),
        {
          customerId: row.customer_id,
          invoiceId: row.invoice_id,
          disputedLedgerEntryId: row.disputed_ledger_entry_id
        },
        this.activeMemos(requestId)
      );
      if (!claim.valid) {
        return this.rejectInvalid(requestId, actor, nowMs, claim);
      }
      const before = requestSnapshot(row);
      this.sql.exec(
        "UPDATE credit_requests SET validated_amount_cents = ?, disputed_ledger_entry_id = ?, updated_at = ? WHERE id = ?",
        claim.creditableAmount.cents,
        claim.disputedLedgerEntryId,
        iso(nowMs),
        requestId
      );
      const after = this.requestRow(requestId) as RequestRow;
      this.appendAudit(
        this.requestAudit(
          after,
          actor,
          "credit_validated",
          claim.explanation,
          before,
          requestSnapshot(after)
        ),
        nowMs
      );
      return this.stepResult("done", after);
    });
  }

  /**
   * Workflow step "create-pending-memo": the reservation. Re-checks the creditable amount against
   * every pending and applied memo inside the transaction, so two requests for the same charge with
   * different idempotency keys cannot both reserve it (D-12).
   */
  async createPendingMemo(
    requestId: string,
    actor: Actor
  ): Promise<StepResult> {
    if (!this.isSeeded()) return this.stepResult("missing", undefined);
    const nowMs = Date.now();
    const timeoutMs = durationMs(getConfig(this.env).APPROVAL_TIMEOUT);
    const result = this.tx(() => {
      const row = this.requestRow(requestId);
      if (!row) return this.stepResult("missing", row);
      if (row.status !== "requested") return this.stepResult("already", row);
      if (row.validated_amount_cents === null) {
        throw new Error(`credit request ${requestId} is not validated yet`);
      }
      const claim = engine.validateCreditClaim(
        this.dataset(),
        {
          customerId: row.customer_id,
          invoiceId: row.invoice_id,
          disputedLedgerEntryId: row.disputed_ledger_entry_id
        },
        this.activeMemos(requestId)
      );
      if (!claim.valid) {
        return this.rejectInvalid(requestId, actor, nowMs, claim);
      }
      const deadlineMs = nowMs + timeoutMs;
      return this.transition(
        requestId,
        "pending_approval",
        actor,
        "memo_pending",
        nowMs,
        () => {
          const memoId = `cm_${requestId.slice(3)}`;
          this.sql.exec(
            "INSERT INTO credit_memos (id, request_id, disputed_ledger_entry_id, amount_cents, status) VALUES (?, ?, ?, ?, 'pending')",
            memoId,
            requestId,
            claim.disputedLedgerEntryId,
            claim.creditableAmount.cents
          );
          this.sql.exec(
            "UPDATE credit_requests SET validated_amount_cents = ?, disputed_ledger_entry_id = ?, deadline = ? WHERE id = ?",
            claim.creditableAmount.cents,
            claim.disputedLedgerEntryId,
            iso(deadlineMs),
            requestId
          );
          this.setTimer("recover", requestId, deadlineMs + SWEEP_GRACE_MS);
          return {
            reason: `Pending credit memo ${memoId} for ${claim.creditableAmount.display} reserves ${claim.disputedLedgerEntryId}`
          };
        }
      );
    });
    await this.armAlarm();
    return result;
  }

  /** The recorded decision, if any. The Workflow acts on this, never on the event payload. */
  decision(requestId: string): StepResult {
    if (!this.isSeeded()) return this.stepResult("missing", undefined);
    const row = this.requestRow(requestId);
    return this.stepResult(row ? "already" : "missing", row);
  }

  /**
   * Record the approver's decision: first writer wins and is immutable (D-6, D-12). An identical
   * retry returns the recorded decision; anything else is refused with 409 and audited once.
   */
  async recordDecision(
    requestId: string,
    input: { decision: "approve" | "reject"; reason: string },
    actor: Actor
  ): Promise<Result<{ request: CreditRequest; alreadyRecorded: boolean }>> {
    if (!this.isSeeded()) return refusal(404, "not_found", "Not found");
    const nowMs = Date.now();
    const result = this.ctx.storage.transactionSync(
      (): Result<{ request: CreditRequest; alreadyRecorded: boolean }> => {
        const row = this.requestRow(requestId);
        if (!row) return refusal(404, "not_found", "No such credit request");
        const refuse = (action: AuditAction, reason: string): Refusal => {
          this.auditRefusalOnce(
            this.requestAudit(
              row,
              actor,
              action,
              reason,
              requestSnapshot(row),
              null
            ),
            nowMs
          );
          return refusal(409, "conflict", reason);
        };
        const recorded = decisionOf(row);
        if (recorded) {
          if (
            recorded.decision === input.decision &&
            recorded.reason === input.reason
          ) {
            return {
              ok: true,
              request: toCreditRequest(row),
              alreadyRecorded: true
            };
          }
          return refuse(
            "decision_refused_conflict",
            `A different decision (${recorded.decision}) is already recorded`
          );
        }
        if (row.status === "expired") {
          return refuse(
            "approval_refused_expired",
            "The request expired before a decision was recorded"
          );
        }
        if (row.status !== "pending_approval") {
          return refuse(
            TERMINAL_CREDIT_STATUSES.includes(row.status)
              ? "approval_refused_finished"
              : "transition_refused",
            `The request is ${row.status}, not awaiting approval`
          );
        }
        const decision: CreditDecision = {
          decision: input.decision,
          reason: input.reason,
          actor,
          at: iso(nowMs)
        };
        this.sql.exec(
          "UPDATE credit_requests SET decision_json = ?, updated_at = ? WHERE id = ?",
          JSON.stringify(decision),
          iso(nowMs),
          requestId
        );
        const after = this.requestRow(requestId) as RequestRow;
        this.appendAudit(
          this.requestAudit(
            after,
            actor,
            "decision_received",
            input.reason,
            requestSnapshot(row),
            requestSnapshot(after)
          ),
          nowMs
        );
        this.setTimer("recover", requestId, nowMs + RECOVERY_DELAY_MS);
        return {
          ok: true,
          request: toCreditRequest(after),
          alreadyRecorded: false
        };
      }
    );
    await this.armAlarm();
    return result;
  }

  /**
   * Expire a pending request with no recorded decision (Workflow timeout or sweeper). A decision
   * recorded just before the timeout is honoured: nothing is expired and the decision is returned.
   */
  async expire(
    requestId: string,
    actor: Actor,
    reason: string
  ): Promise<StepResult> {
    if (!this.isSeeded()) return this.stepResult("missing", undefined);
    const nowMs = Date.now();
    const result = this.tx(() => {
      const row = this.requestRow(requestId);
      if (row && decisionOf(row)) return this.stepResult("already", row);
      return this.transition(
        requestId,
        "expired",
        actor,
        "credit_expired",
        nowMs,
        (r) => {
          this.voidMemo(r.id);
          this.sql.exec(
            "UPDATE credit_requests SET outcome_reason = ? WHERE id = ?",
            reason,
            requestId
          );
          return { reason };
        }
      );
    });
    await this.armAlarm();
    return result;
  }

  private voidMemo(requestId: string): void {
    this.sql.exec(
      "UPDATE credit_memos SET status = 'void' WHERE request_id = ? AND status = 'pending'",
      requestId
    );
  }

  /** pending_approval -> approved, only when the recorded decision is approve. */
  async approve(requestId: string, actor: Actor): Promise<StepResult> {
    return this.decide(requestId, actor, "approve");
  }

  /** pending_approval -> rejected, only when the recorded decision is reject. */
  async reject(requestId: string, actor: Actor): Promise<StepResult> {
    return this.decide(requestId, actor, "reject");
  }

  private async decide(
    requestId: string,
    actor: Actor,
    expected: "approve" | "reject"
  ): Promise<StepResult> {
    if (!this.isSeeded()) return this.stepResult("missing", undefined);
    const nowMs = Date.now();
    const row = this.requestRow(requestId);
    const recorded = row ? decisionOf(row) : null;
    if (!row || !recorded || recorded.decision !== expected) {
      // Money follows the recorded decision only (D-6); anything else is a refused transition.
      if (row) {
        this.auditRefusalOnce(
          this.requestAudit(
            row,
            actor,
            "transition_refused",
            `Refused ${expected}: recorded decision is ${recorded?.decision ?? "none"}`,
            requestSnapshot(row),
            null
          ),
          nowMs
        );
      }
      return this.stepResult(row ? "refused" : "missing", row);
    }
    const result = this.tx(() =>
      expected === "approve"
        ? this.transition(
            requestId,
            "approved",
            actor,
            "credit_approved",
            nowMs,
            () => {
              this.setTimer("recover", requestId, nowMs + RECOVERY_DELAY_MS);
              return {
                reason: `Approved by ${recorded.actor}: ${recorded.reason}`
              };
            }
          )
        : this.transition(
            requestId,
            "rejected",
            actor,
            "credit_rejected",
            nowMs,
            (r) => {
              this.voidMemo(r.id);
              this.sql.exec(
                "UPDATE credit_requests SET outcome_reason = ? WHERE id = ?",
                recorded.reason,
                requestId
              );
              return {
                reason: `Rejected by ${recorded.actor}: ${recorded.reason}`
              };
            }
          )
    );
    await this.armAlarm();
    return result;
  }

  /**
   * approved -> applied: writes the credit ledger entry (UNIQUE on the request, so money moves
   * once) and marks the memo applied, in the same transaction as the audit record.
   */
  async apply(requestId: string, actor: Actor): Promise<StepResult> {
    if (!this.isSeeded()) return this.stepResult("missing", undefined);
    const nowMs = Date.now();
    const result = this.tx(() =>
      this.transition(
        requestId,
        "applied",
        actor,
        "credit_applied",
        nowMs,
        (r) => {
          const memo = this.sql
            .exec<MemoRow>(
              "SELECT * FROM credit_memos WHERE request_id = ? AND status = 'pending'",
              r.id
            )
            .one();
          this.sql.exec(
            "INSERT INTO ledger_entries (id, customer_id, at, kind, amount_cents, invoice_id, reference, description, credit_request_id) VALUES (?, ?, ?, 'credit', ?, ?, ?, ?, ?)",
            `le_${r.id}`,
            r.customer_id,
            iso(nowMs),
            memo.amount_cents,
            r.invoice_id,
            `credit_memo:${memo.id}`,
            `Credit memo ${memo.id} for duplicated charge ${memo.disputed_ledger_entry_id}`,
            r.id
          );
          this.sql.exec(
            "UPDATE credit_memos SET status = 'applied' WHERE id = ?",
            memo.id
          );
          return {
            reason: `Credit memo ${memo.id} applied: ${money(memo.amount_cents).display} credited as le_${r.id}`
          };
        }
      )
    );
    await this.armAlarm();
    return result;
  }

  /** Finish a decided request through the Ledger transitions directly (recovery path). */
  private async finish(requestId: string, actor: Actor): Promise<void> {
    const row = this.requestRow(requestId);
    const recorded = row ? decisionOf(row) : null;
    if (!row || !recorded) return;
    if (recorded.decision === "reject") {
      await this.reject(requestId, actor);
      return;
    }
    await this.approve(requestId, actor);
    await this.apply(requestId, actor);
  }

  // ---- Recovery (docs/ARCHITECTURE.md, "Recovery for non-terminal states") ---------------------

  private async instanceStatus(requestId: string): Promise<string> {
    try {
      const instance = await this.env.CREDIT_WORKFLOW.get(requestId);
      return (await instance.status()).status;
    } catch (_err) {
      return "missing";
    }
  }

  private async recoverRequest(requestId: string, nowMs: number) {
    const actor: Actor = "system:sweeper";
    const row = this.requestRow(requestId);
    if (!row || TERMINAL_CREDIT_STATUSES.includes(row.status)) {
      this.clearTimer("recover", requestId);
      return;
    }
    const recorded = decisionOf(row);
    if (row.status === "approved") {
      await this.apply(requestId, actor);
      return;
    }
    if (row.status === "requested") {
      const createdMs = Date.parse(row.created_at);
      if (nowMs - createdMs < RECOVERY_DELAY_MS) {
        this.setTimer("recover", requestId, createdMs + RECOVERY_DELAY_MS);
        return;
      }
      const status = await this.instanceStatus(requestId);
      if (status === "missing") {
        const sandboxId = this.meta("sandbox_id") as string;
        await this.env.CREDIT_WORKFLOW.create(
          createParams(sandboxId, row.customer_id, requestId) as never
        );
        this.auditWorkflowRestart(
          row,
          "No Workflow instance found; started one",
          nowMs
        );
      } else if (status === "errored" || status === "terminated") {
        await (await this.env.CREDIT_WORKFLOW.get(requestId)).restart();
        this.auditWorkflowRestart(
          row,
          `Workflow instance was ${status}; restarted it`,
          nowMs
        );
      } else if (status === "complete") {
        // The instance finished without moving the Ledger on: drive the steps directly.
        this.validate(requestId, actor);
        await this.createPendingMemo(requestId, actor);
      }
      const now = this.requestRow(requestId) as RequestRow;
      if (now.status === "requested") {
        this.setTimer("recover", requestId, nowMs + RECOVERY_DELAY_MS);
      }
      return;
    }
    // pending_approval
    if (recorded) {
      const decidedMs = Date.parse(recorded.at);
      if (nowMs - decidedMs < RECOVERY_DELAY_MS) {
        this.setTimer("recover", requestId, decidedMs + RECOVERY_DELAY_MS);
        return;
      }
      const status = await this.instanceStatus(requestId);
      if ((LIVE_INSTANCE_STATES as readonly string[]).includes(status)) {
        // The approval event was lost: resend the wake-up. An instance that is not waiting yet
        // buffers it, so this is harmless. (Local dev reports a waiting instance as "running".)
        const instance = await this.env.CREDIT_WORKFLOW.get(requestId);
        await instance.sendEvent({
          type: "approval",
          payload: {
            approved: recorded.decision === "approve",
            reason: recorded.reason
          }
        });
        this.setTimer("recover", requestId, nowMs + RECOVERY_DELAY_MS);
        return;
      }
      // The instance is gone, complete or failed: finish through the Ledger transitions.
      await this.finish(requestId, actor);
      return;
    }
    const deadlineMs = Date.parse(row.deadline as string);
    if (nowMs >= deadlineMs + SWEEP_GRACE_MS) {
      await this.expire(
        requestId,
        actor,
        "No approver decision by the deadline (expired by the sweeper)"
      );
      return;
    }
    this.setTimer("recover", requestId, deadlineMs + SWEEP_GRACE_MS);
  }

  /** Audit a Workflow restart done by the agent when it found an errored instance (D-9). */
  noteWorkflowRestart(requestId: string, reason: string): void {
    if (!this.isSeeded()) return;
    const row = this.requestRow(requestId);
    if (row) this.auditWorkflowRestart(row, reason, Date.now(), "system");
  }

  private auditWorkflowRestart(
    row: RequestRow,
    reason: string,
    nowMs: number,
    actor: Actor = "system:sweeper"
  ): void {
    this.appendAudit(
      this.requestAudit(
        row,
        actor,
        "workflow_restarted",
        reason,
        requestSnapshot(row),
        null
      ),
      nowMs
    );
  }
}

function summary(r: CreditRequest) {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    status: r.status,
    validatedAmount: r.validatedAmount,
    createdAt: r.createdAt,
    deadline: r.deadline,
    outcomeReason: r.outcomeReason
  };
}
