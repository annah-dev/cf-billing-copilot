import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildCases } from "./cases";
import { deployedUrl, runLive, type RunResult } from "./live-runner";

test("one deliberate live eval run", async () => {
  if (process.env.CI) throw new Error("Live evals never run in CI");
  if (process.env.EVAL_LIVE_READY !== "1")
    throw new Error(
      "Set EVAL_LIVE_READY=1 after the owner confirms live capture and merged main is pulled"
    );
  const baseUrl = deployedUrl(process.env.EVAL_BASE_URL);
  const allCases = buildCases();
  const previousPath =
    process.env.EVAL_PREVIOUS_RESULTS ?? "evals/results/latest-run.json";
  const previous: RunResult | null = existsSync(previousPath)
    ? JSON.parse(readFileSync(previousPath, "utf8"))
    : null;
  const selectedIds = process.env.EVAL_CASE_IDS?.split(",").filter(Boolean);
  if (!selectedIds && previous?.baseUrl === baseUrl)
    throw new Error(
      "A full run already exists for this target; select previously failing questions with EVAL_CASE_IDS"
    );
  if (
    selectedIds &&
    (!previous ||
      selectedIds.some(
        (id) => !previous.cases.some((item) => item.id === id && !item.passed)
      ))
  )
    throw new Error("Only previously failing questions may be rerun");
  const cases = selectedIds
    ? allCases.filter((item) => selectedIds.includes(item.id))
    : allCases;
  if (selectedIds && cases.length !== new Set(selectedIds).size)
    throw new Error("Unknown eval case id");
  mkdirSync("evals/results", { recursive: true });
  const resultPath = `evals/results/run-${new Date().toISOString().replaceAll(":", "-")}.json`;
  const result = await runLive({
    baseUrl,
    cases,
    reuseSandboxes: selectedIds ? previous?.sandboxes : undefined,
    saveRecording: (recording) =>
      writeFileSync(
        `evals/recordings/${recording.caseId}.json`,
        `${JSON.stringify(recording, null, 2)}\n`
      ),
    saveResult: (result) => {
      const text = `${JSON.stringify(result, null, 2)}\n`;
      writeFileSync(resultPath, text);
      writeFileSync("evals/results/latest-run.json", text);
    }
  });
  console.log(
    `${result.environment} ${result.runDate} ${result.baseUrl}: ${result.passRate} planned cases passed, ${result.completedCases} completed; ${result.status}`
  );
  console.log(
    `Reported model calls: ${result.modelCallCount}. Estimated neurons: ${result.estimatedNeurons}. Tokens: ${result.usage.inputTokens} input, ${result.usage.outputTokens} output.`
  );
  expect(result.status, result.stopCode ?? "run status").toBe("complete");
  expect(result.passedCases).toBe(result.totalCases);
});
