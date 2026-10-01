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

/** Shown to the model for a failed tool call when the server recorded no error text. */
export const GENERIC_TOOL_ERROR = "The tool call failed.";

type Row = {
  id: string;
  name: string;
  input_hash: string;
  output_hash: string | null;
  error_text: string | null;
  confirmation: string | null;
};

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function hash(value: unknown): Promise<string> {
  return sha256Hex(stableKey("", value));
}

function toolParts(message: UIMessage): ToolPart[] {
  return message.parts.filter(
    (p) => p.type.startsWith("tool-") && "toolCallId" in p
  ) as unknown as ToolPart[];
}

export type IssuedCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

/**
 * Every write is an upsert, so the order does not matter: the AI SDK executes a tool (and the
 * execute wrapper records its output) before the step's onStepFinish records the call.
 */
export class ToolProvenance {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS issued_tool_calls (id TEXT PRIMARY KEY, name TEXT NOT NULL, input_hash TEXT NOT NULL, output_hash TEXT, error_text TEXT, confirmation TEXT)"
    );
    // Tables created before error_text existed gain the column; their rows are kept.
    const columns = sql
      .exec<{ name: string }>("PRAGMA table_info(issued_tool_calls)")
      .toArray()
      .map((c) => c.name);
    if (!columns.includes("error_text")) {
      sql.exec("ALTER TABLE issued_tool_calls ADD COLUMN error_text TEXT");
    }
  }

  private async upsertCall(call: IssuedCall): Promise<void> {
    this.sql.exec(
      "INSERT INTO issued_tool_calls (id, name, input_hash) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
      call.toolCallId,
      call.toolName,
      await hash(call.input)
    );
  }

  /**
   * Record a model step's tool calls (onStepFinish); credit calls in the chat await the
   * customer's confirmation. `errors` are the step's tool failures, as the text shown for them.
   */
  async recordStep(
    calls: readonly IssuedCall[],
    errors: readonly { toolCallId: string; text: string }[],
    /** Calls the SDK asked the customer to confirm in this step (tool-approval-request). */
    approvalRequested: ReadonlySet<string>
  ): Promise<void> {
    for (const call of calls) {
      await this.upsertCall(call);
      if (approvalRequested.has(call.toolCallId)) {
        this.sql.exec(
          "UPDATE issued_tool_calls SET confirmation = 'requested' WHERE id = ? AND confirmation IS NULL",
          call.toolCallId
        );
      }
    }
    for (const error of errors) {
      this.sql.exec(
        "UPDATE issued_tool_calls SET error_text = coalesce(error_text, ?) WHERE id = ?",
        error.text,
        error.toolCallId
      );
    }
    this.sql.exec(
      "DELETE FROM issued_tool_calls WHERE rowid <= (SELECT max(rowid) FROM issued_tool_calls) - ?",
      MAX_ROWS
    );
  }

  /** Record what a tool execution produced (the execute wrapper in tools.ts). */
  async recordResult(
    call: IssuedCall,
    result: { output: unknown } | { error: string }
  ): Promise<void> {
    await this.upsertCall(call);
    if ("output" in result) {
      this.sql.exec(
        "UPDATE issued_tool_calls SET output_hash = ? WHERE id = ?",
        await hash(result.output),
        call.toolCallId
      );
    } else {
      this.sql.exec(
        "UPDATE issued_tool_calls SET error_text = ? WHERE id = ?",
        result.error,
        call.toolCallId
      );
    }
  }

  private rows(): Map<string, Row> {
    return new Map(
      this.sql
        .exec<Row>("SELECT * FROM issued_tool_calls")
        .toArray()
        .map((r) => [r.id, r])
    );
  }

  /**
   * The part as the model may see it, or null to drop it. Only states the server produces are
   * accepted; an output must match the recorded hash, and an error always carries the server's
   * own text, never the client's.
   */
  private async admit(
    part: ToolPart,
    row: Row | undefined
  ): Promise<ToolPart | null> {
    if (!row || `tool-${row.name}` !== part.type) return null;
    if ((await hash(part.input)) !== row.input_hash) return null;
    switch (part.state) {
      case "output-available":
        return row.output_hash !== null &&
          (await hash(part.output)) === row.output_hash
          ? part
          : null;
      case "output-error":
        return { ...part, errorText: row.error_text ?? GENERIC_TOOL_ERROR };
      case "approval-requested":
      case "approval-responded":
      case "output-denied":
        return row.confirmation !== null ? part : null;
      default:
        return null;
    }
  }

  /**
   * Consume a server-issued credit confirmation that the customer just answered: its tool call id
   * only for an `approval-responded` part the server issued, with an unchanged input, not consumed
   * before; otherwise null.
   */
  async consumeAnsweredConfirmation(
    messages: UIMessage[]
  ): Promise<string | null> {
    const assistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!assistant) return null;
    const rows = this.rows();
    for (const part of toolParts(assistant)) {
      if (part.state !== "approval-responded") continue;
      const row = rows.get(part.toolCallId);
      if (row?.confirmation !== "requested") continue;
      if (!(await this.admit(part, row))) continue;
      const updated = this.sql.exec(
        "UPDATE issued_tool_calls SET confirmation = 'consumed' WHERE id = ? AND confirmation = 'requested'",
        part.toolCallId
      ).rowsWritten;
      if (updated > 0) return part.toolCallId;
    }
    return null;
  }

  /** The conversation with every tool part the server did not produce removed or corrected. */
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
          const admitted = await this.admit(p, rows.get(p.toolCallId));
          if (admitted)
            parts.push(admitted as unknown as UIMessage["parts"][number]);
          continue;
        }
        parts.push(part);
      }
      if (parts.length > 0) out.push({ ...message, parts });
    }
    return out;
  }
}
