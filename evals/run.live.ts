import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildCases } from "./cases";
import { deployedUrl, runLive } from "./live-runner";

test("one deliberate deployed eval run", async () => {
  if (process.env.CI) throw new Error("Live evals never run in CI");
  if (process.env.EVAL_LIVE_READY !== "1")
    throw new Error(
      "Set EVAL_LIVE_READY=1 only after Anna confirms PR #4 merged, main is pulled, and the demo is deployed"
    );
  const baseUrl = deployedUrl(process.env.EVAL_BASE_URL);
  mkdirSync("evals/results", { recursive: true });
  const result = await runLive({
    baseUrl,
    cases: buildCases(),
    saveRecording: (recording) =>
      writeFileSync(
        `evals/recordings/${recording.caseId}.json`,
        `${JSON.stringify(recording, null, 2)}\n`
      ),
    saveResult: (result) =>
      writeFileSync(
        "evals/results/latest-run.json",
        `${JSON.stringify(result, null, 2)}\n`
      )
  });
  console.log(
    `Live ${result.runDate}: ${result.passRate} planned cases passed, ${result.completedCases} completed, ${result.usage.modelCalls} reported model calls; ${result.status}`
  );
  console.log(
    `Reported tokens: ${result.usage.inputTokens} input, ${result.usage.outputTokens} output. Neurons are not exposed by TurnResponse.`
  );
  expect(result.status, result.stopCode ?? "run status").toBe("complete");
  expect(result.passedCases).toBe(result.totalCases);
});
