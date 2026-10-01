// The runtime grounding guard (src/agent/grounding.ts, src/agent/guard.ts): every money amount,
// percentage, count and other number in a reply must come from that turn's tool results; dates and
// billing periods may also come from the customer's message. An unsupported draft gets one
// corrective retry, then a safe answer. No test reaches Workers AI (stubAi).
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { money } from "../../src/contracts";
import {
  collectEvidence,
  unsupportedFigures,
  withoutUnsupported
} from "../../src/agent/grounding";
import {
  OMITTED_NOTE,
  SAFE_ANSWER,
  correctionPrompt,
  type GroundingRecord
} from "../../src/agent/guard";
import { ACME, INV_SEP } from "./support/fake-engine";
import {
  call,
  createSandbox,
  stubAi,
  text,
  toolCall,
  turn
} from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine
}));

// The fake engine's September invoice for Acme: three lines totalling $412.87, a spike on
// 2026-09-18 (5.00x) from the server's anomaly check.
const SEP_TOTAL = "$412.87";

type TurnBody = {
  text: string;
  toolCalls: { name: string; output: unknown; error: string | null }[];
  usage: { modelCalls: number };
};

async function turnOk(sandboxId: string, message: string): Promise<TurnBody> {
  const res = await turn(sandboxId, ACME, message);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as TurnBody;
}

/** The guard outcome recorded on the turn's assistant message. */
async function groundingOf(sandboxId: string): Promise<GroundingRecord> {
  const agent = await getAgentByName(env.BillingAgent, `${sandboxId}.${ACME}`);
  const messages = (await runInDurableObject(
    agent,
    (a) => a.messages
  )) as UIMessage[];
  const last = messages.filter((m) => m.role === "assistant").at(-1);
  return (last?.metadata as { grounding: GroundingRecord }).grounding;
}

/** What the stubbed binding received on its nth call (0-based). */
function modelInput(ai: ReturnType<typeof stubAi>, n: number) {
  return ai.mock.calls[n][1] as {
    messages: { role: string; content: unknown }[];
    tools?: unknown[];
  };
}

describe("grounding rule", () => {
  const invoice = {
    id: INV_SEP,
    period: "2026-09",
    issuedOn: "2026-09-28",
    lines: [
      { id: "l1", amount: money(2000) },
      { id: "l2", amount: money(37534) },
      { id: "l3", amount: money(1753) }
    ],
    total: money(41287)
  };
  const comparison = {
    fromTotal: money(29918),
    toTotal: money(41287),
    totalChange: { basisPoints: 3762, display: "38%" }
  };

  it("accepts amounts, percentages and counts copied from the tool results", () => {
    const evidence = collectEvidence(
      [invoice, comparison],
      "Why did it go up?"
    );
    expect(
      unsupportedFigures(
        "Your September 2026 invoice has 3 lines and totals $412.87, up 38% from $299.18. The first line is $20.00.",
        evidence
      )
    ).toEqual([]);
  });

  it("rejects a count that does not match what the tool listed, in digits or words", () => {
    const evidence = collectEvidence([invoice], "Explain my bill");
    expect(unsupportedFigures("It has 4 lines.", evidence)).toEqual([
      "4 lines",
      "4"
    ]);
    expect(unsupportedFigures("It has seven invoice lines.", evidence)).toEqual(
      ["7 lines", "7"]
    );
  });

  it("rejects money and percentages that only the customer said", () => {
    const evidence = collectEvidence(
      [invoice],
      "Is my bill $999.00, 50% more than August?"
    );
    expect(
      unsupportedFigures("Yes, $999.00 is 50% more than August.", evidence)
    ).toEqual(["$999.00", "50%"]);
  });

  it("accepts dates and periods from the customer's message, not from nowhere", () => {
    const evidence = collectEvidence(
      [],
      "What happened on 2026-07-04 and in August 2026?"
    );
    expect(
      unsupportedFigures(
        "I have no data for 2026-07-04 or for August 2026.",
        evidence
      )
    ).toEqual([]);
    expect(
      unsupportedFigures("Your next invoice is due on 2026-10-28.", evidence)
    ).toEqual(["2026-10-28"]);
  });

  it("does not ground a figure in machine fields such as basis points", () => {
    const evidence = collectEvidence([comparison], "Why?");
    expect(
      unsupportedFigures("The change is 3762 basis points.", evidence)
    ).toEqual(["3762"]);
  });

  it("drops only the sentences that carry an unsupported figure", () => {
    const evidence = collectEvidence([invoice], "Explain my bill");
    expect(
      withoutUnsupported(
        `Your bill is ${SEP_TOTAL}. It has 7 lines.\nTax is $17.53. You saved $50.00.`,
        evidence
      )
    ).toBe(`Your bill is ${SEP_TOTAL}.\nTax is $17.53.`);
  });

  it("names every unsupported figure in the correction", () => {
    expect(correctionPrompt(["4 lines", "$9.99"])).toContain(
      'stated "4 lines", "$9.99"'
    );
  });
});

