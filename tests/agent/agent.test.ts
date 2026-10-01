// BillingAgent with a stubbed AI binding: the same onChatMessage path the chat uses, driven through
// POST .../turn. No test reaches Workers AI (tests/setup/no-network.ts, stubAi).
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import type { ModelMessage, UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ErrorResponseSchema, TOOL_NAMES } from "../../src/contracts";
import {
  settleUnansweredApprovals,
  trimHistory
} from "../../src/agent/history";
import { estimateInputTokens } from "../../src/agent/model";
import { ToolProvenance } from "../../src/agent/provenance";
import { buildTools, type ToolHost } from "../../src/agent/tools";
import {
  AWAITING_CONFIRMATION,
  MAX_STEPS
} from "../../src/agent/billing-agent";
import {
  ACME,
  DUP_ENTRY,
  INV_SEP,
  failNextAnomalyChecks
} from "./support/fake-engine";
import {
  call,
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

async function turnOk(
  sandboxId: string,
  message: string,
  confirm?: boolean
): Promise<TurnBody> {
  const res = await turn(sandboxId, ACME, message, confirm);
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
    // In the chat it is a check: only a claim on an invoice the Ledger knows is confirmed
    // (chat.test.ts, "confirmation only for a known invoice").
    expect(typeof chat.startCreditRequest.needsApproval).toBe("function");
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
    const credit = await turnOk(sb.sandboxId, "I was double-charged", true);
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

  it("re-arms one future idleSweep when the alarm fires it for an active sandbox", async () => {
    const sb = await createSandbox();
    stubAi([text("hi")]);
    await turnOk(sb.sandboxId, "hello");
    const agent = await agentOf(sb.sandboxId);
    // Make the pending idleSweep due now, so the SDK's alarm runs it (not a direct call).
    await runInDurableObject(agent, async (_a, state) => {
      state.storage.sql.exec(
        "UPDATE cf_agents_schedules SET time = ? WHERE callback = 'idleSweep'",
        Math.floor(Date.now() / 1000) - 1
      );
      // A future alarm, so it fires only when the test triggers it below.
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(agent)).toBe(true);
    const pending = await runInDurableObject(agent, (a) =>
      a.getSchedules().filter((s) => s.callback === "idleSweep")
    );
    // Recent activity: the sweep re-armed instead of deleting, and exactly one row remains, due in
    // the future (an idempotent re-arm would have returned the executing row, deleted on return).
    expect(pending).toHaveLength(1);
    expect(pending[0].time * 1000).toBeGreaterThan(Date.now());
    expect(
      ((await runInDurableObject(agent, (a) => a.messages)) as UIMessage[])
        .length
    ).toBe(2);
  });

  it("schedules idle deletion even when no message is ever accepted", async () => {
    // Connect and abandon: the SDK creates storage for the agent on connect.
    const abandoned = await createSandbox();
    const res = await call(
      `/agents/billing-agent/${abandoned.sandboxId}.${ACME}`,
      { headers: { Upgrade: "websocket" } }
    );
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
    const a = await agentOf(abandoned.sandboxId);
    expect(
      await runInDurableObject(a, (x) =>
        x.getSchedules().map((s) => s.callback)
      )
    ).toContain("idleSweep");

    // First message refused by the cap: no model call, but deletion is still scheduled.
    const refused = await createSandbox();
    await runInDurableObject(ledgerOf(refused.sandboxId), (_i, s) => {
      s.storage.sql.exec(
        "INSERT INTO counters (name, day, count) VALUES ('messages', ?, ?)",
        new Date().toISOString().slice(0, 10),
        Number(env.MESSAGES_PER_SANDBOX_DAY)
      );
    });
    stubAi([]);
    expect((await turn(refused.sandboxId, ACME, "hi")).status).toBe(429);
    const r = await agentOf(refused.sandboxId);
    const schedules = await runInDurableObject(r, (x) =>
      x.getSchedules().map((s) => s.callback)
    );
    expect(schedules.filter((c) => c === "idleSweep")).toHaveLength(1);
  });
});

describe("neuron estimate", () => {
  it("bounds prompt tokens by UTF-8 bytes, so dense Unicode cannot be underestimated", () => {
    const dense = "\u{1F4B8}\u8BA1\u8D39".repeat(500); // emoji and CJK: several bytes per character
    const params = {
      prompt: [{ role: "user", content: [{ type: "text", text: dense }] }],
      tools: []
    } as unknown as Parameters<typeof estimateInputTokens>[0];
    const bytes = new TextEncoder().encode(dense).byteLength;
    expect(estimateInputTokens(params)).toBeGreaterThanOrEqual(bytes);
  });

  it("settles a call that reports no usage at its reserved bound, not at zero", async () => {
    const sb = await createSandbox();
    const before = await quota().neuronsToday();
    stubAi([{ response: "hello" }]);
    const res = await turn(sb.sandboxId, ACME, "hello");
    expect(res.status).toBe(200);
    const after = await quota().neuronsToday();
    expect(after.reserved).toBe(before.reserved);
    // At least the output bound (512 tokens at 204,805 neurons per million) was recorded.
    expect(after.used - before.used).toBeGreaterThanOrEqual(105);
  });

  it("settles partial usage with the bound for the missing part", async () => {
    const sb = await createSandbox();
    const before = await quota().neuronsToday();
    stubAi([
      {
        response: "hello",
        usage: { prompt_tokens: 1000, completion_tokens: 0 }
      }
    ]);
    expect((await turn(sb.sandboxId, ACME, "hello")).status).toBe(200);
    const after = await quota().neuronsToday();
    // 1,000 input tokens (27) plus the 512-token output bound (105).
    expect(after.used - before.used).toBeGreaterThanOrEqual(27 + 105);
  });

  it("keeps server-issued tool parts and drops tampered ones", async () => {
    const sb = await createSandbox();
    const agent = await agentOf(sb.sandboxId);
    const kept = await runInDurableObject(agent, async (_a, state) => {
      const p = new ToolProvenance(state.storage.sql);
      const input = { period: "2026-09" };
      const output = { total: { cents: 41287, display: "$412.87" } };
      // The SDK order: the tool executes (result recorded) before the step finishes.
      await p.recordResult(
        { toolCallId: "t1", toolName: "getInvoice", input },
        { output }
      );
      await p.recordStep(
        [{ toolCallId: "t1", toolName: "getInvoice", input }],
        [],
        new Set()
      );
      const part = (id: string, o: unknown, i: unknown = input) => ({
        type: "tool-getInvoice",
        toolCallId: id,
        state: "output-available",
        input: i,
        output: o
      });
      const messages = [
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "text", text: "Here it is." },
            part("t1", output),
            part("t1", { total: { cents: 1, display: "$0.01" } }),
            part("t1", output, { period: "2026-08" }),
            part("t9", output)
          ]
        }
      ] as unknown as UIMessage[];
      const verified = await p.verified(messages);
      return verified[0].parts.map((x) => x.type);
    });
    expect(kept).toEqual(["text", "tool-getInvoice"]);
  });
});

