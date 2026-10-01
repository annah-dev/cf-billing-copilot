import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiError,
  adminLink,
  apiMode,
  awaitingWorkflow,
  createApi,
  followUpCreditRequest,
  CREDIT_FOLLOW_UP_DELAYS_MS,
  followUpDecision,
  serialQueue,
  parseAdminFragment,
  readSession,
  saveSession,
  SESSION_KEY
} from "../../src/ui/api";
import { fixturePanel, fixtureSession } from "../../src/ui/fixtures";
import { describeError } from "../../src/ui/errors";
import { ErrorCodeSchema } from "../../src/contracts/http";

import { memoryStorage } from "./storage";
describe("HTTP boundary", () => {
  it("rejects a malformed success payload instead of rendering it", async () => {
    const session = fixtureSession();
    const panel = fixturePanel(session, session.customers[0].customerId);
    panel.currentInvoice.total = { cents: 41287, display: "$1.00" };
    const api = createApi(async () => Response.json(panel));
    await expect(
      api.panel(session.sandboxId, panel.customerId)
    ).rejects.toBeInstanceOf(z.ZodError);
  });
  it("rejects a valid panel for a different sandbox or customer", async () => {
    const session = fixtureSession();
    const panel = fixturePanel(session, session.customers[0].customerId);
    const api = createApi(async () => Response.json(panel));
    await expect(api.panel("f".repeat(32), panel.customerId)).rejects.toThrow(
      "another account"
    );
    await expect(api.panel(session.sandboxId, "cus_other")).rejects.toThrow(
      "another account"
    );
  });
  it("validates ids before transport and rejects empty decision reasons", async () => {
    let calls = 0;
    const api = createApi(async () => {
      calls++;
      return Response.json({});
    });
    await expect(api.panel("bad", "cus_nimbus")).rejects.toBeInstanceOf(
      z.ZodError
    );
    await expect(
      api.decide("f".repeat(32), "token", "cr_one", {
        decision: "reject",
        reason: "  "
      })
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(calls).toBe(0);
  });
  it("sends token only in the bearer header and trims the decision reason", async () => {
    const session = fixtureSession();
    let sentPath = "";
    let sentInit: RequestInit | undefined;
    const api = createApi(async (path, init) => {
      sentPath = path;
      sentInit = init;
      return Response.json(
        { error: { code: "conflict", message: "Already decided" } },
        { status: 409 }
      );
    });
    await expect(
      api.decide(session.sandboxId, session.approverToken, "cr_one", {
        decision: "approve",
        reason: " verified duplicate "
      })
    ).rejects.toBeInstanceOf(ApiError);
    expect(sentPath).not.toContain(session.approverToken);
    expect(new Headers(sentInit?.headers).get("Authorization")).toBe(
      `Bearer ${session.approverToken}`
    );
    expect(JSON.parse(String(sentInit?.body))).toEqual({
      decision: "approve",
      reason: "verified duplicate"
    });
  });
});
describe("sandbox persistence and approval links", () => {
  it("round-trips a validated session and replaces it on reset", () => {
    const storage = memoryStorage();
    const first = fixtureSession();
    const next = fixtureSession();
    expect(saveSession(storage, first)).toBe(true);
    expect(readSession(storage)).toEqual(first);
    saveSession(storage, next);
    expect(readSession(storage)).toEqual(next);
    expect(next.sandboxId).not.toBe(first.sandboxId);
  });
  it("keeps fixture and live sessions separate", () => {
    const storage = memoryStorage();
    const fixture = fixtureSession();
    const live = fixtureSession();
    saveSession(storage, fixture, "fixture");
    expect(readSession(storage, "live")).toBeNull();
    saveSession(storage, live, "live");
    expect(readSession(storage, "live")).toEqual(live);
    expect(readSession(storage, "fixture")).toEqual(fixture);
  });
  it("ignores sessions from the old hand-made preview", () => {
    const storage = memoryStorage();
    storage.setItem(
      "billing-copilot.session.v1.fixture",
      JSON.stringify(fixtureSession())
    );
    expect(readSession(storage, "fixture")).toBeNull();
  });
  it("handles blocked storage, corrupt JSON and invalid stored tokens", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    expect(readSession(blocked)).toBeNull();
    expect(saveSession(blocked, fixtureSession())).toBe(false);
    expect(readSession(null)).toBeNull();
    expect(saveSession(null, fixtureSession())).toBe(false);
    const storage = memoryStorage();
    storage.setItem(SESSION_KEY, "bad json");
    expect(readSession(storage)).toBeNull();
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...fixtureSession(), approverToken: "bad" })
    );
    expect(readSession(storage)).toBeNull();
  });
  it("places sandbox and token in the fragment, never the query", () => {
    const session = fixtureSession();
    const url = new URL(adminLink(session), "https://example.test");
    expect(url.pathname).toBe("/admin");
    expect(url.search).toBe("");
    expect(parseAdminFragment(url.hash)).toEqual({
      sandboxId: session.sandboxId,
      token: session.approverToken
    });
    expect(parseAdminFragment("")).toBeNull();
    expect(() => parseAdminFragment("#token=bad")).toThrow();
  });
});
describe("error presentation", () => {
  it.each(ErrorCodeSchema.options)(
    "gives %s a distinct state with the server message",
    (code) => {
      const result = describeError(
        new ApiError({
          error: {
            code,
            message: "Server explanation",
            cap: {
              name: "Daily messages",
              limit: 30,
              resetsAt: "2026-09-30T00:00:00Z"
            }
          }
        })
      );
      expect(result.code).toBe(code);
      expect(result.title).not.toBe("Unable to connect");
      expect(result.message).toBe("Server explanation");
      expect(result.detail).toContain("Daily messages: 30");
      expect(result.detail).toContain("Wed, 30 Sep 2026 00:00:00 GMT");
    }
  );
  it("handles SDK JSON errors, a rate window and unstructured network failures", () => {
    expect(
      describeError(
        new Error(
          JSON.stringify({
            error: { code: "budget_exhausted", message: "Budget spent" }
          })
        )
      ).title
    ).toContain("budget");
    expect(
      describeError({ error: { code: "rate_limited", message: "Slow down" } })
        .detail
    ).toContain("60 requests per 60 seconds");
    expect(describeError(new Error("network"))).toMatchObject({
      title: "Unable to connect",
      code: null
    });
  });
});

