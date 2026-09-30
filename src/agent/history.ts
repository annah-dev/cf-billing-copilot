// What of the stored conversation reaches the model. Llama 3.3 has a 24,000-token context
// (DEV-1): the system prompt, tool definitions and the answer need room, so the history sent is
// capped by an estimated token budget. Storage keeps more (maxPersistedMessages); memory keeps the
// gist of what falls out of the window.
import {
  convertToModelMessages,
  pruneMessages,
  type ModelMessage,
  type UIMessage
} from "ai";

/** Estimated tokens of history sent per model call (the rest of the 24k is prompt, tools, answer). */
export const HISTORY_TOKEN_BUDGET = 12_000;

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 3);
}

/**
 * A credit confirmation the customer never answered (they typed a new message instead) is closed
 * as denied, so the model sees a settled tool call rather than a dangling one.
 */
export function settleUnansweredApprovals(
  messages: UIMessage[],
  reason = "The customer did not confirm and moved on."
): UIMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    let changed = false;
    const parts = m.parts.map((p) => {
      if (
        "state" in p &&
        p.state === "approval-requested" &&
        "approval" in p &&
        p.approval
      ) {
        changed = true;
        return {
          ...p,
          state: "output-denied" as const,
          approval: {
            id: p.approval.id,
            approved: false as const,
            reason
          }
        };
      }
      return p;
    });
    return changed ? ({ ...m, parts } as UIMessage) : m;
  });
}

/**
 * Keep the newest messages that fit the budget, starting at a user message. Tool results older
 * than the last two messages are dropped first (they are the bulk of the tokens and can be
 * fetched again).
 */
export function trimHistory(
  messages: ModelMessage[],
  budgetTokens = HISTORY_TOKEN_BUDGET
): ModelMessage[] {
  const pruned = pruneMessages({
    messages,
    toolCalls: "before-last-2-messages",
    emptyMessages: "remove"
  });
  let start = 0;
  let total = pruned.reduce((sum, m) => sum + estimateTokens(m), 0);
  while (start < pruned.length - 1 && total > budgetTokens) {
    total -= estimateTokens(pruned[start]);
    start += 1;
  }
  while (start < pruned.length - 1 && pruned[start].role !== "user") {
    start += 1;
  }
  return pruned.slice(start);
}

export async function historyForModel(
  messages: UIMessage[],
  options: { continuation: boolean; confirmedTurn?: boolean }
): Promise<ModelMessage[]> {
  // A proposal left unanswered is closed before the next turn. In a /turn sent with confirm: true
  // the customer is confirming now, so the model is told to make the request again in this turn.
  const settled = options.continuation
    ? messages
    : settleUnansweredApprovals(
        messages,
        options.confirmedTurn
          ? "Not started yet: the customer confirms it in the next message; call the tool again to start it."
          : undefined
      );
  return trimHistory(await convertToModelMessages(settled));
}
