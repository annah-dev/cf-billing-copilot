import { EngineError, type Percent, type Multiple } from "../contracts";

export function integer(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new EngineError("invalid_input", "Expected a safe integer");
  }
  return BigInt(value);
}

export function safe(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new EngineError("invalid_input", "Result exceeds safe integer range");
  }
  return result;
}

// Exact rational arithmetic; the only rounding rule is half away from zero.
export type Fraction = { numerator: bigint; denominator: bigint };
export function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (denominator <= 0n)
    throw new EngineError("invalid_input", "Invalid denominator");
  return { numerator, denominator };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function add(a: Fraction, b: Fraction): Fraction {
  const common = gcd(a.denominator, b.denominator);
  const numerator =
    a.numerator * (b.denominator / common) +
    b.numerator * (a.denominator / common);
  const denominator = a.denominator * (b.denominator / common);
  const divisor = gcd(numerator, denominator);
  return fraction(numerator / divisor, denominator / divisor);
}

export function rounded(value: Fraction): number {
  const sign = value.numerator < 0n ? -1n : 1n;
  const absolute = value.numerator * sign;
  return safe(
    sign * ((2n * absolute + value.denominator) / (2n * value.denominator))
  );
}

export function sum(values: readonly number[]): number {
  return safe(values.reduce((total, value) => total + integer(value), 0n));
}

export function difference(a: number, b: number): number {
  return safe(integer(a) - integer(b));
}

// Percent carries bps; display rounds those bps to the nearest whole percent.
export function percent(delta: number, baseline: number): Percent | null {
  if (baseline === 0) return null;
  const basisPoints = rounded(
    fraction(integer(delta) * 10_000n, integer(Math.abs(baseline)))
  );
  return {
    basisPoints,
    display: `${rounded(fraction(integer(basisPoints), 100n))}%`
  };
}

// Multiples carry hundredths; display drops trailing fractional zeros.
export function multiple(quantity: number, baseline: number): Multiple {
  const hundredths = rounded(
    fraction(integer(quantity) * 100n, integer(baseline))
  );
  const digits = String(hundredths % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return {
    hundredths,
    display: `${Math.trunc(hundredths / 100)}${digits ? `.${digits}` : ""}x`
  };
}

// Compact deterministic FNV-1a identifiers keep even long customer slugs in contract bounds.
export function identifier(prefix: string, key: string): string {
  let hash = 14_695_981_039_346_656_037n;
  for (let i = 0; i < key.length; i++) {
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(key.charCodeAt(i))) * 1_099_511_628_211n
    );
  }
  return `${prefix}_${hash.toString(16)}`;
}
