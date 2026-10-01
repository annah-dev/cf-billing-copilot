// Runtime grounding guard. Before a reply is sent, every money amount, percentage, count and other
// number in it must appear in that turn's tool results; dates and billing periods may also come
// from the customer's own message. This is the eval grader's rule (owner decision, evals lane),
// applied to the product so a wrong figure is caught before the customer sees it, not after.
//
// Tokenising mirrors the grader (evals/grounding.ts): the same money, number, count and named-date
// patterns, number words normalised to digits, counts checked against array lengths, Money checked
// against its display string. It is a separate copy because src/ must not import evals/; a test
// runs both over the recorded answers so they cannot drift apart unnoticed.
import { MoneySchema } from "../contracts";

// Noncanonical currency is recognised too: it must fail rather than disappear from the check.
const moneyPattern =
  /(?:[-+]?[$€£¥]\s*[-+]?[\d,]+(?:\.\d+)?|\bUSD\s*[-+]?[\d,]+(?:\.\d+)?|[-+]?[\d,]+(?:\.\d+)?\s*(?:USD|dollars?|cents?)\b)/gi;
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
const scaleWords = ["hundred", "thousand", "million", "billion"];
const wordAlternatives = [...smallNumbers, ...tens, ...scaleWords].join("|");
const numberWords = new RegExp(
  `\\b(?:${wordAlternatives})(?:[ -]+(?:and[ -]+)?(?:${wordAlternatives}))*\\b`,
  "gi"
);
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

function wordValue(text: string): string {
  let total = 0;
  let segment = 0;
  for (const word of text.toLowerCase().split(/[ -]+/)) {
    if (word === "and") continue;
    if (word === "hundred") segment = (segment || 1) * 100;
    else if (word === "thousand" || word === "million" || word === "billion") {
      const scale = {
        thousand: 1000,
        million: 1_000_000,
        billion: 1_000_000_000
      };
      total += (segment || 1) * scale[word];
      segment = 0;
    } else {
      const small = smallNumbers.indexOf(word);
      segment += small >= 0 ? small : (tens.indexOf(word) + 2) * 10;
    }
  }
  return String(total + segment);
}

function normalizeNumberWords(text: string): string {
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

const COUNTED_ARRAYS: Record<string, string> = {
  lines: "lines",
  simulatedLines: "lines",
  invoices: "invoices",
  tiers: "tiers",
  anomalies: "anomalies",
  requests: "credit requests",
  openCreditRequests: "credit requests",
  byMeter: "meters"
};

function countEvidence(value: unknown, counts: Counts): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => countEvidence(item, counts));
    return;
  }
  if ("lines" in value && "period" in value && "total" in value) {
    addCount(counts, "invoices", 1);
  }
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) && COUNTED_ARRAYS[key]) {
      addCount(counts, COUNTED_ARRAYS[key], child.length);
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

/**
 * Rewrite named calendar dates as ISO so the whole date, not its parts, must be grounded. A
 * yearless day takes its year only from a single grounded period for that month; otherwise it is
 * reported as unresolved.
 */
function normalizeDates(
  text: string,
  periods: Set<string>
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  let result = text;
  for (const [pattern, parts] of namedDates) {
    result = result.replace(pattern, (...match: string[]) => {
      const [year, monthPart, dayPart] = parts(match);
      if (year) {
        return ` ${[year, monthPart, dayPart].filter(Boolean).join("-")} `;
      }
      const years = new Set(
        [...periods]
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

/** Numeric tokens that name a calendar date, a billing period or a year. */
const isDateToken = (token: string) =>
  /^\d{4}-\d{2}(?:-\d{2})?$/.test(token) || /^(?:19|20)\d{2}$/.test(token);

function addNumericToken(numeric: Set<string>, token: string): void {
  numeric.add(token);
  if (/^\d{4}-\d{2}/.test(token)) {
    numeric.add(token.slice(0, 4));
    numeric.add(token.slice(0, 7));
  }
}

function collect(
  value: unknown,
  amounts: Set<string>,
  numeric: Set<string>
): void {
  if (typeof value === "string") {
    moneyStrings(value).forEach((amount) => amounts.add(amount));
    numbers(stripMoney(value)).forEach((token) =>
      addNumericToken(numeric, token)
    );
  } else if (typeof value === "number") {
    numeric.add(String(value));
  } else if (Array.isArray(value)) {
    numeric.add(String(value.length));
    // Ordered entries ground ordinal references ("the 2nd line") and numbered lists.
    value.forEach((_, index) => numeric.add(String(index + 1)));
    value.forEach((item) => collect(item, amounts, numeric));
  } else if (value && typeof value === "object") {
    const money = MoneySchema.safeParse(value);
    if (money.success) {
      amounts.add(money.data.display);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      // Raw basis points and hundredths are machine fields; only their display strings ground.
      if (key !== "basisPoints" && key !== "hundredths") {
        collect(child, amounts, numeric);
      }
    }
  }
}

/** What a turn's reply may cite. */
export type Evidence = {
  amounts: Set<string>;
  numeric: Set<string>;
  counts: Counts;
  /** Dates, periods and years named in the customer's message (they may be echoed back). */
  customerDates: Set<string>;
};

/** Evidence from the turn's successful tool outputs and the customer's message. */
export function collectEvidence(
  toolOutputs: readonly unknown[],
  customerMessage: string
): Evidence {
  const amounts = new Set<string>();
  const numeric = new Set<string>();
  const counts: Counts = new Map();
  for (const output of toolOutputs) {
    collect(output, amounts, numeric);
    countEvidence(output, counts);
  }
  const customerDates = new Set<string>();
  const dated = normalizeDates(customerMessage, numeric);
  for (const token of numbers(stripMoney(dated.text))) {
    if (isDateToken(token)) addNumericToken(customerDates, token);
  }
  return { amounts, numeric, counts, customerDates };
}

/**
 * The figures in `text` that the evidence does not support, in order of appearance, without
 * duplicates. Empty means the reply is grounded.
 */
export function unsupportedFigures(text: string, evidence: Evidence): string[] {
  const found: string[] = [];
  const add = (figure: string) => {
    if (!found.includes(figure)) found.push(figure);
  };
  const periods = new Set([...evidence.numeric, ...evidence.customerDates]);
  const dated = normalizeDates(text, periods);
  const normalized = normalizeNumberWords(dated.text);
  for (const amount of new Set([
    ...moneyStrings(text),
    ...moneyStrings(normalized)
  ])) {
    if (!evidence.amounts.has(amount)) add(amount.trim());
  }
  for (const date of dated.unresolved) add(date);
  for (const match of normalized.matchAll(countPattern)) {
    const name = countName(match[2]);
    if (
      match[2].toLowerCase() === "invoice" &&
      /^\d{4}$/.test(match[1]) &&
      periods.has(match[1])
    ) {
      continue; // "2026 invoice" names a year, not a count
    }
    if (!evidence.counts.get(name)?.has(match[1])) add(`${match[1]} ${name}`);
  }
  for (const token of numbers(stripMoney(normalized))) {
    if (evidence.numeric.has(token)) continue;
    if (isDateToken(token) && evidence.customerDates.has(token)) continue;
    add(token);
  }
  return found;
}

/**
 * The reply with every sentence that carries an unsupported figure removed. Sentences are split at
 * line breaks and at sentence-ending punctuation followed by whitespace, so "$412.87" stays whole.
 */
export function withoutUnsupported(text: string, evidence: Evidence): string {
  return text
    .split(/\n/)
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter(
          (sentence) => unsupportedFigures(sentence, evidence).length === 0
        )
        .join(" ")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
