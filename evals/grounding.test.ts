import { describe, expect, test } from "vitest";
import { buildCases } from "./cases";
import { checkReplay } from "./grounding";
import { engine } from "../src/engine";
import type { Recording } from "./recording";

const cases = buildCases();
const fixture = (id = cases[0].id) => {
  const testCase = cases.find((item) => item.id === id)!;
  return structuredClone({
    formatVersion: 1,
    source: "synthetic-engine",
    recordedAt: null,
    seedVersion: engine.seed().seedVersion,
    caseId: id,
    turns: testCase.turns.map((turn) => ({
      customerId: testCase.customerId,
      request: turn.request,
      response: {
        ...turn.fixture,
        usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 }
      }
    }))
  }) as Recording;
};

describe("eval defect guards", () => {
  test.each(cases)(
    "accepts the known-good engine answer for $id",
    (testCase) => {
      expect(checkReplay(testCase, fixture(testCase.id))).toEqual([]);
    }
  );
  test("covers all six stories with 12 to 15 cases and confirms only credit starts", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.length).toBeLessThanOrEqual(15);
    expect(new Set(cases.map((testCase) => testCase.story)).size).toBe(6);
    for (const testCase of cases) {
      for (const turn of testCase.turns) {
        expect(turn.request.confirm).toBe(
          turn.fixture.toolCalls.some(
            (call) => call.name === "startCreditRequest"
          )
        );
      }
    }
  });

  test("rejects a planted wrong amount even when all expected values still appear", () => {
    const recording = fixture();
    recording.turns[0].response.text += " Extra cost: $999,999.99.";
    expect(checkReplay(cases[0], recording)).toContain(
      "Turn 0: ungrounded money $999,999.99"
    );
  });

  test("rejects a missing expected amount despite otherwise grounded prose", () => {
    const recording = fixture();
    recording.turns[0].response.text = "Please check your invoice.";
    expect(
      checkReplay(cases[0], recording).some((issue) =>
        issue.includes("missing expected")
      )
    ).toBe(true);
  });

  test.each([
    "$412.870",
    "$412",
    "USD 412.87",
    "412.87 dollars",
    "41287 cents",
    "$ 412.87"
  ])("rejects noncanonical or unsupported money %s", (amount) => {
    const recording = fixture();
    recording.turns[0].response.text += ` Additional amount ${amount}.`;
    expect(
      checkReplay(cases[0], recording).some((issue) =>
        issue.includes(`ungrounded money ${amount}`)
      )
    ).toBe(true);
  });

  test("validates tool inputs and outputs beyond the HTTP envelope", () => {
    const recording = fixture();
    recording.turns[0].response.toolCalls[0].input = {};
    expect(checkReplay(cases[0], recording)[0]).toContain("Invalid recording");
    const invalidOutput = fixture();
    (
      invalidOutput.turns[0].response.toolCalls[0].output as {
        total: { display: string };
      }
    ).total.display = "$0.01";
    expect(checkReplay(cases[0], invalidOutput)[0]).toContain(
      "Invalid recording"
    );
  });

  test("rejects failed tools and missing or mismatched turns", () => {
    const recording = fixture();
    recording.turns[0].response.toolCalls[0].error = "Tool failed";
    expect(checkReplay(cases[0], recording)[0]).toContain("Invalid recording");
    const extra = fixture();
    extra.turns.push(extra.turns[0]);
    expect(checkReplay(cases[0], extra)).toContain(
      "Recording turn count mismatch"
    );
    const wrongCustomer = fixture();
    wrongCustomer.turns[0].customerId = "cus_2";
    expect(checkReplay(cases[0], wrongCustomer)).toContain(
      "Turn 0: customer mismatch"
    );
  });

  test("allows recovery after a rejected tool call without trusting its failed output or input", () => {
    const recording = fixture();
    recording.turns[0].response.toolCalls.unshift({
      name: "getInvoice",
      input: {},
      output: null,
      error: "Invalid input"
    });
    expect(checkReplay(cases[0], recording)).toEqual([]);
    recording.turns[0].response.toolCalls[0].input = { count: 42 };
    recording.turns[0].response.text += " There were 42 entries.";
    expect(checkReplay(cases[0], recording)).toContain(
      "Turn 0: ungrounded number 42"
    );
  });

  test("a confirmed credit answer requires a successful request receipt", () => {
    const creditCase = cases.find((item) => item.id === "duplicate-credit")!;
    const recording = fixture(creditCase.id);
    const call = recording.turns[0].response.toolCalls.find(
      (item) => item.name === "startCreditRequest"
    )!;
    call.output = null;
    call.error = "Rejected request";
    expect(checkReplay(creditCase, recording)).toContain(
      "Turn 0: missing successful credit request"
    );
  });

  test("requires proactive anomaly meaning and engine date/multiplier", () => {
    const recording = fixture();
    recording.turns[0].response.text = recording.turns[0].response.text.replace(
      /Unusual usage spike./,
      ""
    );
    expect(
      checkReplay(cases[0], recording).some((issue) =>
        issue.includes("missing meaning")
      )
    ).toBe(true);
  });

  test("rejects invented non-money numbers", () => {
    const recording = fixture();
    recording.turns[0].response.text += " Spike was 99x.";
    expect(checkReplay(cases[0], recording)).toContain(
      "Turn 0: ungrounded number 99x"
    );
  });

  const anomalyCase = cases.find((item) => item.id === "september-anomaly")!;
  const anomalyAnswer = (text: string) => {
    const recording = fixture(anomalyCase.id);
    recording.turns[0].response.text = `Usage spike. ${anomalyCase.turns[0].expected.filter((value) => !/^\d{4}-/.test(value)).join("; ")}. ${text}`;
    return checkReplay(anomalyCase, recording);
  };

  test.each([
    "In September 2026 the spike fell on September 18.",
    "The spike was on September 18, 2026.",
    "The spike was on the 18th of September 2026.",
    "The spike was on Sept. 18th."
  ])("accepts a natural calendar date grounded by the engine: %s", (text) => {
    expect(anomalyAnswer(text)).toEqual([]);
  });

  test("rejects a wrong natural date and still requires the engine date", () => {
    const issues = anomalyAnswer(
      "In September 2026 the spike fell on September 19."
    );
    expect(issues).toContain("Turn 0: ungrounded number 2026-09-19");
    expect(issues).toContain("Turn 0: missing expected 2026-09-18");
  });

  test("rejects a fabricated full date built from separately grounded parts", () => {
    expect(
      anomalyAnswer(
        "September 18, 2026 was a spike; another on September 3, 2026."
      )
    ).toContain("Turn 0: ungrounded number 2026-09-03");
  });

  test("rejects a named day whose month has no grounded period", () => {
    expect(
      anomalyAnswer(
        "September 18, 2026 was a spike; it may recur on October 2."
      )
    ).toContain("Turn 0: ungrounded date October 2");
  });

  test("still rejects invented numbers and money beside natural date wording", () => {
    const issues = anomalyAnswer(
      "In September 2026 the spike on September 18 added 42 requests and $7.00."
    );
    expect(issues).toContain("Turn 0: ungrounded number 42");
    expect(issues).toContain("Turn 0: ungrounded money $7.00");
  });

  const creditAnswer = (id: string, turn: number, text: string) => {
    const testCase = cases.find((item) => item.id === id)!;
    const recording = fixture(id);
    recording.turns[turn].response.text += ` ${text}`;
    return checkReplay(testCase, recording);
  };

  test.each([
    "The approval deadline is October 4, 2026.",
    "The approval deadline is October 4.",
    "It was created on 2026-10-03 and is due by 2026-10-04."
  ])("accepts a deadline date taken from a UTC timestamp: %s", (text) => {
    expect(creditAnswer("remember-credit", 1, text)).toEqual([]);
  });

  test("rejects a fabricated deadline date beside a grounded timestamp", () => {
    expect(
      creditAnswer(
        "remember-credit",
        1,
        "The approval deadline is October 5, 2026."
      )
    ).toContain("Turn 1: ungrounded number 2026-10-05");
  });

  test("grounds month-year wording from a complete timestamp", () => {
    expect(
      creditAnswer("remember-credit", 1, "The deadline is in October 2026.")
    ).toEqual([]);
  });

  const countCase = cases.find((item) => item.id === "zero-tax-invoice")!;
  test("grounds an invoice line count from the engine's actual line array", () => {
    expect(checkReplay(countCase, fixture(countCase.id))).toEqual([]);
  });

  test("does not mistake an ISO month next to invoice for a count", () => {
    const recording = fixture(countCase.id);
    recording.turns[0].response.text += " This is the 2026-09 invoice.";
    expect(checkReplay(countCase, recording)).toEqual([]);
  });
  test.each(["7 lines", "seven invoice lines"])(
    "rejects an incorrect line count %s even if that number appears elsewhere",
    (claim) => {
      const recording = fixture(countCase.id);
      const output = recording.turns[0].response.toolCalls[0].output as {
        lines: { quantity: number | null }[];
      };
      output.lines[0].quantity = 7;
      recording.turns[0].response.text += ` The invoice has ${claim}.`;
      expect(checkReplay(countCase, recording)).toContain(
        "Turn 0: ungrounded count 7 lines"
      );
    }
  );
  test("rejects invented counts outside money and invoice lines", () => {
    const recording = fixture(countCase.id);
    recording.turns[0].response.text += " There were ninety-nine requests.";
    expect(checkReplay(countCase, recording)).toContain(
      "Turn 0: ungrounded number 99"
    );
  });

  test.each(["-99", "1e9", "1/99", "99k"])(
    "checks signed, fractional and compact numeric tokens %s",
    (token) => {
      const recording = fixture(countCase.id);
      recording.turns[0].response.text += ` Usage was ${token}.`;
      expect(checkReplay(countCase, recording)).toContain(
        `Turn 0: ungrounded number ${token}`
      );
    }
  );

  test.each([
    "ninety-nine dollars",
    "ninety-nine cents",
    "ninety-nine dollar",
    "ninety-nine cent"
  ])("rejects an invented amount written as %s", (phrase) => {
    const recording = fixture(countCase.id);
    recording.turns[0].response.text += ` Another charge was ${phrase}.`;
    expect(checkReplay(countCase, recording)).toContain(
      `Turn 0: ungrounded money ${phrase.replace("ninety-nine", "99")}`
    );
  });

  test("grounds a singular invoice and ordinal line reference", () => {
    const recording = fixture(countCase.id);
    recording.turns[0].response.text +=
      " One invoice was issued in 2026. The first line is a subscription.";
    expect(checkReplay(countCase, recording)).toEqual([]);
  });

  test("grounds only the UTC calendar date of a non-midnight timestamp", () => {
    expect(
      creditAnswer(
        "expired-credit-history",
        0,
        "It expired on October 2, 2026."
      )
    ).toEqual([]);
    expect(
      creditAnswer("expired-credit-history", 0, "It expired on October 9.")
    ).toContain("Turn 0: ungrounded number 2026-10-09");
  });

  test("accepts amounts quoted from engine-written tool narratives", () => {
    const testCase = cases.find(
      (item) => item.id === "august-september-change"
    )!;
    const recording = fixture(testCase.id);
    recording.turns[0].response.text += ` ${(recording.turns[0].response.toolCalls[0].output as { summary: string }).summary}`;
    expect(checkReplay(testCase, recording)).toEqual([]);
  });

  test("cannot ground an earlier answer using a future response", () => {
    const testCase = cases.find((item) => item.id === "remember-plan")!;
    const recording = fixture(testCase.id);
    const laterInvoice =
      fixture("zero-tax-invoice").turns[0].response.toolCalls[0];
    const amount = (laterInvoice.output as { total: { display: string } }).total
      .display;
    recording.turns[0].response.text += ` Future ${amount}.`;
    recording.turns[1].response.toolCalls.push(laterInvoice);
    expect(checkReplay(testCase, recording)).toContain(
      `Turn 0: ungrounded money ${amount}`
    );
  });
});
