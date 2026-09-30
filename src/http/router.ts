// The Worker's HTTP surface (docs/ARCHITECTURE.md, "HTTP surface"; shapes in src/contracts/http.ts).
// Order for every /api/* and /agents/* request: the per-IP RATE_LIMITER first (D-13), before any
// Durable Object is touched; then admission in the sandbox's Ledger (well-formed ids, admitted
// sandbox, seeded customer, approver token, daily API cap), which writes nothing when it refuses.
import { getAgentByName, routeAgentRequest } from "agents";
import {
  AdminCreditRequestsResponseSchema,
  AgentInstanceNameSchema,
  CreateSandboxResponseSchema,
  CreditRequestIdSchema,
  CustomerIdSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  MODEL_ID,
  PanelResponseSchema,
  SandboxIdSchema,
  TurnRequestSchema,
  TurnResponseSchema,
  type Actor
} from "../contracts";
import type { BillingAgent } from "../agent/billing-agent";
import type { Ledger } from "../ledger/ledger";
import { QUOTA_NAME } from "../quota/quota";
import {
  getConfig,
  randomBase64Url,
  randomHex,
  sha256Hex,
  utcDay
} from "./config";
import { errorResponse, notFound, refusal, type Refusal } from "./errors";

const AGENT_PREFIX = "/agents/billing-agent/";
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

