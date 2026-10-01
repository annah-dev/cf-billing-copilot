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
