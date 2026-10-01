import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, type UIMessage } from "ai";
import {
  agentInstanceName,
  TurnRequestSchema,
  type PanelResponse
} from "../contracts/http";
import { ToolSchemas } from "../contracts/tools";
import { browserStorage } from "./api";
import { type FixtureBackend } from "./fixtures";
import { Messages, ErrorNotice } from "./components";
import { suggestions, validatedTool } from "./messages";

interface ViewProps {
  messages: UIMessage[];
  send: (text: string) => Promise<void>;
  approve: (id: string, approved: boolean) => void;
  busy: boolean;
  error: unknown;
  connected?: boolean;
  stop?: () => void;
}
function ChatView({
  messages,
  send,
  approve,
  busy,
  error,
  connected = true,
  stop
}: ViewProps) {
  const [text, setText] = useState("");
  const [submitError, setSubmitError] = useState<unknown>(null);
  const pending = messages.some((message) =>
    message.parts.some(
      (part) => isToolUIPart(part) && part.state === "approval-requested"
    )
  );
  async function submit(value: string) {
    if (!value.trim() || busy || pending || !connected) return;
    setSubmitError(null);
    try {
      const input = TurnRequestSchema.parse({ message: value });
      await send(input.message);
      setText("");
    } catch (failure) {
      setSubmitError(failure);
    }
  }
  return (
    <section className="chat-panel" aria-label="Billing chat">
      <div className="chat-heading">
        <div>
          <span className="eyebrow">BILLING ASSISTANT</span>
          <h1>Understand every charge.</h1>
          <p>Ask a question. Follow the evidence.</p>
        </div>
        <span className="grounded-label">Tools do the math</span>
      </div>
      {messages.length === 0 && (
        <div className="welcome">
          <div className="welcome-mark">B</div>
          <h2>Your bill, explained.</h2>
          <p>
            Explore your invoice, compare plans, or request a credit. Every
            amount comes from a billing tool.
          </p>
        </div>
      )}
      <Messages
        messages={messages}
        approve={approve}
        busy={busy || !connected}
      />
      {busy && <output className="working">Checking billing records...</output>}
      {!connected && (
        <output className="working">Connecting to your billing agent...</output>
      )}
      {Boolean(error || submitError) && (
        <ErrorNotice error={error || submitError} />
      )}
      <div className="composer-area">
        <div className="suggestions">
          {suggestions.map((prompt) => (
            <button
              key={prompt}
              onClick={() => void submit(prompt)}
              disabled={busy || pending || !connected}
            >
              {prompt}
            </button>
          ))}
        </div>
        {pending && (
          <p className="small muted">
            Confirm or cancel the credit request above to continue.
          </p>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(text);
          }}
        >
          <label className="sr-only" htmlFor="chat-input">
            Ask about your bill
          </label>
          <textarea
            id="chat-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Ask about your bill..."
            disabled={pending || !connected}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit(text);
              }
            }}
          />
          {busy && stop ? (
            <Button variant="secondary" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              type="submit"
              disabled={!text.trim() || busy || pending || !connected}
            >
              Send
            </Button>
          )}
        </form>
        <p className="composer-note">
          Synthetic data. Credit requests require human approval.
        </p>
      </div>
    </section>
  );
}
export function LiveChat({
  panel,
  changed
}: {
  panel: PanelResponse;
  changed: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const agent = useAgent({
    agent: "BillingAgent",
    name: agentInstanceName(panel.sandboxId, panel.customerId),
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false)
  });
  // No sendAutomaticallyWhen: useAgentChat already sends cf_agent_tool_approval with
  // autoContinue, and the server continues the turn. A second, client-sent request raced that
  // continuation (production: "An internal error occurred" and "Unable to connect").
  const chat = useAgentChat({
    agent,
    onFinish: changed
  });
  return (
    <ChatView
      messages={chat.messages}
      busy={chat.status === "streaming" || chat.status === "submitted"}
      connected={connected}
      error={chat.error}
      send={async (text) => {
        await chat.sendMessage({ text });
      }}
      approve={(id, approved) => {
        void chat.addToolApprovalResponse({ id, approved });
      }}
      stop={() => void chat.stop()}
    />
  );
}
export function FixtureChat({
  panel,
  backend,
  changed
}: {
  panel: PanelResponse;
  backend: FixtureBackend;
  changed: () => void;
}) {
  const storageKey = `billing-copilot.chat.${backend.version}.${agentInstanceName(panel.sandboxId, panel.customerId)}`;
  const [messages, setMessages] = useState<UIMessage[]>(() => {
    try {
      const raw = browserStorage()?.getItem(storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Accept only the fixture message shapes and validated tool parts we produce.
      const valid = parsed.every(
        (message) =>
          message &&
          typeof message.id === "string" &&
          ["user", "assistant"].includes(message.role) &&
          Array.isArray(message.parts) &&
          message.parts.every((part: UIMessage["parts"][number]) =>
            part.type === "text"
              ? typeof part.text === "string"
              : Boolean(validatedTool(part)?.input?.success)
          )
      );
      return valid ? parsed : [];
    } catch {
      return [];
    }
  });
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    try {
      browserStorage()?.setItem(storageKey, JSON.stringify(messages));
    } catch {
      /* Chat is still usable without persistence. */
    }
  }, [messages, storageKey]);
  return (
    <ChatView
      messages={messages}
      busy={false}
      error={error}
      send={async (text) => {
        const answer = backend.answer(panel.sandboxId, panel.customerId, text);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text }]
          },
          answer
        ]);
      }}
      approve={(id, approved) => {
        try {
          const target = messages
            .flatMap((message) => message.parts)
            .find(
              (part) =>
                isToolUIPart(part) &&
                part.state === "approval-requested" &&
                part.approval.id === id
            );
          if (
            !target ||
            !isToolUIPart(target) ||
            target.state !== "approval-requested"
          )
            return;
          const output = approved
            ? backend.startCredit(
                panel.sandboxId,
                panel.customerId,
                ToolSchemas.startCreditRequest.input.parse(target.input)
              )
            : null;
          setMessages((current) =>
            current.map((message) => ({
              ...message,
              parts: message.parts.map((part) =>
                part === target
                  ? approved
                    ? {
                        type: "tool-startCreditRequest",
                        toolCallId: target.toolCallId,
                        state: "output-available",
                        input: target.input,
                        output
                      }
                    : {
                        type: "tool-startCreditRequest",
                        toolCallId: target.toolCallId,
                        state: "output-denied",
                        input: target.input,
                        approval: { id, approved: false }
                      }
                  : part
              )
            }))
          );
          changed();
        } catch (failure) {
          setError(failure);
        }
      }}
    />
  );
}
