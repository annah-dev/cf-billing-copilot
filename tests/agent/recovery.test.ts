// Fixes for the failures the evals attributed to the agent (evals/results/README.md, failure
// analysis): each describe block names the eval question it comes from. No test reaches Workers AI.
import { describe, expect, it, vi } from "vitest";
import { ACME, INV_AUG, INV_SEP } from "./support/fake-engine";
import { createSandbox, stubAi, text, toolCall, turn } from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine,
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
        lineId: "line_1234567890",
      }),
      text("I could not find it."),
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
        lineId: "line_1234567890",
      }),
      toolCall("explainLineItem", {
        invoiceId: INV_SEP,
        lineId: "line_acme_2026_09_req",
      }),
      text("Explained."),
    ]);
    const body = await turnOk(sb.sandboxId, "Explain the requests line");
    expect(body.toolCalls[0].error).toContain(
      "line_acme_2026_09_req (usage line)",
    );
    // The listed id is what the model needs to recover on its next step.
    expect(JSON.stringify(ai.mock.calls[1][1])).toContain(
      "line_acme_2026_09_req (usage line)",
    );
    expect(body.toolCalls[1].error).toBeNull();
    expect(body.toolCalls[1].output).toMatchObject({ invoiceId: INV_SEP });
  });

  it("tells the model to look up the invoice before explaining a line", async () => {
    const { systemPrompt, EMPTY_MEMORY } =
      await import("../../src/agent/prompt");
    expect(systemPrompt(EMPTY_MEMORY, "2026-10-01")).toContain(
      "call getInvoice for its period first, then explainLineItem with the invoice id and line id exactly as getInvoice returned them",
    );
  });
});

describe("plan ids in display case (pro-simulation, scale-simulation)", () => {
  it("maps plan_Pro to the customer's plan_pro and runs the simulation", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("simulatePlan", { period: "2026-09", planId: "plan_Pro" }),
      text("On Pro it would be $350.00."),
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "What would September cost on Pro?",
    );
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolCalls[0].input).toEqual({
      period: "2026-09",
      planId: "plan_pro",
    });
    expect(body.toolCalls[0].error).toBeNull();
    expect(body.toolCalls[0].output).toMatchObject({
      simulatedPlanId: "plan_pro",
      simulatedTotal: { display: "$350.00" },
    });
    expect(body.text).toBe("On Pro it would be $350.00.");
  });

  it("maps a bare plan name too", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("simulatePlan", { period: "2026-09", planId: "Pro" }),
      text("Done."),
    ]);
    const body = await turnOk(sb.sandboxId, "What about Pro?");
    expect(body.toolCalls[0].input).toEqual({
      period: "2026-09",
      planId: "plan_pro",
    });
    expect(body.toolCalls[0].error).toBeNull();
  });

  it("leaves a plan the customer cannot choose as a validation error", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("simulatePlan", {
        period: "2026-09",
        planId: "plan_Enterprise",
      }),
      text("I could not simulate that plan."),
    ]);
    const body = await turnOk(sb.sandboxId, "What about Enterprise?");
    expect(body.toolCalls[0].output).toBeNull();
    expect(body.toolCalls[0].error).toMatch(
      /^Invalid input for tool simulatePlan/,
    );
  });

  it("matches only one plan, ignoring case, spaces and the plan_ prefix", async () => {
    const { matchPlanId } = await import("../../src/agent/repair");
    const plans = [
      { planId: "plan_pro", name: "Pro" },
      { planId: "plan_pro_plus", name: "Pro Plus" },
    ];
    expect(matchPlanId("plan_Pro", plans)).toBe("plan_pro");
    expect(matchPlanId("Pro Plus", plans)).toBe("plan_pro_plus");
    expect(matchPlanId("plan_Pro_Plus", plans)).toBe("plan_pro_plus");
    expect(matchPlanId("plan_Scale", plans)).toBeNull();
    expect(
      matchPlanId("pro", [...plans, { planId: "plan_x", name: "PRO" }]),
    ).toBeNull();
  });
});

describe("spike missing from a comparison (august-september-change)", () => {
  it("runs the server's anomaly check for both compared months and shows it to the model", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("compareInvoices", {
        fromPeriod: "2026-08",
        toPeriod: "2026-09",
      }),
      text("Your bill rose 38%; note the spike on 2026-09-18."),
    ]);
    const body = await turnOk(sb.sandboxId, "Why did my bill change?");
    expect(ai).toHaveBeenCalledTimes(2); // no extra model call
    const checks = body.toolCalls.filter((c) => c.name === "detectAnomalies");
    expect(checks.map((c) => c.input)).toEqual([
      { period: "2026-09" },
      { period: "2026-08" },
    ]);
    expect(checks.every((c) => c.error === null)).toBe(true);
    const seen = JSON.stringify(ai.mock.calls[1][1]);
    expect(seen).toContain("2026-09-18");
    expect(seen).toContain("5.00x");
    expect(body.text).toBe("Your bill rose 38%; note the spike on 2026-09-18.");
  });
});
