// The chat channel itself: the Agents SDK WebSocket protocol that useAgentChat speaks. A credit
// request proposed by the model waits for the customer's confirmation (needsApproval) and nothing
// is written until the customer approves.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ACME, DUP_ENTRY, INV_SEP } from "./support/fake-engine";
import {
  call,
  countRows,
  createSandbox,
  requestIdFor,
  stubAi,
  text,
  toolCall
} from "./support/helpers";

vi.mock("../../src/engine", async () => ({
  engine: (await import("./support/fake-engine")).fakeEngine
}));

type Frame = { type: string; id?: string; done?: boolean; body?: string };

async function connect(sandboxId: string) {
  const res = await call(`/agents/billing-agent/${sandboxId}.${ACME}`, {
    headers: { Upgrade: "websocket" }
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket as WebSocket;
  ws.accept();
  const frames: Frame[] = [];
  const waiters: { test: (f: Frame) => boolean; resolve: () => void }[] = [];
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    frames.push(frame);
    for (const w of [...waiters]) {
      if (w.test(frame)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  });
  const until = (test: (f: Frame) => boolean, label: string) =>
    new Promise<void>((resolve, reject) => {
      if (frames.some(test)) return resolve();
      const timer = setTimeout(
        () => reject(new Error(`timeout: ${label}`)),
        4000
      );
      waiters.push({
        test,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  return { ws, frames, until };
}

function chatRequest(id: string, message: string) {
  const user: UIMessage = {
    id: `u_${id}`,
    role: "user",
    parts: [{ type: "text", text: message }]
  };
  return JSON.stringify({
    type: "cf_agent_use_chat_request",
    id,
    init: {
      method: "POST",
      body: JSON.stringify({ messages: [user], trigger: "submit-message" })
    }
  });
}

const responseDone = (f: Frame) =>
  f.type === "cf_agent_use_chat_response" && f.done === true;

async function creditPart(sandboxId: string) {
  const agent = await getAgentByName(env.BillingAgent, `${sandboxId}.${ACME}`);
  const messages = (await runInDurableObject(
    agent,
    (a) => a.messages
  )) as UIMessage[];
  const part = messages
    .flatMap((m) => m.parts)
    .find((p) => p.type === "tool-startCreditRequest") as
    | {
        toolCallId: string;
        state: string;
        output?: { request: { id: string } };
      }
    | undefined;
  if (!part) throw new Error("no startCreditRequest part");
  return part;
}

describe("chat channel (WebSocket)", () => {
  it("waits for the customer's confirmation before recording a credit request", async () => {
    const sb = await createSandbox();
    const { ws, frames, until } = await connect(sb.sandboxId);
    const claim = {
      invoiceId: INV_SEP,
      disputedLedgerEntryId: DUP_ENTRY,
      reason: "charged twice"
    };
    const ai = stubAi([toolCall("startCreditRequest", claim)]);
    ws.send(chatRequest("r1", "I was double-charged in September"));
    await until(responseDone, "first response");
    expect(ai).toHaveBeenCalledTimes(1);

    const proposed = await creditPart(sb.sandboxId);
    expect(proposed.state).toBe("approval-requested");
    expect(await countRows(sb.sandboxId, "credit_requests")).toBe(1); // seeded only

    stubAi([text("Your request is recorded; an approver will review it.")]);
    const before = frames.length;
    ws.send(
      JSON.stringify({
        type: "cf_agent_tool_approval",
        toolCallId: proposed.toolCallId,
        approved: true,
        autoContinue: true
      })
    );
    await until(
      (f) => responseDone(f) && frames.indexOf(f) >= before,
      "continuation response"
    );
    const confirmed = await creditPart(sb.sandboxId);
    expect(confirmed.state).toBe("output-available");
    const rid = await requestIdFor(sb.sandboxId, ACME, INV_SEP, DUP_ENTRY);
    expect(confirmed.output?.request.id).toBe(rid);
    expect(
      await countRows(sb.sandboxId, "credit_requests", `id = '${rid}'`)
    ).toBe(1);
    expect(
      (await (await env.CREDIT_WORKFLOW.get(rid)).status()).status
    ).toBeDefined();
    ws.close();
  });

  it("records nothing when the customer declines", async () => {
    const sb = await createSandbox();
    const { ws, frames, until } = await connect(sb.sandboxId);
    stubAi([
      toolCall("startCreditRequest", {
        invoiceId: INV_SEP,
        reason: "charged twice"
      })
    ]);
    ws.send(chatRequest("r1", "I was double-charged"));
    await until(responseDone, "first response");
    const proposed = await creditPart(sb.sandboxId);
    stubAi([text("Okay, I did not submit it.")]);
    const before = frames.length;
    ws.send(
      JSON.stringify({
        type: "cf_agent_tool_approval",
        toolCallId: proposed.toolCallId,
        approved: false,
        autoContinue: true
      })
    );
    await until(
      (f) => responseDone(f) && frames.indexOf(f) >= before,
      "continuation response"
    );
    expect((await creditPart(sb.sandboxId)).state).toBe("output-denied");
    expect(await countRows(sb.sandboxId, "credit_requests")).toBe(1);
    ws.close();
  });
});
