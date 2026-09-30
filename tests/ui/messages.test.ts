import { describe, expect, it } from "vitest";
import { type UIMessage } from "ai";
import {
  displayValues,
  fixtureAnswer,
  validatedTool
} from "../../src/ui/messages";
import { fixturePanel, fixtureSession } from "../../src/ui/fixtures";

describe("tool evidence and confirmation", () => {
  it("copies Money, Percent and Multiple display strings without formatting numeric fields", () => {
    expect(
      displayValues({
        amount: { cents: 41287, display: "$412.87" },
        percent: { basisPoints: 3800, display: "38%" },
        spike: { hundredths: 500, display: "5x" }
      })
    ).toEqual(["$412.87", "38%", "5x"]);
  });
  it("validates both tool boundaries and rejects unknown tool names", () => {
    const part: UIMessage["parts"][number] = {
      type: "tool-getInvoice",
      toolCallId: "call",
      state: "output-available",
      input: { period: "2026-09" },
      output: {}
    };
    const tool = validatedTool(part);
    expect(tool?.input?.success).toBe(true);
    expect(tool?.output?.success).toBe(false);
    expect(validatedTool({ ...part, input: {} })?.input?.success).toBe(false);
    expect(validatedTool({ ...part, type: "tool-toString" })).toBeNull();
    expect(validatedTool({ type: "text", text: "answer" })).toBeNull();
  });
  it("waits for customer approval before starting a credit and validates the claim", () => {
    const session = fixtureSession();
    const panel = fixturePanel(session, session.customers[0].customerId);
    const answer = fixtureAnswer("I was double-charged", panel);
    const tool = validatedTool(answer.parts[1]);
    expect(tool?.name).toBe("startCreditRequest");
    expect(tool?.part.state).toBe("approval-requested");
    expect(tool?.input?.success).toBe(true);
    expect(panel.creditRequests).toHaveLength(1);
  });
  it("grounds the fixture invoice answer in a validated tool output", () => {
    const session = fixtureSession();
    const panel = fixturePanel(session, session.customers[0].customerId);
    const answer = fixtureAnswer("Explain my invoice", panel);
    expect(validatedTool(answer.parts[0])?.output?.success).toBe(true);
    expect(answer.parts[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining(panel.currentInvoice.total.display)
    });
    expect(() => fixtureAnswer(" ", panel)).toThrow();
  });
});
