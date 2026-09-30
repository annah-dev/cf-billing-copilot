import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { format, type FormatConfig } from "oxfmt";
import { buildCases } from "./cases";
import { RecordingSchema } from "./recording";
import {
  grade,
  recordingDigest,
  summarize,
  type GradedRun,
  type ReplayResults
} from "./report";

test("regrade every committed recording with the same grader, preserving raw results", async () => {
  if (process.env.EVAL_REGRADE_ALL !== "1")
    throw new Error("Set EVAL_REGRADE_ALL=1 to explicitly update all verdicts");
  const now = new Date().toISOString();
  const cases = buildCases();
  const digests: Record<string, string> = {};
  const read = (path: string) => {
    const bytes = readFileSync(`evals/${path}`, "utf8");
    digests[path] = recordingDigest(bytes);
    return RecordingSchema.parse(JSON.parse(bytes));
  };
  const runFiles = readdirSync("evals/results")
    .filter((name) => /^run-.*\.json$/.test(name))
    .sort();
  const runs = runFiles.map((name) => {
    const result: GradedRun = JSON.parse(
      readFileSync(`evals/results/${name}`, "utf8")
    );
    const previous = summarize(result.cases, result.totalCases);
    result.initialGrading ??= previous;
    const dir = `recordings/runs/${result.runDate.replaceAll(":", "-")}`;
    const expectedFiles = result.cases.map((item) => `${item.id}.json`).sort();
    const actualFiles = readdirSync(`evals/${dir}`).sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles))
      throw new Error(`Archived recordings differ from run cases: ${name}`);
    const corrected = summarize(
      result.cases.map((entry) => {
        const testCase = cases.find((item) => item.id === entry.id);
        if (!testCase) throw new Error(`Unknown case ${entry.id}`);
        return grade(testCase, read(`${dir}/${entry.id}.json`));
      }),
      result.totalCases
    );
    if (JSON.stringify(previous) !== JSON.stringify(corrected)) {
      result.gradingHistory = [
        ...(result.gradingHistory ?? []),
        {
          ...previous,
          gradedAt: result.regradedAt ?? result.runDate
        }
      ];
    }
    Object.assign(result, corrected, { regradedAt: now });
    return { name, result };
  });
  const archiveDirs = readdirSync("evals/recordings/runs").sort();
  const expectedDirs = runs
    .map(({ result }) => result.runDate.replaceAll(":", "-"))
    .sort();
  if (JSON.stringify(archiveDirs) !== JSON.stringify(expectedDirs))
    throw new Error("Every archived run must have a results file");
  const active = cases.map((testCase) => ({
    testCase,
    recording: read(`recordings/${testCase.id}.json`)
  }));
  const first = active[0].recording;
  if (first.source !== "live" || !first.baseUrl || !first.environment)
    throw new Error("The captured snapshot requires live target metadata");
  const { baseUrl, environment } = first;
  if (
    active.some(
      ({ recording }) =>
        recording.source !== "live" ||
        recording.baseUrl !== baseUrl ||
        recording.environment !== environment
    )
  )
    throw new Error("Snapshot must use one target and environment");
  const targetRuns = runs.filter(({ result }) => result.baseUrl === baseUrl);
  const snapshot: ReplayResults = {
    formatVersion: 1,
    kind: "latest-recordings snapshot",
    baseUrl,
    environment,
    runDate: targetRuns.at(-1)!.result.runDate,
    regradedAt: now,
    modelCallCount: targetRuns.reduce(
      (sum, { result }) => sum + result.modelCallCount,
      0
    ),
    estimatedNeurons: targetRuns.reduce(
      (sum, { result }) => sum + result.estimatedNeurons,
      0
    ),
    usageScope: "all captured attempts at this target",
    sourceRuns: targetRuns.map(({ name }) => name),
    recordingSha256: digests,
    rawGrading: summarize(
      active.map(({ testCase, recording }) => {
        const run = targetRuns
          .filter(({ result }) =>
            result.cases.some((item) => item.id === testCase.id)
          )
          .at(-1);
        const archived = `recordings/runs/${run!.result.runDate.replaceAll(":", "-")}/${testCase.id}.json`;
        if (digests[`recordings/${testCase.id}.json`] !== digests[archived])
          throw new Error(
            `Active recording is not the latest attempt: ${testCase.id}`
          );
        const raw = run?.result.initialGrading?.cases.find(
          (item) => item.id === testCase.id
        );
        if (!raw) throw new Error(`Missing raw verdict for ${testCase.id}`);
        return raw;
      })
    ),
    ...summarize(
      active.map(({ testCase, recording }) => grade(testCase, recording))
    )
  };
  // Writes are explicit and occur only after all recordings were graded successfully.
  const config: FormatConfig = JSON.parse(
    readFileSync(".oxfmtrc.json", "utf8")
  );
  const files = [
    ...runs.map(({ name, result }) => ({ path: name, value: result })),
    { path: "latest-run.json", value: runs.at(-1)!.result },
    { path: "replay.json", value: snapshot }
  ];
  const formatted = await Promise.all(
    files.map(async ({ path, value }) => {
      const result = await format(path, JSON.stringify(value, null, 2), config);
      if (result.errors.length) throw new Error(`Cannot format report ${path}`);
      return { path, code: result.code };
    })
  );
  for (const { path, code } of formatted)
    writeFileSync(`evals/results/${path}`, code);
  console.log(
    `All ${Object.keys(digests).length} recordings regraded; latest snapshot ${snapshot.passRate}. Zero model calls.`
  );
});
