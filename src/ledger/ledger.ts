// STUB from the Stop 2 foundation. Owned by the agent lane (prompt-history/prompts/03-agent.md).
import { DurableObject } from "cloudflare:workers";

/** One instance per sandbox: the system of record (DECISIONS.md D-1). */
export class Ledger extends DurableObject<Env> {
  ping(): string {
    return "ledger";
  }
}
