// One instance per "<sandboxId>.<customerId>" (D-3): the chat history (AIChatAgent's SQLite),
// customer memory, and the Llama 3.3 tool loop. It reads the Ledger and has exactly one write,
// startCreditRequest, which records a `requested` row and starts the credit Workflow. It never
// decides, approves or applies a credit, and it never does money math (D-15).
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  InvalidToolInputError,
  NoSuchToolError,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamWriter
} from "ai";
import {
  AgentInstanceNameSchema,
  TOOL_NAMES,
  type CreditRequest,
  type ToolCallRecord,
  type ToolName,
  type TurnResponse
} from "../contracts";
import { DAY_MS, getConfig, utcDay } from "../http/config";
import {
  BUDGET_MESSAGE,
  capMessage,
  refusal,
  type Refusal,
  type Result
} from "../http/errors";
import { CREDIT_WORKFLOW } from "../workflows/params";
import { historyForModel } from "./history";
import { billingModel, newTurnStats, type TurnStats } from "./model";
import { EMPTY_MEMORY, systemPrompt, type Memory } from "./prompt";
import { AnomalyChecks } from "./anomalies";
import { planIdRepair } from "./repair";
import { collectEvidence } from "./grounding";
import { guardReply, type GroundingRecord } from "./guard";
import { ToolProvenance } from "./provenance";
import { ToolError, buildTools, stableKey } from "./tools";

/** Model calls per turn: tool round trips plus the answer. Small on purpose (Stop 2 finding). */
export const MAX_STEPS = 4;
const MAX_REMEMBERED_QUESTIONS = 8;

/**
 * Whether the next step gets no tools, so the model has to answer: the last allowed step, or a
 * step after one where the model only repeated calls it had already made this turn. In the evals
 * Llama 3.3 spent every step on tool calls (four identical getCreditRequestStatus calls) and the
 * turn ended with no text (remember-credit).
 */
export function mustAnswer(
  stepNumber: number,
  steps: readonly {
    toolCalls: readonly { toolName: string; input: unknown }[];
  }[]
): boolean {
  if (stepNumber >= MAX_STEPS - 1) return true;
  const last = steps.at(-1);
  if (!last || last.toolCalls.length === 0) return false;
  const earlier = new Set(
    steps
      .slice(0, -1)
      .flatMap((s) => s.toolCalls.map((c) => stableKey(c.toolName, c.input)))
  );
  return last.toolCalls.every((c) =>
    earlier.has(stableKey(c.toolName, c.input))
  );
}
const QUESTION_CHARS = 160;
const MAX_TRACKED_TURNS = 16;

/** /turn's report for a credit request the model proposed without `confirm: true` (D-20). */
export const AWAITING_CONFIRMATION =
  "Awaiting the customer's confirmation: nothing was recorded. Send the turn with confirm: true to start the credit request.";

/** Broadcast to connected chat clients when a credit request changes state. */
export type CreditUpdateMessage = {
  type: "credit-request-update";
  requestId: string;
  status: string | null;
};

type TurnRecord = TurnStats & {
  capRefusal: Refusal | null;
  /** The grounding guard's outcome for the reply (guard.ts); null when no model reply ran. */
  grounding: GroundingRecord | null;
};

function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

/**
 * Error text shown in the chat and returned by /turn for a failed tool call. The SDK hands tool
 * failures over as their message string; every tool turns unexpected failures into a generic
 * ToolError first (tools.ts), so these strings are input-validation messages or the tools' own
 * refusals and are safe to show. Anything else stays generic.
 */
function toolErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (InvalidToolInputError.isInstance(error)) {
    return `Invalid input for ${error.toolName}: ${error.message}`;
  }
  if (NoSuchToolError.isInstance(error)) return error.message;
  if (error instanceof ToolError) return error.message;
  return "An internal error occurred.";
}

/** Successful tool outputs after the last user message: a continuation's earlier steps. */
function toolOutputsSinceLastUser(messages: UIMessage[]): unknown[] {
  let start = 0;
  messages.forEach((m, index) => {
    if (m.role === "user") start = index + 1;
  });
  return messages
    .slice(start)
    .flatMap((m) => m.parts)
    .flatMap((part) =>
      part.type.startsWith("tool-") &&
      (part as { state?: string }).state === "output-available"
        ? [(part as { output?: unknown }).output]
        : []
    );
}

