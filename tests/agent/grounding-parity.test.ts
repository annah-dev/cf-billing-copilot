// The runtime guard (src/agent/grounding.ts) and the eval grader (evals/grounding.ts) apply the
// same grounding rule from two copies of the code (src/ must not import evals/). This test runs
// both over every committed recording, active and archived, and requires that they flag the same
// figures on every turn, so the copies cannot drift apart unnoticed.
import { describe, expect, it } from "vitest";
import { buildCases } from "../../evals/cases";
import { checkReplay } from "../../evals/grounding";
import { collectEvidence, unsupportedFigures } from "../../src/agent/grounding";

type Recording = {
  caseId: string;
  turns: {
    request: { message: string };
    response: {
      text: string;
      toolCalls: { output: unknown; error: string | null }[];
    };
  }[];
};

const recordings = import.meta.glob<Recording>(
  "../../evals/recordings/**/*.json",
  { eager: true, import: "default" }
);

/** "Turn 1: ungrounded count 7 lines" -> [1, "7 lines"]; other issues are not grounding. */
function graderFigure(issue: string): [number, string] | null {
  const m = /^Turn (\d+): ungrounded (?:money|count|number|date) (.+)$/.exec(
    issue
  );
  return m ? [Number(m[1]), m[2]] : null;
}

describe("guard and grader agree", () => {
  const cases = new Map(buildCases().map((c) => [c.id, c]));
  const files = Object.entries(recordings);

  it("finds the committed recordings", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)("flags the same figures as the grader: %s", (_path, rec) => {
    const testCase = cases.get(rec.caseId);
    expect(testCase, rec.caseId).toBeDefined();
    const fromGrader = rec.turns.map(() => new Set<string>());
    for (const issue of checkReplay(testCase!, rec)) {
      const found = graderFigure(issue);
      if (found) fromGrader[found[0]].add(found[1]);
    }
    rec.turns.forEach((turn, index) => {
      const evidence = collectEvidence(
        turn.response.toolCalls
          .filter((c) => c.error === null && c.output !== null)
          .map((c) => c.output),
        turn.request.message
      );
      expect(
        new Set(unsupportedFigures(turn.response.text, evidence)),
        `turn ${index}: ${turn.response.text}`
      ).toEqual(fromGrader[index]);
    });
  });
});
