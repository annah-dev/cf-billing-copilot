import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { engine } from "../src/engine";
import { buildCases } from "./cases";
import { checkReplay } from "./grounding";
import { parseRecording, RecordingSchema } from "./recording";

const cases = buildCases();
export const readRecording = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`./recordings/${id}.json`, import.meta.url), "utf8")
  );

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
      const recording = parseRecording(readRecording(testCase.id));
      expect(recording.seedVersion).toBe(engine.seed().seedVersion);
      expect(checkReplay(testCase, recording)).toEqual([]);
    });
  }

  test(`reports recording sources: ${live} live, ${synthetic} synthetic-engine of ${cases.length} cases`, () => {
    expect(live + synthetic).toBe(cases.length);
  });
});
