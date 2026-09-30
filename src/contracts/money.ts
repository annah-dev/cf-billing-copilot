import { z } from "zod";

/**
 * All money is integer minor units (US cents). No floats anywhere on a money path.
 * Every amount that can reach the model or the UI travels as Money: the integer
 * plus a display string produced by formatUsd, so neither the model nor the UI
 * ever converts or rounds an amount itself (DECISIONS.md D-15).
 */
export const CentsSchema = z.number().int().refine(Number.isSafeInteger, {
  message: "cents must be a safe integer"
});
export type Cents = z.infer<typeof CentsSchema>;

export const MoneySchema = z
  .object({
    cents: CentsSchema,
    display: z.string()
  })
  .refine((m) => m.display === formatUsd(m.cents), {
    message: "display must equal formatUsd(cents)"
  });
export type Money = z.infer<typeof MoneySchema>;

export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`formatUsd expects integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  // Manual grouping keeps the output identical in Node and workerd regardless of ICU data.
  const dollars = String(Math.trunc(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ","
  );
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}

export function money(cents: number): Money {
  return { cents, display: formatUsd(cents) };
}

/**
 * A ratio computed by the engine, carried as integer basis points (1% = 100 bps)
 * with its display string, for the same reason as Money.
 */
export const PercentSchema = z.object({
  basisPoints: z.number().int(),
  display: z.string()
});
export type Percent = z.infer<typeof PercentSchema>;

/** A multiplier (for example a usage spike of 5.2x), as integer hundredths plus display. */
export const MultipleSchema = z.object({
  hundredths: z.number().int().nonnegative(),
  display: z.string()
});
export type Multiple = z.infer<typeof MultipleSchema>;
