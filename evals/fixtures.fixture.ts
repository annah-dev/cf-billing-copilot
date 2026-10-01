import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { engine } from "../src/engine";
import { buildCases } from "./cases";
import { parseRecording } from "./recording";

test("generate explicitly labeled engine fixtures (zero model calls)", () => {
  mkdirSync("evals/recordings", { recursive: true });
  for (const testCase of buildCases()) {
    const recording = parseRecording({
      formatVersion: 1,
      seedVersion: engine.seed().seedVersion,
      caseId: testCase.id,
      source: "synthetic-engine",
      recordedAt: null,
      turns: testCase.turns.map((turn) => ({
        customerId: testCase.customerId,
        request: turn.request,
        response: {
          ...turn.fixture,
          usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 }
        }
      }))
    });
    // Never overwrite live evidence with generated synthetic prose.
    const path = `evals/recordings/${testCase.id}.json`;
    if (
      existsSync(path) &&
      parseRecording(JSON.parse(readFileSync(path, "utf8"))).source !==
        "synthetic-engine"
    )
      throw new Error(`Refusing to replace live recording ${path}`);
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
  }
});
