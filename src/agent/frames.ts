// Which chat-channel frames are counted like a /turn request (D-7, D-13). Production report: chat
// messages over the WebSocket passed neither the per-IP rate limiter nor the daily caps, because
// those run per HTTP request and the socket is upgraded once. The SDK also saves a chat request's
// messages before onChatMessage runs, so the caps must be checked before the SDK sees the frame.
import { autoTransformMessages } from "@cloudflare/ai-chat/ai-chat-v5-migration";
import type { UIMessage } from "ai";

export type Frame =
  /** A new chat turn: counted as an API request and a chat message, length-checked. */
  | { kind: "chat-request"; id: string; lastUserText: string }
  /** Anything else that writes or can start model work: counted as an API request. */
  | { kind: "write" }
  /** Reads and stream control that store nothing (cancel, resume requests): not counted. */
  | { kind: "pass" };

const WRITES = new Set([
  // Agent state from the client: the SDK persists it (_setStateInternal). PR review r1.
  "cf_agent_state",
  // A resume acknowledgement can complete an orphaned stream after hibernation, which the SDK
  // then persists as an assistant message (ResumableStream.replayChunks). PR review r2.
  "cf_agent_stream_resume_ack",
  "cf_agent_chat_messages",
  "cf_agent_tool_result",
  "cf_agent_tool_approval",
  "cf_agent_chat_clear"
]);

export function classifyFrame(message: string): Frame {
  let frame: { type?: unknown; id?: unknown; init?: { body?: unknown } };
  try {
    frame = JSON.parse(message) as typeof frame;
  } catch {
    return { kind: "pass" };
  }
  if (!frame || typeof frame !== "object") return { kind: "pass" };
  if (frame.type === "cf_agent_use_chat_request") {
    let messages: UIMessage[] = [];
    try {
      const body = JSON.parse(String(frame.init?.body ?? "{}")) as {
        messages?: unknown[];
      };
      // Measure the messages as the SDK will store them: it converts the older `content` shapes
      // (strings and arrays) into `parts` (PR review r1).
      messages = Array.isArray(body.messages)
        ? autoTransformMessages(body.messages)
        : [];
    } catch {
      messages = [];
    }
    const lastUser = [...messages].reverse().find((m) => m?.role === "user");
    const lastUserText = (lastUser?.parts ?? [])
      .map((p) => (p?.type === "text" ? String(p.text ?? "") : ""))
      .join("")
      .trim();
    return {
      kind: "chat-request",
      id: typeof frame.id === "string" ? frame.id : "",
      lastUserText
    };
  }
  return typeof frame.type === "string" && WRITES.has(frame.type)
    ? { kind: "write" }
    : { kind: "pass" };
}
