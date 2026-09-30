// CreditRequestWorkflow end to end in workerd: started by the agent's startCreditRequest tool
// through /turn (stubbed AI), decided through the admin endpoint, observed through the Ledger.
import { env } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it, vi } from "vitest";
import { STEP } from "../../src/workflows/credit-request";
import { createParams } from "../../src/workflows/params";
import { ACME, DUP_CENTS, DUP_ENTRY, INV_SEP } from "./support/fake-engine";
import {
  auditActions,
  countRows,
  createSandbox,
  decide,
  idempotencyKey,
  ledgerOf,
  requestIdFor,
  requestOf,
  stubAi,
  text,
  toolCall,
  turn
} from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine
}));

const CLAIM = {
  invoiceId: INV_SEP,
  disputedLedgerEntryId: DUP_ENTRY,
  reason: "I was charged twice for September"
};

type Introspector = Awaited<ReturnType<typeof introspectWorkflowInstance>>;

/** Run fn with an introspector on the request's Workflow instance, disposing it afterwards. */
async function withInstance(
  requestId: string,
  fn: (wf: Introspector) => Promise<void>
): Promise<void> {
  const wf = await introspectWorkflowInstance(env.CREDIT_WORKFLOW, requestId);
  try {
    await fn(wf);
  } finally {
    await wf.dispose();
  }
}

/** Ask for the credit through the chat path (stubbed model calls startCreditRequest). */
async function requestCredit(sandboxId: string) {
  stubAi([toolCall("startCreditRequest", CLAIM), text("Request submitted.")]);
  const res = await turn(sandboxId, ACME, "I was double-charged in September");
  expect(res.status).toBe(200);
  return (await res.json()) as {
    toolCalls: {
      name: string;
      output: { request: { id: string; status: string }; existing: boolean };
      error: string | null;
    }[];
  };
}

async function creditEntries(sandboxId: string): Promise<number> {
  return countRows(sandboxId, "ledger_entries", "kind = 'credit'");
}

