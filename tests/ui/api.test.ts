import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiError,
  adminLink,
  apiMode,
  awaitingWorkflow,
  createApi,
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
