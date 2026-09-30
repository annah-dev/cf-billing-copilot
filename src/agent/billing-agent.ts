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
  stepCountIs,
  streamText,
  type UIMessage
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
import { capMessage, refusal, type Refusal, type Result } from "../http/errors";
import { CREDIT_WORKFLOW } from "../workflows/params";
import { historyForModel } from "./history";
import { billingModel, newTurnStats, type TurnStats } from "./model";
import { EMPTY_MEMORY, systemPrompt, type Memory } from "./prompt";
import { ToolError, buildTools } from "./tools";

/** Model calls per turn: tool round trips plus the answer. Small on purpose (Stop 2 finding). */
export const MAX_STEPS = 4;
const MAX_REMEMBERED_QUESTIONS = 8;
const QUESTION_CHARS = 160;
const MAX_TRACKED_TURNS = 16;

/** Broadcast to connected chat clients when a credit request changes state. */
export type CreditUpdateMessage = {
  type: "credit-request-update";
  requestId: string;
  status: string | null;
};

type TurnRecord = TurnStats & { capRefusal: Refusal | null };

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
   * User message ids submitted by headlessTurn (POST .../turn). Server-side only: a chat client
   * cannot mark its own message headless (message metadata is client-controlled).
   */
  private headlessMessageIds = new Set<string>();

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

  /**
   * True when this continuation resumes a credit confirmation the customer just answered: the
   * newest assistant message has a tool part in `approval-responded`. Any other continuation (for
   * example an approval frame for an unknown or already-answered tool call, which the SDK still
   * continues) is charged against the message cap like a new message.
   */
  private answeredConfirmationPending(): boolean {
    const assistant = [...this.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    return (
      assistant?.parts.some(
        (p) => "state" in p && p.state === "approval-responded"
      ) ?? false
    );
  }

  // ---- Credit requests ------------------------------------------------------------------------

  private async startCreditRequest(input: {
    invoiceId: string;
    disputedLedgerEntryId: string | null;
    reason: string;
    idempotencyKey: string;
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
    const lastUser = [...this.messages]
      .reverse()
      .find((m) => m.role === "user");
    const record: TurnRecord = { ...newTurnStats(), capRefusal: null };
    this.turns.set(lastUser?.id ?? options?.requestId ?? "unknown", record);
    // Only /turn reads these back; keep the map small for chat turns nobody collects.
    for (const key of this.turns.keys()) {
      if (this.turns.size <= MAX_TRACKED_TURNS) break;
      this.turns.delete(key);
    }
    const headless = lastUser
      ? this.headlessMessageIds.has(lastUser.id)
      : false;
    const continuation = options?.continuation ?? false;

    if (!continuation || !this.answeredConfirmationPending()) {
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

    const cache = new Map<string, unknown>();
    const tools = buildTools(
      {
        sandboxId,
        customerId,
        ledger: this.ledger(),
        startCreditRequest: (input) => this.startCreditRequest(input),
        remember: (name, output) => this.remember(name, output)
      },
      cache,
      { confirmCredit: !headless }
    );
    const result = streamText({
      model: billingModel(this.env, record, {
        maxOutputTokens: config.MAX_OUTPUT_TOKENS,
        neuronStop: config.NEURON_DAILY_STOP
      }),
      system: systemPrompt(this.memory(), utcDay(Date.now())),
      messages: await historyForModel(this.messages, {
        continuation
      }),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens: config.MAX_OUTPUT_TOKENS,
      temperature: 0,
      abortSignal: options?.abortSignal
    });
    return result.toUIMessageStreamResponse({ onError: toolErrorText });
  }

  /**
   * One non-streaming turn for the eval harness and scripted clients (POST .../turn). It runs the
   * same onChatMessage path as the chat, persisted in the same history, with the credit
   * confirmation step off: the request itself is the customer's explicit instruction.
   */
  async headlessTurn(message: string): Promise<Result<{ turn: TurnResponse }>> {
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: message }]
    };
    this.headlessMessageIds.add(userMessage.id);
    try {
      await this.saveMessages((messages) => [...messages, userMessage]);
    } finally {
      this.headlessMessageIds.delete(userMessage.id);
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
