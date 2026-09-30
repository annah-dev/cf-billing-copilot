// The Worker's HTTP surface against src/contracts/http.ts: sandbox creation and its caps, the
// approver token on every admin route, the decision endpoint, the panel, and the rate limiter.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  AdminCreditRequestsResponseSchema,
  CreateSandboxResponseSchema,
  ErrorResponseSchema,
  PanelResponseSchema
} from "../../src/contracts";
import { randomBase64Url } from "../../src/http/config";
import { ACME, DUP_ENTRY, HIST_REQUEST, INV_SEP } from "./support/fake-engine";
import {
  call,
  countRows,
  createSandbox,
  decide,
  freshIp,
  idempotencyKey,
  ledgerOf,
  quota
} from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine
}));

async function errorOf(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error;
}

async function pendingRequest(sandboxId: string): Promise<string> {
  const ledger = ledgerOf(sandboxId);
  const created = await ledger.createCreditRequest({
    customerId: ACME,
    invoiceId: INV_SEP,
    disputedLedgerEntryId: DUP_ENTRY,
    reason: "charged twice",
    idempotencyKey: await idempotencyKey(sandboxId, ACME, INV_SEP, DUP_ENTRY)
  });
  if (!created.ok) throw new Error(created.message);
  const rid = created.request.id;
  await ledger.validate(rid, `workflow:${rid}`);
  await ledger.createPendingMemo(rid, `workflow:${rid}`);
  return rid;
}

describe("sandboxes", () => {
  it("creates a seeded sandbox with a one-time approver token", async () => {
    const res = await call("/api/sandboxes", { method: "POST" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = CreateSandboxResponseSchema.parse(await res.json());
    expect(body.idleDeletionDays).toBe(Number(env.SANDBOX_IDLE_DAYS));
    // Only the token's SHA-256 is stored.
    const stored = await runInDurableObject(
      ledgerOf(body.sandboxId),
      (_i, s) =>
        s.storage.sql
          .exec<{ value: string }>(
            "SELECT value FROM meta WHERE key = 'token_hash'"
          )
          .one().value
    );
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(body.approverToken);
  });

  it("holds the per-IP cap of new sandboxes per UTC day", async () => {
    const ip = freshIp();
    const limit = Number(env.SANDBOXES_PER_DAY_PER_IP);
    for (let i = 0; i < limit; i++) await createSandbox(ip);
    const res = await call("/api/sandboxes", { method: "POST", ip });
    expect(res.status).toBe(429);
    const error = await errorOf(res);
    expect(error.code).toBe("cap_reached");
    expect(error.cap).toMatchObject({ name: "sandboxes_per_ip", limit });
    expect(error.cap?.resetsAt).toMatch(/T00:00:00.000Z$/);
    expect((await call("/api/sandboxes", { method: "POST" })).status).toBe(201);
  });

  it("holds the global cap of new sandboxes per UTC day", async () => {
    const limit = Number(env.SANDBOXES_PER_DAY_GLOBAL);
    const day = new Date().toISOString().slice(0, 10);
    const q = quota();
    const previous = await runInDurableObject(q, (_i, s) => {
      const row = s.storage.sql
        .exec<{
          count: number;
        }>(
          "SELECT count FROM counters WHERE name = 'sandboxes' AND day = ?",
          day
        )
        .toArray()[0];
      s.storage.sql.exec(
        "INSERT INTO counters (name, day, count) VALUES ('sandboxes', ?, ?) ON CONFLICT (name, day) DO UPDATE SET count = excluded.count",
        day,
        limit - 1
      );
      return row?.count ?? 0;
    });
    try {
      expect((await call("/api/sandboxes", { method: "POST" })).status).toBe(
        201
      );
      const res = await call("/api/sandboxes", { method: "POST" });
      expect(res.status).toBe(429);
      expect((await errorOf(res)).cap).toMatchObject({
        name: "sandboxes_global",
        limit
      });
    } finally {
      await runInDurableObject(q, (_i, s) => {
        s.storage.sql.exec(
          "UPDATE counters SET count = ? WHERE name = 'sandboxes' AND day = ?",
          previous,
          day
        );
      });
    }
  });
});

describe("approver token", () => {
  it("answers 401 for a missing, malformed or wrong token on every admin route", async () => {
    const sb = await createSandbox();
    const other = await createSandbox();
    const rid = await pendingRequest(sb.sandboxId);
    const list = `/api/sandboxes/${sb.sandboxId}/admin/credit-requests`;
    const decision = `${list}/${rid}/decision`;
    const body = JSON.stringify({ decision: "approve", reason: "ok" });
    const attempts: [string, Record<string, string>][] = [
      ["missing", {}],
      ["malformed", { Authorization: "Bearer short" }],
      ["not bearer", { Authorization: sb.approverToken }],
      ["wrong", { Authorization: `Bearer ${randomBase64Url(32)}` }],
      ["other sandbox", { Authorization: `Bearer ${other.approverToken}` }]
    ];
    for (const [label, headers] of attempts) {
      const a = await call(list, { headers });
      expect(a.status, `list ${label}`).toBe(401);
      expect((await errorOf(a)).code).toBe("unauthorized");
      const d = await call(decision, { method: "POST", headers, body });
      expect(d.status, `decision ${label}`).toBe(401);
    }
    // Nothing was decided or audited by the refused calls.
    expect(
      await countRows(sb.sandboxId, "audit_log", "action = 'decision_received'")
    ).toBe(0);
    const ok = await call(list, { token: sb.approverToken });
    expect(ok.status).toBe(200);
  });

  it("lists credit requests pending first and records a decision idempotently", async () => {
    const sb = await createSandbox();
    const rid = await pendingRequest(sb.sandboxId);
    const listRes = await call(
      `/api/sandboxes/${sb.sandboxId}/admin/credit-requests`,
      { token: sb.approverToken }
    );
    const list = AdminCreditRequestsResponseSchema.parse(await listRes.json());
    expect(list.requests.map((r) => r.id)).toEqual([rid, HIST_REQUEST]);
    expect(list.requests[0].customerName).toContain("Acme");

    const first = await decide(
      sb.sandboxId,
      rid,
      sb.approverToken,
      "approve",
      "ok"
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      alreadyRecorded: false,
      request: {
        decision: { decision: "approve", actor: `approver:${sb.sandboxId}` }
      }
    });
    const retry = await decide(
      sb.sandboxId,
      rid,
      sb.approverToken,
      "approve",
      "ok"
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ alreadyRecorded: true });
    expect(
      await countRows(sb.sandboxId, "audit_log", "action = 'decision_received'")
    ).toBe(1);
  });

  it("validates the decision body and the request id", async () => {
    const sb = await createSandbox();
    const base = `/api/sandboxes/${sb.sandboxId}/admin/credit-requests`;
    const bad = await call(`${base}/${HIST_REQUEST}/decision`, {
      method: "POST",
      token: sb.approverToken,
      body: JSON.stringify({ decision: "maybe", reason: "" })
    });
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe("invalid_request");
    const unknown = await decide(
      sb.sandboxId,
      "cr_does_not_exist",
      sb.approverToken,
      "approve"
    );
    expect(unknown.status).toBe(404);
    const malformed = await decide(
      sb.sandboxId,
      "not-an-id",
      sb.approverToken,
      "approve"
    );
    expect(malformed.status).toBe(404);
  });
});

