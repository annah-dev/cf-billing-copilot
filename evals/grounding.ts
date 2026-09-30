import { MoneySchema } from "../src/contracts";
import type { EvalCase } from "./cases";
import { parseRecording } from "./recording";

// Recognize noncanonical currency too: it must fail rather than disappear from the check.
const moneyPattern =
  /(?:[-+]?\$\s*[\d,]+(?:\.\d+)?|\bUSD\s*[-+]?[\d,]+(?:\.\d+)?|[-+]?[\d,]+(?:\.\d+)?\s*(?:USD|dollars|cents)\b)/gi;
const numberPattern =
  /(?<![\w])\d{4}-\d{2}-\d{2}(?=T\d{2}:\d{2})|(?<![\w])\d{4}-\d{2}(?:-\d{2})?(?![\w])|(?<![\w])\d[\d,]*(?:\.\d+)?(?:%|x)?(?![\w])/g;
const numbers = (text: string) =>
  [...text.matchAll(numberPattern)].map((match) =>
    match[0].replaceAll(",", "")
  );
const moneyStrings = (text: string) =>
  [...text.matchAll(moneyPattern)].map((match) => match[0]);
const stripMoney = (text: string) => text.replace(moneyPattern, " ");

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const month = String.raw`(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const day = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const yearSep = String.raw`(?:,\s*|\s+)(\d{4})(?!\d)`;
const monthNumber = (name: string) =>
  String(
    monthNames.findIndex((full) => full.startsWith(name.slice(0, 3))) + 1
  ).padStart(2, "0");
const pad = (value: string) => value.padStart(2, "0");
const namedDates: [RegExp, (m: string[]) => [string, string, string?]][] = [
  [
    new RegExp(String.raw`\b${month}\s+${day}${yearSep}`, "g"),
    (m) => [m[3], monthNumber(m[1]), pad(m[2])]
  ],
  [
    new RegExp(String.raw`(?<![\w])${day}\s+(?:of\s+)?${month}${yearSep}`, "g"),
    (m) => [m[3], monthNumber(m[2]), pad(m[1])]
  ],
  [
    new RegExp(String.raw`\b${month}${yearSep}`, "g"),
    (m) => [m[2], monthNumber(m[1])]
  ],
  [
    new RegExp(String.raw`\b${month}\s+${day}(?![\w])`, "g"),
    (m) => ["", monthNumber(m[1]), pad(m[2])]
  ],
  [
    new RegExp(String.raw`(?<![\w])${day}\s+(?:of\s+)?${month}(?![\w])`, "g"),
    (m) => ["", monthNumber(m[2]), pad(m[1])]
  ]
];

// Rewrite named calendar dates as ISO so the whole date, not its parts, must be grounded.
// A yearless day takes its year only from a single grounded period for that month.
function normalizeDates(
  text: string,
  numeric: Set<string>
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  let result = text;
  for (const [pattern, parts] of namedDates) {
    result = result.replace(pattern, (...match: string[]) => {
      const [year, monthPart, dayPart] = parts(match);
      if (year)
        return ` ${[year, monthPart, dayPart].filter(Boolean).join("-")} `;
      const years = new Set(
        [...numeric]
          .filter((token) => token.slice(4, 7) === `-${monthPart}`)
          .map((token) => token.slice(0, 4))
      );
      if (years.size === 1) return ` ${[...years][0]}-${monthPart}-${dayPart} `;
      unresolved.push(match[0]);
      return " ";
    });
  }
  return { text: result, unresolved };
}

function evidence(
  value: unknown,
  amounts: Set<string>,
  numeric: Set<string>
): void {
  if (typeof value === "string") {
    moneyStrings(value).forEach((amount) => amounts.add(amount));
    numbers(stripMoney(value)).forEach((token) => {
      numeric.add(token);
      if (/^\d{4}-\d{2}/.test(token)) numeric.add(token.slice(0, 4));
    });
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
    const dated = normalizeDates(recorded.response.text, numeric);
    for (const expected of planned.expected) {
      const amount = expected.includes("$");
      const present = amount
        ? moneyStrings(recorded.response.text).includes(expected)
        : numbers(dated.text).includes(expected.replaceAll(",", ""));
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
    for (const date of dated.unresolved)
      issues.push(`Turn ${index}: ungrounded date ${date}`);
    for (const token of numbers(stripMoney(dated.text))) {
      if (!numeric.has(token))
        issues.push(`Turn ${index}: ungrounded number ${token}`);
    }
  });
  return issues;
}
