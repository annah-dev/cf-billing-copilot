// The eight typed tools (src/contracts/tools.ts). The AI SDK validates every input against the
// contract zod schema before execute runs; every output is parsed against its contract schema
// before it reaches the model. Reads go to the Ledger, which runs the engine; the one write is
// startCreditRequest, which records a `requested` row and starts the Workflow. No tool can decide,
// approve or apply a credit.
import { tool, type ToolSet } from "ai";
import {
  ToolSchemas,
  type ToolName,
  type ToolOutput,
  type CreditRequest
} from "../contracts";
import { sha256Hex } from "../http/config";
import type { Result } from "../http/errors";

/** What the tools need from their agent: the Ledger reads and the credit-request start. */
export type ToolHost = {
  sandboxId: string;
  customerId: string;
  ledger: DurableObjectStub<import("../ledger/ledger").Ledger>;
  /** Record the request in the Ledger and make sure its Workflow runs (idempotent). */
  startCreditRequest(input: {
    invoiceId: string;
    disputedLedgerEntryId: string | null;
    reason: string;
    idempotencyKey: string;
  }): Promise<Result<{ request: CreditRequest; existing: boolean }>>;
  /** Called after getAccount and startCreditRequest so the agent can update its memory. */
  remember(name: ToolName, output: unknown): void;
  /** Record the output the server produced for a tool call (provenance.ts). */
  recordOutput(toolCallId: string, output: unknown): Promise<void>;
};

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** Keep a tool's failure message safe to show: unexpected errors become a generic ToolError. */
function guard<I, O>(
  name: ToolName,
  execute: (input: I) => Promise<O>
): (input: I) => Promise<O> {
  return async (input) => {
    try {
      return await execute(input);
    } catch (err) {
      if (err instanceof ToolError) throw err;
      console.error(`tool ${name} failed`, err);
      throw new ToolError(
        "Billing data could not be read just now. Please try again."
      );
    }
  };
}

function unwrap<T>(result: Result<{ value: T }>): T {
  if (!result.ok) throw new ToolError(result.message);
  return result.value;
}

/** Stable JSON for the per-turn cache key (object keys sorted). */
export function stableKey(name: string, input: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)])
          )
        : v;
  return `${name}:${JSON.stringify(sort(input))}`;
}

/** The credit idempotency key: SHA-256 of sandbox, customer, invoice and disputed entry (D-18). */
export function creditIdempotencyKey(
  sandboxId: string,
  customerId: string,
  invoiceId: string,
  disputedLedgerEntryId: string | null
): Promise<string> {
  return sha256Hex(
    [sandboxId, customerId, invoiceId, disputedLedgerEntryId ?? ""].join("|")
  );
}

function summary(r: CreditRequest) {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    status: r.status,
    validatedAmount: r.validatedAmount,
    createdAt: r.createdAt,
    deadline: r.deadline,
    outcomeReason: r.outcomeReason
  };
}

/**
 * Build the tool set for one turn. Identical read calls within the turn are served from `cache`
 * (Llama 3.3 repeated an identical getAccount call at Stop 2). `confirmCredit` puts
 * startCreditRequest behind the AI SDK approval step, so the chat UI asks the customer first.
 */
