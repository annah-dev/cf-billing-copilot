import { describe, expect, it } from "vitest";
import {
  ClaimValidationSchema,
  MoneySchema,
  money,
  type CreditMemo
} from "../../src/contracts";
import { engine } from "../../src/engine";

function creditFixture() {
  const data = engine.seed();
  const entry = data.ledger.find(
    (item) => item.id === "le_duplicate_september"
  )!;
  const claim = {
    customerId: "cus_1",
    invoiceId: entry.invoiceId!,
    disputedLedgerEntryId: entry.id as string | null
  };
  const memo = (
    cents: number,
    status: CreditMemo["status"] = "pending",
    id = "cm_test"
  ): CreditMemo => ({
    id,
    requestId: "cr_test",
    disputedLedgerEntryId: entry.id,
    amount: money(cents),
    status
  });
  return { data, entry, claim, memo };
}

describe("duplicated-debit claims", () => {
  it("validates explicit and inferred duplicate against the ledger", () => {
    const { data, entry, claim } = creditFixture();
    const result = engine.validateCreditClaim(data, claim, []);
    expect(ClaimValidationSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      valid: true,
      disputedLedgerEntryId: entry.id,
      duplicateOfLedgerEntryId: "le_charge_1_2026_09",
      creditableAmount: money(41287)
    });
    expect(
      engine.validateCreditClaim(
        data,
        { ...claim, disputedLedgerEntryId: null },
        []
      )
    ).toEqual(result);
  });

  it("subtracts pending plus applied reservations once and ignores void memos", () => {
    const { data, claim, memo } = creditFixture();
    const pending = memo(10000);
    data.creditMemos.push(pending);
    expect(
      engine.validateCreditClaim(data, claim, [
        pending,
        memo(20000, "applied", "cm_applied"),
        memo(30000, "void", "cm_void")
      ])
    ).toMatchObject({ valid: true, creditableAmount: money(11287) });
  });

  it.each([41287, 50000])(
    "refuses fully reserved or over-reserved debit (%i)",
    (cents) => {
      const { data, claim, memo } = creditFixture();
      expect(
        engine.validateCreditClaim(data, claim, [memo(cents)])
      ).toMatchObject({ valid: false, reason: "already_fully_credited" });
      expect(
        engine.validateCreditClaim(
          data,
          { ...claim, disputedLedgerEntryId: null },
          [memo(cents)]
        )
      ).toMatchObject({ valid: false, reason: "already_fully_credited" });
    }
  );

  it("ignores reservations belonging to another charge", () => {
    const { data, claim, memo } = creditFixture();
    expect(
      engine.validateCreditClaim(data, claim, [
        { ...memo(41287), disputedLedgerEntryId: "le_other" }
      ])
    ).toMatchObject({ valid: true, creditableAmount: money(41287) });
  });

  it("rejects conflicting snapshots and nonpositive memos", () => {
    const { data, claim, memo } = creditFixture();
    data.creditMemos.push(memo(10));
    expect(() => engine.validateCreditClaim(data, claim, [memo(11)])).toThrow(
      /Conflicting/
    );
    expect(() => engine.validateCreditClaim(data, claim, [memo(-1)])).toThrow(
      /positive/
    );
  });

  it.each([
    "original",
    "payment",
    "reference",
    "amount",
    "customer",
    "invoice",
    "entry"
  ])("refuses a non-matching %s", (defect) => {
    const { data, entry, claim } = creditFixture();
    let reason = "no_duplicate_found";
    if (defect === "original")
      claim.disputedLedgerEntryId = "le_charge_1_2026_09";
    if (defect === "payment") entry.kind = "payment";
    if (defect === "reference") entry.reference = "different-run";
    if (defect === "amount") entry.amount = money(41286);
    if (defect === "customer") {
      claim.customerId = "cus_2";
      reason = "invoice_not_found";
    }
    if (defect === "invoice") {
      claim.invoiceId = "inv_missing";
      reason = "invoice_not_found";
    }
    if (defect === "entry") {
      claim.disputedLedgerEntryId = "le_payment_1_2026_08";
      reason = "entry_not_on_invoice";
    }
    expect(engine.validateCreditClaim(data, claim, [])).toMatchObject({
      valid: false,
      reason
    });
  });

  it("sorts ledger chronology independently of array order and finds the next available duplicate", () => {
    const { data, entry, claim, memo } = creditFixture();
    data.ledger.push({ ...entry, id: "le_third", at: "2026-10-01T00:02:00Z" });
    data.ledger.reverse();
    expect(
      engine.validateCreditClaim(
        data,
        { ...claim, disputedLedgerEntryId: null },
        [memo(41287)]
      )
    ).toMatchObject({
      valid: true,
      disputedLedgerEntryId: "le_third",
      duplicateOfLedgerEntryId: "le_charge_1_2026_09"
    });
  });
});

describe("balance", () => {
  it("sums signed charges minus payments and posted credits, isolated by customer", () => {
    const { data, entry } = creditFixture();
    expect(engine.balance(data.ledger, "cus_1")).toEqual(money(82574));
    data.ledger.push({
      ...entry,
      id: "le_remedy",
      kind: "credit",
      reference: "cr_remedy"
    });
    expect(engine.balance(data.ledger, "cus_1")).toEqual(money(41287));
    const result = engine.balance([{ ...entry, kind: "payment" }], "cus_1");
    expect(result).toEqual(money(-41287));
    expect(MoneySchema.parse(result)).toEqual(result);
    expect(engine.balance([], "cus_1")).toEqual(money(0));
    expect(engine.balance(data.ledger, "cus_unknown")).toEqual(money(0));
  });
});
