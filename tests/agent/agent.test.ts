// BillingAgent with a stubbed AI binding: the same onChatMessage path the chat uses, driven through
// POST .../turn. No test reaches Workers AI (tests/setup/no-network.ts, stubAi).
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import type { ModelMessage, UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ErrorResponseSchema, TOOL_NAMES } from "../../src/contracts";
import {
  settleUnansweredApprovals,
  trimHistory
} from "../../src/agent/history";
import { buildTools, type ToolHost } from "../../src/agent/tools";
import { ACME, DUP_ENTRY, INV_SEP } from "./support/fake-engine";
import {
  countRows,
  createSandbox,
  ledgerOf,
  quota,
  stubAi,
  text,
  toolCall,
  turn
} from "./support/helpers";

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
  usage: { inputTokens: number; outputTokens: number; modelCalls: number };
};

async function turnOk(sandboxId: string, message: string): Promise<TurnBody> {
  const res = await turn(sandboxId, ACME, message);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as TurnBody;
}

function agentOf(sandboxId: string) {
  return getAgentByName(env.BillingAgent, `${sandboxId}.${ACME}`);
}

async function setUsedNeurons(neurons: number): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  return runInDurableObject(quota(), (_i, s) => {
    const row = s.storage.sql
      .exec<{
        count: number;
      }>(
        "SELECT count FROM counters WHERE name = 'neurons_used' AND day = ?",
        day
      )
      .toArray()[0];
    s.storage.sql.exec(
      "INSERT INTO counters (name, day, count) VALUES ('neurons_used', ?, ?) ON CONFLICT (name, day) DO UPDATE SET count = excluded.count",
      day,
      neurons
    );
    return row?.count ?? 0;
  });
}

describe("tool calls", () => {
  it("exposes exactly the eight contract tools", () => {
    const tools = buildTools({} as ToolHost, new Map(), {
      confirmCredit: true
    });
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("rejects bad tool input with zod before any tool runs or writes", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getInvoice", { period: "September" }),
      toolCall("getInvoice", { period: "2026-09", invoiceId: INV_SEP }),
      toolCall("startCreditRequest", { invoiceId: "INV-9", reason: "twice" }),
      text("I could not find that invoice.")
    ]);
    const body = await turnOk(sb.sandboxId, "Explain September");
    expect(ai).toHaveBeenCalledTimes(4);
    expect(body.toolCalls.map((c) => c.name)).toEqual([
      "getInvoice",
      "getInvoice",
      "startCreditRequest"
    ]);
    for (const c of body.toolCalls) {
      expect(c.output).toBeNull();
      expect(c.error).toMatch(
        /^Invalid input for tool \w+: Type validation failed/
      );
    }
    expect(await countRows(sb.sandboxId, "credit_requests")).toBe(1); // the seeded one only
  });

  it("serves identical calls within a turn from the per-turn cache", async () => {
    const account = vi.fn(async () => ({
      ok: true as const,
      value: {
        customerId: ACME,
        customerName: "Acme",
        plan: { planId: "plan_starter", name: "Starter" },
        availablePlans: [],
        balance: { cents: 100, display: "$1.00" },
        invoices: [],
        openCreditRequests: []
      }
    }));
    const host = {
      sandboxId: "0".repeat(32),
      customerId: ACME,
      ledger: { account },
      startCreditRequest: vi.fn(),
      remember: vi.fn()
    } as unknown as ToolHost;
    const cache = new Map<string, unknown>();
    const tools = buildTools(host, cache, { confirmCredit: false });
    const run = (
      tools.getAccount as {
        execute: (i: unknown, o: unknown) => Promise<unknown>;
      }
    ).execute;
    const a = await run({}, {});
    const b = await run({}, {});
    expect(b).toEqual(a);
    expect(account).toHaveBeenCalledTimes(1);
    // A fresh turn has a fresh cache.
    const next = buildTools(host, new Map(), { confirmCredit: false });
    await (
      next.getAccount as {
        execute: (i: unknown, o: unknown) => Promise<unknown>;
      }
    ).execute({}, {});
    expect(account).toHaveBeenCalledTimes(2);
  });

  it("rejects a tool output that does not match its contract schema", async () => {
    const host = {
      sandboxId: "0".repeat(32),
      customerId: ACME,
      ledger: {
        account: async () => ({
          ok: true,
          value: {
            customerId: ACME,
            balance: { cents: 41287, display: "412.87" }
          }
        })
      },
      startCreditRequest: vi.fn(),
      remember: vi.fn()
    } as unknown as ToolHost;
    const tools = buildTools(host, new Map(), { confirmCredit: false });
    await expect(
      (
        tools.getAccount as {
          execute: (i: unknown, o: unknown) => Promise<unknown>;
        }
      ).execute({}, {})
    ).rejects.toThrow(/could not be read/);
  });

  it("puts startCreditRequest behind customer confirmation in the chat, not in headless turns", () => {
    const chat = buildTools({} as ToolHost, new Map(), { confirmCredit: true });
    const headless = buildTools({} as ToolHost, new Map(), {
      confirmCredit: false
    });
    expect(chat.startCreditRequest.needsApproval).toBe(true);
    expect(headless.startCreditRequest.needsApproval).toBe(false);
    for (const name of TOOL_NAMES.filter((n) => n !== "startCreditRequest")) {
      expect(chat[name].needsApproval, name).toBeFalsy();
    }
  });

  it("returns Money with display strings so the model only copies", async () => {
    const sb = await createSandbox();
    stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      text("Your September bill is $412.87.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "Why is my September bill $412.87?"
    );
    const invoice = body.toolCalls[0].output as {
      total: { cents: number; display: string };
    };
    expect(invoice.total).toEqual({ cents: 41287, display: "$412.87" });
    expect(body.usage).toEqual({
      inputTokens: 1800,
      outputTokens: 100,
      modelCalls: 2
    });
  });
});

