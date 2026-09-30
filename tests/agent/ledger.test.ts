// Ledger invariants (docs/ARCHITECTURE.md, "Ledger invariants" and "Recovery"), exercised on the
// Durable Object directly and through the Worker. The engine is the fake from support/.
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { randomHex } from "../../src/http/config";
import { RECOVERY_DELAY_MS, SWEEP_GRACE_MS } from "../../src/ledger/ledger";
import {
  ACME,
  DUP_CENTS,
  DUP_ENTRY,
  GLOBEX,
  HIST_REQUEST,
  INV_SEP
} from "./support/fake-engine";
import {
  auditActions,
  call,
  countRows,
  createSandbox,
  idempotencyKey,
  ledgerOf,
  requestIdFor,
  requestOf
} from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine
}));

const WF = (rid: string) => `workflow:${rid}` as const;

async function newRequest(
  sandboxId: string,
  disputed: string | null = DUP_ENTRY
): Promise<string> {
  const created = await ledgerOf(sandboxId).createCreditRequest({
    customerId: ACME,
    invoiceId: INV_SEP,
    disputedLedgerEntryId: disputed,
    reason: "charged twice",
    idempotencyKey: await idempotencyKey(sandboxId, ACME, INV_SEP, disputed)
  });
  if (!created.ok) throw new Error(created.message);
  return created.request.id;
}

async function toPending(sandboxId: string, rid: string): Promise<void> {
  const ledger = ledgerOf(sandboxId);
  expect((await ledger.validate(rid, WF(rid))).outcome).toBe("done");
  expect((await ledger.createPendingMemo(rid, WF(rid))).status).toBe(
    "pending_approval"
  );
}

async function tableNames(sandboxId: string): Promise<string[]> {
  return runInDurableObject(ledgerOf(sandboxId), (_i, state) =>
    state.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'"
      )
      .toArray()
      .map((r) => r.name)
  );
}

async function setCounter(
  sandboxId: string,
  name: string,
  count: number
): Promise<void> {
  await runInDurableObject(ledgerOf(sandboxId), (_i, state) => {
    state.storage.sql.exec(
      "INSERT INTO counters (name, day, count) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET day = excluded.day, count = excluded.count",
      name,
      new Date().toISOString().slice(0, 10),
      count
    );
  });
}

