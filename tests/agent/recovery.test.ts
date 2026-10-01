// Fixes for the failures the evals attributed to the agent (evals/results/README.md, failure
// analysis): each describe block names the eval question it comes from. No test reaches Workers AI.
import { describe, expect, it, vi } from "vitest";
import {
  AWAITING_CONFIRMATION,
  MAX_STEPS
} from "../../src/agent/billing-agent";
import { ANSWER_NOW, INCOMPLETE_ANSWER } from "../../src/agent/guard";
import { ACME, INV_AUG, INV_SEP } from "./support/fake-engine";
import { createSandbox, stubAi, text, toolCall, turn } from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine
}));

type TurnBody = {
  text: string;
  toolCalls: {
    name: string;
    input: unknown;
    output: unknown;
    error: string | null;
  }[];
  usage: { modelCalls: number };
};

async function turnOk(sandboxId: string, message: string): Promise<TurnBody> {
  const res = await turn(sandboxId, ACME, message);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as TurnBody;
}

describe("invented invoice and line ids (request-tiers, tax-line)", () => {
  it("names the customer's real invoice ids when the model invents one", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("explainLineItem", {
        invoiceId: "inv_1234567890",
        lineId: "line_1234567890"
      }),
      text("I could not find it.")
    ]);
    const body = await turnOk(sb.sandboxId, "Explain the requests line");
    const [failed] = body.toolCalls;
    expect(failed.output).toBeNull();
    expect(failed.error).toContain("No invoice inv_1234567890");
    expect(failed.error).toContain(`${INV_SEP} (2026-09)`);
    expect(failed.error).toContain(`${INV_AUG} (2026-08)`);
    expect(failed.error).toContain("getInvoice");
  });

  it("names the invoice's real line ids when the model invents a line", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("explainLineItem", {
        invoiceId: INV_SEP,
        lineId: "line_1234567890"
      }),
      toolCall("explainLineItem", {
        invoiceId: INV_SEP,
        lineId: "line_acme_2026_09_req"
      }),
      text("Explained.")
    ]);
    const body = await turnOk(sb.sandboxId, "Explain the requests line");
    expect(body.toolCalls[0].error).toContain(
      "line_acme_2026_09_req (usage line)"
    );
    // The listed id is what the model needs to recover on its next step.
    expect(JSON.stringify(ai.mock.calls[1][1])).toContain(
      "line_acme_2026_09_req (usage line)"
    );
    expect(body.toolCalls[1].error).toBeNull();
    expect(body.toolCalls[1].output).toMatchObject({ invoiceId: INV_SEP });
  });

  it("tells the model to look up the invoice before explaining a line", async () => {
    const { systemPrompt, EMPTY_MEMORY } =
      await import("../../src/agent/prompt");
    expect(systemPrompt(EMPTY_MEMORY, "2026-10-01")).toContain(
      "call getInvoice for its period first, then explainLineItem with the invoice id and line id exactly as getInvoice returned them"
    );
  });
});

describe("plan ids in display case (pro-simulation, scale-simulation)", () => {
  it("maps plan_Pro to the customer's plan_pro and runs the simulation", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("simulatePlan", { period: "2026-09", planId: "plan_Pro" }),
      text("On Pro it would be $350.00.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "What would September cost on Pro?"
    );
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolCalls[0].input).toEqual({
      period: "2026-09",
      planId: "plan_pro"
    });
    expect(body.toolCalls[0].error).toBeNull();
    expect(body.toolCalls[0].output).toMatchObject({
      simulatedPlanId: "plan_pro",
      simulatedTotal: { display: "$350.00" }
    });
    expect(body.text).toBe("On Pro it would be $350.00.");
  });

  it("maps a bare plan name too", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("simulatePlan", { period: "2026-09", planId: "Pro" }),
      text("Done.")
    ]);
    const body = await turnOk(sb.sandboxId, "What about Pro?");
    expect(body.toolCalls[0].input).toEqual({
      period: "2026-09",
      planId: "plan_pro"
    });
    expect(body.toolCalls[0].error).toBeNull();
  });

  it("leaves a plan the customer cannot choose as a validation error", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("simulatePlan", {
        period: "2026-09",
        planId: "plan_Enterprise"
      }),
      text("I could not simulate that plan.")
    ]);
    const body = await turnOk(sb.sandboxId, "What about Enterprise?");
    expect(body.toolCalls[0].output).toBeNull();
    expect(body.toolCalls[0].error).toMatch(
      /^Invalid input for tool simulatePlan/
    );
  });

  it("matches only one plan, ignoring case, spaces and the plan_ prefix", async () => {
    const { matchPlanId } = await import("../../src/agent/repair");
    const plans = [
      { planId: "plan_pro", name: "Pro" },
      { planId: "plan_pro_plus", name: "Pro Plus" }
    ];
    expect(matchPlanId("plan_Pro", plans)).toBe("plan_pro");
    expect(matchPlanId("Pro Plus", plans)).toBe("plan_pro_plus");
    expect(matchPlanId("plan_Pro_Plus", plans)).toBe("plan_pro_plus");
    expect(matchPlanId("plan_Scale", plans)).toBeNull();
    expect(
      matchPlanId("pro", [...plans, { planId: "plan_x", name: "PRO" }])
    ).toBeNull();
  });
});

