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

/** Chat-template special tokens per message (header, role, end-of-turn), rounded up. */
const TEMPLATE_TOKENS_PER_MESSAGE = 8;

/**
 * Upper bound on prompt tokens: the UTF-8 byte length of the serialised prompt and tool
 * definitions, plus the chat template's special tokens per message. Llama 3's tokenizer is
 * byte-level BPE, so every text token covers at least one byte; serialising adds characters but
 * never removes any. Typical text is about 4 bytes per token, so this over-reserves about 3 to 4
 * times; the reservation is settled with the real usage right after the call.
 */
export function estimateInputTokens(params: CallOptions): number {
  const bytes = new TextEncoder().encode(
    JSON.stringify(params.prompt) + JSON.stringify(params.tools ?? [])
  ).byteLength;
  return bytes + TEMPLATE_TOKENS_PER_MESSAGE * (params.prompt.length + 1);
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
      const inputBound = estimateInputTokens(params);
      const estimate = estimateNeurons(inputBound, limits.maxOutputTokens);
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
        // workers-ai-provider reports absent usage as 0, and Llama's usage field is optional: a
        // missing or zero count is settled at its bound, so an unreported call is never free.
        actual = estimateNeurons(
          input > 0 ? input : inputBound,
          output > 0 ? output : limits.maxOutputTokens
        );
        if (actual > estimate) {
          // Recorded as spent (never clamped); the estimate is meant to be an upper bound.
          console.error("neuron estimate exceeded", { estimate, actual });
        }
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

/**
 * Workers AI rejects `tools: []` (error 8007, "must not be an empty array"), and
 * workers-ai-provider sends whatever list the AI SDK passes. A step whose tools were taken away
 * (`activeTools: []`, billing-agent.ts mustAnswer) must send no tools at all.
 */
export const noEmptyToolsMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) =>
    params.tools && params.tools.length === 0
      ? { ...params, tools: undefined, toolChoice: undefined }
      : params
};

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
      noEmptyToolsMiddleware,
      budgetMiddleware(env, stats, limits)
    ]
  });
}
