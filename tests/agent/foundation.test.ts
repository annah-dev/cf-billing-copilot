// Foundation smoke test: the Worker boots in workerd with every binding from wrangler.jsonc.
// The agent lane keeps this file passing and adds its own tests beside it.
import { env, exports } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MODEL_ID } from "../../src/contracts";

describe("foundation bindings", () => {
  it("serves /api/health with the pinned model id", async () => {
    const res = await exports.default.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, model: MODEL_ID });
  });

  it("answers unknown API routes with the contract error shape", async () => {
    const res = await exports.default.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Not found" }
    });
  });

  it.each([
    "/agents/ledger/x",
    "/agents/quota/global",
    "/agents/LEDGER/x",
    "/agents/billing-agent"
  ])("refuses to route %s to a Durable Object", async (path) => {
    const res = await exports.default.fetch(`https://example.com${path}`);
    expect(res.status).toBe(404);
  });

  it("exposes the cloudflare:test Workflow helpers to the agent lane", () => {
    expect(typeof introspectWorkflowInstance).toBe("function");
  });

  it("fails any global fetch instead of reaching the network", async () => {
    await expect(fetch("https://example.com")).rejects.toThrow(
      /Network access is disabled/
    );
  });

  it("binds the Ledger and Quota Durable Objects", async () => {
    const ledger = env.LEDGER.get(env.LEDGER.idFromName("0".repeat(32)));
    const quota = env.QUOTA.get(env.QUOTA.idFromName("global"));
    expect(await ledger.ping()).toBe("ledger");
    expect(await quota.ping()).toBe("quota");
  });

  it("binds the credit Workflow, the rate limiter and the AI binding", () => {
    expect(typeof env.CREDIT_WORKFLOW.create).toBe("function");
    expect(typeof env.RATE_LIMITER.limit).toBe("function");
    expect(env.AI).toBeDefined();
  });
});