describe("caps without a model call", () => {
  it("answers the daily message cap with the fixed message and never calls the model", async () => {
    const sb = await createSandbox();
    const limit = Number(env.MESSAGES_PER_SANDBOX_DAY);
    await runInDurableObject(ledgerOf(sb.sandboxId), (_i, s) => {
      s.storage.sql.exec(
        "INSERT INTO counters (name, day, count) VALUES ('messages', ?, ?)",
        new Date().toISOString().slice(0, 10),
        limit
      );
    });
    const ai = stubAi([text("should not be used")]);
    const res = await turn(sb.sandboxId, ACME, "hello");
    expect(res.status).toBe(429);
    const error = ErrorResponseSchema.parse(await res.json()).error;
    expect(error.code).toBe("cap_reached");
    expect(error.cap).toMatchObject({ name: "messages", limit });
    expect(ai).not.toHaveBeenCalled();
    // The chat sees the same fixed text, naming the cap and the reset.
    const agent = await agentOf(sb.sandboxId);
    const messages = (await runInDurableObject(
      agent,
      (a) => a.messages
    )) as UIMessage[];
    const last = messages[messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(JSON.stringify(last.parts)).toMatch(
      /limit of 30 chat messages.*00:00 UTC/
    );
  });

  it("answers the neuron stop with budget_exhausted and never calls the model", async () => {
    const sb = await createSandbox();
    const previous = await setUsedNeurons(Number(env.NEURON_DAILY_STOP));
    try {
      const ai = stubAi([text("should not be used")]);
      const res = await turn(sb.sandboxId, ACME, "hello");
      expect(res.status).toBe(429);
      expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe(
        "budget_exhausted"
      );
      expect(ai).not.toHaveBeenCalled();
    } finally {
      await setUsedNeurons(previous);
    }
  });

  it("never lets concurrent turns near the neuron stop exceed it", async () => {
    const stop = Number(env.NEURON_DAILY_STOP);
    const sandboxes = await Promise.all(
      [1, 2, 3, 4, 5].map(() => createSandbox())
    );
    const previous = await setUsedNeurons(stop - 400);
    try {
      const ai = stubAi(
        sandboxes.map(() => ({
          response: "ok",
          usage: { prompt_tokens: 3000, completion_tokens: 512 }
        }))
      );
      const results = await Promise.all(
        sandboxes.map((sb) => turn(sb.sandboxId, ACME, "hi"))
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
      expect(statuses).toContain(429);
      const { used, reserved } = await quota().neuronsToday();
      expect(reserved).toBe(0);
      expect(used).toBeLessThanOrEqual(stop);
      expect(ai.mock.calls.length).toBe(
        statuses.filter((s) => s === 200).length
      );
    } finally {
      await setUsedNeurons(previous);
    }
  });
});

describe("memory and history", () => {
  it("remembers the account, earlier questions and credit requests across sessions", async () => {
    const sb = await createSandbox();
    stubAi([toolCall("getAccount", {}), text("You are on Starter.")]);
    await turnOk(sb.sandboxId, "Which plan am I on?");
    stubAi([
      toolCall("startCreditRequest", {
        invoiceId: INV_SEP,
        disputedLedgerEntryId: DUP_ENTRY,
        reason: "charged twice"
      }),
      text("Submitted.")
    ]);
    const credit = await turnOk(sb.sandboxId, "I was double-charged");
    const requestId = (
      credit.toolCalls[0].output as { request: { id: string } }
    ).request.id;

    const ai = stubAi([text("Welcome back.")]);
    await turnOk(sb.sandboxId, "Hello again");
    const inputs = ai.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const system =
      inputs.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("Acme Rockets (fictional)");
    expect(system).toContain("plan Starter");
    expect(system).toContain("Which plan am I on?");
    expect(system).toContain(requestId);
    // The conversation itself is persisted in the agent's SQLite.
    const agent = await agentOf(sb.sandboxId);
    const messages = (await runInDurableObject(
      agent,
      (a) => a.messages
    )) as UIMessage[];
    expect(messages.filter((m) => m.role === "user")).toHaveLength(3);
  });

  it("trims history to the token budget, starting at a user message", () => {
    const big = "x".repeat(3000);
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 40; i++) {
      messages.push({ role: "user", content: `question ${i} ${big}` });
      messages.push({ role: "assistant", content: `answer ${i} ${big}` });
    }
    const trimmed = trimHistory(messages, 12_000);
    const tokens = Math.ceil(JSON.stringify(trimmed).length / 3);
    expect(tokens).toBeLessThanOrEqual(12_100);
    expect(trimmed[0].role).toBe("user");
    expect(trimmed[trimmed.length - 1]).toEqual(messages[messages.length - 1]);
    expect(trimmed.length).toBeLessThan(messages.length);
  });

  it("closes an unanswered credit confirmation as denied when the customer moves on", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-startCreditRequest",
            toolCallId: "t1",
            state: "approval-requested",
            input: { invoiceId: INV_SEP, reason: "x" },
            approval: { id: "ap1" }
          }
        ]
      }
    ] as unknown as UIMessage[];
    const [settled] = settleUnansweredApprovals(messages);
    expect(settled.parts[0]).toMatchObject({
      state: "output-denied",
      approval: { id: "ap1", approved: false }
    });
  });

  it("deletes the agent's storage after the idle period and keeps an active one", async () => {
    const sb = await createSandbox();
    stubAi([text("hi")]);
    await turnOk(sb.sandboxId, "hello");
    const agent = await agentOf(sb.sandboxId);
    const scheduled = await runInDurableObject(agent, (a) =>
      a.getSchedules().map((s) => s.callback)
    );
    expect(scheduled).toContain("idleSweep");

    // Active: the sweep re-arms instead of deleting.
    await runInDurableObject(agent, async (a) => a.idleSweep());
    expect(
      ((await runInDurableObject(agent, (a) => a.messages)) as UIMessage[])
        .length
    ).toBe(2);

    // Idle: last activity older than the idle period. destroy() wipes storage, then aborts the
    // instance on the next tick, so the storage is read in the same call.
    const tables = await runInDurableObject(agent, async (a, state) => {
      state.storage.sql.exec(
        "UPDATE billing_memory SET value = '0' WHERE key = 'last_activity_at'"
      );
      await a.idleSweep();
      return state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
        .toArray()
        .map((r) => r.name)
        .filter((n) => n === "billing_memory" || n.startsWith("cf_ai_chat"));
    });
    expect(tables).toEqual([]);
  });
});
