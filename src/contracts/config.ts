import { z } from "zod";

/** The only model this app calls (DECISIONS.md DEV-1). */
export const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Workers AI pricing for MODEL_ID, used for the neuron estimate (DECISIONS.md DEV-11). */
export const NEURONS_PER_MILLION_INPUT_TOKENS = 26_668;
export const NEURONS_PER_MILLION_OUTPUT_TOKENS = 204_805;

/** Estimated neurons for a call, rounded up. Integer math only. */
export function estimateNeurons(inputTokens: number, outputTokens: number): number {
  const micro =
    inputTokens * NEURONS_PER_MILLION_INPUT_TOKENS + outputTokens * NEURONS_PER_MILLION_OUTPUT_TOKENS;
  return Math.ceil(micro / 1_000_000);
}

const positiveInt = z
  .string()
  .regex(/^[1-9]\d*$/, "expected a positive integer")
  .transform(Number);

/** The `vars` in wrangler.jsonc, parsed once per request by the Worker. */
export const EnvConfigSchema = z.object({
  APPROVAL_TIMEOUT: z.string().regex(/^\d+ (seconds?|minutes?|hours?|days?)$/),
  NEURON_DAILY_STOP: positiveInt,
  MAX_OUTPUT_TOKENS: positiveInt,
  SANDBOXES_PER_DAY_GLOBAL: positiveInt,
  SANDBOXES_PER_DAY_PER_IP: positiveInt,
  MESSAGES_PER_SANDBOX_DAY: positiveInt,
  MESSAGE_MAX_CHARS: positiveInt,
  CREDIT_REQUESTS_PER_SANDBOX_DAY: positiveInt,
  API_REQUESTS_PER_SANDBOX_DAY: positiveInt,
  SANDBOX_IDLE_DAYS: positiveInt
});
export type EnvConfig = z.infer<typeof EnvConfigSchema>;
