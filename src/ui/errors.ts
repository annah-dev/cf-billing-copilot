import {
  ErrorResponseSchema,
  type ErrorCode,
  type ErrorResponse
} from "../contracts/http";
import { ApiError } from "./api";
const titles: Record<ErrorCode, string> = {
  invalid_request: "Check your request",
  unauthorized: "Approver access required",
  not_found: "Demo data no longer available",
  conflict: "This request has already changed",
  rate_limited: "Too many requests",
  cap_reached: "Demo limit reached",
  budget_exhausted: "Today's AI budget is used up",
  internal: "Something went wrong"
};
export function errorResponse(error: unknown): ErrorResponse | null {
  if (error instanceof ApiError) return error.response;
  const direct = ErrorResponseSchema.safeParse(error);
  if (direct.success) return direct.data;
  if (error instanceof Error) {
    try {
      const parsed = ErrorResponseSchema.safeParse(JSON.parse(error.message));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
  return null;
}
export function describeError(error: unknown) {
  const response = errorResponse(error);
  if (!response)
    return {
      title: "Unable to connect",
      message: "The request could not be completed. Try again.",
      detail: null,
      code: null
    };
  const { code, message, cap } = response.error;
  return {
    title: titles[code],
    message,
    code,
    detail: cap
      ? `${cap.name}: ${cap.limit}. Resets ${new Date(cap.resetsAt).toUTCString()}.`
      : code === "rate_limited"
        ? "The per-IP limit is 60 requests per 60 seconds. Try again after this window."
        : code === "not_found"
          ? "Use Reset demo to create a fresh sandbox."
          : code === "unauthorized"
            ? "Open Approver view from your demo's invoice panel."
            : null
  };
}
