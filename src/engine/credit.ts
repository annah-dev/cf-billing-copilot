import {
  ClaimValidationSchema,
  EngineError,
  MoneySchema,
  money,
  type BillingDataset,
  type CreditMemo,
  type LedgerEntry
} from "../contracts";
import { difference, integer, safe } from "./math";

export function validateClaim(
  data: BillingDataset,
  claim: {
    customerId: string;
    invoiceId: string;
    disputedLedgerEntryId: string | null;
  },
  existingMemos: readonly CreditMemo[]
) {
  const refuse = (
    reason:
      | "invoice_not_found"
      | "entry_not_on_invoice"
      | "no_duplicate_found"
      | "already_fully_credited",
    explanation: string
  ) => ClaimValidationSchema.parse({ valid: false, reason, explanation });
  if (
    !data.invoices.some(
      (bill) =>
        bill.id === claim.invoiceId && bill.customerId === claim.customerId
    )
  )
    return refuse(
      "invoice_not_found",
      "Invoice does not belong to this customer or does not exist."
    );
  const entries = data.ledger
    .filter(
      (entry) =>
        entry.customerId === claim.customerId &&
        entry.invoiceId === claim.invoiceId
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (
    claim.disputedLedgerEntryId !== null &&
    !entries.some((entry) => entry.id === claim.disputedLedgerEntryId)
  )
    return refuse(
      "entry_not_on_invoice",
      "Disputed entry is not on this customer's invoice."
    );
  const memos = new Map<string, CreditMemo>();
  // The frozen engine interface requires the caller's current pending/applied
  // reservation snapshot. Dataset history must never resurrect a void memo.
  for (const memo of existingMemos) {
    if (memo.amount.cents <= 0)
      throw new EngineError(
        "invalid_input",
        "Credit memo amount must be positive"
      );
    const previous = memos.get(memo.id);
    if (
      previous &&
      (previous.requestId !== memo.requestId ||
        previous.disputedLedgerEntryId !== memo.disputedLedgerEntryId ||
        previous.amount.cents !== memo.amount.cents ||
        previous.status !== memo.status)
    )
      throw new EngineError(
        "invalid_input",
        "Conflicting credit memo snapshots"
      );
    memos.set(memo.id, memo);
  }
  let duplicateFound = false;
  for (let index = 0; index < entries.length; index++) {
    const disputed = entries[index];
    if (
      claim.disputedLedgerEntryId !== null &&
      disputed.id !== claim.disputedLedgerEntryId
    )
      continue;
    if (disputed.kind !== "charge") continue;
    const original = entries
      .slice(0, index)
      .find(
        (entry) =>
          entry.kind === "charge" &&
          entry.reference === disputed.reference &&
          entry.amount.cents === disputed.amount.cents
      );
    if (!original) continue;
    duplicateFound = true;
    const reserved = safe(
      [...memos.values()]
        .filter(
          (memo) =>
            memo.disputedLedgerEntryId === disputed.id && memo.status !== "void"
        )
        .reduce((total, memo) => total + integer(memo.amount.cents), 0n)
    );
    const remaining = difference(disputed.amount.cents, reserved);
    if (remaining <= 0) continue;
    return ClaimValidationSchema.parse({
      valid: true,
      disputedLedgerEntryId: disputed.id,
      duplicateOfLedgerEntryId: original.id,
      creditableAmount: money(remaining),
      explanation: `Charge ${disputed.id} duplicates earlier charge ${original.id}: same customer, invoice, billing-run posting id and amount ${disputed.amount.display}. Pending and applied reservations total ${money(reserved).display}; remaining creditable amount ${money(remaining).display}.`
    });
  }
  return duplicateFound
    ? refuse(
        "already_fully_credited",
        "Pending and applied memos already reserve the entire duplicated debit."
      )
    : refuse(
        "no_duplicate_found",
        "No earlier invoice charge with the same billing-run posting id and amount; payments are outside duplicated-debit claims."
      );
}

export function balance(entries: readonly LedgerEntry[], customerId: string) {
  return MoneySchema.parse(
    money(
      safe(
        entries
          .filter((entry) => entry.customerId === customerId)
          .reduce(
            (total, entry) =>
              total +
              (entry.kind === "charge" ? 1n : -1n) *
                integer(entry.amount.cents),
            0n
          )
      )
    )
  );
}