describe("grounding guard on a turn", () => {
  it("sends a grounded reply unchanged without an extra model call", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      text(`Your September bill is ${SEP_TOTAL} across 3 lines.`)
    ]);
    const body = await turnOk(sb.sandboxId, "Explain my September bill");
    expect(ai).toHaveBeenCalledTimes(2);
    expect(body.text).toBe(
      `Your September bill is ${SEP_TOTAL} across 3 lines.`
    );
    expect(await groundingOf(sb.sandboxId)).toEqual({
      outcome: "grounded",
      unsupported: [],
      retryUnsupported: null
    });
  });

  it("retries once with a correction naming the figure, and sends the corrected reply", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      text(`Your September bill is ${SEP_TOTAL} across 4 lines.`),
      text(`Your September bill is ${SEP_TOTAL} across 3 lines.`)
    ]);
    const body = await turnOk(sb.sandboxId, "Explain my September bill");
    expect(ai).toHaveBeenCalledTimes(3);
    expect(body.usage.modelCalls).toBe(3);
    expect(body.text).toBe(
      `Your September bill is ${SEP_TOTAL} across 3 lines.`
    );
    expect(body.text).not.toContain("4 lines");

    // The retry sees the turn's tool results and the correction, and gets no tools.
    const retry = modelInput(ai, 2);
    const seen = JSON.stringify(retry.messages);
    expect(seen).toContain(INV_SEP);
    expect(seen).toContain("2026-09-18"); // the server's anomaly check is in its context
    expect(JSON.stringify(retry.messages.at(-1))).toContain(
      'stated \\"4 lines\\"'
    );
    expect(retry.tools ?? []).toEqual([]);

    expect(await groundingOf(sb.sandboxId)).toEqual({
      outcome: "corrected",
      unsupported: ["4 lines", "4"],
      retryUnsupported: []
    });
  });

  it("sends a safe answer without the figure when the retry is still unsupported", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      text(`Your September bill is ${SEP_TOTAL}. It has 4 lines.`),
      text(`Your September bill is ${SEP_TOTAL}. It has 5 lines.`)
    ]);
    const body = await turnOk(sb.sandboxId, "Explain my September bill");
    expect(body.text).toBe(
      `Your September bill is ${SEP_TOTAL}.\n\n${OMITTED_NOTE}`
    );
    expect(await groundingOf(sb.sandboxId)).toEqual({
      outcome: "safe_answer",
      unsupported: ["4 lines", "4"],
      retryUnsupported: ["5 lines", "5"]
    });
  });

  it("sends the fixed safe answer when nothing in the reply can be verified", async () => {
    const sb = await createSandbox();
    stubAi([text("Your bill is $999.00."), text("Your bill is $998.00.")]);
    const body = await turnOk(sb.sandboxId, "How much is my bill?");
    expect(body.text).toBe(SAFE_ANSWER);
    expect(body.text).not.toMatch(/\d/);
    expect((await groundingOf(sb.sandboxId)).outcome).toBe("safe_answer");
  });

  it("does not accept money the customer typed as grounding", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      text("Yes, your bill is $999.00."),
      text("I need to look up your invoice before I can confirm an amount.")
    ]);
    const body = await turnOk(sb.sandboxId, "Is my bill $999.00?");
    expect(ai).toHaveBeenCalledTimes(2);
    expect(body.text).toBe(
      "I need to look up your invoice before I can confirm an amount."
    );
  });

  it("accepts a period the customer named without a tool call", async () => {
    const sb = await createSandbox();
    const ai = stubAi([text("I have no invoice for 2026-12 yet.")]);
    const body = await turnOk(sb.sandboxId, "Show my 2026-12 invoice");
    expect(ai).toHaveBeenCalledTimes(1);
    expect(body.text).toBe("I have no invoice for 2026-12 yet.");
  });

  it("never streams the unsupported draft to a chat client", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      text("DRAFT has 4 lines."),
      text(`Your bill is ${SEP_TOTAL}.`)
    ]);
    const res = await call(`/agents/billing-agent/${sb.sandboxId}.${ACME}`, {
      headers: { Upgrade: "websocket" }
    });
    const ws = res.webSocket as WebSocket;
    ws.accept();
    const frames: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 4000);
      ws.addEventListener("message", (event) => {
        frames.push(String(event.data));
        const f = JSON.parse(String(event.data)) as {
          type: string;
          done?: boolean;
        };
        if (f.type === "cf_agent_use_chat_response" && f.done) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const user: UIMessage = {
      id: "u_g1",
      role: "user",
      parts: [{ type: "text", text: "Explain my September bill" }]
    };
    ws.send(
      JSON.stringify({
        type: "cf_agent_use_chat_request",
        id: "g1",
        init: {
          method: "POST",
          body: JSON.stringify({ messages: [user], trigger: "submit-message" })
        }
      })
    );
    await done;
    ws.close();
    const all = frames.join("\n");
    expect(all).toContain(SEP_TOTAL);
    expect(all).not.toContain("DRAFT");
  });
});
