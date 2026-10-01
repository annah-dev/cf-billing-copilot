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

// Copied from evals/grounding.ts after #10: ordinal words ("first", "twenty-first") are labels,
// not figures; numeral ordinals ("1st") still go through the numeric matcher.
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
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
    "twentieth",
    "thirtieth",
    "fortieth",
    "fiftieth",
    "sixtieth",
    "seventieth",
    "eightieth",
    "ninetieth",
    "hundredth",
    "thousandth",
    "millionth",
    "billionth"
  ];
  const cardinal = [
    ...smallNumbers,
    ...tens,
    "hundred",
    "thousand",
    "million",
    "billion"
  ].join("|");
  // Ordinal words (including compound phrases) are labels, not figures. Numeral ordinals
  // still go through the numeric matcher; cardinal words still normalize to figures.
  const ordinalWords = new RegExp(
    `\\b((?:(?:${cardinal})(?:[ -]+(?:and[ -]+)?(?:${cardinal}))*[ -]+(?:and[ -]+)?)?)(${ordinals.join("|")})\\b(?=(-[a-z]|[ ]+(?:time|hand)\\b)?)`,
    "gi"
  );
  return text
    .replace(
      ordinalWords,
      (_, prefix: string, ordinal: string, label: string | undefined) => {
        // Preserve a cardinal before an independent ordinal word, such as "one second",
        // or before a spaced ordinal label, such as "forty first-time".
        const compound =
          !(label && /\s$/.test(prefix)) &&
          (/\b(hundred|thousand|million|billion)\b/i.test(prefix) ||
            tens.some((word) => prefix.toLowerCase().startsWith(word)) ||
            /^(hundredth|thousandth|millionth|billionth)$/i.test(ordinal));
        return !prefix || compound ? " " : prefix;
      }
    )
    .replace(numberWords, (words) => wordValue(words))
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

const dateToken = /^\d{4}-\d{2}(?:-\d{2})?$/;

/**
 * Rewrite named calendar dates as ISO so the whole date, not its parts, must be grounded. A
 * yearless day takes its year only from a single grounded period for that month; otherwise it is
 * reported as unresolved (`--MM-DD`, tab, the original words), and only the same yearless date in
 * the customer's message grounds it.
 */
function normalizeDates(
  text: string,
  dates: Set<string>
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
        [...dates]
          .filter(
            (token) =>
              dateToken.test(token) && token.slice(4, 7) === `-${monthPart}`
          )
          .map((token) => token.slice(0, 4))
      );
      if (years.size === 1) return ` ${[...years][0]}-${monthPart}-${dayPart} `;
      unresolved.push(`--${monthPart}-${dayPart}\t${match[0]}`);
      return " ";
    });
  }
  return { text: result, unresolved };
}

const dateLike = (token: string) =>
  dateToken.test(token) || /^\d{4}$/.test(token);

function addDate(dates: Set<string>, token: string, year = true): void {
  dates.add(token);
  dates.add(token.slice(0, 7));
  if (year) dates.add(token.slice(0, 4));
}

/**
 * Dates and billing periods the customer wrote ground only date-shaped tokens of the reply, never
 * money, percentages, counts, bare years or bare day numbers.
 */
function messageDates(message: string, dates: Set<string>): void {
  for (let pass = 0; pass < 2; pass++) {
    const normalized = normalizeDates(message, dates);
    numbers(normalized.text)
      .filter((token) => dateToken.test(token))
      .forEach((token) => addDate(dates, token, false));
    if (pass === 1) {
      normalized.unresolved.forEach((entry) => dates.add(entry.split("\t")[0]));
    }
  }
}

function collect(
  value: unknown,
  amounts: Set<string>,
  numeric: Set<string>,
  dates: Set<string>
): void {
  if (typeof value === "string") {
    moneyStrings(value).forEach((amount) => amounts.add(amount));
    numbers(stripMoney(value)).forEach((token) => {
      if (/^\d{4}-\d{2}/.test(token)) addDate(dates, token);
      else numeric.add(token);
    });
  } else if (typeof value === "number") {
    numeric.add(String(value));
  } else if (Array.isArray(value)) {
    numeric.add(String(value.length));
    // Ordered entries ground ordinal references ("the 2nd line") and numbered lists.
    value.forEach((_, index) => numeric.add(String(index + 1)));
    value.forEach((item) => collect(item, amounts, numeric, dates));
  } else if (value && typeof value === "object") {
    const money = MoneySchema.safeParse(value);
    if (money.success) {
      amounts.add(money.data.display);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      // Raw basis points and hundredths are machine fields; only their display strings ground.
      if (key !== "basisPoints" && key !== "hundredths") {
        collect(child, amounts, numeric, dates);
      }
    }
  }
}

/** What a turn's reply may cite. */
export type Evidence = {
  amounts: Set<string>;
  numeric: Set<string>;
  /** Dates and periods from the tool outputs and the customer's message. */
  dates: Set<string>;
  counts: Counts;
};

/** Evidence from the turn's successful tool outputs and the customer's message. */
export function collectEvidence(
  toolOutputs: readonly unknown[],
  customerMessage: string
): Evidence {
  const amounts = new Set<string>();
  const numeric = new Set<string>();
  const dates = new Set<string>();
  const counts: Counts = new Map();
  for (const output of toolOutputs) {
    collect(output, amounts, numeric, dates);
    countEvidence(output, counts);
  }
  messageDates(customerMessage, dates);
  return { amounts, numeric, dates, counts };
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
  const dated = normalizeDates(text, evidence.dates);
  const normalized = normalizeNumberWords(dated.text);
  for (const amount of new Set([
    ...moneyStrings(text),
    ...moneyStrings(normalized)
  ])) {
    if (!evidence.amounts.has(amount)) add(amount);
  }
  for (const entry of dated.unresolved) {
    const [echo, date] = entry.split("\t");
    if (!evidence.dates.has(echo)) add(date);
  }
  for (const match of normalized.matchAll(countPattern)) {
    const name = countName(match[2]);
    if (
      match[2].toLowerCase() === "invoice" &&
      /^\d{4}$/.test(match[1]) &&
      evidence.dates.has(match[1])
    ) {
      continue; // "2026 invoice" names a year, not a count
    }
    if (!evidence.counts.get(name)?.has(match[1])) add(`${match[1]} ${name}`);
  }
  for (const token of numbers(stripMoney(normalized))) {
    if (evidence.numeric.has(token)) continue;
    if (dateLike(token) && evidence.dates.has(token)) continue;
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
