// The model stack for every chat turn (D-7, D-14): Workers AI Llama 3.3, wrapped by
// simulateStreamingMiddleware (native streaming garbles tool arguments, DEV-16) around a budget
// middleware that reserves estimated neurons in Quota before each inference call and settles the
// reservation with the real token usage afterwards. A refused reservation returns a fixed message
// instead of calling the model.
import {
  simulateStreamingMiddleware,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { MODEL_ID, estimateNeurons } from "../contracts";
import { BUDGET_MESSAGE, type Refusal } from "../http/errors";
import { QUOTA_NAME } from "../quota/quota";

type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
type CallOptions = Parameters<WrapGenerate>[0]["params"];

/** Per-turn accounting, read by the /turn endpoint and by tests. */
export type TurnStats = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Set when a reservation was refused: the turn answered with BUDGET_MESSAGE. */
  budgetRefusal: Refusal | null;
};

export function newTurnStats(): TurnStats {
  return {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    budgetRefusal: null
  };
}

/**
 * Upper-bound estimate of prompt tokens: one token per 3 characters of the serialised prompt and
 * tool definitions (Llama 3's tokenizer averages about 4 characters per token on English and JSON).
 */
export function estimateInputTokens(params: CallOptions): number {
  const chars =
    JSON.stringify(params.prompt).length +
    JSON.stringify(params.tools ?? []).length;
  return Math.ceil(chars / 3);
}

function fixedResult(text: string): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "budget_exhausted" },
    usage: {
      inputTokens: {
        total: 0,
        noCache: 0,
        cacheRead: undefined,
        cacheWrite: undefined
      },
      outputTokens: { total: 0, text: undefined, reasoning: undefined }
    },
    warnings: []
  };
}

export function budgetMiddleware(
  env: Env,
  stats: TurnStats,
  limits: { maxOutputTokens: number; neuronStop: number }
): LanguageModelMiddleware {
  const quota = env.QUOTA.get(env.QUOTA.idFromName(QUOTA_NAME));
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate, params }) => {
      const estimate = estimateNeurons(
        estimateInputTokens(params),
        limits.maxOutputTokens
      );
      const reservation = await quota.reserveNeurons({
        estimate,
        stop: limits.neuronStop
      });
      if (!reservation.ok) {
        stats.budgetRefusal = {
          ok: false,
          status: reservation.status,
          code: reservation.code,
          message: reservation.message,
          cap: reservation.cap
        };
        return fixedResult(BUDGET_MESSAGE);
      }
      let actual = estimate;
      try {
        stats.modelCalls += 1;
        const result = await doGenerate();
        const input = result.usage.inputTokens.total ?? 0;
        const output = result.usage.outputTokens.total ?? 0;
        stats.inputTokens += input;
        stats.outputTokens += output;
        actual = estimateNeurons(input, output);
        return result;
      } finally {
        // A failed call is settled at its estimate: the budget errs on the safe side.
        await quota.settleNeurons({
          reservationId: reservation.reservationId,
          actual
        });
      }
    }
  };
}

export function billingModel(
  env: Env,
  stats: TurnStats,
  limits: { maxOutputTokens: number; neuronStop: number }
): LanguageModel {
  const workersai = createWorkersAI({ binding: env.AI });
  return wrapLanguageModel({
    model: workersai(MODEL_ID),
    // First is outermost: the simulated stream calls doGenerate, which the budget check wraps.
    middleware: [
      simulateStreamingMiddleware(),
      budgetMiddleware(env, stats, limits)
    ]
  });
}
