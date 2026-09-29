// STUB from the Stop 2 foundation. Owned by the agent lane (prompt-history/prompts/03-agent.md).
import { DurableObject } from "cloudflare:workers";

/** One global instance: daily sandbox and neuron counters (DECISIONS.md D-7). */
export class Quota extends DurableObject<Env> {
  ping(): string {
    return "quota";
  }
}