export function buildTools(
  host: ToolHost,
  cache: Map<string, unknown>,
  options: { confirmCredit: boolean }
): ToolSet {
  const { ledger, customerId } = host;

  function read<N extends ToolName>(
    name: N,
    fetch: (input: never) => Promise<ToolOutput<N>>
  ) {
    return guard(name, async (input: unknown): Promise<ToolOutput<N>> => {
      const key = stableKey(name, input);
      if (cache.has(key)) return cache.get(key) as ToolOutput<N>;
      const output = ToolSchemas[name].output.parse(
        await fetch(input as never)
      ) as ToolOutput<N>;
      cache.set(key, output);
      host.remember(name, output);
      return output;
    });
  }

  const tools: ToolSet = {
    getAccount: tool({
      description: ToolSchemas.getAccount.description,
      inputSchema: ToolSchemas.getAccount.input,
      execute: read("getAccount", async () =>
        unwrap(await ledger.account(customerId))
      )
    }),
    getInvoice: tool({
      description: ToolSchemas.getInvoice.description,
      inputSchema: ToolSchemas.getInvoice.input,
      execute: read(
        "getInvoice",
        async (input: { period?: string; invoiceId?: string }) =>
          unwrap(await ledger.invoice(customerId, input))
      )
    }),
    explainLineItem: tool({
      description: ToolSchemas.explainLineItem.description,
      inputSchema: ToolSchemas.explainLineItem.input,
      execute: read(
        "explainLineItem",
        async (input: { invoiceId: string; lineId: string }) =>
          unwrap(
            await ledger.explainLine(customerId, input.invoiceId, input.lineId)
          )
      )
    }),
    compareInvoices: tool({
      description: ToolSchemas.compareInvoices.description,
      inputSchema: ToolSchemas.compareInvoices.input,
      execute: read(
        "compareInvoices",
        async (input: { fromPeriod: string; toPeriod: string }) =>
          unwrap(
            await ledger.compare(customerId, input.fromPeriod, input.toPeriod)
          )
      )
    }),
    simulatePlan: tool({
      description: ToolSchemas.simulatePlan.description,
      inputSchema: ToolSchemas.simulatePlan.input,
      execute: read(
        "simulatePlan",
        async (input: { period: string; planId: string }) =>
          unwrap(await ledger.simulate(customerId, input.period, input.planId))
      )
    }),
    detectAnomalies: tool({
      description: ToolSchemas.detectAnomalies.description,
      inputSchema: ToolSchemas.detectAnomalies.input,
      execute: read("detectAnomalies", async (input: { period: string }) =>
        unwrap(await ledger.anomalies(customerId, input.period))
      )
    }),
    startCreditRequest: tool({
      description: ToolSchemas.startCreditRequest.description,
      inputSchema: ToolSchemas.startCreditRequest.input,
      needsApproval: options.confirmCredit,
      execute: guard("startCreditRequest", async (input: unknown) => {
        const parsed = ToolSchemas.startCreditRequest.input.parse(input);
        const disputed = parsed.disputedLedgerEntryId ?? null;
        const result = await host.startCreditRequest({
          invoiceId: parsed.invoiceId,
          disputedLedgerEntryId: disputed,
          reason: parsed.reason,
          idempotencyKey: await creditIdempotencyKey(
            host.sandboxId,
            customerId,
            parsed.invoiceId,
            disputed
          )
        });
        if (!result.ok) throw new ToolError(result.message);
        const output = ToolSchemas.startCreditRequest.output.parse({
          request: summary(result.request),
          existing: result.existing,
          message: result.existing
            ? `A credit request for this charge already exists (${result.request.id}, status ${result.request.status}). No new request was created.`
            : `Credit request ${result.request.id} was recorded. The claim is checked against the ledger and a human approver decides; no credit is applied until then.`
        });
        host.remember("startCreditRequest", output);
        return output;
      })
    }),
    getCreditRequestStatus: tool({
      description: ToolSchemas.getCreditRequestStatus.description,
      inputSchema: ToolSchemas.getCreditRequestStatus.input,
      // Not cached: a status can change while the turn runs.
      execute: guard("getCreditRequestStatus", async (input: unknown) => {
        const parsed = ToolSchemas.getCreditRequestStatus.input.parse(input);
        return ToolSchemas.getCreditRequestStatus.output.parse(
          unwrap(await ledger.creditStatus(customerId, parsed.requestId))
        );
      })
    })
  };
  // Every output the server produces is recorded, so a client cannot plant a tool result.
  type Execute = NonNullable<ToolSet[string]["execute"]>;
  for (const t of Object.values(tools)) {
    const execute = t.execute as Execute | undefined;
    if (!execute) continue;
    const recorded: Execute = async (input, options) => {
      const output = await execute(input, options);
      if (options?.toolCallId) {
        await host.recordOutput(options.toolCallId, output);
      }
      return output;
    };
    t.execute = recorded;
  }
  return tools;
}
