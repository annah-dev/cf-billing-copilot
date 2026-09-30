import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { buildCases } from "./cases";
import { checkReplay } from "./grounding";
import type { RunResult } from "./live-runner";

test("regrade immutable captures after the demonstrated count-parser correction", () => {
  const path = process.env.EVAL_REGRADE_RESULTS;
  if (!path)
    throw new Error("Set EVAL_REGRADE_RESULTS to the captured run JSON");
  const result: RunResult & { initialGrading?: unknown; regradedAt?: string } =
    JSON.parse(readFileSync(path, "utf8"));
  result.initialGrading = {
    cases: result.cases,
    passRate: result.passRate,
    passedCases: result.passedCases
  };
  result.regradedAt = new Date().toISOString();
  const cases = buildCases();
  const dir = `evals/recordings/runs/${result.runDate.replaceAll(":", "-")}`;
  result.cases = result.cases.map((entry) => {
    const testCase = cases.find((item) => item.id === entry.id)!;
    const issues = checkReplay(
      testCase,
      JSON.parse(readFileSync(`${dir}/${entry.id}.json`, "utf8"))
    );
    return { id: entry.id, passed: issues.length === 0, issues };
  });
  result.passedCases = result.cases.filter((entry) => entry.passed).length;
  result.passRate = `${result.passedCases}/${result.totalCases}`;
  const text = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(path, text);
  writeFileSync("evals/results/latest-run.json", text);
  console.log(
    `Corrected grading: ${result.passRate}; model responses and usage unchanged.`
  );
});
