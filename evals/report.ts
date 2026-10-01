import { createHash } from "node:crypto";
import type { EvalCase } from "./cases";
import { checkReplay } from "./grounding";
import type { RunResult } from "./live-runner";

export type Verdict = RunResult["cases"][number];
export interface Grading {
  cases: Verdict[];
  passedCases: number;
  passRate: string;
}
export interface GradedRun extends RunResult {
  initialGrading?: Grading;
  gradingHistory?: (Grading & { gradedAt?: string })[];
  regradedAt?: string;
}
export interface ReplayResults extends Grading {
  formatVersion: 1;
  kind: "latest-recordings snapshot";
  baseUrl: string;
  environment: RunResult["environment"];
  runDate: string;
  regradedAt: string;
  modelCallCount: number;
  estimatedNeurons: number;
  usageScope: "all captured attempts at this target";
  sourceRuns: string[];
  rawGrading: Grading;
  // Digests cover active and archived response bytes, independent of verdicts.
  recordingSha256: Record<string, string>;
}

export function grade(testCase: EvalCase, recording: unknown): Verdict {
  const issues = checkReplay(testCase, recording);
  return { id: testCase.id, passed: issues.length === 0, issues };
}

export function summarize(cases: Verdict[], total = cases.length): Grading {
  const passedCases = cases.filter((item) => item.passed).length;
  return { cases, passedCases, passRate: `${passedCases}/${total}` };
}

export const recordingDigest = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
