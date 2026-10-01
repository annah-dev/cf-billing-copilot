// The live chat's wiring to the Agents SDK hooks. Production: after the customer confirmed a credit
// request, the stream failed ("An internal error occurred", then "Unable to connect"). useAgentChat
// already sends cf_agent_tool_approval with autoContinue and the server continues the turn; the
// UI also set sendAutomaticallyWhen, so the AI SDK client sent a second, full-conversation request
// that raced that continuation. Reproduced in local dev (two continuations, one left pending).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const captured: { options?: Record<string, unknown> } = {};

vi.mock("agents/react", () => ({ useAgent: () => ({}) }));
vi.mock("@cloudflare/ai-chat/react", () => ({
  useAgentChat: (options: Record<string, unknown>) => {
    captured.options = options;
    return {
      messages: [],
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      addToolApprovalResponse: vi.fn(),
      stop: vi.fn()
    };
  }
}));

describe("live chat wiring", () => {
  it("lets the server continue after a confirmation, without a second client request", async () => {
    const { LiveChat } = await import("../../src/ui/chat");
    renderToString(
      createElement(LiveChat, {
        panel: {
          sandboxId: "0".repeat(32),
          customerId: "cus_1"
        } as never,
        changed: () => {}
      })
    );
    expect(captured.options).toBeDefined();
    expect(captured.options).not.toHaveProperty("sendAutomaticallyWhen");
    // The SDK default (true) is what continues the turn on the server.
    expect(captured.options?.autoContinueAfterToolResult ?? true).toBe(true);
    // The first import of the UI module and its component library is slow.
  }, 60_000);
});
