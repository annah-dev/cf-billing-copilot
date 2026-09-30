import { MoneySchema } from "../src/contracts";
import type { EvalCase } from "./cases";
import { parseRecording } from "./recording";

// Recognize noncanonical currency too: it must fail rather than disappear from the check.
const moneyPattern =
  /(?:[-+]?[$\u20ac\u00a3\u00a5]\s*[-+]?[\d,]+(?:\.\d+)?|\bUSD\s*[-+]?[\d,]+(?:\.\d+)?|[-+]?[\d,]+(?:\.\d+)?\s*(?:USD|dollars?|cents?)\b)/gi;
const numberPattern =
  /(?<![\w])\d{4}-\d{2}-\d{2}(?=T\d{2}:\d{2})|(?<![\w])\d{4}-\d{2}(?:-\d{2})?(?![\w])|(?<![\w])[-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+|\/\d+)?(?:%|x|st|nd|rd|th|[kKmMbB])?(?![\w])/g;
const numbers = (text: string) =>
  [...text.matchAll(numberPattern)].map((match) =>
    match[0].replaceAll(",", "").replace(/(st|nd|rd|th)$/, "")
  );
const moneyStrings = (text: string) =>
  [...text.matchAll(moneyPattern)].map((match) => match[0]);
const stripMoney = (text: string) => text.replace(moneyPattern, " ");

const smallNumbers = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen"
];
const tens = [
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety"
];
const numberWords = new RegExp(
  `\\b(?:${[...smallNumbers, ...tens, "hundred", "thousand", "million", "billion"].join("|")})(?:[ -]+(?:and[ -]+)?(?:${[...smallNumbers, ...tens, "hundred", "thousand", "million", "billion"].join("|")}))*\\b`,
  "gi"
);
function wordValue(text: string): string {
  let total = 0;
  let segment = 0;
  for (const word of text.toLowerCase().split(/[ -]+/)) {
    if (word === "and") continue;
    if (word === "hundred") segment = (segment || 1) * 100;
    else if (["thousand", "million", "billion"].includes(word)) {
      total +=
        (segment || 1) *
        { thousand: 1000, million: 1_000_000, billion: 1_000_000_000 }[
          word as "thousand"
        ];
      segment = 0;
    } else {
      const small = smallNumbers.indexOf(word);
      segment += small >= 0 ? small : (tens.indexOf(word) + 2) * 10;
    }
  }
  return String(total + segment);
}
function normalizeNumberWords(text: string): string {
  const ordinals = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth"
  ];
  return text
    .replace(numberWords, (words) => wordValue(words))
    .replace(
      new RegExp(`\\b(${ordinals.join("|")})\\b`, "gi"),
      (word) => `${ordinals.indexOf(word.toLowerCase()) + 1}th`
    )
    .replace(/(\d+(?:\.\d+)?)\s+percent\b/gi, "$1%")
    .replace(/(\d+(?:\.\d+)?)\s+times\b/gi, "$1x");
}

const countPattern =
  /(?<![\w-])(\d+)\s+(?:(?:invoice|billing|line)\s+)?(lines?|line items?|invoices?|tiers?|anomalies?|spikes?|credit requests?|meters?)\b/gi;
type Counts = Map<string, Set<string>>;
function addCount(counts: Counts, name: string, length: number): void {
  const values = counts.get(name) ?? new Set<string>();
  values.add(String(length));
  counts.set(name, values);
}
function countEvidence(value: unknown, counts: Counts): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => countEvidence(item, counts));
    return;
  }
  if ("lines" in value && "period" in value && "total" in value)
    addCount(counts, "invoices", 1);
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      const label = (
        {
          lines: "lines",
          simulatedLines: "lines",
          invoices: "invoices",
          tiers: "tiers",
          anomalies: "anomalies",
          requests: "credit requests",
          openCreditRequests: "credit requests",
          byMeter: "meters"
        } as Record<string, string>
      )[key];
      if (label) addCount(counts, label, child.length);
    }
    countEvidence(child, counts);
  }
}
function countName(name: string): string {
  const lower = name.toLowerCase();
  if (/^line/.test(lower)) return "lines";
  if (/^spike/.test(lower)) return "anomalies";
  return lower.endsWith("s") ? lower : `${lower}s`;
}

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
    monthNames.findIndex((full) =>
      full.toLowerCase().startsWith(name.slice(0, 3).toLowerCase())
    ) + 1
  ).padStart(2, "0");
