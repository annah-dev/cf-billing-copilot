import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  ToolSchemas,
  type ToolName,
  type ToolInput,
  type ToolOutput
} from "../contracts/tools";
import { TurnRequestSchema, type PanelResponse } from "../contracts/http";
import { type BillingDataset } from "../contracts/engine";
import { engine } from "../engine";

export function validatedTool(part: UIMessage["parts"][number]) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  if (!Object.hasOwn(ToolSchemas, name)) return null;
  const schema = ToolSchemas[name as ToolName];
  const input =
    part.state === "input-streaming"
      ? null
      : schema.input.safeParse(part.input);
  const output =
    part.state === "output-available"
      ? schema.output.safeParse(part.output)
      : null;
  return { name: name as ToolName, part, input, output };
}
export function displayValues(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if ("display" in value && typeof value.display === "string")
    return [value.display];
  return Object.values(value).flatMap(displayValues);
}
function completedTool<N extends ToolName>(
  name: N,
  input: ToolInput<N>,
  output: ToolOutput<N>
): UIMessage["parts"][number] {
  return {
    type: `tool-${name}`,
    toolCallId: crypto.randomUUID(),
    state: "output-available",
    input: ToolSchemas[name].input.parse(input),
    output: ToolSchemas[name].output.parse(output)
  };
}
export function fixtureAnswer(
  message: string,
  panel: PanelResponse,
  data: BillingDataset = engine.seed()
): UIMessage {
  TurnRequestSchema.parse({ message });
  const { customerId, currentInvoice: invoice } = panel;
  const parts: UIMessage["parts"][number][] = [];
  let text: string;
  if (/credit|double|duplicate/i.test(message)) {
    const claim = engine.validateCreditClaim(
      data,
      { customerId, invoiceId: invoice.id, disputedLedgerEntryId: null },
      data.creditMemos
    );
    if (claim.valid) {
      const input = ToolSchemas.startCreditRequest.input.parse({
        invoiceId: invoice.id,
        disputedLedgerEntryId: claim.disputedLedgerEntryId,
        reason: message
      });
      parts.push(
        {
          type: "text",
          text: `${claim.explanation} Confirm the request to send it for human approval.`
        },
        {
          type: "tool-startCreditRequest",
          toolCallId: crypto.randomUUID(),
          state: "approval-requested",
          input,
          approval: { id: crypto.randomUUID() }
        }
      );
      return { id: crypto.randomUUID(), role: "assistant", parts };
    }
    const requests = data.creditRequests
      .filter((request) => request.customerId === customerId)
      .map((request) => ({
        request,
        audit: data.audit.filter((record) => record.subject.id === request.id)
      }));
    parts.push(completedTool("getCreditRequestStatus", {}, { requests }));
    text = claim.explanation;
  } else if (/changed|august|compare/i.test(message)) {
    const previous = data.invoices
      .filter(
        (item) => item.customerId === customerId && item.period < invoice.period
      )
      .sort((a, b) => b.period.localeCompare(a.period))[0];
    if (!previous)
      throw new Error("Seed has no earlier invoice for comparison");
    const comparison = engine.compareInvoices(
      data,
      customerId,
      previous.period,
      invoice.period
    );
    parts.push(
      completedTool(
        "compareInvoices",
        { fromPeriod: previous.period, toPeriod: invoice.period },
        comparison
      )
    );
    text = comparison.summary;
  } else if (/plan|pro/i.test(message)) {
    const plan = data.plans.find((item) =>
      message.toLowerCase().includes(item.name.toLowerCase())
    );
    if (!plan) throw new Error("Choose a plan from the seeded plan catalog");
    const simulation = engine.simulatePlan(
      data,
      customerId,
      invoice.period,
      plan.id
    );
    parts.push(
      completedTool(
        "simulatePlan",
        { period: invoice.period, planId: plan.id },
        simulation
      )
    );
    text = `${plan.name} would cost ${simulation.simulatedTotal.display} for the same usage, compared with ${simulation.actualTotal.display}. Difference (simulated minus actual): ${simulation.difference.display}. ${simulation.assumptions.join(" ")}`;
  } else {
    const billed = engine.buildInvoice(data, customerId, invoice.period);
    parts.push(completedTool("getInvoice", { invoiceId: billed.id }, billed));
    text = /spike|anomal/i.test(message)
      ? ""
      : `Your ${billed.period} invoice is ${billed.total.display}. ${billed.lines.map((line) => `${line.description}: ${line.amount.display}.`).join(" ")} `;
    const anomalies = engine.detectAnomalies(data, customerId, invoice.period);
    parts.push(
      completedTool("detectAnomalies", { period: invoice.period }, anomalies)
    );
    text += anomalies.anomalies.length
      ? anomalies.anomalies
          .map(
            (anomaly) =>
              `${anomaly.meterName} on ${anomaly.date}: ${anomaly.multiple.display} the engine baseline; estimated excess cost ${anomaly.estimatedExcessCost.display}.`
          )
          .join(" ")
      : "The engine found no unusual daily usage in this period.";
  }
  parts.push({ type: "text", text });
  return { id: crypto.randomUUID(), role: "assistant", parts };
}
export const suggestions = [
  "Explain my September invoice",
  "What changed since August?",
  "What would I pay on Pro?",
  "I was double-charged. Can I request a credit?"
];