describe("panel and routing", () => {
  it("serves the panel in the contract shape with the audit trail newest first", async () => {
    const sb = await createSandbox();
    await pendingRequest(sb.sandboxId);
    const res = await call(
      `/api/sandboxes/${sb.sandboxId}/customers/${ACME}/panel`
    );
    expect(res.status).toBe(200);
    const panel = PanelResponseSchema.parse(await res.json());
    expect(panel.sandboxId).toBe(sb.sandboxId);
    expect(panel.currentInvoice.period).toBe("2026-09");
    const seqs = panel.audit.map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(panel.audit[0].action).toBe("memo_pending");
    expect(panel.creditRequests).toHaveLength(2);
  });

  it("rejects unknown routes and methods with the contract 404", async () => {
    const sb = await createSandbox();
    for (const [method, path] of [
      ["GET", "/api/sandboxes"],
      ["DELETE", `/api/sandboxes/${sb.sandboxId}/customers/${ACME}/panel`],
      ["GET", `/api/sandboxes/${sb.sandboxId}/customers/${ACME}/turn`],
      ["GET", "/api/other"],
      ["GET", "/agents/billing-agent"]
    ] as const) {
      const res = await call(path, { method });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect((await errorOf(res)).code).toBe("not_found");
    }
  });

  it("applies the per-IP rate limiter before any Durable Object call", async () => {
    const ip = freshIp();
    const path = `/api/sandboxes/${"0".repeat(32)}/customers/${ACME}/panel`;
    // The limiter counts in fixed 60-second windows, so a run that crosses a window boundary
    // gets up to 60 more; what must hold is no 429 before 60 requests and a 429 after them.
    let first429 = -1;
    for (let i = 0; i < 125 && first429 < 0; i++) {
      const status = (await call(path, { ip })).status;
      if (status === 429) first429 = i;
      else expect(status, `request ${i}`).toBe(404);
    }
    expect(first429).toBeGreaterThanOrEqual(60);
    const limited = await call("/api/sandboxes", { method: "POST", ip });
    expect(limited.status).toBe(429);
    expect((await errorOf(limited)).code).toBe("rate_limited");
    // The health probe is exempt and never touches a Durable Object or the model.
    expect((await call("/api/health", { ip })).status).toBe(200);
  });

  it("accepts a WebSocket upgrade on the agent route for an admitted sandbox and customer", async () => {
    const sb = await createSandbox();
    const res = await call(`/agents/billing-agent/${sb.sandboxId}.${ACME}`, {
      headers: { Upgrade: "websocket" }
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });
});
