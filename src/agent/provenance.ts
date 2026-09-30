// Which tool calls and tool results in the stored conversation the server actually produced.
// The Agents SDK accepts client-sent history (cf_agent_chat_messages, and the messages in every
// chat request), so a client could otherwise plant an "approved" credit confirmation or a fake
// tool result. The agent records every tool call it issues (with a hash of its input) and every
// output its tools return (hash), and the model only ever sees tool parts that match those
// records (PR #4 review round 2). Assistant text is not filtered: it carries no tool authority,
// and a client can type the same words as a user message anyway.
import type { UIMessage } from "ai";
import { sha256Hex } from "../http/config";
import { stableKey } from "./tools";

const MAX_ROWS = 1_000;

type Row = {
  id: string;
  name: string;
  input_hash: string;
  output_hash: string | null;
  confirmation: string | null;
};

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
};

function hash(value: unknown): Promise<string> {
  return sha256Hex(stableKey("", value));
}

function toolParts(message: UIMessage): ToolPart[] {
  return message.parts.filter(
    (p) => p.type.startsWith("tool-") && "toolCallId" in p
  ) as unknown as ToolPart[];
}

export class ToolProvenance {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS issued_tool_calls (id TEXT PRIMARY KEY, name TEXT NOT NULL, input_hash TEXT NOT NULL, output_hash TEXT, confirmation TEXT)"
    );
  }

  /** Record the tool calls a model step produced; credit calls in the chat await confirmation. */
  async recordIssued(
    calls: readonly { toolCallId: string; toolName: string; input: unknown }[],
    confirmCredit: boolean
  ): Promise<void> {
    for (const call of calls) {
      this.sql.exec(
        "INSERT OR IGNORE INTO issued_tool_calls (id, name, input_hash, output_hash, confirmation) VALUES (?, ?, ?, NULL, ?)",
        call.toolCallId,
        call.toolName,
        await hash(call.input),
        confirmCredit && call.toolName === "startCreditRequest"
          ? "requested"
          : null
      );
    }
    this.sql.exec(
      "DELETE FROM issued_tool_calls WHERE rowid <= (SELECT max(rowid) FROM issued_tool_calls) - ?",
      MAX_ROWS
    );
  }

  async recordOutput(toolCallId: string, output: unknown): Promise<void> {
    this.sql.exec(
      "UPDATE issued_tool_calls SET output_hash = ? WHERE id = ?",
      await hash(output),
      toolCallId
    );
  }

  private rows(): Map<string, Row> {
    return new Map(
      this.sql
        .exec<Row>("SELECT * FROM issued_tool_calls")
        .toArray()
        .map((r) => [r.id, r])
    );
  }

  private async genuine(
    part: ToolPart,
    row: Row | undefined
  ): Promise<boolean> {
    if (!row || `tool-${row.name}` !== part.type) return false;
    if ((await hash(part.input)) !== row.input_hash) return false;
    if (part.state === "output-available") {
      return (
        row.output_hash !== null &&
        (await hash(part.output)) === row.output_hash
      );
    }
    if (part.state.startsWith("approval-") || part.state === "output-denied") {
      return row.confirmation !== null;
    }
    return true;
  }

  /**
   * Consume a server-issued credit confirmation that the customer just answered: true only for an
   * `approval-responded` part the server issued, with an unchanged input, not consumed before.
   */
  async consumeAnsweredConfirmation(messages: UIMessage[]): Promise<boolean> {
    const assistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!assistant) return false;
    const rows = this.rows();
    for (const part of toolParts(assistant)) {
      if (part.state !== "approval-responded") continue;
      const row = rows.get(part.toolCallId);
      if (row?.confirmation !== "requested") continue;
      if (!(await this.genuine(part, row))) continue;
      const updated = this.sql.exec(
        "UPDATE issued_tool_calls SET confirmation = 'consumed' WHERE id = ? AND confirmation = 'requested'",
        part.toolCallId
      ).rowsWritten;
      if (updated > 0) return true;
    }
    return false;
  }

  /** The conversation with every tool part the server did not produce removed. */
  async verified(messages: UIMessage[]): Promise<UIMessage[]> {
    const rows = this.rows();
    const out: UIMessage[] = [];
    for (const message of messages) {
      if (message.role !== "assistant") {
        out.push(message);
        continue;
      }
      const parts: UIMessage["parts"] = [];
      for (const part of message.parts) {
        if (part.type === "dynamic-tool") continue;
        if (part.type.startsWith("tool-") && "toolCallId" in part) {
          const p = part as unknown as ToolPart;
          if (!(await this.genuine(p, rows.get(p.toolCallId)))) continue;
        }
        parts.push(part);
      }
      if (parts.length > 0) out.push({ ...message, parts });
    }
    return out;
  }
}