describe("spike missing from a comparison (august-september-change)", () => {
  it("runs the server's anomaly check for both compared months and shows it to the model", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("compareInvoices", {
        fromPeriod: "2026-08",
        toPeriod: "2026-09"
      }),
      text("Your bill rose 38%; note the spike on 2026-09-18.")
    ]);
    const body = await turnOk(sb.sandboxId, "Why did my bill change?");
    expect(ai).toHaveBeenCalledTimes(2); // no extra model call
    const checks = body.toolCalls.filter((c) => c.name === "detectAnomalies");
    expect(checks.map((c) => c.input)).toEqual([
      { period: "2026-09" },
      { period: "2026-08" }
    ]);
    expect(checks.every((c) => c.error === null)).toBe(true);
    const seen = JSON.stringify(ai.mock.calls[1][1]);
    expect(seen).toContain("2026-09-18");
    expect(seen).toContain("5.00x");
    expect(body.text).toBe("Your bill rose 38%; note the spike on 2026-09-18.");
  });
});

describe("empty answers after spent steps (remember-credit)", () => {
  const toolsSent = (ai: ReturnType<typeof stubAi>, n: number) =>
    ((ai.mock.calls[n][1] as { tools?: unknown[] }).tools ?? []).length;

  it("takes the tools away after the model repeats a call, so it answers", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getCreditRequestStatus", {}),
      toolCall("getCreditRequestStatus", {}),
      text("Your request has expired.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "What is my credit request status?"
    );
    expect(ai).toHaveBeenCalledTimes(3);
    expect(toolsSent(ai, 0)).toBeGreaterThan(0);
    expect(toolsSent(ai, 1)).toBeGreaterThan(0);
    expect(toolsSent(ai, 2)).toBe(0);
    expect(body.text).toBe("Your request has expired.");
  });

  it("gives the last allowed step no tools", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getAccount", {}),
      toolCall("getInvoice", { period: "2026-08" }),
      toolCall("getCreditRequestStatus", {}),
      text("Done.")
    ]);
    await turnOk(sb.sandboxId, "Tell me everything");
    expect(ai).toHaveBeenCalledTimes(MAX_STEPS);
    for (let n = 0; n < MAX_STEPS - 1; n += 1) {
      expect(toolsSent(ai, n)).toBeGreaterThan(0);
    }
    expect(toolsSent(ai, MAX_STEPS - 1)).toBe(0);
  });

  it("asks once for the answer when the draft is empty, and sends it", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getCreditRequestStatus", {}),
      text(""),
      text("Your earlier request expired.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "What is my credit request status?"
    );
    expect(ai).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(ai.mock.calls[2][1])).toContain(ANSWER_NOW);
    expect(toolsSent(ai, 2)).toBe(0);
    expect(body.text).toBe("Your earlier request expired.");
  });

  it("says the answer is incomplete when the retry is empty too", async () => {
    const sb = await createSandbox();
    stubAi([toolCall("getCreditRequestStatus", {}), text(""), text("")]);
    const body = await turnOk(
      sb.sandboxId,
      "What is my credit request status?"
    );
    expect(body.text).toBe(INCOMPLETE_ANSWER);
  });

  it("does not ask for an answer while a credit proposal awaits confirmation", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("startCreditRequest", {
        invoiceId: INV_SEP,
        reason: "Charged twice"
      })
    ]);
    const body = await turnOk(sb.sandboxId, "I was charged twice in September");
    expect(ai).toHaveBeenCalledTimes(1);
    expect(body.text).toBe("");
    expect(body.toolCalls[0].error).toBe(AWAITING_CONFIRMATION);
  });
});

describe("counts that do not match the listed entries (september-invoice)", () => {
  it("tells the model to count the entries a tool result lists", async () => {
    const { systemPrompt, EMPTY_MEMORY } =
      await import("../../src/agent/prompt");
    expect(systemPrompt(EMPTY_MEMORY, "2026-10-01")).toContain(
      "A count (lines, invoices, tiers) is the number of entries the tool result lists"
    );
  });
});
