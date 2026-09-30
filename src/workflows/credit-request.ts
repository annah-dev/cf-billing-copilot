// validate, pending memo, wait for the approver, then apply or reject, or expire on timeout
// (docs/ARCHITECTURE.md, "Credit request" and "Approval never arrives"; D-6, D-9). Every step is
// one idempotent Ledger call, so a replayed or restarted instance never writes a second record.
import type { WorkflowSleepDuration } from "cloudflare:workers";
import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep,
  type DefaultProgress
} from "agents/workflows";
import type { Actor } from "../contracts";
import type { BillingAgent } from "../agent/billing-agent";
import { getConfig } from "../http/config";
import type { StepResult } from "../ledger/ledger";
import type { CreditWorkflowParams } from "./params";

export type { CreditWorkflowParams } from "./params";

/** Step names, exported so tests can mock or time out a specific step. */
export const STEP = {
  validate: "validate",
  memo: "create-pending-memo",
  wait: "wait-for-approval",
  readDecision: "read-decision",
  expire: "expire",
  approve: "approve",
  apply: "apply",
  reject: "reject"
} as const;

export const EXPIRY_REASON = "No approver decision within the approval timeout";

/** Copy an RPC result into a plain, serialisable step result. */
function plain(r: StepResult): StepResult {
  return { outcome: r.outcome, status: r.status, decision: r.decision };
}

export type CreditWorkflowResult = {
  requestId: string;
  status: StepResult["status"];
  timedOut: boolean;
  /** Name and message of the error waitForEvent threw on timeout (undocumented, DEV-8). */
  waitError: string | null;
};

export class CreditRequestWorkflow extends AgentWorkflow<
  BillingAgent,
  CreditWorkflowParams,
  DefaultProgress,
  Env
> {
  async run(
    event: AgentWorkflowEvent<CreditWorkflowParams>,
    step: AgentWorkflowStep
  ): Promise<CreditWorkflowResult> {
    const { sandboxId, requestId } = event.payload;
    const ledger = this.env.LEDGER.get(this.env.LEDGER.idFromName(sandboxId));
    const actor: Actor = `workflow:${requestId}`;
    let timedOut = false;
    let waitError: string | null = null;
    const done = async (
      status: StepResult["status"]
    ): Promise<CreditWorkflowResult> => {
      await this.notify(requestId, status);
      return { requestId, status, timedOut, waitError };
    };

    // A restarted instance replays from the top; each step returns the Ledger's current state, so
    // the run resumes wherever the request actually is.
    const validated = await step.do(STEP.validate, async () =>
      plain(await ledger.validate(requestId, actor))
    );
    let current = validated;
    if (current.status === "requested") {
      current = await step.do(STEP.memo, async () =>
        plain(await ledger.createPendingMemo(requestId, actor))
      );
    }
    if (current.status === "approved") {
      return this.settle(step, ledger, requestId, actor, "approve", done);
    }
    if (current.status !== "pending_approval") return done(current.status);
    if (current.decision !== null) {
      return this.settle(
        step,
        ledger,
        requestId,
        actor,
        current.decision,
        done
      );
    }
    await this.notify(requestId, "pending_approval");

    // The event is only a wake-up: the decision is read from the Ledger, never from the payload.
    // waitForEvent throws on timeout (no documented error class), so the catch covers that one call.
    try {
      await step.waitForEvent(STEP.wait, {
        type: "approval",
        timeout: getConfig(this.env).APPROVAL_TIMEOUT as WorkflowSleepDuration
      });
    } catch (err) {
      timedOut = true;
      waitError =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    const after = timedOut
      ? await step.do(STEP.expire, async () =>
          plain(await ledger.expire(requestId, "system", EXPIRY_REASON))
        )
      : await step.do(STEP.readDecision, async () =>
          plain(await ledger.decision(requestId))
        );

    if (after.status === "expired") return done("expired");
    if (after.decision === null) {
      // Woken without a recorded decision: leave the request pending; the Ledger's sweeper expires
      // it after the deadline, or finishes it once a decision is recorded.
      return done(after.status);
    }
    return this.settle(step, ledger, requestId, actor, after.decision, done);
  }

  private async settle(
    step: AgentWorkflowStep,
    ledger: DurableObjectStub<import("../ledger/ledger").Ledger>,
    requestId: string,
    actor: Actor,
    decision: "approve" | "reject",
    done: (status: StepResult["status"]) => Promise<CreditWorkflowResult>
  ): Promise<CreditWorkflowResult> {
    if (decision === "reject") {
      const rejected = await step.do(STEP.reject, async () =>
        plain(await ledger.reject(requestId, actor))
      );
      return done(rejected.status);
    }
    await step.do(STEP.approve, async () =>
      plain(await ledger.approve(requestId, actor))
    );
    const applied = await step.do(STEP.apply, async () =>
      plain(await ledger.apply(requestId, actor))
    );
    return done(applied.status);
  }

  /** Best-effort progress to the originating agent, which broadcasts it to the chat UI. */
  private async notify(
    requestId: string,
    status: StepResult["status"]
  ): Promise<void> {
    try {
      await this.reportProgress({
        step: "credit-request",
        status: "running",
        requestId,
        creditStatus: status
      });
    } catch (_err) {
      // The agent may be gone (idle deletion); the Ledger stays the source of truth.
    }
  }
}
