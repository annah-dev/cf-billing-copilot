import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { engine } from "../src/engine";
import { buildCases } from "./cases";
import { checkReplay } from "./grounding";
import { parseRecording } from "./recording";

const cases = buildCases();
export const readRecording = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`./recordings/${id}.json`, import.meta.url), "utf8")
  );

describe("billing eval replay", () => {
  for (const testCase of cases) {
    test(`${testCase.id} [${testCase.story}]`, () => {
      const recording = parseRecording(readRecording(testCase.id));
      expect(recording.seedVersion).toBe(engine.seed().seedVersion);
      expect(checkReplay(testCase, recording)).toEqual([]);
    });
  }
});
