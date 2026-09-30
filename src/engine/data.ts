import { z } from "zod";
import {
  BillingDatasetSchema,
  EngineError,
  PeriodSchema,
  type BillingDataset,
  type Invoice
} from "../contracts";

export function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new EngineError("invalid_input", result.error.message);
  return result.data;
}

export function dataset(value: BillingDataset): BillingDataset {
  return input(BillingDatasetSchema, value);
}

export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new EngineError("not_found", `${label} not found`);
  return value;
}

export function calendarDate(date: string): void {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new EngineError("invalid_input", `Invalid calendar date: ${date}`);
  }
}

export function month(period: string) {
  input(PeriodSchema, period);
  const start = `${period}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.toISOString().slice(0, 10);
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  const dates = Array.from(
    { length: days },
    (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`
  );
  return { start, end, days, dates };
}

export function storedInvoice(
  data: BillingDataset,
  customerId: string,
  period: string
): Invoice {
  month(period);
  required(
    data.customers.find((customer) => customer.id === customerId),
    "Customer"
  );
  const invoices = data.invoices.filter(
    (invoice) => invoice.customerId === customerId && invoice.period === period
  );
  if (invoices.length > 1)
    throw new EngineError("invalid_input", "Ambiguous invoice for period");
  return required(invoices[0], "Invoice");
}