describe("seeding and admission", () => {
  it("seeds a new sandbox fresh and shares no state with an older one", async () => {
    const a = await createSandbox();
    const rid = await newRequest(a.sandboxId);
    const b = await createSandbox();
    expect(b.sandboxId).not.toBe(a.sandboxId);
    expect(
      await countRows(b.sandboxId, "credit_requests", `id = '${rid}'`)
    ).toBe(0);
    expect(await countRows(b.sandboxId, "credit_requests")).toBe(1);
    expect(
      await countRows(b.sandboxId, "credit_requests", `id = '${HIST_REQUEST}'`)
    ).toBe(1);
    // Seeded history (2 records) plus sandbox_created; nothing from sandbox a.
    expect(await countRows(b.sandboxId, "audit_log")).toBe(3);
    expect(await countRows(a.sandboxId, "audit_log")).toBe(4);
    expect(a.customers.map((c) => c.customerId)).toEqual([ACME, GLOBEX]);
  });

  it("measures real rows written for seeding and for deletion", async () => {
    const sandboxId = randomHex(16);
    const seeded = await ledgerOf(sandboxId).seed({
      sandboxId,
      tokenHash: "0".repeat(64)
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    // Fake seed: 44 rows in 15 tables plus DDL; the real seed's bound is in seed.test.ts.
    expect(seeded.rowsWritten).toBeGreaterThan(40);
    const deleted = await ledgerOf(sandboxId).deleteSandboxData();
    expect(deleted.rowsWritten).toBeGreaterThan(40);
    expect(await tableNames(sandboxId)).toEqual([]);
  });

  it("refuses to seed the same sandbox twice", async () => {
    const a = await createSandbox();
    const again = await ledgerOf(a.sandboxId).seed({
      sandboxId: a.sandboxId,
      tokenHash: "0".repeat(64)
    });
    expect(again.ok).toBe(false);
  });

  it("answers fabricated sandbox ids with 404 and writes nothing", async () => {
    const fake = randomHex(16);
    const paths = [
      `/api/sandboxes/${fake}/customers/${ACME}/panel`,
      `/api/sandboxes/${fake}/admin/credit-requests`,
      `/agents/billing-agent/${fake}.${ACME}`,
      `/agents/billing-agent/${fake}.${ACME}/get-messages`
    ];
    for (const path of paths) {
      const res = await call(path, { token: "a".repeat(43) });
      expect(res.status, path).toBe(404);
    }
    const turn = await call(`/api/sandboxes/${fake}/customers/${ACME}/turn`, {
      method: "POST",
      body: JSON.stringify({ message: "hi" })
    });
    expect(turn.status).toBe(404);
    const ws = await call(`/agents/billing-agent/${fake}.${ACME}`, {
      headers: { Upgrade: "websocket" }
    });
    expect(ws.status).toBe(404);
    expect(await tableNames(fake)).toEqual([]);
    for (const bad of ["abc", "G".repeat(32), `${fake}x`]) {
      const res = await call(`/api/sandboxes/${bad}/customers/${ACME}/panel`);
      expect(res.status, bad).toBe(404);
    }
  });

  it("answers fabricated customer ids with 404 and writes nothing", async () => {
    const sb = await createSandbox();
    const before = await countRows(sb.sandboxId, "counters");
    for (const cid of ["cus_nobody", "not-a-customer"]) {
      const res = await call(
        `/api/sandboxes/${sb.sandboxId}/customers/${cid}/panel`
      );
      expect(res.status, cid).toBe(404);
      const ws = await call(`/agents/billing-agent/${sb.sandboxId}.${cid}`, {
        headers: { Upgrade: "websocket" }
      });
      expect(ws.status, cid).toBe(404);
    }
    expect(await countRows(sb.sandboxId, "counters")).toBe(before);
  });

  it("caps non-model requests at the daily limit with 429, writing nothing on refusal", async () => {
    const sb = await createSandbox();
    const limit = Number(env.API_REQUESTS_PER_SANDBOX_DAY);
    await setCounter(sb.sandboxId, "api", limit - 1);
    const panel = `/api/sandboxes/${sb.sandboxId}/customers/${ACME}/panel`;
    expect((await call(panel)).status).toBe(200);
    const auditBefore = await countRows(sb.sandboxId, "audit_log");
    const lastActivity = await runInDurableObject(
      ledgerOf(sb.sandboxId),
      (_i, s) =>
        s.storage.sql
          .exec<{
            value: string;
          }>("SELECT value FROM meta WHERE key = 'last_activity_at'")
          .one().value
    );
    for (let i = 0; i < 3; i++) {
      const res = await call(panel);
      expect(res.status).toBe(429);
      const body = (await res.json()) as {
        error: { code: string; cap: { name: string; limit: number } };
      };
      expect(body.error.code).toBe("cap_reached");
      expect(body.error.cap).toMatchObject({ name: "api", limit });
    }
    expect(
      await countRows(
        sb.sandboxId,
        "counters",
        `name = 'api' AND count = ${limit}`
      )
    ).toBe(1);
    expect(await countRows(sb.sandboxId, "audit_log")).toBe(auditBefore);
    const lastAfter = await runInDurableObject(
      ledgerOf(sb.sandboxId),
      (_i, s) =>
        s.storage.sql
          .exec<{
            value: string;
          }>("SELECT value FROM meta WHERE key = 'last_activity_at'")
          .one().value
    );
    expect(lastAfter).toBe(lastActivity);
  });
});

describe("credit invariants", () => {
  it("lets concurrent requests with different keys for the same charge reserve it at most once", async () => {
    const sb = await createSandbox();
    const ledger = ledgerOf(sb.sandboxId);
    const make = async (disputed: string | null) =>
      ledger.createCreditRequest({
        customerId: ACME,
        invoiceId: INV_SEP,
        disputedLedgerEntryId: disputed,
        reason: "charged twice",
        idempotencyKey: await idempotencyKey(
          sb.sandboxId,
          ACME,
          INV_SEP,
          disputed
        )
      });
    const [one, two] = await Promise.all([make(DUP_ENTRY), make(null)]);
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    // A second open request for the same charge returns the first.
    expect([one.existing, two.existing].sort()).toEqual([false, true]);
    expect(one.request.id).toBe(two.request.id);

    // Force the race at the reservation itself: a second open request for the charge that
    // bypassed creation (as a concurrent create could), both validated, both reserving at once.
    const rid = one.request.id;
    const rogue = "cr_rogue_second_request";
    await runInDurableObject(ledger, (_i, state) => {
      state.storage.sql.exec(
        "INSERT INTO credit_requests (id, idempotency_key, customer_id, invoice_id, disputed_ledger_entry_id, customer_reason, status, created_at, updated_at) SELECT ?, ?, customer_id, invoice_id, disputed_ledger_entry_id, customer_reason, 'requested', created_at, updated_at FROM credit_requests WHERE id = ?",
        rogue,
        "b".repeat(64),
        rid
      );
    });
    await Promise.all([
      ledger.validate(rid, WF(rid)),
      ledger.validate(rogue, WF(rogue))
    ]);
    const memos = await Promise.all([
      ledger.createPendingMemo(rid, WF(rid)),
      ledger.createPendingMemo(rogue, WF(rogue))
    ]);
    expect(memos.map((m) => m.status).sort()).toEqual([
      "pending_approval",
      "rejected"
    ]);
    expect(
      await countRows(sb.sandboxId, "credit_memos", "status = 'pending'")
    ).toBe(1);
    expect(
      await countRows(
        sb.sandboxId,
        "credit_memos",
        `disputed_ledger_entry_id = '${DUP_ENTRY}' AND amount_cents = ${DUP_CENTS}`
      )
    ).toBe(1);
    const loser = memos[0].status === "rejected" ? rid : rogue;
    expect(await auditActions(sb.sandboxId, ACME, loser)).toContain(
      "credit_validation_failed"
    );
  });

  it("returns the recorded result for replayed transitions without a second audit record", async () => {
    const sb = await createSandbox();
    const ledger = ledgerOf(sb.sandboxId);
    const rid = await newRequest(sb.sandboxId);
    const actor = WF(rid);
    const approver = `approver:${sb.sandboxId}` as const;
    const steps: [string, () => Promise<{ outcome: string }>][] = [
      ["validate", async () => ledger.validate(rid, actor)],
      ["memo", async () => ledger.createPendingMemo(rid, actor)],
      [
        "decision",
        async () => {
          const r = await ledger.recordDecision(
            rid,
            { decision: "approve", reason: "ok" },
            approver
          );
          return { outcome: r.ok && !r.alreadyRecorded ? "done" : "already" };
        }
      ],
      ["approve", async () => ledger.approve(rid, actor)],
      ["apply", async () => ledger.apply(rid, actor)]
    ];
    for (const [name, step] of steps) {
      expect((await step()).outcome, name).toBe("done");
      const audit = await countRows(sb.sandboxId, "audit_log");
      expect((await step()).outcome, `${name} replayed`).toBe("already");
      expect(await countRows(sb.sandboxId, "audit_log"), name).toBe(audit);
    }
    // A replayed approve after the credit was applied is still "already", never a refusal.
    expect((await ledger.approve(rid, actor)).outcome).toBe("already");
    expect(await auditActions(sb.sandboxId, ACME, rid)).toEqual([
      "credit_requested",
      "credit_validated",
      "memo_pending",
      "decision_received",
      "credit_approved",
      "credit_applied"
    ]);
    expect(
      await countRows(sb.sandboxId, "ledger_entries", "kind = 'credit'")
    ).toBe(1);
  });

  it("refuses moves the state machine forbids and audits each refusal once", async () => {
    const sb = await createSandbox();
    const ledger = ledgerOf(sb.sandboxId);
    const rid = await newRequest(sb.sandboxId);
    await toPending(sb.sandboxId, rid);
    await ledger.recordDecision(
      rid,
      { decision: "reject", reason: "not a duplicate" },
      `approver:${sb.sandboxId}`
    );
    expect((await ledger.reject(rid, WF(rid))).status).toBe("rejected");
    for (let i = 0; i < 3; i++) {
      expect((await ledger.approve(rid, WF(rid))).outcome).toBe("refused");
      expect((await ledger.apply(rid, WF(rid))).outcome).toBe("refused");
      const late = await ledger.recordDecision(
        rid,
        { decision: "approve", reason: "changed my mind" },
        `approver:${sb.sandboxId}`
      );
      expect(late.ok || late.status).toBe(409);
    }
    const actions = await auditActions(sb.sandboxId, ACME, rid);
    expect(actions.filter((a) => a === "transition_refused")).toHaveLength(2);
    expect(
      actions.filter((a) => a === "decision_refused_conflict")
    ).toHaveLength(1);
    expect(
      await countRows(sb.sandboxId, "ledger_entries", "kind = 'credit'")
    ).toBe(0);
  });

  it("refuses a decision on a finished request with 409 approval_refused_finished", async () => {
    const sb = await createSandbox();
    const res = await call(
      `/api/sandboxes/${sb.sandboxId}/admin/credit-requests/${HIST_REQUEST}/decision`,
      {
        method: "POST",
        token: sb.approverToken,
        body: JSON.stringify({ decision: "approve", reason: "late" })
      }
    );
    // The seeded historical request is expired.
    expect(res.status).toBe(409);
    expect(await auditActions(sb.sandboxId, ACME, HIST_REQUEST)).toContain(
      "approval_refused_expired"
    );
    const rid = await newRequest(sb.sandboxId, "le_acme_2026_09_charge");
    // The original charge is not a duplicate: validation rejects it, which is terminal.
    expect((await ledgerOf(sb.sandboxId).validate(rid, WF(rid))).status).toBe(
      "rejected"
    );
    const finished = await ledgerOf(sb.sandboxId).recordDecision(
      rid,
      { decision: "approve", reason: "x" },
      `approver:${sb.sandboxId}`
    );
    expect(finished.ok).toBe(false);
    expect(await auditActions(sb.sandboxId, ACME, rid)).toEqual([
      "credit_requested",
      "credit_validation_failed",
      "approval_refused_finished"
    ]);
  });
});

describe("timers and the single alarm", () => {
  it("fires for the earliest of several timers and is rescheduled", async () => {
    const sb = await createSandbox();
    const ledger = ledgerOf(sb.sandboxId);
    const alarmAt = () =>
      runInDurableObject(ledger, (_i, state) => state.storage.getAlarm());
    const now = Date.now();
    const idleDue = await runInDurableObject(
      ledger,
      (_i, s) =>
        s.storage.sql
          .exec<{ due_at: number }>(
            "SELECT due_at FROM timers WHERE kind = 'idle'"
          )
          .one().due_at
    );
    expect(await alarmAt()).toBe(idleDue);

    // Two recovery timers for requests that no longer exist, due in 1 and 3 minutes.
    await runInDurableObject(ledger, (_i, s) => {
      s.storage.sql.exec(
        "INSERT INTO timers (kind, subject, due_at) VALUES ('recover', 'cr_ghost_a', ?), ('recover', 'cr_ghost_b', ?)",
        now + 60_000,
        now + 180_000
      );
    });
    await ledger.processTimers(now);
    expect(await alarmAt()).toBe(now + 60_000);

    // A later timer (a new request's 5-minute recovery) never postpones the earlier one.
    await newRequest(sb.sandboxId);
    expect(await alarmAt()).toBe(now + 60_000);

    const fired = await ledger.processTimers(now + 120_000);
    expect(fired.processed).toEqual(["recover:cr_ghost_a"]);
    expect(await alarmAt()).toBe(now + 180_000);

    // The real alarm handler runs at the real time: nothing is due, the alarm stays armed.
    expect(await runDurableObjectAlarm(ledger)).toBe(true);
    expect(await alarmAt()).toBe(now + 180_000);
  });

  it("expires a pending request an hour past its deadline (sweeper), voiding the memo", async () => {
    const sb = await createSandbox();
    const rid = await newRequest(sb.sandboxId);
    await toPending(sb.sandboxId, rid);
    const { request } = await requestOf(sb.sandboxId, ACME, rid);
    const deadline = Date.parse(request.deadline as string);
    await ledgerOf(sb.sandboxId).processTimers(
      deadline + SWEEP_GRACE_MS - 1000
    );
    expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
      "pending_approval"
    );
    await ledgerOf(sb.sandboxId).processTimers(deadline + SWEEP_GRACE_MS);
    expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
      "expired"
    );
    expect(
      await countRows(
        sb.sandboxId,
        "audit_log",
        `request_id = '${rid}' AND action = 'credit_expired' AND actor = 'system:sweeper'`
      )
    ).toBe(1);
    expect(
      await countRows(sb.sandboxId, "credit_memos", "status = 'void'")
    ).toBe(1);
    expect(await countRows(sb.sandboxId, "timers", `subject = '${rid}'`)).toBe(
      0
    );
  });

  it("re-applies an approved request whose credit was never applied", async () => {
    const sb = await createSandbox();
    const ledger = ledgerOf(sb.sandboxId);
    const rid = await newRequest(sb.sandboxId);
    await toPending(sb.sandboxId, rid);
    await ledger.recordDecision(
      rid,
      { decision: "approve", reason: "ok" },
      `approver:${sb.sandboxId}`
    );
    await ledger.approve(rid, WF(rid));
    // The Workflow died before its apply step.
    await ledger.processTimers(Date.now() + RECOVERY_DELAY_MS + 1000);
    expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
      "applied"
    );
    expect(
      await countRows(sb.sandboxId, "ledger_entries", "kind = 'credit'")
    ).toBe(1);
  });

  it("finishes a decided request through the Ledger when its instance is gone", async () => {
    const sb = await createSandbox();
    const ledger = ledgerOf(sb.sandboxId);
    const rid = await newRequest(sb.sandboxId);
    await toPending(sb.sandboxId, rid);
    await ledger.recordDecision(
      rid,
      { decision: "reject", reason: "no" },
      `approver:${sb.sandboxId}`
    );
    await ledger.processTimers(Date.now() + RECOVERY_DELAY_MS + 1000);
    expect((await requestOf(sb.sandboxId, ACME, rid)).request.status).toBe(
      "rejected"
    );
  });

  it("deletes an idle sandbox's storage after the idle period", async () => {
    const sb = await createSandbox();
    const idleMs = Number(env.SANDBOX_IDLE_DAYS) * 86_400_000;
    const ledger = ledgerOf(sb.sandboxId);
    const early = await ledger.processTimers(Date.now() + idleMs - 60_000);
    expect(early.processed).toEqual([]);
    const fired = await ledger.processTimers(Date.now() + idleMs + 60_000);
    expect(fired.processed).toEqual(["idle:sandbox"]);
    expect(await tableNames(sb.sandboxId)).toEqual([]);
    const res = await call(
      `/api/sandboxes/${sb.sandboxId}/customers/${ACME}/panel`
    );
    expect(res.status).toBe(404);
    expect(
      await runInDurableObject(ledger, (_i, s) => s.storage.getAlarm())
    ).toBeNull();
  });

  it("keeps an active sandbox and re-arms its idle timer from the last activity", async () => {
    const sb = await createSandbox();
    const idleMs = Number(env.SANDBOX_IDLE_DAYS) * 86_400_000;
    const ledger = ledgerOf(sb.sandboxId);
    const later = Date.now() + 2 * 86_400_000;
    await runInDurableObject(ledger, (_i, s) => {
      s.storage.sql.exec(
        "UPDATE meta SET value = ? WHERE key = 'last_activity_at'",
        String(later)
      );
    });
    await ledger.processTimers(Date.now() + idleMs + 60_000);
    expect(await tableNames(sb.sandboxId)).toContain("meta");
    const due = await runInDurableObject(
      ledger,
      (_i, s) =>
        s.storage.sql
          .exec<{ due_at: number }>(
            "SELECT due_at FROM timers WHERE kind = 'idle'"
          )
          .one().due_at
    );
    expect(due).toBe(later + idleMs);
  });
});
