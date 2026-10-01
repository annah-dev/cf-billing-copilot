// Shared helpers for the agent lane's Workers tests. Every request carries its own random
// CF-Connecting-IP, so the per-IP rate limiter and sandbox cap never couple two tests.
import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import {
  CreateSandboxResponseSchema,
  type CreateSandboxResponse
} from "../../../src/contracts";
import { creditIdempotencyKey } from "../../../src/agent/tools";

export const BASE = "https://copilot.test";

let ipCounter = 0;
export function freshIp(): string {
  ipCounter += 1;
  const r = Math.floor(Math.random() * 250);
  return `10.${r}.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export function call(
  path: string,
  init: RequestInit & { ip?: string; token?: string } = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", init.ip ?? freshIp());
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return exports.default.fetch(`${BASE}${path}`, { ...init, headers });
}

export async function createSandbox(
  ip?: string
): Promise<CreateSandboxResponse> {
  const res = await call("/api/sandboxes", { method: "POST", ip });
  if (res.status !== 201) {
    throw new Error(
      `sandbox creation failed: ${res.status} ${await res.text()}`
    );
  }
  return CreateSandboxResponseSchema.parse(await res.json());
}

export function ledgerOf(sandboxId: string) {
  return env.LEDGER.get(env.LEDGER.idFromName(sandboxId));
}

export function quota() {
  return env.QUOTA.get(env.QUOTA.idFromName("global"));
}

/** The request id the Ledger derives for a claim (cr_ + first 24 hex of the idempotency key). */
export async function requestIdFor(
  sandboxId: string,
  customerId: string,
  invoiceId: string,
  disputed: string | null
): Promise<string> {
  const key = await creditIdempotencyKey(
    sandboxId,
    customerId,
    invoiceId,
    disputed
  );
  return `cr_${key.slice(0, 24)}`;
}

export function idempotencyKey(
  sandboxId: string,
  customerId: string,
  invoiceId: string,
  disputed: string | null
): Promise<string> {
  return creditIdempotencyKey(sandboxId, customerId, invoiceId, disputed);
}

/** A scripted Workers AI reply in the binding's own shape (what workers-ai-provider parses). */
export type AiReply = {
  response?: string;
  tool_calls?: { name: string; arguments: Record<string, unknown> | string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
};

export const text = (response: string): AiReply => ({
  response,
  usage: { prompt_tokens: 900, completion_tokens: 60 }
});

export const toolCall = (
  name: string,
  args: Record<string, unknown> | string
): AiReply => ({
  response: "",
  tool_calls: [{ name, arguments: args }],
  usage: { prompt_tokens: 900, completion_tokens: 40 }
});

/**
 * Replace the AI binding's run() for this test. Replies are served in order; running out fails
 * the call loudly. Returns the mock so tests can count model calls. Nothing reaches Workers AI.
 */
export function stubAi(replies: AiReply[]) {
  const queue = [...replies];
  const run = vi.fn(async (_model: string, inputs: unknown) => {
    // The real binding refuses an empty tool list (Workers AI error 8007, seen in local dev).
    const tools = (inputs as { tools?: unknown[] } | undefined)?.tools;
    if (Array.isArray(tools) && tools.length === 0) {
      throw new Error("stubbed AI: 8007 `tools` must not be an empty array");
    }
    const next = queue.shift();
    if (!next) throw new Error("stubbed AI: no scripted reply left");
    return next;
  });
  (env.AI as unknown as { run: typeof run }).run = run;
  return run;
}

export async function turn(
  sandboxId: string,
  customerId: string,
  message: string,
  confirm?: boolean
): Promise<Response> {
  return call(`/api/sandboxes/${sandboxId}/customers/${customerId}/turn`, {
    method: "POST",
    body: JSON.stringify(
      confirm === undefined ? { message } : { message, confirm }
    )
  });
}

export async function decide(
  sandboxId: string,
  requestId: string,
  token: string,
  decision: "approve" | "reject",
  reason = "Checked the duplicate posting"
): Promise<Response> {
  return call(
    `/api/sandboxes/${sandboxId}/admin/credit-requests/${requestId}/decision`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ decision, reason })
    }
  );
}

type LedgerClass = import("../../../src/ledger/ledger").Ledger;

/** Audit actions of one request, oldest first (through the Ledger's read used by the status tool). */
export async function auditActions(
  sandboxId: string,
  customerId: string,
  requestId: string
): Promise<string[]> {
  const result = (await ledgerOf(sandboxId).creditStatus(
    customerId,
    requestId
  )) as ReturnType<LedgerClass["creditStatus"]>;
  if (!result.ok) throw new Error(result.message);
  return result.value.requests[0].audit.map((a) => a.action);
}

export async function requestOf(
  sandboxId: string,
  customerId: string,
  requestId: string
) {
  const result = (await ledgerOf(sandboxId).panel(customerId)) as ReturnType<
    LedgerClass["panel"]
  >;
  if (!result.ok) throw new Error(result.message);
  const request = result.value.creditRequests.find((r) => r.id === requestId);
  if (!request) throw new Error(`no request ${requestId}`);
  return { request, panel: result.value };
}

/** Rows in a Ledger table, read inside the Durable Object. */
export async function countRows(
  sandboxId: string,
  table: string,
  where = "1 = 1"
): Promise<number> {
  const { runInDurableObject } = await import("cloudflare:test");
  return runInDurableObject(ledgerOf(sandboxId), (_i, state) => {
    return state.storage.sql
      .exec<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
      .one().n;
  });
}
