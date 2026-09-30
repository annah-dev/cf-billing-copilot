import {
  CreateSandboxResponseSchema,
  ErrorResponseSchema,
  ROUTES,
  TurnResponseSchema,
  type ErrorCode,
  type TurnResponse
} from "../src/contracts";
import { engine } from "../src/engine";
import { type EvalCase } from "./cases";
import { checkReplay } from "./grounding";
import { RecordingSchema, type Recording } from "./recording";

export interface RunResult {
  formatVersion: 1;
  source: "live";
  runDate: string;
  status: "running" | "complete" | "stopped" | "failed";
  totalCases: number;
  attemptedCases: number;
  completedCases: number;
  passedCases: number;
  // Denominator includes all planned cases; a capped run cannot claim a full pass rate.
  passRate: string;
  usage: TurnResponse["usage"];
  turnsPosted: number;
  stopCode: ErrorCode | "transport_or_schema_error" | null;
  cases: { id: string; passed: boolean; issues: string[] }[];
}
export interface RunOptions {
  baseUrl: string;
  cases: EvalCase[];
  fetcher?: typeof fetch;
  now?: () => Date;
  saveRecording: (recording: Recording) => void;
  saveResult: (result: RunResult) => void;
}

class HttpFailure extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export function deployedUrl(value: string | undefined): string {
  if (!value) throw new Error("Set EVAL_BASE_URL to the deployed origin");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "EVAL_BASE_URL must be an HTTPS origin without credentials, query or path"
    );
  return url.origin;
}

export async function runLive(options: RunOptions): Promise<RunResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const baseUrl = deployedUrl(options.baseUrl);
  const result: RunResult = {
    formatVersion: 1,
    source: "live",
    runDate: now().toISOString(),
    status: "running",
    totalCases: options.cases.length,
    attemptedCases: 0,
    completedCases: 0,
    passedCases: 0,
    passRate: `0/${options.cases.length}`,
    usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
    turnsPosted: 0,
    stopCode: null,
    cases: []
  };
  const post = async (path: string, body: unknown) => {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(120_000)
    });
    const value: unknown = await response.json();
    if (!response.ok)
      throw new HttpFailure(ErrorResponseSchema.parse(value).error.code);
    return value;
  };
  for (const testCase of options.cases) {
    result.attemptedCases++;
    try {
      // No readiness request hits /turn. Each case creates exactly one fresh sandbox.
      const sandbox = CreateSandboxResponseSchema.parse(
        await post(ROUTES.sandboxes, {})
      );
      if (
        !sandbox.customers.some(
          (customer) => customer.customerId === testCase.customerId
        )
      )
        throw new Error("Seed customer missing from sandbox");
      // The approver token is discarded, never logged or saved.
      const recording: Recording = {
        formatVersion: 1,
        seedVersion: engine.seed().seedVersion,
        caseId: testCase.id,
        source: "live",
        recordedAt: now().toISOString(),
        turns: []
      };
      for (const turn of testCase.turns) {
        result.turnsPosted++;
        // A new HTTP request has no client history; the same sandbox/customer exercises DO memory.
        const response = TurnResponseSchema.parse(
          await post(
            ROUTES.turn(sandbox.sandboxId, testCase.customerId),
            turn.request
          )
        );
        result.usage.inputTokens += response.usage.inputTokens;
        result.usage.outputTokens += response.usage.outputTokens;
        result.usage.modelCalls += response.usage.modelCalls;
        recording.turns.push({
          customerId: testCase.customerId,
          request: turn.request,
          response
        });
        // Keep completed turns even if a memory follow-up hits a cap or loses transport.
        // A partial recording deliberately fails replay's turn-count check.
        options.saveRecording(RecordingSchema.parse(recording));
      }
      const issues = checkReplay(testCase, recording);
      // Preserve even schema-invalid tool payloads for replay to expose the actual failure.
      result.completedCases++;
      if (result.completedCases === result.totalCases)
        result.status = "complete";
      if (issues.length === 0) result.passedCases++;
      result.cases.push({
        id: testCase.id,
        passed: issues.length === 0,
        issues
      });
    } catch (error) {
      result.stopCode =
        error instanceof HttpFailure ? error.code : "transport_or_schema_error";
      result.status = [
        "budget_exhausted",
        "cap_reached",
        "rate_limited"
      ].includes(result.stopCode)
        ? "stopped"
        : "failed";
      result.cases.push({
        id: testCase.id,
        passed: false,
        issues: [`Run stopped: ${result.stopCode}`]
      });
      break; // No retries, no model loop, no cap bypass.
    } finally {
      result.passRate = `${result.passedCases}/${result.totalCases}`;
      options.saveResult(structuredClone(result));
    }
  }
  return result;
}