describe("credit request workflow", () => {
  it("runs request, pending, approve, applied, with audit records in order", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      const body = await requestCredit(sb.sandboxId);
      expect(body.toolCalls[0].error).toBeNull();
      expect(body.toolCalls[0].output.request).toMatchObject({
        id: rid,
        status: "requested"
      });
      await wf.waitForStepResult({ name: STEP.memo });
      const pending = await requestOf(sb.sandboxId, ACME, rid);
      expect(pending.request.status).toBe("pending_approval");
      expect(pending.request.validatedAmount?.cents).toBe(DUP_CENTS);
      expect(pending.request.deadline).not.toBeNull();

      const res = await decide(sb.sandboxId, rid, sb.approverToken, "approve");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ alreadyRecorded: false });
      await wf.waitForStatus("complete");

      const done = await requestOf(sb.sandboxId, ACME, rid);
      expect(done.request.status).toBe("applied");
      expect(done.request.decision?.decision).toBe("approve");
      expect(await creditEntries(sb.sandboxId)).toBe(1);
      expect(
        await countRows(
          sb.sandboxId,
          "credit_memos",
          `request_id = '${rid}' AND status = 'applied'`
        )
      ).toBe(1);
      expect(await auditActions(sb.sandboxId, ACME, rid)).toEqual([
        "credit_requested",
        "credit_validated",
        "memo_pending",
        "decision_received",
        "credit_approved",
        "credit_applied"
      ]);
    });
  });

  it("rejects: memo voided, no credit, audit ends in credit_rejected", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      await requestCredit(sb.sandboxId);
      await wf.waitForStepResult({ name: STEP.memo });
      const res = await decide(sb.sandboxId, rid, sb.approverToken, "reject");
      expect(res.status).toBe(200);
      await wf.waitForStatus("complete");
      const done = await requestOf(sb.sandboxId, ACME, rid);
      expect(done.request.status).toBe("rejected");
      expect(await creditEntries(sb.sandboxId)).toBe(0);
      expect(
        await countRows(sb.sandboxId, "credit_memos", "status = 'void'")
      ).toBe(1);
      expect(await auditActions(sb.sandboxId, ACME, rid)).toEqual([
        "credit_requested",
        "credit_validated",
        "memo_pending",
        "decision_received",
        "credit_rejected"
      ]);
    });
  });

  it("expires on timeout, then refuses a late approval with 409, audited once", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      await wf.modify(async (m) => {
        await m.forceEventTimeout({ name: STEP.wait });
      });
      await requestCredit(sb.sandboxId);
      await wf.waitForStatus("complete");
      const output = (await wf.getOutput()) as {
        status: string;
        timedOut: boolean;
        waitError: string | null;
      };
      expect(output).toMatchObject({ status: "expired", timedOut: true });
      // Settles DEV-8's open question: what waitForEvent throws on timeout.
      expect(output.waitError).toMatch(/.+/);

      const done = await requestOf(sb.sandboxId, ACME, rid);
      expect(done.request.status).toBe("expired");
      expect(await creditEntries(sb.sandboxId)).toBe(0);
      expect(
        await countRows(sb.sandboxId, "credit_memos", "status = 'void'")
      ).toBe(1);
      const expiry = await countRows(
        sb.sandboxId,
        "audit_log",
        `request_id = '${rid}' AND action = 'credit_expired' AND actor = 'system'`
      );
      expect(expiry).toBe(1);

      for (const attempt of [1, 2, 3]) {
        const late = await decide(
          sb.sandboxId,
          rid,
          sb.approverToken,
          "approve"
        );
        expect(late.status, `attempt ${attempt}`).toBe(409);
      }
      expect(
        await countRows(
          sb.sandboxId,
          "audit_log",
          `request_id = '${rid}' AND action = 'approval_refused_expired'`
        )
      ).toBe(1);
      expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
        "expired"
      );
    });
  });

  it("returns the same request for a retried idempotency key and credits once", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      const first = await requestCredit(sb.sandboxId);
      const second = await requestCredit(sb.sandboxId);
      expect(first.toolCalls[0].output.existing).toBe(false);
      expect(second.toolCalls[0].output.existing).toBe(true);
      expect(second.toolCalls[0].output.request.id).toBe(rid);
      expect(
        await countRows(sb.sandboxId, "credit_requests", `id = '${rid}'`)
      ).toBe(1);

      await wf.waitForStepResult({ name: STEP.memo });
      await decide(sb.sandboxId, rid, sb.approverToken, "approve");
      await wf.waitForStatus("complete");

      // The same key through the Ledger directly, after completion: still the one request.
      const again = await ledgerOf(sb.sandboxId).createCreditRequest({
        customerId: ACME,
        ...CLAIM,
        idempotencyKey: await idempotencyKey(
          sb.sandboxId,
          ACME,
          INV_SEP,
          DUP_ENTRY
        )
      });
      expect(again.ok && again.existing && again.request.id).toBe(rid);
      expect(await creditEntries(sb.sandboxId)).toBe(1);
    });
  });

  it("leaves exactly one recorded decision when decisions compete, and money follows it", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      await requestCredit(sb.sandboxId);
      await wf.waitForStepResult({ name: STEP.memo });
      const [a, r] = await Promise.all([
        decide(sb.sandboxId, rid, sb.approverToken, "approve", "ok"),
        decide(sb.sandboxId, rid, sb.approverToken, "reject", "no")
      ]);
      expect([a.status, r.status].sort()).toEqual([200, 409]);
      const winner = a.status === 200 ? "approve" : "reject";
      await wf.waitForStatus("complete");

      const done = await requestOf(sb.sandboxId, ACME, rid);
      expect(done.request.decision?.decision).toBe(winner);
      expect(done.request.status).toBe(
        winner === "approve" ? "applied" : "rejected"
      );
      expect(await creditEntries(sb.sandboxId)).toBe(
        winner === "approve" ? 1 : 0
      );
      expect(
        await countRows(
          sb.sandboxId,
          "audit_log",
          `request_id = '${rid}' AND action = 'decision_received'`
        )
      ).toBe(1);
      expect(
        await countRows(
          sb.sandboxId,
          "audit_log",
          `request_id = '${rid}' AND action = 'decision_refused_conflict'`
        )
      ).toBe(1);
    });
  });

  it("recovers a lost approval event from the recorded decision", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      await requestCredit(sb.sandboxId);
      await wf.waitForStepResult({ name: STEP.memo });
      // The decision is recorded, but the wake-up event is never sent (lost).
      const recorded = await ledgerOf(sb.sandboxId).recordDecision(
        rid,
        { decision: "approve", reason: "ok" },
        `approver:${sb.sandboxId}`
      );
      expect(recorded.ok).toBe(true);
      await ledgerOf(sb.sandboxId).processTimers(Date.now() + 6 * 60_000);
      await wf.waitForStatus("complete");
      expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
        "applied"
      );
      expect(await creditEntries(sb.sandboxId)).toBe(1);
    });
  });

  it("honours a decision recorded just before the approval wait times out", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    // Drive the Ledger to pending_approval and record the decision, as if it landed while the
    // Workflow was already waiting. The Workflow's first two steps report what it saw before the
    // decision (pending, no decision); then its wait times out and the expire step runs for real.
    const ledger = ledgerOf(sb.sandboxId);
    await ledger.createCreditRequest({
      customerId: ACME,
      ...CLAIM,
      idempotencyKey: await idempotencyKey(
        sb.sandboxId,
        ACME,
        INV_SEP,
        DUP_ENTRY
      )
    });
    await ledger.validate(rid, `workflow:${rid}`);
    await ledger.createPendingMemo(rid, `workflow:${rid}`);
    await ledger.recordDecision(
      rid,
      { decision: "approve", reason: "just in time" },
      `approver:${sb.sandboxId}`
    );
    await withInstance(rid, async (wf) => {
      const seenBefore = {
        outcome: "done",
        status: "pending_approval",
        decision: null
      };
      await wf.modify(async (m) => {
        await m.mockStepResult({ name: STEP.validate }, seenBefore);
        await m.mockStepResult({ name: STEP.memo }, seenBefore);
        await m.forceEventTimeout({ name: STEP.wait });
      });
      await env.CREDIT_WORKFLOW.create(
        createParams(sb.sandboxId, ACME, rid) as never
      );
      await wf.waitForStatus("complete");
      expect(await wf.getOutput()).toMatchObject({
        status: "applied",
        timedOut: true
      });
      expect(await creditEntries(sb.sandboxId)).toBe(1);
      const actions = await auditActions(sb.sandboxId, ACME, rid);
      expect(actions).not.toContain("credit_expired");
      expect(actions.slice(-2)).toEqual(["credit_approved", "credit_applied"]);
    });
  });
});

