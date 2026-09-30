// Shared by the agent (which starts a credit Workflow through runWorkflow) and the Ledger (which
// re-creates a missing instance during recovery). AgentWorkflow needs the originating agent in its
// params; runWorkflow adds these fields itself, and createParams builds the same ones for the Ledger.
import { agentInstanceName } from "../contracts";

export const CREDIT_WORKFLOW = "CREDIT_WORKFLOW";
export const AGENT_BINDING = "BillingAgent";

export type CreditWorkflowParams = { sandboxId: string; requestId: string };

/** The Workflow instance id is the credit request id (DECISIONS.md DEV-9, D-9). */
export function createParams(
  sandboxId: string,
  customerId: string,
  requestId: string
) {
  const name = agentInstanceName(sandboxId, customerId);
  return {
    id: requestId,
    params: {
      sandboxId,
      requestId,
      __agentName: name,
      __agentBinding: AGENT_BINDING,
      __workflowName: CREDIT_WORKFLOW,
      __agentOrigin: {
        kind: "agent" as const,
        version: 1 as const,
        binding: AGENT_BINDING,
        name
      }
    }
  };
}

/** Workflow instance states in which the instance is alive and will make progress on its own. */
export const LIVE_INSTANCE_STATES = [
  "queued",
  "running",
  "waiting",
  "paused",
  "waitingForPause"
] as const;
