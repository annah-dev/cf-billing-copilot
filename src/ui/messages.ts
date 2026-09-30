import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { ToolSchemas, type ToolName } from "../contracts/tools";
import { TurnRequestSchema, type PanelResponse } from "../contracts/http";

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
export function fixtureAnswer(
  message: string,
  panel: PanelResponse
): UIMessage {
  TurnRequestSchema.parse({ message });
  const credit = /credit|double|duplicate/i.test(message);
  if (credit)
    return {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "The invoice debit appears twice in this preview. Confirm the request below to send it for human approval."
        },
        {
          type: "tool-startCreditRequest",
          toolCallId: crypto.randomUUID(),
          state: "approval-requested",
          input: {
            invoiceId: panel.currentInvoice.id,
            disputedLedgerEntryId: "le_duplicate",
            reason: message
          },
          approval: { id: crypto.randomUUID() }
        }
      ]
    };
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "tool-getInvoice",
        toolCallId: crypto.randomUUID(),
        state: "output-available",
        input: { invoiceId: panel.currentInvoice.id },
        output: ToolSchemas.getInvoice.output.parse(panel.currentInvoice)
      },
      {
        type: "text",
        text: `Your September invoice is ${panel.currentInvoice.total.display}. ${panel.currentInvoice.lines.map((line) => `${line.description}: ${line.amount.display}.`).join(" ")} These values are illustrative fixture data. The live copilot uses the billing engine to explain changes, simulate plans and detect anomalies.`
      }
    ]
  };
}
export const suggestions = [
  "Explain my September invoice",
  "What changed since August?",
  "What would I pay on Pro?",
  "I was double-charged. Can I request a credit?"
];