/**
 * Forward a step stream to the client, holding back its text: the reply is only sent after the
 * grounding guard has checked it. Returns the held text, step by step, and every tool output.
 */
async function forwardHoldingText(
  stream: ReadableStream<UIMessageChunk>,
  writer: UIMessageStreamWriter
): Promise<{
  text: string;
  outputs: unknown[];
  awaitingConfirmation: boolean;
}> {
  const texts = new Map<string, string>();
  const outputs: unknown[] = [];
  let awaitingConfirmation = false;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "text-start") texts.set(value.id, "");
    else if (value.type === "text-delta") {
      texts.set(value.id, (texts.get(value.id) ?? "") + value.delta);
    } else if (value.type !== "text-end") {
      if (value.type === "tool-output-available") outputs.push(value.output);
      if (value.type === "tool-approval-request") awaitingConfirmation = true;
      writer.write(value);
    }
  }
  const text = [...texts.values()]
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .join("\n\n");
  return { text, outputs, awaitingConfirmation };
}

/** A reply that never reaches the model: a cap, the budget stop or an oversize message. */
function fixedTextResponse(text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = crypto.randomUUID();
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    }
  });
  return createUIMessageStreamResponse({ stream });
}

export class BillingAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200;

  /** Turn accounting keyed by the user message id that started the turn (read by /turn). */
  private turns = new Map<string, TurnRecord>();

  /**
   * User message ids submitted by headlessTurn (POST .../turn), with the request's `confirm` flag
   * (D-20). Server-side only: a chat client cannot mark its own message headless or confirmed
   * (message metadata is client-controlled).
   */
  private headlessTurns = new Map<string, { confirm: boolean }>();

  private provenanceStore: ToolProvenance | undefined;

  /** Server-issued tool calls and outputs; the model only sees tool parts that match them. */
  private get provenance(): ToolProvenance {
    this.provenanceStore ??= new ToolProvenance(this.ctx.storage.sql);
    return this.provenanceStore;
  }

  async onStart(): Promise<void> {
    this
      .sql`CREATE TABLE IF NOT EXISTS billing_memory (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
    // Every agent the SDK creates, even one whose first message is refused or whose client only
    // connects, gets an idle deletion schedule (D-5).
    await this.ensureIdleSchedule();
  }

  private identity(): { sandboxId: string; customerId: string } {
    const name = AgentInstanceNameSchema.parse(this.name);
    const dot = name.indexOf(".");
    return { sandboxId: name.slice(0, dot), customerId: name.slice(dot + 1) };
  }

  private ledger() {
    const { sandboxId } = this.identity();
    return this.env.LEDGER.get(this.env.LEDGER.idFromName(sandboxId));
  }

  // ---- Memory -------------------------------------------------------------------------------

  private readKey<T>(key: string, fallback: T): T {
    const rows = this.sql<{
      value: string;
    }>`SELECT value FROM billing_memory WHERE key = ${key}`;
    return rows[0] ? (JSON.parse(rows[0].value) as T) : fallback;
  }

  private writeKey(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.sql`INSERT INTO billing_memory (key, value) VALUES (${key}, ${json})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
  }

  /** What the agent remembers across sessions (docs/ARCHITECTURE.md, BillingAgent). */
  memory(): Memory {
    return this.readKey<Memory>("memory", EMPTY_MEMORY);
  }

  private updateMemory(change: (m: Memory) => Memory): void {
    this.writeKey("memory", change(this.memory()));
  }

  private remember(name: ToolName, output: unknown): void {
    if (name === "getAccount") {
      const account = output as {
        customerName: string;
        plan: { name: string };
      };
      this.updateMemory((m) => ({
        ...m,
        customerName: account.customerName,
        planName: account.plan.name
      }));
    }
    if (name === "startCreditRequest") {
      const id = (output as { request: { id: string } }).request.id;
      this.updateMemory((m) =>
        m.creditRequestIds.includes(id)
          ? m
          : { ...m, creditRequestIds: [...m.creditRequestIds, id] }
      );
    }
  }

  private rememberQuestion(text: string): void {
    const at = utcDay(Date.now());
    this.updateMemory((m) => ({
      ...m,
      questions: [
        ...m.questions,
        { at, text: text.slice(0, QUESTION_CHARS) }
      ].slice(-MAX_REMEMBERED_QUESTIONS)
    }));
  }

  // ---- Idle deletion (D-5): the SDK scheduler multiplexes onto this object's alarm -------------

  private idleMs(): number {
    return getConfig(this.env).SANDBOX_IDLE_DAYS * DAY_MS;
  }

  /** Keep exactly one pending idleSweep, due SANDBOX_IDLE_DAYS after the last activity. */
  private async ensureIdleSchedule(): Promise<void> {
    let last = this.readKey<number | null>("last_activity_at", null);
    if (last === null) {
      last = Date.now();
      this.writeKey("last_activity_at", last);
    }
    const id = this.readKey<string | null>("idle_schedule", null);
    if (id && this.getSchedule(id)) return;
    await this.armIdleSweep(last + this.idleMs());
  }

  private async armIdleSweep(at: number): Promise<void> {
    const now = Date.now();
    for (const pending of this.getSchedules()) {
      if (pending.callback === "idleSweep" && pending.time * 1000 > now) {
        await this.cancelSchedule(pending.id);
      }
    }
    const schedule = await this.schedule(new Date(at), "idleSweep");
    this.writeKey("idle_schedule", schedule.id);
  }

  private async touchActivity(): Promise<void> {
    this.writeKey("last_activity_at", Date.now());
    await this.ensureIdleSchedule();
  }

  /** Scheduled callback: delete this agent's storage after SANDBOX_IDLE_DAYS without activity. */
  async idleSweep(): Promise<void> {
    const last = this.readKey<number>("last_activity_at", 0);
    if (last + this.idleMs() > Date.now()) {
      await this.armIdleSweep(last + this.idleMs());
      return;
    }
    await this.destroy();
  }

  // ---- Credit requests ------------------------------------------------------------------------

  private async startCreditRequest(input: {
    invoiceId: string;
    disputedLedgerEntryId: string | null;
    reason: string;
    idempotencyKey: string;
    confirmedVia: "chat" | "turn";
  }): Promise<Result<{ request: CreditRequest; existing: boolean }>> {
    const { customerId } = this.identity();
    const created = await this.ledger().createCreditRequest({
      customerId,
      ...input
    });
    if (!created.ok) return created;
    const result = {
      ok: true as const,
      request: created.request,
      existing: created.existing
    };
    if (result.request.status === "requested") {
      await this.ensureWorkflow(result.request.id);
    }
    return result;
  }

  /**
   * Start the request's Workflow, with the request id as instance id (D-9). An existing instance
   * is left alone unless it errored or was terminated, in which case it is restarted. If starting
   * fails outright, the Ledger's recovery sweep starts it within minutes.
   */
  private async ensureWorkflow(requestId: string): Promise<void> {
    const { sandboxId } = this.identity();
    try {
      await this.runWorkflow(
        CREDIT_WORKFLOW,
        { sandboxId, requestId },
        { id: requestId }
      );
      return;
    } catch (err) {
      try {
        const instance = await this.env.CREDIT_WORKFLOW.get(requestId);
        const { status } = await instance.status();
        if (status === "errored" || status === "terminated") {
          await instance.restart();
          await this.ledger().noteWorkflowRestart(
            requestId,
            `Workflow instance was ${status}; restarted by the agent`
          );
        }
      } catch (_statusErr) {
        console.error("credit workflow not started; recovery will retry", err);
      }
    }
  }

  async onWorkflowProgress(
    _workflowName: string,
    _workflowId: string,
    progress: unknown
  ): Promise<void> {
    const p = progress as { requestId?: string; creditStatus?: string | null };
    if (!p.requestId) return;
    const message: CreditUpdateMessage = {
      type: "credit-request-update",
      requestId: p.requestId,
      status: p.creditStatus ?? null
    };
    this.broadcast(JSON.stringify(message));
  }

  // ---- The chat turn ----------------------------------------------------------------------------

  async onChatMessage(
    _onFinish: unknown,
    options?: OnChatMessageOptions
  ): Promise<Response> {
    const { sandboxId, customerId } = this.identity();
    const config = getConfig(this.env);
    // One immutable snapshot for the whole turn: the confirmation, the cap exemption and the model
    // context all come from it. The SDK applies client-sent history outside its turn queue, so
    // this.messages can change at any await below (PR #4 review round 4).
    const conversation = structuredClone(this.messages);
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    const record: TurnRecord = {
      ...newTurnStats(),
      capRefusal: null,
      grounding: null
    };
    this.turns.set(lastUser?.id ?? options?.requestId ?? "unknown", record);
    // Only /turn reads these back; keep the map small for chat turns nobody collects.
    for (const key of this.turns.keys()) {
      if (this.turns.size <= MAX_TRACKED_TURNS) break;
      this.turns.delete(key);
    }
    const turn = lastUser ? this.headlessTurns.get(lastUser.id) : undefined;
    // D-20: a credit request needs the customer's explicit confirmation on every path. In the chat
    // it comes through the needsApproval step; a /turn gives it up front with `confirm: true`,
    // otherwise the turn can only propose the request.
    const preConfirmed = turn?.confirm === true;
    const continuation = options?.continuation ?? false;

    // Only a continuation that resumes a server-issued credit confirmation the customer just
    // answered is exempt from the message cap; any other continuation (a stray or forged approval
    // frame, which the SDK still continues) is charged as a message.
    const exempt =
      continuation &&
      (await this.provenance.consumeAnsweredConfirmation(conversation));
    if (!exempt) {
      if (!continuation) {
        const text = textOf(lastUser);
        if (text.length > config.MESSAGE_MAX_CHARS) {
          record.capRefusal = refusal(
            400,
            "invalid_request",
            `Messages are limited to ${config.MESSAGE_MAX_CHARS} characters. Please shorten your message.`
          );
          return fixedTextResponse(record.capRefusal.message);
        }
      }
      const cap = await this.ledger().consumeMessage();
      if (!cap.ok) {
        record.capRefusal = {
          ok: false,
          status: cap.status,
          code: cap.code,
          message: cap.message,
          cap: cap.cap
        };
        return fixedTextResponse(
          cap.code === "cap_reached"
            ? capMessage("chat messages", config.MESSAGES_PER_SANDBOX_DAY)
            : cap.message
        );
      }
      if (!continuation) this.rememberQuestion(textOf(lastUser));
      await this.touchActivity();
    }

    const ledger = this.ledger();
    const cache = new Map<string, unknown>();
    const tools = buildTools(
      {
        sandboxId,
        customerId,
        ledger,
        startCreditRequest: (input) => this.startCreditRequest(input),
        remember: (name, output) => this.remember(name, output),
        recordResult: (call, result) =>
          this.provenance.recordResult(call, result)
      },
      cache,
      { confirmCredit: !preConfirmed }
    );
    const verified = await this.provenance.verified(conversation);
    const messages = await historyForModel(verified, {
      continuation,
      confirmedTurn: preConfirmed
    });
    const earlierOutputs = toolOutputsSinceLastUser(verified);
    const customerText = textOf(lastUser);
    const system = systemPrompt(this.memory(), utcDay(Date.now()));
    const stream = createUIMessageStream({
      onError: toolErrorText,
      execute: async ({ writer }) => {
        // User story 4: the spike is checked and shown whether or not the model asks (anomalies.ts).
        const checks = new AnomalyChecks({
          detectAnomalies: tools.detectAnomalies.execute as NonNullable<
            (typeof tools)[string]["execute"]
          >,
          periodOfInvoice: async (invoiceId) => {
            const found = await ledger.invoice(customerId, { invoiceId });
            return found.ok ? found.value.period : null;
          },
          writer
        });
        checks.wrap(tools);
        const model = billingModel(this.env, record, {
          maxOutputTokens: config.MAX_OUTPUT_TOKENS,
          neuronStop: config.NEURON_DAILY_STOP
        });
        const result = streamText({
          model,
          system,
          messages,
          tools,
          prepareStep: async (step) => {
            const prepared = await checks.prepareStep(step);
            return mustAnswer(step.stepNumber, step.steps)
              ? { ...prepared, activeTools: [] }
              : prepared;
          },
          experimental_repairToolCall: planIdRepair(async () => {
            const account = await ledger.account(customerId);
            return account.ok ? account.value.availablePlans : [];
          }),
          onStepFinish: (step) =>
            this.provenance.recordStep(
              step.toolCalls,
              step.content.flatMap((c) =>
                c.type === "tool-error"
                  ? [
                      {
                        toolCallId: c.toolCallId,
                        text:
                          c.error instanceof Error
                            ? c.error.message
                            : String(c.error)
                      }
                    ]
                  : []
              ),
              !preConfirmed
            ),
          // The last step has no tools (mustAnswer), so no server check can arrive after it.
          stopWhen: stepCountIs(MAX_STEPS),
          maxOutputTokens: config.MAX_OUTPUT_TOKENS,
          temperature: 0,
          abortSignal: options?.abortSignal
        });
        const draft = await forwardHoldingText(
          result.toUIMessageStream({
            onError: toolErrorText,
            sendFinish: false
          }),
          writer
        );
        // The grounding guard (guard.ts): figures must come from this turn's tool results, dates
        // and periods also from the customer's message. One corrective retry, then a safe answer.
        let reply: string;
        if (record.budgetRefusal) {
          reply = BUDGET_MESSAGE;
          record.grounding = {
            outcome: "budget",
            unsupported: [],
            retryUnsupported: null
          };
        } else {
          const guarded = await guardReply({
            draft: draft.text,
            awaitingConfirmation: draft.awaitingConfirmation,
            evidence: collectEvidence(
              [...earlierOutputs, ...draft.outputs, ...checks.outputs],
              customerText
            ),
            retry: async (correction) => {
              let response;
              try {
                response = await result.response;
              } catch (_err) {
                return null; // the turn failed; nothing to correct
              }
              // The context the model answered from, server checks included, then the correction.
              // No tools: the retry restates what this turn already fetched.
              const retried = await generateText({
                model,
                system,
                messages: [
                  ...checks.withServerResults([
                    ...messages,
                    ...response.messages
                  ]),
                  { role: "user", content: correction }
                ],
                maxOutputTokens: config.MAX_OUTPUT_TOKENS,
                temperature: 0,
                abortSignal: options?.abortSignal
              });
              return record.budgetRefusal ? null : retried.text;
            }
          });
          reply = guarded.text;
          record.grounding = guarded.grounding;
        }
        if (record.grounding.outcome !== "grounded") {
          console.log("grounding guard", record.grounding);
        }
        if (reply !== "") {
          const id = crypto.randomUUID();
          writer.write({ type: "text-start", id });
          writer.write({ type: "text-delta", id, delta: reply });
          writer.write({ type: "text-end", id });
        }
        writer.write({
          type: "message-metadata",
          messageMetadata: { grounding: record.grounding }
        });
        writer.write({ type: "finish" });
      }
    });
    return createUIMessageStreamResponse({ stream });
  }

  /**
   * One non-streaming turn for the eval harness and scripted clients (POST .../turn). It runs the
   * same onChatMessage path as the chat, persisted in the same history. A credit request needs
   * `confirm: true` (D-20); without it the turn can only propose one, and the proposal is reported
   * as a tool call awaiting confirmation.
   */
  async headlessTurn(
    message: string,
    confirm = false
  ): Promise<Result<{ turn: TurnResponse }>> {
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: message }]
    };
    this.headlessTurns.set(userMessage.id, { confirm });
    try {
      await this.saveMessages((messages) => [...messages, userMessage]);
    } finally {
      this.headlessTurns.delete(userMessage.id);
    }
    const record = this.turns.get(userMessage.id);
    this.turns.delete(userMessage.id);
    if (!record) return refusal(500, "internal", "The turn did not run");
    if (record.capRefusal) return record.capRefusal;
    if (record.budgetRefusal && record.modelCalls === 0) {
      return record.budgetRefusal;
    }
    const index = this.messages.findIndex((m) => m.id === userMessage.id);
    const replies = this.messages
      .slice(index + 1)
      .filter((m) => m.role === "assistant");
    const text = replies
      .flatMap((m) => m.parts)
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    const toolCalls: ToolCallRecord[] = [];
    for (const part of replies.flatMap((m) => m.parts)) {
      if (!part.type.startsWith("tool-") || !("toolCallId" in part)) continue;
      const name = part.type.slice("tool-".length) as ToolName;
      if (!TOOL_NAMES.includes(name)) continue;
      const p = part as {
        state: string;
        input?: unknown;
        output?: unknown;
        errorText?: string;
      };
      toolCalls.push({
        name,
        input: p.input ?? null,
        output: p.state === "output-available" ? (p.output ?? null) : null,
        error:
          p.state === "output-error"
            ? (p.errorText ?? "tool error")
            : p.state === "output-available"
              ? null
              : p.state === "approval-requested"
                ? AWAITING_CONFIRMATION
                : `tool call ${p.state}`
      });
    }
    return {
      ok: true,
      turn: {
        text,
        toolCalls,
        usage: {
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          modelCalls: record.modelCalls
        }
      }
    };
  }
}
