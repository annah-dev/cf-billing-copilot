// The live chat's wiring to the Agents SDK hooks. Production: after the customer confirmed a credit
// request, the stream failed ("An internal error occurred", then "Unable to connect"). useAgentChat
// already sends cf_agent_tool_approval with autoContinue and the server continues the turn; the
// UI also set sendAutomaticallyWhen, so the AI SDK client sent a second, full-conversation request
// that raced that continuation. Reproduced in local dev (two continuations, one left pending).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const captured: { options?: Record<string, unknown> } = {};

const agentOptions: { onMessage?: (event: MessageEvent) => void } = {};
vi.mock("agents/react", () => ({
  useAgent: (options: typeof agentOptions) => {
    Object.assign(agentOptions, options);
    return {};
  }
}));
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

  it("listens for the agent's billing-refusal message on the chat connection", async () => {
    const { LiveChat } = await import("../../src/ui/chat");
    renderToString(
      createElement(LiveChat, {
        panel: { sandboxId: "0".repeat(32), customerId: "cus_1" } as never,
        changed: () => {}
      })
    );
    expect(typeof agentOptions.onMessage).toBe("function");
  }, 60_000);
});

describe("chat refusals", () => {
  it("reads a billing-refusal as the contract error the UI shows", async () => {
    const { chatRefusal, describeError } = await import("../../src/ui/errors");
    const refusal = chatRefusal(
      JSON.stringify({
        type: "billing-refusal",
        error: {
          code: "cap_reached",
          message: "Daily limit reached for sandbox API requests (200).",
          cap: { name: "api", limit: 200, resetsAt: "2026-10-02T00:00:00.000Z" }
        }
      })
    );
    expect(refusal?.error.code).toBe("cap_reached");
    expect(describeError(refusal).title).toBe("Demo limit reached");
  });

  it("ignores every other message on the connection", async () => {
    const { chatRefusal } = await import("../../src/ui/errors");
    expect(
      chatRefusal(
        JSON.stringify({ type: "cf_agent_chat_messages", messages: [] })
      )
    ).toBeNull();
    expect(chatRefusal("not json")).toBeNull();
    expect(chatRefusal(JSON.stringify({ type: "billing-refusal" }))).toBeNull();
    expect(chatRefusal(new ArrayBuffer(2))).toBeNull();
  });
});