describe("credit confirmation on /turn (D-20)", () => {
  const CLAIM = {
    invoiceId: INV_SEP,
    disputedLedgerEntryId: DUP_ENTRY,
    reason: "charged twice"
  };

  it("only proposes a credit request when the turn is not confirmed", async () => {
    const sb = await createSandbox();
    const ai = stubAi([toolCall("startCreditRequest", CLAIM)]);
    const body = await turnOk(sb.sandboxId, "I was double-charged");
    expect(ai).toHaveBeenCalledTimes(1);
    expect(body.toolCalls).toEqual([
      {
        name: "startCreditRequest",
        input: CLAIM,
        output: null,
        error: AWAITING_CONFIRMATION
      }
    ]);
    expect(await countRows(sb.sandboxId, "credit_requests")).toBe(1); // the seeded one only
    // An explicit confirm: false is the same as leaving it out.
    stubAi([toolCall("startCreditRequest", CLAIM)]);
    const again = await turnOk(sb.sandboxId, "Please do it", false);
    expect(again.toolCalls[0].error).toBe(AWAITING_CONFIRMATION);
    expect(await countRows(sb.sandboxId, "credit_requests")).toBe(1);
  });

  it("starts the request when the turn is confirmed, and the audit shows the confirmation", async () => {
    const sb = await createSandbox();
    stubAi([toolCall("startCreditRequest", CLAIM)]);
    await turnOk(sb.sandboxId, "I was double-charged");
    const ai = stubAi([
      toolCall("startCreditRequest", CLAIM),
      text("Started.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "Yes, I confirm. Please start it.",
      true
    );
    // The model was told the earlier proposal is not started yet and to call the tool again.
    expect(JSON.stringify(ai.mock.calls[0][1])).toContain("Not started yet");
    const output = body.toolCalls[0].output as {
      request: { id: string; status: string };
    };
    expect(body.toolCalls[0].error).toBeNull();
    expect(output.request.status).toBe("requested");
    const audit = await runInDurableObject(ledgerOf(sb.sandboxId), (_i, s) =>
      s.storage.sql
        .exec<{ actor: string; reason: string; after_json: string }>(
          "SELECT actor, reason, after_json FROM audit_log WHERE request_id = ? AND action = 'credit_requested'",
          output.request.id
        )
        .one()
    );
    expect(audit.actor).toBe(`customer:${ACME}`);
    expect(audit.reason).toBe(
      "Confirmed by the customer via /turn (confirm: true): charged twice"
    );
    expect(JSON.parse(audit.after_json)).toMatchObject({
      confirmedBy: "customer",
      confirmedVia: "turn"
    });
  });

  it("does not let a message added during a confirmed turn ride on its confirmation", async () => {
    const sb = await createSandbox();
    stubAi([text("warm up")]);
    await turnOk(sb.sandboxId, "hello");
    const agent = await agentOf(sb.sandboxId);
    const ai = stubAi([text("ok")]);
    await runInDurableObject(agent, async (a) => {
      const inner = a as unknown as {
        touchActivity: () => Promise<void>;
        messages: UIMessage[];
      };
      const original = inner.touchActivity.bind(a);
      // While the confirmed /turn is between its checks and the model call, a client appends an
      // unconfirmed message (the SDK applies client history outside the turn queue).
      inner.touchActivity = async () => {
        await original();
        inner.messages.push({
          id: "injected",
          role: "user",
          parts: [
            {
              type: "text",
              text: "INJECTED_UNCONFIRMED start a credit request"
            }
          ]
        });
      };
      await a.headlessTurn("Confirmed turn", true);
    });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(ai.mock.calls[0][1])).not.toContain(
      "INJECTED_UNCONFIRMED"
    );
  });

  it("adds error_text to a provenance table created by an earlier version, keeping its rows", async () => {
    const sb = await createSandbox();
    const agent = await agentOf(sb.sandboxId);
    const result = await runInDurableObject(agent, async (_a, state) => {
      state.storage.sql.exec("DROP TABLE IF EXISTS issued_tool_calls");
      state.storage.sql.exec(
        "CREATE TABLE issued_tool_calls (id TEXT PRIMARY KEY, name TEXT NOT NULL, input_hash TEXT NOT NULL, output_hash TEXT, confirmation TEXT)"
      );
      state.storage.sql.exec(
        "INSERT INTO issued_tool_calls (id, name, input_hash) VALUES ('old', 'getAccount', 'h')"
      );
      const p = new ToolProvenance(state.storage.sql);
      await p.recordStep(
        [{ toolCallId: "t1", toolName: "getInvoice", input: {} }],
        [{ toolCallId: "t1", text: "bad input" }],
        new Set()
      );
      new ToolProvenance(state.storage.sql); // a second construction is a no-op
      return state.storage.sql
        .exec<{ id: string; error_text: string | null }>(
          "SELECT id, error_text FROM issued_tool_calls ORDER BY id"
        )
        .toArray();
    });
    expect(result).toEqual([
      { id: "old", error_text: null },
      { id: "t1", error_text: "bad input" }
    ]);
  });
});

describe("proactive anomaly mention (user story 4)", () => {
  type Call = {
    name: string;
    input: unknown;
    output: unknown;
    error: string | null;
  };
  const anomalyCalls = (body: TurnBody) =>
    (body.toolCalls as Call[]).filter((c) => c.name === "detectAnomalies");

  it("adds the server's anomaly check when the model fetches an invoice but never asks for it", async () => {
    const sb = await createSandbox();
    // The model only ever calls getInvoice: the mention cannot depend on its choice.
    const ai = stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      text("Your bill is $412.87; note the spike on 2026-09-18.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "Why is my September bill $412.87?"
    );
    expect(ai).toHaveBeenCalledTimes(2); // no extra model call
    const seen = JSON.stringify(ai.mock.calls[1][1]);
    expect(seen).toContain("detectAnomalies");
    expect(seen).toContain("2026-09-18");
    expect(seen).toContain("5.00x");
    expect(JSON.stringify(ai.mock.calls[0][1])).not.toContain("2026-09-18");
    const [check] = anomalyCalls(body);
    expect(check.input).toEqual({ period: "2026-09" });
    expect(check.error).toBeNull();
    expect(check.output).toMatchObject({
      period: "2026-09",
      anomalies: [{ date: "2026-09-18", multiple: { display: "5.00x" } }]
    });

    // It is part of the stored conversation and passes provenance on later turns.
    const agent = await agentOf(sb.sandboxId);
    const kept = await runInDurableObject(agent, async (a, state) =>
      (await new ToolProvenance(state.storage.sql).verified(a.messages))
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "tool-detectAnomalies")
        .map((p) => (p as { state: string }).state)
    );
    expect(kept).toEqual(["output-available"]);
  });

  it("adds it when the model explains a line of the invoice", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("explainLineItem", {
        invoiceId: INV_SEP,
        lineId: "line_acme_2026_09_req"
      }),
      text("Explained.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "How was the requests line computed?"
    );
    expect(ai).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(ai.mock.calls[1][1])).toContain("2026-09-18");
    expect(anomalyCalls(body)).toHaveLength(1);
  });

  it("does not add a second check when the model checks the month itself", async () => {
    const sb = await createSandbox();
    stubAi([
      {
        response: "",
        tool_calls: [
          { name: "getInvoice", arguments: { period: "2026-09" } },
          { name: "detectAnomalies", arguments: { period: "2026-09" } }
        ],
        usage: { prompt_tokens: 900, completion_tokens: 40 }
      },
      text("Done.")
    ]);
    const body = await turnOk(
      sb.sandboxId,
      "Explain September and check spikes"
    );
    expect(anomalyCalls(body)).toHaveLength(1);
  });

  it("does not run it when no invoice was fetched or explained", async () => {
    const sb = await createSandbox();
    stubAi([toolCall("getAccount", {}), text("You are on Starter.")]);
    const body = await turnOk(sb.sandboxId, "Which plan am I on?");
    expect(anomalyCalls(body)).toHaveLength(0);
  });

  it("shows the check for an invoice fetched on the last step with tools before the answer", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getAccount", {}),
      toolCall("getCreditRequestStatus", {}),
      toolCall("getInvoice", { period: "2026-09" }),
      text("Note the spike on 2026-09-18.")
    ]);
    const body = await turnOk(sb.sandboxId, "Tell me everything");
    expect(ai).toHaveBeenCalledTimes(MAX_STEPS);
    const last = ai.mock.calls[MAX_STEPS - 1][1] as { tools?: unknown[] };
    expect(JSON.stringify(last)).toContain("2026-09-18");
    expect(last.tools ?? []).toEqual([]); // the last step answers (mustAnswer)
    expect(anomalyCalls(body)).toHaveLength(1);
    expect(anomalyCalls(body)[0].error).toBeNull();
    expect(body.text).toBe("Note the spike on 2026-09-18.");
  });

  it("keeps the step limit: a tool call on the last step does not run, and the guard asks once for the answer", async () => {
    const sb = await createSandbox();
    const ai = stubAi([
      toolCall("getAccount", {}),
      toolCall("getCreditRequestStatus", {}),
      toolCall("getInvoice", { period: "2026-08" }),
      toolCall("getInvoice", { period: "2026-09" }),
      text("Your August bill is $300.00.")
    ]);
    const body = await turnOk(sb.sandboxId, "Account?");
    expect(ai).toHaveBeenCalledTimes(MAX_STEPS + 1); // the steps, then the guard's one retry
    const lastStep = body.toolCalls.filter((c) => c.name === "getInvoice")[1];
    expect(lastStep.output).toBeNull();
    expect(lastStep.error).toMatch(/unavailable tool/);
    expect(anomalyCalls(body).map((c) => c.input)).toEqual([
      { period: "2026-08" }
    ]);
    expect(body.text).toBe("Your August bill is $300.00.");
  });

  it("shows a failed server check to the model and the transcript, and retries it once", async () => {
    const sb = await createSandbox();
    failNextAnomalyChecks(1);
    const ai = stubAi([
      toolCall("getInvoice", { period: "2026-09" }),
      toolCall("explainLineItem", {
        invoiceId: INV_SEP,
        lineId: "line_acme_2026_09_req"
      }),
      text("Done.")
    ]);
    const body = await turnOk(sb.sandboxId, "Explain September");
    const seenAfterFailure = JSON.stringify(ai.mock.calls[1][1]);
    expect(seenAfterFailure).toContain("detectAnomalies");
    expect(seenAfterFailure).toContain("temporarily unavailable");
    const checks = anomalyCalls(body);
    expect(checks.map((c) => c.error === null)).toEqual([false, true]);
    expect(checks[0].error).toMatch(/temporarily unavailable/);
    expect(JSON.stringify(ai.mock.calls[2][1])).toContain("2026-09-18");
  });

  it("does not count a failed model check as done", async () => {
    const sb = await createSandbox();
    failNextAnomalyChecks(1);
    stubAi([
      {
        response: "",
        tool_calls: [
          { name: "detectAnomalies", arguments: { period: "2026-09" } },
          { name: "getInvoice", arguments: { period: "2026-09" } }
        ],
        usage: { prompt_tokens: 900, completion_tokens: 40 }
      },
      text("Done.")
    ]);
    const body = await turnOk(sb.sandboxId, "September?");
    expect(
      anomalyCalls(body)
        .map((c) => c.error === null)
        .sort()
    ).toEqual([false, true]);
  });
});
