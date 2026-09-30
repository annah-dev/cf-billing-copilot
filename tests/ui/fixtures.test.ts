import { describe, expect, it } from "vitest";
import { createApi, ApiError } from "../../src/ui/api";
import { createFixtureBackend } from "../../src/ui/fixtures";
import { ToolSchemas } from "../../src/contracts/tools";
import { memoryStorage } from "./storage";

describe("interactive fixture backend", () => {
  it("boots three customers and keeps resets and customers isolated", async () => {
    const backend = createFixtureBackend(memoryStorage());
    const api = createApi(backend.transport);
    const first = await api.createSandbox();
    const second = await api.createSandbox();
    expect(first.customers).toHaveLength(3);
    const customerId = first.customers[0].customerId;
    const panel = await api.panel(first.sandboxId, customerId);
    backend.startCredit(first.sandboxId, customerId, {
      invoiceId: panel.currentInvoice.id,
      reason: "Double posted"
    });
    expect(
      (await api.panel(first.sandboxId, customerId)).creditRequests
    ).toHaveLength(2);
    expect(
      (await api.panel(second.sandboxId, customerId)).creditRequests
    ).toHaveLength(1);
    expect(
      (await api.panel(first.sandboxId, first.customers[1].customerId))
        .creditRequests
    ).toHaveLength(1);
  });
  it("confirmation creates one pending request, retry reuses it and records source values", async () => {
    const backend = createFixtureBackend(memoryStorage());
    const api = createApi(backend.transport);
    const session = await api.createSandbox();
    const cid = session.customers[0].customerId;
    const panel = await api.panel(session.sandboxId, cid);
    const input = {
      invoiceId: panel.currentInvoice.id,
      reason: "Duplicated debit"
    };
    const result = backend.startCredit(session.sandboxId, cid, input);
    expect(
      ToolSchemas.startCreditRequest.output.parse(result).request.status
    ).toBe("pending_approval");
    expect(backend.startCredit(session.sandboxId, cid, input).existing).toBe(
      true
    );
    const pending = await api.panel(session.sandboxId, cid);
    expect(pending.creditRequests).toHaveLength(2);
    expect(pending.audit.map((record) => record.action)).toEqual([
      "memo_pending",
      "credit_validated",
      "credit_requested",
      "sandbox_created"
    ]);
  });
  it.each(["approve", "reject"] as const)(
    "persists %s across tabs and refuses a conflicting decision",
    async (decision) => {
      const storage = memoryStorage();
      const backend = createFixtureBackend(storage);
      const api = createApi(backend.transport);
      const session = await api.createSandbox();
      const cid = session.customers[0].customerId;
      const panel = await api.panel(session.sandboxId, cid);
      const started = backend.startCredit(session.sandboxId, cid, {
        invoiceId: panel.currentInvoice.id,
        reason: "Duplicate debit"
      });
      const otherTab = createApi(createFixtureBackend(storage).transport);
      expect(
        (
          await otherTab.creditRequests(
            session.sandboxId,
            session.approverToken
          )
        ).requests[0].status
      ).toBe("pending_approval");
      const action = { decision, reason: "Reviewed the posting reference" };
      const result = await otherTab.decide(
        session.sandboxId,
        session.approverToken,
        started.request.id,
        action
      );
      expect(result.request.status).toBe(
        decision === "approve" ? "applied" : "rejected"
      );
      expect(
        (
          await otherTab.decide(
            session.sandboxId,
            session.approverToken,
            started.request.id,
            action
          )
        ).alreadyRecorded
      ).toBe(true);
      await expect(
        otherTab.decide(
          session.sandboxId,
          session.approverToken,
          started.request.id,
          {
            decision: decision === "approve" ? "reject" : "approve",
            reason: "Changed my mind"
          }
        )
      ).rejects.toBeInstanceOf(ApiError);
      expect(
        (await api.panel(session.sandboxId, cid)).creditRequests[0].status
      ).toBe(result.request.status);
      expect((await api.panel(session.sandboxId, cid)).audit[0].action).toBe(
        decision === "approve" ? "credit_applied" : "credit_rejected"
      );
    }
  );
  it("refuses wrong tokens, unknown sandboxes and expired requests", async () => {
    const backend = createFixtureBackend(memoryStorage());
    const api = createApi(backend.transport);
    const session = await api.createSandbox();
    const cid = session.customers[0].customerId;
    const panel = await api.panel(session.sandboxId, cid);
    await expect(
      api.creditRequests(session.sandboxId, "wrong")
    ).rejects.toMatchObject({ response: { error: { code: "unauthorized" } } });
    await expect(api.panel("f".repeat(32), cid)).rejects.toMatchObject({
      response: { error: { code: "not_found" } }
    });
    await expect(
      api.decide(
        session.sandboxId,
        session.approverToken,
        panel.creditRequests[0].id,
        { decision: "approve", reason: "late" }
      )
    ).rejects.toMatchObject({ response: { error: { code: "conflict" } } });
  });
});
