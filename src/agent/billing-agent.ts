// STUB from the Stop 2 foundation. Owned by the agent lane (prompt-history/prompts/03-agent.md).
import { AIChatAgent } from "@cloudflare/ai-chat";

/** One instance per "<sandboxId>.<customerId>": chat history and customer memory. */
export class BillingAgent extends AIChatAgent<Env> {
  async onChatMessage(): Promise<Response> {
    return new Response("BillingAgent is not implemented yet (agent lane)", { status: 501 });
  }
}
