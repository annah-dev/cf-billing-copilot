// What the agent does with a reply before the customer sees it (grounding.ts holds the rule). A
// grounded draft goes out unchanged. Otherwise the model gets one retry with a correction that names
// each unsupported figure; if the retry is still unsupported, the customer gets the reply without
// the sentences carrying those figures, or a fixed safe answer when nothing verifiable is left.
// An empty draft (the model spent its steps on tool calls, evals remember-credit) gets the same one
// retry, asking for the answer; if that is empty too, the customer is told the answer is incomplete.
// The outcome is recorded on the turn (message metadata and the /turn accounting).
import {
  unsupportedFigures,
  withoutUnsupported,
  type Evidence
} from "./grounding";

/** Sent when no sentence of the reply could be verified. Contains no figure. */
export const SAFE_ANSWER =
  "I could not verify the figures for that answer against your billing data, so I have not given them. Please ask again, or check the side panel for your invoice and credit requests.";

/** Appended when sentences were removed from an otherwise verified reply. Contains no figure. */
export const OMITTED_NOTE =
  "(I left out a figure I could not verify against your billing data.)";

/** Sent when the model produced no answer, even when asked again. Contains no figure. */
export const INCOMPLETE_ANSWER =
  "I could not finish that answer. Please ask again; the side panel shows your invoice and credit requests.";

export type GroundingOutcome =
  /** The draft was grounded and sent unchanged. */
  | "grounded"
  /** The draft was not; the retry was, and the retry was sent. */
  | "corrected"
  /** Neither was; the sent reply has the unsupported sentences removed, or is SAFE_ANSWER. */
  | "safe_answer"
  /** The daily neuron stop was reached during the turn; the fixed budget message was sent. */
  | "budget"
  /** The turn ended on a credit proposal awaiting the customer's confirmation; no text to check. */
  | "awaiting_confirmation"
  /** The draft was empty; the retry answered with grounded text, which was sent. */
  | "completed"
  /** The draft and the retry were both empty; INCOMPLETE_ANSWER was sent. */
  | "incomplete";

export type GroundingRecord = {
  outcome: GroundingOutcome;
  /** Unsupported figures in the first draft, in order of appearance. */
  unsupported: string[];
  /** Unsupported figures in the retry; null when there was no retry or it was not answered. */
  retryUnsupported: string[] | null;
};

export function correctionPrompt(unsupported: string[]): string {
  const named = unsupported.map((figure) => `"${figure}"`).join(", ");
  return [
    `Your last answer stated ${named}, which the tool results in this turn do not support.`,
    "Answer the customer's question again. State only figures that appear in the tool results above, copying each display string exactly; dates and billing periods may also come from the customer's message.",
    "Count items only by the entries a tool result actually lists. If a figure is not in the tool results, say you do not have it instead of giving one.",
    "Do not mention this correction."
  ].join(" ");
}

export const ANSWER_NOW =
  "You have not answered the customer yet. Answer their question now in plain sentences, using only the tool results above and copying each display string exactly. If something is missing, say so.";

/** The reply with unsupported sentences removed, or SAFE_ANSWER when nothing verifiable is left. */
export function safeAnswer(text: string, evidence: Evidence): string {
  const kept = withoutUnsupported(text, evidence);
  if (kept === "" || unsupportedFigures(kept, evidence).length > 0) {
    return SAFE_ANSWER;
  }
  return `${kept}\n\n${OMITTED_NOTE}`;
}

export async function guardReply(input: {
  draft: string;
  evidence: Evidence;
  /** The turn stopped at a credit proposal the customer still has to confirm (D-20). */
  awaitingConfirmation: boolean;
  /** One model call with the correction appended; resolves to its text, or null if refused. */
  retry: (correction: string) => Promise<string | null>;
}): Promise<{ text: string; grounding: GroundingRecord }> {
  const { draft, evidence } = input;
  if (draft.trim() === "") {
    if (input.awaitingConfirmation) {
      return {
        text: "",
        grounding: {
          outcome: "awaiting_confirmation",
          unsupported: [],
          retryUnsupported: null
        }
      };
    }
    const answered = (await input.retry(ANSWER_NOW))?.trim() ?? "";
    if (answered === "") {
      return {
        text: INCOMPLETE_ANSWER,
        grounding: {
          outcome: "incomplete",
          unsupported: [],
          retryUnsupported: null
        }
      };
    }
    const retryUnsupported = unsupportedFigures(answered, evidence);
    return retryUnsupported.length === 0
      ? {
          text: answered,
          grounding: { outcome: "completed", unsupported: [], retryUnsupported }
        }
      : {
          text: safeAnswer(answered, evidence),
          grounding: {
            outcome: "safe_answer",
            unsupported: [],
            retryUnsupported
          }
        };
  }
  const unsupported = unsupportedFigures(draft, evidence);
  if (unsupported.length === 0) {
    return {
      text: draft,
      grounding: { outcome: "grounded", unsupported, retryUnsupported: null }
    };
  }
  const retried = await input.retry(correctionPrompt(unsupported));
  if (retried === null || retried.trim() === "") {
    return {
      text: safeAnswer(draft, evidence),
      grounding: {
        outcome: "safe_answer",
        unsupported,
        retryUnsupported: null
      }
    };
  }
  const retryUnsupported = unsupportedFigures(retried, evidence);
  if (retryUnsupported.length === 0) {
    return {
      text: retried.trim(),
      grounding: { outcome: "corrected", unsupported, retryUnsupported }
    };
  }
  return {
    text: safeAnswer(retried, evidence),
    grounding: { outcome: "safe_answer", unsupported, retryUnsupported }
  };
}
