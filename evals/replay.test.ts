import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { engine } from "../src/engine";
import { buildCases } from "./cases";
import { RecordingSchema } from "./recording";
import {
  grade,
  summarize,
  recordingDigest,
  type GradedRun,
  type ReplayResults
} from "./report";

const cases = buildCases();
export const readRecording = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`./recordings/${id}.json`, import.meta.url), "utf8")
  );
const read = (path: string) =>
  readFileSync(new URL(`./${path}`, import.meta.url), "utf8");
const snapshot: ReplayResults = JSON.parse(read("results/replay.json"));
const runNames = readdirSync(new URL("./results/", import.meta.url))
  .filter((name) => /^run-.*\.json$/.test(name))
  .sort();
const runs = runNames.map((name) => ({
  name,
  result: JSON.parse(read(`results/${name}`)) as GradedRun
}));
const verify = (path: string, id: string) => {
  const testCase = cases.find((item) => item.id === id)!;
  const bytes = read(path);
  expect(recordingDigest(bytes)).toBe(snapshot.recordingSha256[path]);
  const recording = RecordingSchema.parse(JSON.parse(bytes));
  expect(recording.seedVersion).toBe(engine.seed().seedVersion);
  return { recording, verdict: grade(testCase, recording) };
};

const sources = cases.map(
  (testCase) => RecordingSchema.parse(readRecording(testCase.id)).source
);
const live = sources.filter((source) => source === "live").length;
const synthetic = sources.filter(
  (source) => source === "synthetic-engine"
).length;

describe("billing eval replay", () => {
  for (const testCase of cases) {
    test(`${testCase.id} [${testCase.story}]`, () => {
      const { verdict } = verify(`recordings/${testCase.id}.json`, testCase.id);
      expect(verdict).toEqual(
        snapshot.cases.find((item) => item.id === testCase.id)
      );
    });
  }

  test(`reports recording sources: ${live} live, ${synthetic} synthetic-engine of ${cases.length} cases`, () => {
    expect(live + synthetic).toBe(cases.length);
  });

  for (const { name, result } of runs) {
    for (const expected of result.cases) {
      test(`archived ${name}: ${expected.id} matches its committed verdict`, () => {
        const path = `recordings/runs/${result.runDate.replaceAll(":", "-")}/${expected.id}.json`;
        const { recording, verdict } = verify(path, expected.id);
        expect(verdict).toEqual(expected);
        expect(recording.source).toBe("live");
        if (recording.source === "live") {
          expect(Date.parse(recording.recordedAt)).toBeGreaterThanOrEqual(
            Date.parse(result.runDate)
          );
          expect(recording.baseUrl).toBe(result.baseUrl);
          expect(recording.environment).toBe(result.environment);
        }
      });
    }
  }

  test("covers every active and archived recording and preserves raw grading", () => {
    expect(snapshot.cases.map((item) => item.id).sort()).toEqual(
      cases.map((item) => item.id).sort()
    );
    const paths = cases.map((item) => `recordings/${item.id}.json`);
    expect(
      readdirSync(new URL("./recordings/", import.meta.url))
        .filter((name) => name.endsWith(".json"))
        .sort()
    ).toEqual(cases.map((item) => `${item.id}.json`).sort());
    expect(
      readdirSync(new URL("./recordings/runs/", import.meta.url)).sort()
    ).toEqual(
      runs.map(({ result }) => result.runDate.replaceAll(":", "-")).sort()
    );
    for (const { result } of runs) {
      const dir = `recordings/runs/${result.runDate.replaceAll(":", "-")}`;
      const files = readdirSync(new URL(`./${dir}/`, import.meta.url));
      expect(files.sort()).toEqual(
        result.cases.map((item) => `${item.id}.json`).sort()
      );
      paths.push(...files.map((name) => `${dir}/${name}`));
      const corrected = summarize(result.cases, result.totalCases);
      expect(result.passedCases).toBe(corrected.passedCases);
      expect(result.passRate).toBe(corrected.passRate);
      expect(result.initialGrading).toBeDefined();
      expect(result.initialGrading).toMatchObject(
        summarize(result.initialGrading!.cases, result.totalCases)
      );
    }
    expect(Object.keys(snapshot.recordingSha256).sort()).toEqual(paths.sort());
    expect(snapshot).toMatchObject(summarize(snapshot.cases));
    const raw = cases.map((testCase) => {
      const { recording } = verify(
        `recordings/${testCase.id}.json`,
        testCase.id
      );
      const latest = runs
        .filter(
          ({ result }) =>
            result.baseUrl === snapshot.baseUrl &&
            result.cases.some((item) => item.id === testCase.id)
        )
        .at(-1)!;
      const archived = `recordings/runs/${latest.result.runDate.replaceAll(":", "-")}/${testCase.id}.json`;
      expect(snapshot.recordingSha256[`recordings/${testCase.id}.json`]).toBe(
        snapshot.recordingSha256[archived]
      );
      return latest.result.initialGrading!.cases.find(
        (item) => item.id === testCase.id
      )!;
    });
    expect(snapshot.rawGrading).toEqual(summarize(raw));
    const targetRuns = runs.filter(
      ({ result }) => result.baseUrl === snapshot.baseUrl
    );
    expect(snapshot.sourceRuns).toEqual(targetRuns.map(({ name }) => name));
    expect(snapshot.modelCallCount).toBe(
      targetRuns.reduce((sum, { result }) => sum + result.modelCallCount, 0)
    );
    expect(snapshot.estimatedNeurons).toBe(
      targetRuns.reduce((sum, { result }) => sum + result.estimatedNeurons, 0)
    );
    expect(JSON.parse(read("results/latest-run.json"))).toEqual(
      runs.at(-1)!.result
    );
  });
});
