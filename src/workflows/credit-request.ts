// STUB from the Stop 2 foundation. Owned by the agent lane (prompt-history/prompts/03-agent.md).
import type { WorkflowStep } from "cloudflare:workers";
import { AgentWorkflow, type AgentWorkflowEvent } from "agents/workflows";
import type { BillingAgent } from "../agent/billing-agent";

export type CreditWorkflowParams = { sandboxId: string; requestId: string };

/** validate, pending memo, wait for approval, apply or reject, or expire (docs/ARCHITECTURE.md). */
export class CreditRequestWorkflow extends AgentWorkflow<BillingAgent, CreditWorkflowParams> {
  async run(_event: AgentWorkflowEvent<CreditWorkflowParams>, _step: WorkflowStep): Promise<never> {
    throw new Error("CreditRequestWorkflow is not implemented yet (agent lane)");
  }
}
