import { describe, expect, it } from "vitest";
import { createApi, ApiError } from "../../src/ui/api";
import { createFixtureBackend } from "../../src/ui/fixtures";
import { engine } from "../../src/engine";
import { ToolSchemas } from "../../src/contracts/tools";
import { memoryStorage } from "./storage";

describe("interactive fixture backend", () => {
  it("derives every customer's plan, invoice, balance, history and customers from the shared seed", async () => {
    const data = engine.seed();
    const api = createApi(createFixtureBackend(memoryStorage()).transport);
    const session = await api.createSandbox();
    expect(session.customers).toEqual(
      data.customers.map(({ id, name }) => ({ customerId: id, name }))
    );
    for (const customer of data.customers) {
      const panel = await api.panel(session.sandboxId, customer.id);
      expect(panel.customerName).toBe(customer.name);
      const invoice = data.invoices
        .filter((item) => item.customerId === customer.id)
        .sort((a, b) => b.period.localeCompare(a.period))[0];
      expect(panel.currentInvoice).toEqual(JSON.parse(JSON.stringify(invoice)));
      expect(panel.currentInvoice).toEqual(
        JSON.parse(
          JSON.stringify(engine.buildInvoice(data, customer.id, invoice.period))
        )
      );
      expect(panel.balance).toEqual(engine.balance(data.ledger, customer.id));
      const subscription = data.subscriptions.find(
        (item) =>
          item.customerId === customer.id &&
          item.from <= invoice.issuedOn &&
          (item.to === null || item.to > invoice.issuedOn)
      )!;
      const plan = data.plans.find((item) => item.id === subscription.planId)!;
      expect(panel.plan).toEqual({ planId: plan.id, name: plan.name });
      expect(panel.creditRequests).toEqual(
        data.creditRequests.filter((item) => item.customerId === customer.id)
      );
      expect(
        panel.audit.filter((record) => record.action !== "sandbox_created")
      ).toEqual(
        [...data.audit]
          .reverse()
          .filter((record) =>
            panel.creditRequests.some(
              (request) =>
                request.id === record.subject.id ||
                data.creditMemos.some(
                  (memo) =>
                    memo.requestId === request.id &&
                    memo.id === record.subject.id
                )
            )
          )
      );
    }
  });
  it("uses engine credit validation and balance before and after a credit without changing the invoice", async () => {
    const data = engine.seed();
    const storage = memoryStorage();
    const backend = createFixtureBackend(storage);
    const api = createApi(backend.transport);
    const session = await api.createSandbox();
    const cid = session.customers[0].customerId;
    const before = await api.panel(session.sandboxId, cid);
    const validation = engine.validateCreditClaim(
      data,
      {
        customerId: cid,
        invoiceId: before.currentInvoice.id,
        disputedLedgerEntryId: null
      },
      data.creditMemos
    );
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("Seed has no duplicate");
    const started = backend.startCredit(session.sandboxId, cid, {
      invoiceId: before.currentInvoice.id,
      reason: "Duplicate posting"
    });
    expect(started.request.validatedAmount).toEqual(
      validation.creditableAmount
    );
    expect(
      (await api.panel(session.sandboxId, cid)).creditRequests.find(
        (request) => request.id === started.request.id
      )?.disputedLedgerEntryId
    ).toBe(validation.disputedLedgerEntryId);
    await api.decide(
      session.sandboxId,
      session.approverToken,
      started.request.id,
      { decision: "approve", reason: "Verified" }
    );
    const after = await api.panel(session.sandboxId, cid);
    const expectedLedger = [
      ...data.ledger,
      {
        id: "le_test_credit",
        customerId: cid,
        at: session.createdAt,
        kind: "credit" as const,
        amount: validation.creditableAmount,
        invoiceId: before.currentInvoice.id,
        reference: "test",
        description: "test credit"
      }
    ];
    expect(after.balance).toEqual(engine.balance(expectedLedger, cid));
    expect(after.currentInvoice).toEqual(before.currentInvoice);
    expect(engine.seed()).toEqual(data);
  });
  it("rejects a credit on a customer with no duplicated debit using the engine explanation", async () => {
    const data = engine.seed();
    const backend = createFixtureBackend(memoryStorage());
    const api = createApi(backend.transport);
    const session = await api.createSandbox();
    const cid = session.customers[1].customerId;
    const panel = await api.panel(session.sandboxId, cid);
    const validation = engine.validateCreditClaim(
      data,
      {
        customerId: cid,
        invoiceId: panel.currentInvoice.id,
        disputedLedgerEntryId: null
      },
      data.creditMemos
    );
    expect(validation.valid).toBe(false);
    const result = backend.startCredit(session.sandboxId, cid, {
      invoiceId: panel.currentInvoice.id,
      reason: "Check for a duplicate"
    });
    expect(result.request.status).toBe("rejected");
    expect(result.request.validatedAmount).toBeNull();
    expect(result.message).toBe(validation.explanation);
    expect((await api.panel(session.sandboxId, cid)).balance).toEqual(
      engine.balance(data.ledger, cid)
    );
  });
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
    ).toHaveLength(0);
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
    expect(pending.audit.slice(0, 4).map((record) => record.action)).toEqual([
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
        (await api.panel(session.sandboxId, cid)).creditRequests.find(
          (request) => request.id === started.request.id
        )?.status
      ).toBe(result.request.status);
      expect(
        (await api.panel(session.sandboxId, cid)).audit.some(
          (record) =>
            record.action ===
            (decision === "approve" ? "credit_applied" : "credit_rejected")
        )
      ).toBe(true);
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
