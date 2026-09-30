import { MoneySchema } from "../src/contracts";
import type { EvalCase } from "./cases";
import { parseRecording } from "./recording";

// Recognize noncanonical currency too: it must fail rather than disappear from the check.
const moneyPattern =
  /(?:[-+]?\$\s*[\d,]+(?:\.\d+)?|\bUSD\s*[-+]?[\d,]+(?:\.\d+)?|[-+]?[\d,]+(?:\.\d+)?\s*(?:USD|dollars|cents)\b)/gi;
const numberPattern =
  /(?<![\w])\d{4}-\d{2}(?:-\d{2})?(?![\w])|(?<![\w])\d[\d,]*(?:\.\d+)?(?:%|x)?(?![\w])/g;
const numbers = (text: string) =>
  [...text.matchAll(numberPattern)].map((match) =>
    match[0].replaceAll(",", "")
  );
const moneyStrings = (text: string) =>
  [...text.matchAll(moneyPattern)].map((match) => match[0]);
const stripMoney = (text: string) => text.replace(moneyPattern, " ");

function evidence(
  value: unknown,
  amounts: Set<string>,
  numeric: Set<string>
): void {
  if (typeof value === "string") {
    moneyStrings(value).forEach((amount) => amounts.add(amount));
    numbers(stripMoney(value)).forEach((token) => numeric.add(token));
  } else if (typeof value === "number") {
    numeric.add(String(value));
  } else if (Array.isArray(value)) {
    value.forEach((item) => evidence(item, amounts, numeric));
  } else if (value && typeof value === "object") {
    const money = MoneySchema.safeParse(value);
    if (money.success) {
      amounts.add(money.data.display);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "basisPoints" && key !== "hundredths")
        evidence(child, amounts, numeric);
    }
  }
}

export function checkReplay(testCase: EvalCase, value: unknown): string[] {
  const issues: string[] = [];
  let recording;
  try {
    recording = parseRecording(value);
  } catch (error) {
    return [`Invalid recording: ${String(error)}`];
  }
  if (recording.caseId !== testCase.id)
    issues.push("Recording case id mismatch");
  if (recording.turns.length !== testCase.turns.length)
    issues.push("Recording turn count mismatch");
  const amounts = new Set<string>();
  const numeric = new Set<string>();
  recording.turns.forEach((recorded, index) => {
    const planned = testCase.turns[index];
    if (!planned) return;
    if (recorded.customerId !== testCase.customerId)
      issues.push(`Turn ${index}: customer mismatch`);
    if (
      recorded.request.message !== planned.request.message ||
      recorded.request.confirm !== planned.request.confirm
    )
      issues.push(`Turn ${index}: request mismatch`);
    // Only this and earlier responses ground an answer; future turns cannot excuse a fabrication.
    recorded.response.toolCalls.forEach((call) =>
      evidence(call.output, amounts, numeric)
    );
    for (const expected of planned.expected) {
      const amount = expected.includes("$");
      const present = amount
        ? moneyStrings(recorded.response.text).includes(expected)
        : numbers(recorded.response.text).includes(
            expected.replaceAll(",", "")
          );
      if (!present) issues.push(`Turn ${index}: missing expected ${expected}`);
    }
    for (const phrase of planned.phrases) {
      if (!phrase.test(recorded.response.text))
        issues.push(`Turn ${index}: missing meaning ${phrase}`);
    }
    for (const amount of moneyStrings(recorded.response.text)) {
      if (!amounts.has(amount))
        issues.push(`Turn ${index}: ungrounded money ${amount}`);
    }
    for (const token of numbers(stripMoney(recorded.response.text))) {
      if (!numeric.has(token))
        issues.push(`Turn ${index}: ungrounded number ${token}`);
    }
  });
  return issues;
}
