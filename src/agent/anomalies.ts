// User story 4: the copilot mentions an unusual usage spike proactively. That must not depend on
// Llama 3.3 choosing to call detectAnomalies (in the live run it did not). So whenever a turn's
// tool results include an invoice (getInvoice) or a line explanation (explainLineItem) for a
// period, the server runs detectAnomalies for that period itself, before the next model step, and
// hands the result to the model as a server-issued tool call and result. The same pair is written
// to the chat stream, so it is persisted, shown in the UI and /turn, and recorded in provenance
// like any other tool call.
import type {
  ModelMessage,
  PrepareStepFunction,
  ToolSet,
  UIMessageStreamWriter
} from "ai";

type Execute = NonNullable<ToolSet[string]["execute"]>;

type StepView = {
  toolCalls: readonly { toolName: string; input: unknown }[];
  toolResults: readonly { toolName: string; input: unknown; output: unknown }[];
};

/** Periods whose invoice the model fetched or explained in these steps. */
async function invoicePeriods(
  steps: readonly StepView[],
  periodOfInvoice: (invoiceId: string) => Promise<string | null>
): Promise<string[]> {
  const periods: string[] = [];
  for (const step of steps) {
    for (const r of step.toolResults) {
      if (r.toolName === "getInvoice") {
        const period = (r.output as { period?: string } | undefined)?.period;
        if (period) periods.push(period);
      }
      if (r.toolName === "explainLineItem") {
        const invoiceId = (r.output as { invoiceId?: string } | undefined)
          ?.invoiceId;
        const period = invoiceId ? await periodOfInvoice(invoiceId) : null;
        if (period) periods.push(period);
      }
    }
  }
  return [...new Set(periods)];
}

/** Periods the model already asked detectAnomalies about itself in these steps. */
function modelCheckedPeriods(steps: readonly StepView[]): Set<string> {
  const periods = new Set<string>();
  for (const step of steps) {
    for (const c of step.toolCalls) {
      if (c.toolName !== "detectAnomalies") continue;
      const period = (c.input as { period?: string } | undefined)?.period;
      if (period) periods.add(period);
    }
  }
  return periods;
}

/**
 * A prepareStep that adds a server-issued detectAnomalies call and result for every period whose
 * invoice was fetched or explained and not yet checked. `prepareStep` messages apply to one step
 * only, so each injected pair is re-inserted at the position where it was first added.
 */
export function serverAnomalyChecks(options: {
  detectAnomalies: Execute;
  periodOfInvoice: (invoiceId: string) => Promise<string | null>;
  writer: UIMessageStreamWriter;
}): PrepareStepFunction {
  const injections: { at: number; messages: ModelMessage[] }[] = [];
  const done = new Set<string>();
  return async ({ steps, messages }) => {
    const checked = modelCheckedPeriods(steps);
    for (const period of await invoicePeriods(steps, options.periodOfInvoice)) {
      if (done.has(period) || checked.has(period)) continue;
      done.add(period);
      const toolCallId = `srv_anomalies_${period.replace("-", "_")}_${crypto.randomUUID().slice(0, 8)}`;
      const input = { period };
      let output: unknown;
      try {
        output = await options.detectAnomalies(input, {
          toolCallId,
          messages: []
        });
      } catch (err) {
        console.error("server anomaly check failed", period, err);
        continue;
      }
      options.writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "detectAnomalies",
        input
      });
      options.writer.write({
        type: "tool-output-available",
        toolCallId,
        output
      });
      injections.push({
        at: messages.length,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId,
                toolName: "detectAnomalies",
                input
              }
            ]
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId,
                toolName: "detectAnomalies",
                output: { type: "json", value: output as never }
              }
            ]
          }
        ]
      });
    }
    if (injections.length === 0) return undefined;
    const out = [...messages];
    let offset = 0;
    for (const injection of injections) {
      out.splice(injection.at + offset, 0, ...injection.messages);
      offset += injection.messages.length;
    }
    return { messages: out };
  };
}
