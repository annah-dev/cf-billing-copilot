// User story 4: the copilot mentions an unusual usage spike proactively. That must not depend on
// Llama 3.3 choosing to call detectAnomalies (in the live run it did not). So whenever a tool
// result in a turn is an invoice (getInvoice), a line explanation (explainLineItem) or a comparison
// (compareInvoices, both months) for a period that has not been checked successfully in that turn,
// the server runs detectAnomalies for the period itself, at the moment the result is produced. The call and its result (or its error) are
// written to the chat stream at once, so they are stored, shown in the UI and /turn and recorded in
// provenance, and they are handed to the model as a server-issued tool call and result before its
// next step. The turn's last step has no tools (billing-agent.ts, mustAnswer), so every result is
// seen by at least that answer step.
import type {
  ModelMessage,
  PrepareStepFunction,
  ToolSet,
  UIMessageStreamWriter
} from "ai";

type Execute = NonNullable<ToolSet[string]["execute"]>;

/** Server attempts per period and turn; a failed check is retried once on the next trigger. */
const MAX_ATTEMPTS = 2;

export class AnomalyChecks {
  /** Periods with a successful check (by the model or the server) in this turn. */
  private readonly checked = new Set<string>();
  private readonly attempts = new Map<string, number>();
  /** Model-issued checks still running, by period, resolving to whether they succeeded. */
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /** Server-issued pairs not yet shown to the model, and those already placed in its context. */
  private pending: ModelMessage[][] = [];
  /** Outputs of successful server-issued checks, in order (evidence for the grounding guard). */
  readonly outputs: unknown[] = [];
  private readonly injections: { at: number; messages: ModelMessage[] }[] = [];

  constructor(
    private readonly options: {
      /** The recorded (provenance) detectAnomalies execute, not the model-facing wrapper. */
      detectAnomalies: Execute;
      periodOfInvoice: (invoiceId: string) => Promise<string | null>;
      writer: UIMessageStreamWriter;
    }
  ) {}

  /** Wrap the model-facing tools: invoice results trigger the check; model checks are tracked. */
  wrap(tools: ToolSet): void {
    const invoice = tools.getInvoice.execute as Execute;
    tools.getInvoice.execute = async (input, opts) => {
      const output = await invoice(input, opts);
      await this.afterInvoice((output as { period?: string }).period ?? null);
      return output;
    };
    const explain = tools.explainLineItem.execute as Execute;
    tools.explainLineItem.execute = async (input, opts) => {
      const output = await explain(input, opts);
      const invoiceId = (output as { invoiceId?: string }).invoiceId;
      await this.afterInvoice(
        invoiceId ? await this.options.periodOfInvoice(invoiceId) : null
      );
      return output;
    };
    // A spike in either month can explain a change (evals: august-september-change).
    const compare = tools.compareInvoices.execute as Execute;
    tools.compareInvoices.execute = async (input, opts) => {
      const output = await compare(input, opts);
      const { fromPeriod, toPeriod } = output as {
        fromPeriod?: string;
        toPeriod?: string;
      };
      await this.afterInvoice(toPeriod ?? null);
      await this.afterInvoice(fromPeriod ?? null);
      return output;
    };
    const detect = tools.detectAnomalies.execute as Execute;
    tools.detectAnomalies.execute = async (input, opts) => {
      const period = (input as { period?: string }).period;
      const run = detect(input, opts);
      if (period) {
        const ok = Promise.resolve(run).then(
          () => true,
          () => false
        );
        this.inFlight.set(period, ok);
        void ok.then((succeeded) => {
          if (succeeded) this.checked.add(period);
          if (this.inFlight.get(period) === ok) this.inFlight.delete(period);
        });
      }
      return run;
    };
  }

  private async afterInvoice(period: string | null): Promise<void> {
    if (!period || this.checked.has(period)) return;
    const running = this.inFlight.get(period);
    if (running && (await running)) return;
    const attempt = (this.attempts.get(period) ?? 0) + 1;
    if (attempt > MAX_ATTEMPTS) return;
    this.attempts.set(period, attempt);

    const toolCallId = `srv_anomalies_${period.replace("-", "_")}_${crypto.randomUUID().slice(0, 8)}`;
    const input = { period };
    const { writer } = this.options;
    writer.write({
      type: "tool-input-available",
      toolCallId,
      toolName: "detectAnomalies",
      input
    });
    let result: ModelMessage;
    try {
      const output = await this.options.detectAnomalies(input, {
        toolCallId,
        messages: []
      });
      this.checked.add(period);
      this.outputs.push(output);
      writer.write({ type: "tool-output-available", toolCallId, output });
      result = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "detectAnomalies",
            output: { type: "json", value: output as never }
          }
        ]
      };
    } catch (err) {
      // Shown to the model and the customer, like any failed tool call (the recorded execute
      // stored the same text for provenance).
      const errorText = err instanceof Error ? err.message : String(err);
      console.error("server anomaly check failed", period, errorText);
      writer.write({ type: "tool-output-error", toolCallId, errorText });
      result = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "detectAnomalies",
            output: { type: "error-text", value: errorText }
          }
        ]
      };
    }
    this.pending.push([
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId, toolName: "detectAnomalies", input }
        ]
      },
      result
    ]);
  }

  /**
   * Place pending pairs in the model's context. `prepareStep` messages apply to one step only, so
   * every pair is re-inserted, each time, at the position where it was first added.
   */
  readonly prepareStep: PrepareStepFunction = ({ messages }) => {
    const out = this.withServerResults(messages);
    return out === messages ? undefined : { messages: out };
  };

  /**
   * `messages` with every server-issued pair placed where it was first added (the context the
   * model saw), for prepareStep and for a call outside the step loop such as the grounding retry.
   */
  withServerResults(messages: ModelMessage[]): ModelMessage[] {
    for (const pair of this.pending) {
      this.injections.push({ at: messages.length, messages: pair });
    }
    this.pending = [];
    if (this.injections.length === 0) return messages;
    const out = [...messages];
    let offset = 0;
    for (const injection of this.injections) {
      out.splice(injection.at + offset, 0, ...injection.messages);
      offset += injection.messages.length;
    }
    return out;
  }
}
