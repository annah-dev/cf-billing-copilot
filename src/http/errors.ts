import type { ErrorCode, ErrorResponse } from "../contracts";

/** A refusal returned across RPC by the Ledger, Quota or agent (no exceptions for expected cases). */
export type Refusal = {
  ok: false;
  status: 400 | 401 | 404 | 409 | 429 | 500;
  code: ErrorCode;
  message: string;
  cap?: { name: string; limit: number; resetsAt: string };
};

export type Result<T> = ({ ok: true } & T) | Refusal;

export function refusal(
  status: Refusal["status"],
  code: ErrorCode,
  message: string,
  cap?: Refusal["cap"]
): Refusal {
  return cap
    ? { ok: false, status, code, message, cap }
    : { ok: false, status, code, message };
}

export function errorResponse(r: Refusal): Response {
  const body: ErrorResponse = {
    error: r.cap
      ? { code: r.code, message: r.message, cap: r.cap }
      : { code: r.code, message: r.message }
  };
  return Response.json(body, { status: r.status });
}

export function notFound(): Response {
  return errorResponse(refusal(404, "not_found", "Not found"));
}

/** Fixed text for a daily cap: names the cap and the 00:00 UTC reset (D-7). */
export function capMessage(what: string, limit: number): string {
  return `This demo has reached its daily limit of ${limit} ${what}. The limit resets at 00:00 UTC.`;
}

export const BUDGET_MESSAGE =
  "The demo has used its AI budget for today, so I cannot answer right now. The budget resets at 00:00 UTC. The side panel still shows your invoice, credit requests and audit trail.";
