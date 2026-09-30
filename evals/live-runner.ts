import {
  CreateSandboxResponseSchema,
  ErrorResponseSchema,
  ROUTES,
  TurnResponseSchema,
  type ErrorCode,
  type TurnResponse,
  estimateNeurons,
  type CreateSandboxResponse,
  SandboxIdSchema
} from "../src/contracts";
import { engine } from "../src/engine";
import { type EvalCase } from "./cases";
import { checkReplay } from "./grounding";
import { RecordingSchema, type Recording } from "./recording";

export interface RunResult {
  formatVersion: 1;
  source: "live";
  baseUrl: string;
  environment: "local dev" | "deployed";
  modelCallCount: number;
  estimatedNeurons: number;
  sandboxes: Record<string, { sandboxId: string; messages: number }>;
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
  reuseSandboxes?: RunResult["sandboxes"];
}

class HttpFailure extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export function deployedUrl(value: string | undefined): string {
  const url = new URL(value ?? "http://127.0.0.1:5173");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "EVAL_BASE_URL must be an HTTPS or local-dev origin without credentials, query or path"
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
    baseUrl,
    environment:
      new URL(baseUrl).protocol === "http:" ? "local dev" : "deployed",
    modelCallCount: 0,
    estimatedNeurons: 0,
    sandboxes: structuredClone(options.reuseSandboxes ?? {}),
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
  const sandboxes = new Map<
    string,
    {
      value: Pick<CreateSandboxResponse, "sandboxId" | "customers">;
      messages: number;
    }
  >();
  for (const [group, entry] of Object.entries(options.reuseSandboxes ?? {})) {
    const sandboxId = SandboxIdSchema.parse(entry.sandboxId);
    if (!Number.isSafeInteger(entry.messages) || entry.messages < 0)
      throw new Error("Invalid prior sandbox usage");
    sandboxes.set(group, {
      value: {
        sandboxId,
        customers: engine.seed().customers.map((customer) => ({
          customerId: customer.id,
          name: customer.name
        }))
      },
      messages: entry.messages
    });
  }
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
      // Owner-authorized grouping stays within the five-sandbox and 30-message caps.
      // State-changing and memory cases have their own groups.
      const group = testCase.sandboxGroup ?? testCase.id;
      let entry = sandboxes.get(group);
      if (!entry || entry.messages + testCase.turns.length > 30) {
        const { sandboxId, customers } = CreateSandboxResponseSchema.parse(
          await post(ROUTES.sandboxes, {})
        );
        entry = {
          value: { sandboxId, customers },
          messages: 0
        };
        sandboxes.set(group, entry);
      }
      const sandbox = entry.value;
      result.sandboxes[group] = {
        sandboxId: sandbox.sandboxId,
        messages: entry.messages
      };
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
        baseUrl,
        environment: result.environment,
        recordedAt: now().toISOString(),
        turns: []
      };
      for (const turn of testCase.turns) {
        result.turnsPosted++;
        entry.messages++;
        result.sandboxes[group].messages = entry.messages;
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
        result.modelCallCount = result.usage.modelCalls;
        result.estimatedNeurons += estimateNeurons(
          response.usage.inputTokens,
          response.usage.outputTokens
        );
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
