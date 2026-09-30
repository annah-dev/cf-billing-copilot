import {
  CreateSandboxResponseSchema,
  PanelResponseSchema,
  AdminCreditRequestsResponseSchema,
  DecisionRequestSchema,
  type CreateSandboxResponse,
  type PanelResponse,
  type ErrorCode
} from "../contracts/http";
import { CreditRequestSchema, type CreditRequest } from "../contracts/credit";
import { type ToolInput, ToolSchemas } from "../contracts/tools";
import { type StoragePort, type Transport } from "./api";

// Illustrative UI fixtures, not the engine seed. Every amount is a contract display pair.
const invoiceTotal = { cents: 41287, display: "$412.87" };
const zero = { cents: 0, display: "$0.00" };
const createdAt = "2026-09-29T16:00:00Z";
export const fixtureCustomers = [
  { customerId: "cus_nimbus", name: "Nimbus Studio" },
  { customerId: "cus_orbit", name: "Orbit Workshop" },
  { customerId: "cus_cedar", name: "Cedar Labs" }
];
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
    createdAt,
    idleDeletionDays: 7
  });
}
export function fixtureCredit(
  customerId: string,
  pending = false
): CreditRequest {
  return CreditRequestSchema.parse({
    id: pending
      ? `cr_${customerId.slice(4)}_pending`
      : `cr_${customerId.slice(4)}_expired`,
    customerId,
    invoiceId: `inv_${customerId.slice(4)}_202609`,
    disputedLedgerEntryId: "le_duplicate",
    idempotencyKey: "a".repeat(64),
    customerReason: "The September invoice debit was posted twice.",
    validatedAmount: invoiceTotal,
    status: pending ? "pending_approval" : "expired",
    workflowInstanceId: pending
      ? `cr_${customerId.slice(4)}_pending`
      : `cr_${customerId.slice(4)}_expired`,
    createdAt: pending ? createdAt : "2026-09-01T16:00:00Z",
    updatedAt: createdAt,
    deadline: pending ? "2026-09-30T16:00:00Z" : "2026-09-02T16:00:00Z",
    decision: null,
    outcomeReason: pending ? null : "No approver decision within 24 hours."
  });
}
export function fixturePanel(
  session: CreateSandboxResponse,
  customerId: string
): PanelResponse {
  const customer = session.customers.find(
    (item) => item.customerId === customerId
  );
  if (!customer) throw new Error("Unknown fixture customer");
  return PanelResponseSchema.parse({
    sandboxId: session.sandboxId,
    customerId,
    customerName: customer.name,
    plan: { planId: "plan_standard", name: "Standard" },
    balance: { cents: 82574, display: "$825.74" },
    currentInvoice: {
      id: `inv_${customerId.slice(4)}_202609`,
      customerId,
      period: "2026-09",
      issuedOn: "2026-09-30",
      lines: [
        {
          id: "line_subscription",
          kind: "subscription",
          description: "Standard subscription",
          planId: "plan_standard",
          meterId: null,
          quantity: null,
          amount: { cents: 2500, display: "$25.00" },
          tiers: []
        },
        {
          id: "line_workers",
          kind: "usage",
          description: "Workers requests",
          planId: "plan_standard",
          meterId: "meter_workers",
          quantity: 620000000,
          amount: { cents: 18000, display: "$180.00" },
          tiers: []
        },
        {
          id: "line_storage",
          kind: "usage",
          description: "Object storage",
          planId: "plan_standard",
          meterId: "meter_storage",
          quantity: 12500,
          amount: { cents: 8500, display: "$85.00" },
          tiers: []
        },
        {
          id: "line_egress",
          kind: "usage",
          description: "Network transfer",
          planId: "plan_standard",
          meterId: "meter_egress",
          quantity: 900,
          amount: { cents: 6900, display: "$69.00" },
          tiers: []
        },
        {
          id: "line_reads",
          kind: "usage",
          description: "Database reads",
          planId: "plan_standard",
          meterId: "meter_reads",
          quantity: 8000000,
          amount: { cents: 2240, display: "$22.40" },
          tiers: []
        },
        {
          id: "line_tax",
          kind: "tax",
          description: "Sales tax",
          planId: null,
          meterId: null,
          quantity: null,
          amount: { cents: 3147, display: "$31.47" },
          tiers: []
        }
      ],
      subtotal: { cents: 38140, display: "$381.40" },
      credits: zero,
      tax: { cents: 3147, display: "$31.47" },
      total: invoiceTotal
    },
    creditRequests: [fixtureCredit(customerId)],
    audit: [
      {
        seq: 1,
        at: createdAt,
        actor: "system",
        action: "sandbox_created",
        subject: { type: "sandbox", id: session.sandboxId },
        reason: "Fresh synthetic demo data created.",
        before: null,
        after: null
      }
    ]
  });
}
interface FixtureWorld {
  session: CreateSandboxResponse;
  panels: Record<string, PanelResponse>;
}
export function createFixtureBackend(storage: StoragePort | null) {
  const cache = new Map<string, FixtureWorld>();
  function persist(world: FixtureWorld) {
    cache.set(world.session.sandboxId, world);
    try {
      storage?.setItem(
        `billing-copilot.fixture.${world.session.sandboxId}`,
        JSON.stringify(world)
      );
    } catch {
      /* In-memory demo remains available. */
    }
  }
  function load(sandboxId: string): FixtureWorld | undefined {
    try {
      const raw = storage?.getItem(`billing-copilot.fixture.${sandboxId}`);
      if (raw) {
        const data = JSON.parse(raw) as FixtureWorld;
        const session = CreateSandboxResponseSchema.parse(data.session);
        if (session.sandboxId !== sandboxId) return undefined;
        const panels = Object.fromEntries(
          session.customers.map(({ customerId }) => [
            customerId,
            PanelResponseSchema.parse(data.panels[customerId])
          ])
        );
        const world = { session, panels };
        cache.set(sandboxId, world);
        return world;
      }
    } catch {
      /* Fall back to this tab's validated data. */
    }
    return cache.get(sandboxId);
  }
  const fail = (code: ErrorCode, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status });
  const transport: Transport = async (path, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (path === "/api/sandboxes" && init?.method === "POST") {
      const session = fixtureSession();
      persist({
        session,
        panels: Object.fromEntries(
          session.customers.map(({ customerId }) => [
            customerId,
            fixturePanel(session, customerId)
          ])
        )
      });
      return Response.json(session);
    }
    const parts = path.split("/");
    const world = load(parts[3]);
    if (!world) return fail("not_found", "This demo sandbox has expired.", 404);
    if (parts[4] === "customers" && parts[6] === "panel") {
      const panel = world.panels[parts[5]];
      return panel
        ? Response.json(panel)
        : fail("not_found", "Customer not found.", 404);
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
      const requests = Object.values(world.panels).flatMap((panel) =>
        panel.creditRequests.map((request) => ({
          ...request,
          customerName: panel.customerName
        }))
      );
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
      const request = requests.find((item) => item.id === parts[6]);
      if (!request) return fail("not_found", "Credit request not found.", 404);
      const decision = DecisionRequestSchema.parse(
        JSON.parse(String(init?.body))
      );
      if (request.decision) {
        if (
          request.decision.decision === decision.decision &&
          request.decision.reason === decision.reason
        )
          return Response.json({ request, alreadyRecorded: true });
        return fail(
          "conflict",
          "A different decision is already recorded. Refresh the list.",
          409
        );
      }
      if (request.status !== "pending_approval")
        return fail(
          "conflict",
          "This request no longer accepts decisions.",
          409
        );
      const panel = world.panels[request.customerId];
      const at = new Date().toISOString();
      const updated = CreditRequestSchema.parse({
        ...request,
        status: decision.decision === "approve" ? "applied" : "rejected",
        decision: {
          ...decision,
          actor: `approver:${world.session.sandboxId}`,
          at
        },
        updatedAt: at,
        outcomeReason: decision.decision === "reject" ? decision.reason : null
      });
      panel.creditRequests = panel.creditRequests.map((item) =>
        item.id === updated.id ? updated : item
      );
      if (decision.decision === "approve") panel.balance = invoiceTotal;
      for (const action of decision.decision === "approve"
        ? (["decision_received", "credit_approved", "credit_applied"] as const)
        : (["decision_received", "credit_rejected"] as const)) {
        panel.audit.unshift({
          seq: panel.audit.length + 1,
          at,
          actor: `approver:${world.session.sandboxId}`,
          action,
          subject: { type: "credit_request", id: request.id },
          reason: decision.reason,
          before: null,
          after: { status: updated.status }
        });
      }
      persist(world);
      return Response.json({ request: updated, alreadyRecorded: false });
    }
    return fail("not_found", "Route not found.", 404);
  };
  return {
    transport,
    startCredit(
      sandboxId: string,
      customerId: string,
      input: ToolInput<"startCreditRequest">
    ) {
      ToolSchemas.startCreditRequest.input.parse(input);
      const world = load(sandboxId);
      if (!world) throw new Error("Sandbox unavailable");
      const panel = world.panels[customerId];
      const existing = panel.creditRequests.find(
        (request) => request.id === fixtureCredit(customerId, true).id
      );
      const request = existing ?? {
        ...fixtureCredit(customerId, true),
        customerReason: input.reason
      };
      if (!existing) {
        panel.creditRequests.unshift(request);
        for (const action of [
          "credit_requested",
          "credit_validated",
          "memo_pending"
        ] as const)
          panel.audit.unshift({
            seq: panel.audit.length + 1,
            at: createdAt,
            actor: `customer:${customerId}`,
            action,
            subject: { type: "credit_request", id: request.id },
            reason: input.reason,
            before: null,
            after: { status: "pending_approval" }
          });
        persist(world);
      }
      return ToolSchemas.startCreditRequest.output.parse({
        request,
        existing: Boolean(existing),
        message: "A human approver must decide before a credit is applied."
      });
    }
  };
}
export type FixtureBackend = ReturnType<typeof createFixtureBackend>;