function ledgerFor(env: Env, sandboxId: string) {
  return env.LEDGER.get(env.LEDGER.idFromName(sandboxId));
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function badRequest(message: string): Response {
  return errorResponse(refusal(400, "invalid_request", message));
}

/** Copy an RPC refusal into a plain object (RPC results carry a disposer). */
function plainRefusal(r: Refusal): Refusal {
  return refusal(r.status, r.code, r.message, r.cap);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (_err) {
    return undefined;
  }
}

/** Admission for a sandbox-scoped request. Returns null when admitted. */
async function admit(
  env: Env,
  sandboxId: string,
  scope: { customerId?: string; tokenHash?: string }
): Promise<Refusal | null> {
  if (!SandboxIdSchema.safeParse(sandboxId).success) {
    return refusal(404, "not_found", "Not found");
  }
  if (
    scope.customerId !== undefined &&
    !CustomerIdSchema.safeParse(scope.customerId).success
  ) {
    return refusal(404, "not_found", "Not found");
  }
  const result = await ledgerFor(env, sandboxId).gate(scope);
  return result.ok ? null : plainRefusal(result);
}

/** Bearer approver token -> its SHA-256 (only the hash is ever compared or stored, D-4). */
async function approverTokenHash(request: Request): Promise<string | null> {
  const match = BEARER.exec(request.headers.get("Authorization") ?? "");
  return match ? sha256Hex(match[1]) : null;
}

async function createSandbox(request: Request, env: Env): Promise<Response> {
  const config = getConfig(env);
  const ipHash = await sha256Hex(`${utcDay(Date.now())}|${clientIp(request)}`);
  const quota = env.QUOTA.get(env.QUOTA.idFromName(QUOTA_NAME));
  const admitted = await quota.admitSandbox({
    ipHash,
    perIp: config.SANDBOXES_PER_DAY_PER_IP,
    global: config.SANDBOXES_PER_DAY_GLOBAL
  });
  if (!admitted.ok) return errorResponse(plainRefusal(admitted));
  const sandboxId = randomHex(16);
  const approverToken = randomBase64Url(32);
  const seeded = await ledgerFor(env, sandboxId).seed({
    sandboxId,
    tokenHash: await sha256Hex(approverToken)
  });
  if (!seeded.ok) return errorResponse(plainRefusal(seeded));
  const body = CreateSandboxResponseSchema.parse({
    sandboxId,
    approverToken,
    customers: seeded.customers,
    createdAt: seeded.createdAt,
    idleDeletionDays: config.SANDBOX_IDLE_DAYS
  });
  return Response.json(body, {
    status: 201,
    headers: { "Cache-Control": "no-store" }
  });
}

async function panel(
  env: Env,
  sandboxId: string,
  customerId: string
): Promise<Response> {
  const refused = await admit(env, sandboxId, { customerId });
  if (refused) return errorResponse(refused);
  // RPC typing turns `unknown` fields into never; use the method's own return type.
  const result = (await ledgerFor(env, sandboxId).panel(
    customerId
  )) as ReturnType<Ledger["panel"]>;
  if (!result.ok) return errorResponse(plainRefusal(result));
  return Response.json(
    PanelResponseSchema.parse({ sandboxId, ...result.value })
  );
}

async function adminList(
  request: Request,
  env: Env,
  sandboxId: string
): Promise<Response> {
  const tokenHash = await approverTokenHash(request);
  const refused = tokenHash
    ? await admit(env, sandboxId, { tokenHash })
    : refusal(401, "unauthorized", "Missing or wrong approver token");
  if (refused) return errorResponse(refused);
  const result = (await ledgerFor(env, sandboxId).adminList()) as ReturnType<
    Ledger["adminList"]
  >;
  if (!result.ok) return errorResponse(plainRefusal(result));
  return Response.json(
    AdminCreditRequestsResponseSchema.parse({
      sandboxId,
      requests: result.value
    })
  );
}

async function decide(
  request: Request,
  env: Env,
  sandboxId: string,
  requestId: string
): Promise<Response> {
  const tokenHash = await approverTokenHash(request);
  const refused = tokenHash
    ? await admit(env, sandboxId, { tokenHash })
    : refusal(401, "unauthorized", "Missing or wrong approver token");
  if (refused) return errorResponse(refused);
  if (!CreditRequestIdSchema.safeParse(requestId).success) return notFound();
  const body = DecisionRequestSchema.safeParse(await readJson(request));
  if (!body.success) {
    return badRequest("Expected { decision: approve | reject, reason }");
  }
  // The approver of this sandbox; demo-grade identity (D-4).
  const actor: Actor = `approver:${sandboxId}`;
  const result = await ledgerFor(env, sandboxId).recordDecision(
    requestId,
    body.data,
    actor
  );
  if (!result.ok) return errorResponse(plainRefusal(result));
  if (!result.alreadyRecorded) {
    // Wake the Workflow. If this event is lost, the Ledger's recovery resends it (D-12).
    try {
      const instance = await env.CREDIT_WORKFLOW.get(requestId);
      await instance.sendEvent({
        type: "approval",
        payload: {
          approved: body.data.decision === "approve",
          reason: body.data.reason
        }
      });
    } catch (err) {
      console.error("approval event not delivered; recovery will resend", err);
    }
  }
  return Response.json(
    DecisionResponseSchema.parse({
      request: result.request,
      alreadyRecorded: result.alreadyRecorded
    })
  );
}

async function turn(
  request: Request,
  env: Env,
  sandboxId: string,
  customerId: string
): Promise<Response> {
  const refused = await admit(env, sandboxId, { customerId });
  if (refused) return errorResponse(refused);
  const body = TurnRequestSchema.safeParse(await readJson(request));
  if (!body.success) {
    return badRequest("Expected { message } with 1 to 2000 characters");
  }
  const agent = await getAgentByName(
    env.BillingAgent,
    `${sandboxId}.${customerId}`
  );
  const result = (await agent.headlessTurn(
    body.data.message,
    body.data.confirm
  )) as Awaited<ReturnType<BillingAgent["headlessTurn"]>>;
  if (!result.ok) return errorResponse(plainRefusal(result));
  return Response.json(TurnResponseSchema.parse(result.turn));
}

/** Admission for the Agents SDK route, run by routeAgentRequest before the agent is reached. */
async function admitAgent(
  env: Env,
  name: string
): Promise<Response | undefined> {
  if (!AgentInstanceNameSchema.safeParse(name).success) return notFound();
  const dot = name.indexOf(".");
  const refused = await admit(env, name.slice(0, dot), {
    customerId: name.slice(dot + 1)
  });
  return refused ? errorResponse(refused) : undefined;
}

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/health") {
    // Readiness probe: touches no Durable Object and never calls the model.
    return Response.json({ ok: true, model: MODEL_ID });
  }
  const isAgent = path.startsWith("/agents/");
  if (!isAgent && !path.startsWith("/api/")) return notFound();

  const { success } = await env.RATE_LIMITER.limit({ key: clientIp(request) });
  if (!success) {
    return errorResponse(
      refusal(429, "rate_limited", "Too many requests; slow down.")
    );
  }

  if (isAgent) {
    // routeAgentRequest maps every Durable Object binding by name (LEDGER, QUOTA included),
    // so only the BillingAgent namespace may reach it (DECISIONS.md D-18).
    if (!path.startsWith(AGENT_PREFIX)) return notFound();
    const response = await routeAgentRequest(request, env, {
      onBeforeConnect: (_req, lobby) => admitAgent(env, lobby.name),
      onBeforeRequest: (_req, lobby) => admitAgent(env, lobby.name)
    });
    return response ?? notFound();
  }

  const parts = path.split("/").filter(Boolean); // ["api", "sandboxes", ...]
  const method = request.method;
  if (parts[1] !== "sandboxes") return notFound();
  if (parts.length === 2 && method === "POST") {
    return createSandbox(request, env);
  }
  const sandboxId = parts[2] ?? "";
  if (parts[3] === "customers" && parts.length === 6) {
    if (parts[5] === "panel" && method === "GET") {
      return panel(env, sandboxId, parts[4]);
    }
    if (parts[5] === "turn" && method === "POST") {
      return turn(request, env, sandboxId, parts[4]);
    }
  }
  if (parts[3] === "admin" && parts[4] === "credit-requests") {
    if (parts.length === 5 && method === "GET") {
      return adminList(request, env, sandboxId);
    }
    if (parts.length === 7 && parts[6] === "decision" && method === "POST") {
      return decide(request, env, sandboxId, parts[5]);
    }
  }
  return notFound();
}