const pad = (value: string) => value.padStart(2, "0");
const namedDates: [RegExp, (m: string[]) => [string, string, string?]][] = [
  [
    new RegExp(String.raw`\b${month}\s+${day}${yearSep}`, "gi"),
    (m) => [m[3], monthNumber(m[1]), pad(m[2])]
  ],
  [
    new RegExp(
      String.raw`(?<![\w])${day}\s+(?:of\s+)?${month}${yearSep}`,
      "gi"
    ),
    (m) => [m[3], monthNumber(m[2]), pad(m[1])]
  ],
  [
    new RegExp(String.raw`\b${month}${yearSep}`, "gi"),
    (m) => [m[2], monthNumber(m[1])]
  ],
  [
    new RegExp(String.raw`\b${month}\s+${day}(?![\w])`, "gi"),
    (m) => ["", monthNumber(m[1]), pad(m[2])]
  ],
  [
    new RegExp(String.raw`(?<![\w])${day}\s+(?:of\s+)?${month}(?![\w])`, "gi"),
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
      if (/^\d{4}-\d{2}/.test(token)) {
        numeric.add(token.slice(0, 4));
        numeric.add(token.slice(0, 7));
      }
    });
  } else if (typeof value === "number") {
    numeric.add(String(value));
  } else if (Array.isArray(value)) {
    numeric.add(String(value.length));
    // Ordered entries ground ordinal references in numbered invoice explanations.
    value.forEach((_, index) => numeric.add(String(index + 1)));
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
  const counts: Counts = new Map();
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
    recorded.response.toolCalls.forEach((call) => {
      evidence(call.output, amounts, numeric);
      countEvidence(call.output, counts);
    });
    const dated = normalizeDates(recorded.response.text, numeric);
    const normalized = normalizeNumberWords(dated.text);
    for (const expected of planned.expected) {
      const amount = expected.includes("$");
      const present = amount
        ? moneyStrings(recorded.response.text).includes(expected)
        : numbers(/[%x]$/.test(expected) ? dated.text : normalized).includes(
            expected.replaceAll(",", "")
          );
      if (!present) issues.push(`Turn ${index}: missing expected ${expected}`);
    }
    for (const phrase of planned.phrases) {
      if (!phrase.test(recorded.response.text))
        issues.push(`Turn ${index}: missing meaning ${phrase}`);
    }
    for (const amount of new Set([
      ...moneyStrings(recorded.response.text),
      ...moneyStrings(normalized)
    ])) {
      if (!amounts.has(amount))
        issues.push(`Turn ${index}: ungrounded money ${amount}`);
    }
    for (const date of dated.unresolved)
      issues.push(`Turn ${index}: ungrounded date ${date}`);
    for (const match of normalized.matchAll(countPattern)) {
      const name = countName(match[2]);
      if (
        match[2].toLowerCase() === "invoice" &&
        /^\d{4}$/.test(match[1]) &&
        numeric.has(match[1])
      )
        continue;
      if (!counts.get(name)?.has(match[1]))
        issues.push(`Turn ${index}: ungrounded count ${match[1]} ${name}`);
    }
    for (const token of numbers(stripMoney(normalized))) {
      if (!numeric.has(token))
        issues.push(`Turn ${index}: ungrounded number ${token}`);
    }
  });
  return issues;
}
