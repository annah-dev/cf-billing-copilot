import { describe, expect, it } from "vitest";
import { engine } from "../../src/engine";
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
  it("copies comparison, simulation and anomaly outputs from the shared engine", () => {
    const data = engine.seed();
    const session = fixtureSession();
    const panel = fixturePanel(session, session.customers[0].customerId);
    const comparison = fixtureAnswer("What changed since August?", panel, data);
    expect(validatedTool(comparison.parts[0])?.output?.data).toEqual(
      engine.compareInvoices(
        data,
        panel.customerId,
        "2026-08",
        panel.currentInvoice.period
      )
    );
    const simulation = fixtureAnswer("What would I pay on Pro?", panel, data);
    const pro = data.plans.find((plan) => plan.name === "Pro")!;
    expect(validatedTool(simulation.parts[0])?.output?.data).toEqual(
      engine.simulatePlan(
        data,
        panel.customerId,
        panel.currentInvoice.period,
        pro.id
      )
    );
    const anomalies = fixtureAnswer("Show unusual usage spikes", panel, data);
    expect(validatedTool(anomalies.parts[1])?.output?.data).toEqual(
      engine.detectAnomalies(
        data,
        panel.customerId,
        panel.currentInvoice.period
      )
    );
  });
  it("uses the seeded duplicate id and refuses unsupported duplicate claims", () => {
    const data = engine.seed();
    const session = fixtureSession();
    const panel = fixturePanel(session, session.customers[0].customerId);
    const claim = engine.validateCreditClaim(
      data,
      {
        customerId: panel.customerId,
        invoiceId: panel.currentInvoice.id,
        disputedLedgerEntryId: null
      },
      data.creditMemos
    );
    if (!claim.valid) throw new Error("Seed has no duplicate");
    expect(
      validatedTool(fixtureAnswer("I was double-charged", panel, data).parts[1])
        ?.input?.data
    ).toMatchObject({ disputedLedgerEntryId: claim.disputedLedgerEntryId });
    const other = fixturePanel(session, session.customers[1].customerId);
    expect(
      fixtureAnswer("I was double-charged", other, data).parts.some(
        (part) => validatedTool(part)?.part.state === "approval-requested"
      )
    ).toBe(false);
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
    expect(answer.parts.at(-1)).toMatchObject({
      type: "text",
      text: expect.stringContaining(panel.currentInvoice.total.display)
    });
    expect(() => fixtureAnswer(" ", panel)).toThrow();
  });
});
