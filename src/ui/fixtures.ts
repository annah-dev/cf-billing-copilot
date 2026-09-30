import { z } from "zod";
import {
  CreateSandboxResponseSchema,
  PanelResponseSchema,
  AdminCreditRequestsResponseSchema,
  DecisionRequestSchema,
  type CreateSandboxResponse,
  type PanelResponse,
  type ErrorCode
} from "../contracts/http";
import { BillingDatasetSchema, type BillingDataset } from "../contracts/engine";
import {
  CreditRequestSchema,
  CreditMemoSchema,
  type CreditRequest,
  type Actor
} from "../contracts/credit";
import { LedgerEntrySchema } from "../contracts/billing";
import { type ToolInput, ToolSchemas } from "../contracts/tools";
import { engine } from "../engine";
import { fixtureAnswer } from "./messages";
import { type StoragePort, type Transport } from "./api";

// Data and monetary outputs come exclusively from the shared deterministic engine.
const seed = engine.seed();
export const fixtureCustomers = seed.customers.map(({ id, name }) => ({
  customerId: id,
  name
}));
function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}
export function fixtureSession(): CreateSandboxResponse {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const approverToken = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return CreateSandboxResponseSchema.parse({
    sandboxId: randomHex(16),
    approverToken,
    customers: fixtureCustomers,
    createdAt: new Date().toISOString(),
    idleDeletionDays: 7
  });
}
export function fixturePanel(
  session: CreateSandboxResponse,
  customerId: string,
  data: BillingDataset = engine.seed()
): PanelResponse {
  const customer = data.customers.find((item) => item.id === customerId);
  if (
    !customer ||
    !session.customers.some((item) => item.customerId === customerId)
  )
    throw new Error("Unknown fixture customer");
  const latest = data.invoices
    .filter((item) => item.customerId === customerId)
    .sort((a, b) => b.period.localeCompare(a.period))[0];
  if (!latest) throw new Error("Seed has no issued invoice for this customer");
  const subscription = data.subscriptions
    .filter(
      (item) =>
        item.customerId === customerId &&
        item.from <= latest.issuedOn &&
        (item.to === null || item.to > latest.issuedOn)
    )
    .sort((a, b) => b.from.localeCompare(a.from))[0];
  const plan = data.plans.find((item) => item.id === subscription?.planId);
  if (!plan) throw new Error("Seed has no current plan for this customer");
  const requests = data.creditRequests
    .filter((item) => item.customerId === customerId)
    .sort(
      (a, b) =>
        Number(b.status === "pending_approval") -
          Number(a.status === "pending_approval") ||
        b.createdAt.localeCompare(a.createdAt)
    );
  const subjects = new Set([
    session.sandboxId,
    ...requests.map((item) => item.id),
    ...data.creditMemos
      .filter((item) =>
        requests.some((request) => request.id === item.requestId)
      )
      .map((item) => item.id),
    ...data.ledger
      .filter((item) => item.customerId === customerId)
      .map((item) => item.id)
  ]);
  return PanelResponseSchema.parse({
    sandboxId: session.sandboxId,
    customerId,
    customerName: customer.name,
    plan: { planId: plan.id, name: plan.name },
    balance: engine.balance(data.ledger, customerId),
    currentInvoice: engine.buildInvoice(data, customerId, latest.period),
    creditRequests: requests,
    audit: data.audit
      .filter((record) => subjects.has(record.subject.id))
      .sort((a, b) => b.seq - a.seq)
  });
}
const FixtureWorldSchema = z.object({
  session: CreateSandboxResponseSchema,
  data: BillingDatasetSchema
});
type FixtureWorld = z.infer<typeof FixtureWorldSchema>;
export function createFixtureBackend(storage: StoragePort | null) {
  const cache = new Map<string, FixtureWorld>();
  const storageKey = (sandboxId: string) =>
    `billing-copilot.fixture.${seed.seedVersion}.${sandboxId}`;
  function persist(world: FixtureWorld) {
    const validated = FixtureWorldSchema.parse(world);
    cache.set(world.session.sandboxId, validated);
    try {
      storage?.setItem(
        storageKey(world.session.sandboxId),
        JSON.stringify(validated)
      );
    } catch {
      /* In-memory demo remains available. */
    }
  }
  function load(sandboxId: string): FixtureWorld | undefined {
    try {
      const raw = storage?.getItem(storageKey(sandboxId));
      if (raw) {
        const world = FixtureWorldSchema.parse(JSON.parse(raw));
        if (
          world.session.sandboxId !== sandboxId ||
          world.data.seedVersion !== seed.seedVersion
        )
          return undefined;
        cache.set(sandboxId, world);
        return world;
      }
    } catch {
      /* Fall back to this tab's validated data. */
    }
    return cache.get(sandboxId);
  }
  function audit(
    world: FixtureWorld,
    request: CreditRequest,
    action: BillingDataset["audit"][number]["action"],
    reason: string,
    actor: Actor,
    before: Record<string, unknown> | null = null,
    after: Record<string, unknown> | null = null
  ) {
    world.data.audit.push({
      seq: world.data.audit.length + 1,
      at: new Date().toISOString(),
      actor,
      action,
      subject: { type: "credit_request", id: request.id },
      reason,
      before,
      after
    });
  }
  const fail = (code: ErrorCode, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status });
  const transport: Transport = async (path, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (path === "/api/sandboxes" && init?.method === "POST") {
      const session = fixtureSession();
      const data = engine.seed();
      data.audit.push({
        seq: data.audit.length + 1,
        at: session.createdAt,
        actor: "system",
        action: "sandbox_created",
        subject: { type: "sandbox", id: session.sandboxId },
        reason: "Fresh engine seed created for this sandbox.",
        before: null,
        after: { seedVersion: data.seedVersion }
      });
      persist({ session, data });
      return Response.json(session);
    }
    const parts = path.split("/");
    const world = load(parts[3]);
    if (!world) return fail("not_found", "This demo sandbox has expired.", 404);
    if (parts[4] === "customers" && parts[6] === "panel") {
      if (!world.session.customers.some((item) => item.customerId === parts[5]))
        return fail("not_found", "Customer not found.", 404);
      return Response.json(fixturePanel(world.session, parts[5], world.data));
    }
    if (parts[4] === "admin") {
      if (
        new Headers(init?.headers).get("Authorization") !==
        `Bearer ${world.session.approverToken}`
      )
        return fail(
          "unauthorized",
          "The approver token is missing or invalid.",
          401
        );
      const requests = world.data.creditRequests.map((request) => ({
        ...request,
        customerName: world.data.customers.find(
          (item) => item.id === request.customerId
        )!.name
      }));
      if (parts[7] !== "decision")
        return Response.json(
          AdminCreditRequestsResponseSchema.parse({
            sandboxId: world.session.sandboxId,
            requests: requests.sort(
              (a, b) =>
                Number(b.status === "pending_approval") -
                  Number(a.status === "pending_approval") ||
                b.createdAt.localeCompare(a.createdAt)
            )
          })
        );
      const request = world.data.creditRequests.find(
        (item) => item.id === parts[6]
      );
      if (!request) return fail("not_found", "Credit request not found.", 404);
      const decision = DecisionRequestSchema.parse(
        JSON.parse(String(init?.body))
      );
      const actor = `approver:${world.session.sandboxId}`;
      function refuse(
        action: BillingDataset["audit"][number]["action"],
        message: string
      ) {
        audit(world!, request!, action, message, actor);
        persist(world!);
        return fail("conflict", message, 409);
      }
      if (request.decision) {
        if (
          request.decision.decision === decision.decision &&
          request.decision.reason === decision.reason
        )
          return Response.json({ request, alreadyRecorded: true });
        return refuse(
          "decision_refused_conflict",
          "A different decision is already recorded. Refresh the list."
        );
      }
      if (request.status !== "pending_approval")
        return refuse(
          request.status === "expired"
            ? "approval_refused_expired"
            : "approval_refused_finished",
          "This request no longer accepts decisions."
        );
      const memo = world.data.creditMemos.find(
        (item) => item.requestId === request.id && item.status === "pending"
      );
      if (!memo)
        throw new Error("Pending credit has no engine-validated reservation");
      const at = new Date().toISOString();
      request.decision = { ...decision, actor, at };
      request.updatedAt = at;
      audit(
        world,
        request,
        "decision_received",
        decision.reason,
        actor,
        null,
        request.decision
      );
      if (decision.decision === "approve") {
        request.status = "approved";
        audit(
          world,
          request,
          "credit_approved",
          decision.reason,
          actor,
          { status: "pending_approval" },
          { status: "approved" }
        );
        world.data.ledger.push(
          LedgerEntrySchema.parse({
            id: `le_${randomHex(16)}`,
            customerId: request.customerId,
            at,
            kind: "credit",
            amount: memo.amount,
            invoiceId: request.invoiceId,
            reference: `fixture-credit:${request.id}`,
            description: decision.reason
          })
        );
        memo.status = "applied";
        request.status = "applied";
        audit(
          world,
          request,
          "credit_applied",
          decision.reason,
          actor,
          { status: "approved" },
          { status: "applied" }
        );
      } else {
        memo.status = "void";
        request.status = "rejected";
        request.outcomeReason = decision.reason;
        audit(
          world,
          request,
          "credit_rejected",
          decision.reason,
          actor,
          { status: "pending_approval" },
          { status: "rejected" }
        );
        audit(
          world,
          request,
          "memo_voided",
          decision.reason,
          actor,
          { status: "pending" },
          { status: "void" }
        );
      }
      persist(world);
      return Response.json({
        request: CreditRequestSchema.parse(request),
        alreadyRecorded: false
      });
    }
    return fail("not_found", "Route not found.", 404);
  };
  return {
    version: seed.seedVersion,
    transport,
    answer(sandboxId: string, customerId: string, message: string) {
      const world = load(sandboxId);
      if (!world) throw new Error("Sandbox unavailable");
      return fixtureAnswer(
        message,
        fixturePanel(world.session, customerId, world.data),
        world.data
      );
    },
    startCredit(
      sandboxId: string,
      customerId: string,
      rawInput: ToolInput<"startCreditRequest">
    ) {
      const input = ToolSchemas.startCreditRequest.input.parse(rawInput);
      const world = load(sandboxId);
      if (!world) throw new Error("Sandbox unavailable");
      if (
        !world.session.customers.some((item) => item.customerId === customerId)
      )
        throw new Error("Unknown customer");
      const existing = world.data.creditRequests.find(
        (request) =>
          request.customerId === customerId &&
          request.invoiceId === input.invoiceId &&
          (input.disputedLedgerEntryId === undefined ||
            request.disputedLedgerEntryId === input.disputedLedgerEntryId) &&
          request.status !== "expired"
      );
      if (existing)
        return ToolSchemas.startCreditRequest.output.parse({
          request: existing,
          existing: true,
          message: "This claim already has a recorded credit request."
        });
      const claim = engine.validateCreditClaim(
        world.data,
        {
          customerId,
          invoiceId: input.invoiceId,
          disputedLedgerEntryId: input.disputedLedgerEntryId ?? null
        },
        world.data.creditMemos
      );
      const disputedId = claim.valid
        ? claim.disputedLedgerEntryId
        : (input.disputedLedgerEntryId ?? null);
      const id = `cr_${randomHex(16)}`;
      const at = new Date().toISOString();
      const request = CreditRequestSchema.parse({
        id,
        customerId,
        invoiceId: input.invoiceId,
        disputedLedgerEntryId: disputedId,
        idempotencyKey: randomHex(32),
        customerReason: input.reason,
        validatedAmount: null,
        status: "requested",
        workflowInstanceId: id,
        createdAt: at,
        updatedAt: at,
        deadline: null,
        decision: null,
        outcomeReason: null
      });
      world.data.creditRequests.push(request);
      audit(
        world,
        request,
        "credit_requested",
        input.reason,
        `customer:${customerId}`,
        null,
        { status: "requested" }
      );
      if (claim.valid) {
        request.validatedAmount = claim.creditableAmount;
        audit(
          world,
          request,
          "credit_validated",
          claim.explanation,
          "system",
          { validatedAmount: null },
          { validatedAmount: claim.creditableAmount }
        );
        request.status = "pending_approval";
        const deadline = new Date(at);
        deadline.setUTCDate(deadline.getUTCDate() + 1);
        request.deadline = deadline.toISOString();
        world.data.creditMemos.push(
          CreditMemoSchema.parse({
            id: `cm_${randomHex(16)}`,
            requestId: id,
            disputedLedgerEntryId: claim.disputedLedgerEntryId,
            amount: claim.creditableAmount,
            status: "pending"
          })
        );
        audit(
          world,
          request,
          "memo_pending",
          "Pending memo reserves the engine-validated duplicated debit.",
          "system",
          { status: "requested" },
          { status: "pending_approval", amount: claim.creditableAmount }
        );
      } else {
        request.status = "rejected";
        request.outcomeReason = claim.explanation;
        audit(
          world,
          request,
          "credit_validation_failed",
          claim.explanation,
          "system",
          { status: "requested" },
          { status: "rejected" }
        );
      }
      persist(world);
      return ToolSchemas.startCreditRequest.output.parse({
        request,
        existing: false,
        message: claim.valid
          ? "A human approver must decide before a credit is applied."
          : claim.explanation
      });
    }
  };
}
export type FixtureBackend = ReturnType<typeof createFixtureBackend>;