describe("backend mode", () => {
  it("talks to the live API in a production build by default", () => {
    expect(apiMode({ DEV: false })).toBe("live");
    expect(apiMode({ DEV: false, VITE_BILLING_API_MODE: "" })).toBe("live");
  });
  it("keeps the fixture preview on the dev server by default", () => {
    expect(apiMode({ DEV: true })).toBe("fixture");
  });
  it("lets VITE_BILLING_API_MODE override either default", () => {
    expect(apiMode({ DEV: true, VITE_BILLING_API_MODE: "live" })).toBe("live");
    expect(apiMode({ DEV: false, VITE_BILLING_API_MODE: "fixture" })).toBe(
      "fixture"
    );
    expect(apiMode({ DEV: false, VITE_BILLING_API_MODE: "preview" })).toBe(
      "live"
    );
  });
});

describe("admin follow-up after a decision", () => {
  const decision = {
    decision: "approve",
    reason: "verified",
    actor: "approver:x",
    at: "2026-10-01T00:00:00.000Z"
  };
  it("waits while the Workflow has not finished a decided request", () => {
    expect(awaitingWorkflow({ status: "approved", decision })).toBe(true);
    expect(awaitingWorkflow({ status: "pending_approval", decision })).toBe(
      true
    );
  });
  it("stops at a terminal state or when no decision is recorded", () => {
    for (const status of ["applied", "rejected", "expired"])
      expect(awaitingWorkflow({ status, decision })).toBe(false);
    expect(
      awaitingWorkflow({ status: "pending_approval", decision: null })
    ).toBe(false);
    expect(awaitingWorkflow({ status: "requested", decision: null })).toBe(
      false
    );
  });
});

