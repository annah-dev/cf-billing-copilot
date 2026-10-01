// Tool-call repair for plan ids. Llama 3.3 writes plan ids with the plan's display case
// (`plan_Pro`, `plan_Scale` in the evals), which the contract's lowercase slug rejects, and it
// repeated the rejected id even after getAccount returned the real one. A simulatePlan call whose
// input fails validation is repaired only when its planId names exactly one of the customer's
// available plans, ignoring case, spaces and the `plan_` prefix; the repaired input is validated
// with the contract schema like any other. Anything else stays a validation error.
import {
  InvalidToolInputError,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

type Plan = { planId: string; name: string };

const plain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^plan_/, "");

/** The one available plan `raw` names, or null when it names none or several. */
export function matchPlanId(raw: string, plans: Plan[]): string | null {
  const wanted = plain(raw);
  const matches = plans.filter(
    (p) => plain(p.planId) === wanted || plain(p.name) === wanted,
  );
  return matches.length === 1 ? matches[0].planId : null;
}

export function planIdRepair(
  availablePlans: () => Promise<Plan[]>,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error }) => {
    if (
      toolCall.toolName !== "simulatePlan" ||
      !InvalidToolInputError.isInstance(error)
    ) {
      return null;
    }
    let input: unknown;
    try {
      input = JSON.parse(toolCall.input);
    } catch (_err) {
      return null;
    }
    if (!input || typeof input !== "object") return null;
    const planId = (input as { planId?: unknown }).planId;
    if (typeof planId !== "string") return null;
    let plans: Plan[];
    try {
      plans = await availablePlans();
    } catch (_err) {
      return null;
    }
    const match = matchPlanId(planId, plans);
    if (!match || match === planId) return null;
    return { ...toolCall, input: JSON.stringify({ ...input, planId: match }) };
  };
}