describe("failure injection and recovery", () => {
  it("starts a missing instance for a request stranded in requested (crash before the Workflow started)", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      // Recorded in the Ledger, but the agent died before runWorkflow.
      const created = await ledgerOf(sb.sandboxId).createCreditRequest({
        customerId: ACME,
        ...CLAIM,
        idempotencyKey: await idempotencyKey(
          sb.sandboxId,
          ACME,
          INV_SEP,
          DUP_ENTRY
        )
      });
      expect(created.ok).toBe(true);
      const early = await ledgerOf(sb.sandboxId).processTimers(Date.now());
      expect(early.processed).toEqual([]);
      await ledgerOf(sb.sandboxId).processTimers(Date.now() + 6 * 60_000);
      await wf.waitForStepResult({ name: STEP.memo });
      expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
        "pending_approval"
      );
      expect(await auditActions(sb.sandboxId, ACME, rid)).toContain(
        "workflow_restarted"
      );
    });
  });

  it("restarts an instance that errored after creation but before the pending memo", async () => {
    const sb = await createSandbox();
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    await withInstance(rid, async (wf) => {
      await wf.modify(async (m) => {
        // Non-retryable, so the instance errors at once instead of after the retry backoff.
        await m.mockStepError(
          { name: STEP.memo },
          new NonRetryableError("injected crash")
        );
      });
      await requestCredit(sb.sandboxId);
      await wf.waitForStatus("errored");
      expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
        "requested"
      );
    });
    await withInstance(rid, async (wf) => {
      await ledgerOf(sb.sandboxId).processTimers(Date.now() + 6 * 60_000);
      await wf.waitForStepResult({ name: STEP.memo });
      expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
        "pending_approval"
      );
      const actions = await auditActions(sb.sandboxId, ACME, rid);
      expect(actions.filter((a) => a === "workflow_restarted")).toHaveLength(1);
      // The validate step re-ran after the restart without a second record.
      expect(actions.filter((a) => a === "credit_validated")).toHaveLength(1);
    });
  });
});