describe("admin follow-up loop", () => {
  const decision = { decision: "approve" };
  const list = (status: string) => ({
    requests: [
      { id: "cr_1", status, decision },
      { id: "cr_other", status: "approved", decision }
    ]
  });
  function run(
    statuses: (string | null)[],
    {
      active = (): boolean => true,
      attempts = 5
    }: { active?: () => boolean; attempts?: number } = {}
  ) {
    const sleeps: number[] = [];
    let reads = 0;
    const done = followUpDecision({
      requestId: "cr_1",
      read: async () => {
        const status = statuses[Math.min(reads++, statuses.length - 1)];
        return status === null ? null : list(status);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      active,
      attempts,
      delayMs: 1000
    });
    return done.then((count) => ({ count, sleeps, reads }));
  }
  it("re-reads until the Workflow applies the credit, then stops", async () => {
    const r = await run(["approved", "approved", "applied", "applied"]);
    expect(r).toEqual({ count: 3, sleeps: [1000, 1000], reads: 3 });
  });
  it("reads once when the decision is already terminal", async () => {
    expect((await run(["rejected"])).count).toBe(1);
  });
  it("never makes more than one read plus the attempt limit", async () => {
    const r = await run(["approved"], { attempts: 5 });
    expect(r.count).toBe(6);
    expect(r.sleeps).toHaveLength(5);
  });
  it("stops after a failed read", async () => {
    expect((await run(["approved", null, "applied"])).count).toBe(2);
  });
  it("makes no read after the page unmounts during a delay", async () => {
    let alive = true;
    const r = await run(["approved", "approved", "applied"], {
      active: () => {
        const was = alive;
        alive = false;
        return was;
      }
    });
    expect(r.count).toBe(1);
    expect(r.reads).toBe(1);
  });
  it("ignores other requests that are still unfinished", async () => {
    expect((await run(["applied"])).count).toBe(1);
  });
});

describe("serial read queue", () => {
  it("never runs two reads at once and keeps call order", async () => {
    const enqueue = serialQueue();
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (n: number, ms: number) => () =>
      new Promise<number>((done) => {
        running++;
        peak = Math.max(peak, running);
        setTimeout(() => {
          running--;
          order.push(n);
          done(n);
        }, ms);
      });
    const results = await Promise.all([
      enqueue(task(1, 30)),
      enqueue(task(2, 5)),
      enqueue(task(3, 1))
    ]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
  });
  it("starts the next read after a failed one", async () => {
    const enqueue = serialQueue();
    const failed = enqueue(() => Promise.reject(new Error("network")));
    const next = enqueue(async () => "ok");
    await expect(failed).rejects.toThrow("network");
    await expect(next).resolves.toBe("ok");
  });
});

describe("panel follow-up after a credit confirmation", () => {
  const known = new Set(["cr_historical_expired"]);
  const panel = (...rows: [string, string][]) => ({
    creditRequests: [
      { id: "cr_historical_expired", status: "expired" },
      ...rows.map(([id, status]) => ({ id, status }))
    ]
  });
  function run(
    panels: (ReturnType<typeof panel> | null)[],
    active: () => boolean = () => true
  ) {
    const sleeps: number[] = [];
    let reads = 0;
    return followUpCreditRequest({
      known,
      read: async () => panels[Math.min(reads++, panels.length - 1)],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      active
    }).then((count) => ({ count, sleeps, reads }));
  }
  it("reads until the new request leaves requested, then stops", async () => {
    const r = await run([
      panel(),
      panel(["cr_new", "requested"]),
      panel(["cr_new", "pending_approval"]),
      panel(["cr_new", "pending_approval"])
    ]);
    expect(r.count).toBe(3);
    expect(r.sleeps).toEqual(CREDIT_FOLLOW_UP_DELAYS_MS.slice(0, 3));
  });
  it("makes at most five reads", async () => {
    expect(CREDIT_FOLLOW_UP_DELAYS_MS).toHaveLength(5);
    const r = await run([panel(["cr_new", "requested"])]);
    expect(r.count).toBe(5);
  });
  it("ignores requests that were already in the panel", async () => {
    // The historical expired request is known, so it never ends the follow-up on its own.
    expect((await run([panel()])).count).toBe(5);
  });
  it("stops after a failed read", async () => {
    expect(
      (await run([panel(), null, panel(["cr_new", "pending_approval"])])).count
    ).toBe(2);
  });
  it("makes no read after the page unmounts during a delay", async () => {
    const r = await run([panel(["cr_new", "pending_approval"])], () => false);
    expect(r.count).toBe(0);
    expect(r.reads).toBe(0);
  });
});
