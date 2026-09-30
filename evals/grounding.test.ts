import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildCases } from "./cases";
import { checkReplay } from "./grounding";

const cases = buildCases();
const fixture = (id = cases[0].id) =>
  JSON.parse(
    readFileSync(new URL(`./recordings/${id}.json`, import.meta.url), "utf8")
  );

describe("eval defect guards", () => {
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
    invalidOutput.turns[0].response.toolCalls[0].output.total.display = "$0.01";
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
    recording.turns[0].response.text = `Usage spike. $11.60; 15000; 3000; 5x. ${text}`;
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
    recording.turns[0].response.text += ` ${recording.turns[0].response.toolCalls[0].output.summary}`;
    expect(checkReplay(testCase, recording)).toEqual([]);
  });

  test("cannot ground an earlier answer using a future response", () => {
    const testCase = cases.find((item) => item.id === "remember-plan")!;
    const recording = fixture(testCase.id);
    const laterInvoice =
      fixture("zero-tax-invoice").turns[0].response.toolCalls[0];
    const amount = laterInvoice.output.total.display;
    recording.turns[0].response.text += ` Future ${amount}.`;
    recording.turns[1].response.toolCalls.push(laterInvoice);
    expect(checkReplay(testCase, recording)).toContain(
      `Turn 0: ungrounded money ${amount}`
    );
  });
});
