import { z } from "zod";
import {
  ROUTES,
  CreateSandboxResponseSchema,
  PanelResponseSchema,
  AdminCreditRequestsResponseSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  ErrorResponseSchema,
  type CreateSandboxResponse,
  type DecisionRequest
} from "../contracts/http";
import {
  CustomerIdSchema,
  SandboxIdSchema,
  CreditRequestIdSchema
} from "../contracts/ids";

export type Transport = (path: string, init?: RequestInit) => Promise<Response>;
export class ApiError extends Error {
  constructor(public readonly response: z.infer<typeof ErrorResponseSchema>) {
    super(response.error.message);
    this.name = "ApiError";
  }
}
export function createApi(transport: Transport) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit
  ): Promise<T> {
    const response = await transport(path, init);
    const body: unknown = await response.json();
    if (!response.ok) throw new ApiError(ErrorResponseSchema.parse(body));
    return schema.parse(body);
  }
  const sid = (value: string) => SandboxIdSchema.parse(value);
  return {
    createSandbox: () =>
      request(ROUTES.sandboxes, CreateSandboxResponseSchema, {
        method: "POST"
      }),
    async panel(sandboxId: string, customerId: string, signal?: AbortSignal) {
      const panel = await request(
        ROUTES.panel(sid(sandboxId), CustomerIdSchema.parse(customerId)),
        PanelResponseSchema,
        { signal }
      );
      if (panel.sandboxId !== sandboxId || panel.customerId !== customerId)
        throw new Error(
          "The panel belongs to another account. Refresh and try again."
        );
      return panel;
    },
    async creditRequests(
      sandboxId: string,
      token: string,
      signal?: AbortSignal
    ) {
      const result = await request(
        ROUTES.adminCreditRequests(sid(sandboxId)),
        AdminCreditRequestsResponseSchema,
        { headers: { Authorization: `Bearer ${token}` }, signal }
      );
      if (result.sandboxId !== sandboxId)
        throw new Error("The approval list belongs to another sandbox.");
      return result;
    },
    async decide(
      sandboxId: string,
      token: string,
      requestId: string,
      decision: DecisionRequest
    ) {
      const result = await request(
        ROUTES.decision(sid(sandboxId), CreditRequestIdSchema.parse(requestId)),
        DecisionResponseSchema,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(DecisionRequestSchema.parse(decision))
        }
      );
      if (result.request.id !== requestId)
        throw new Error("The decision response belongs to another request.");
      return result;
    }
  };
}
export type BillingApi = ReturnType<typeof createApi>;
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const SESSION_KEY = "billing-copilot.session.v1.fixture";
export type SessionMode = "fixture" | "live";
const sessionKey = (mode: SessionMode) => `billing-copilot.session.v1.${mode}`;
export function readSession(
  storage: StoragePort | null,
  mode: SessionMode = "fixture"
): CreateSandboxResponse | null {
  try {
    const raw = storage?.getItem(sessionKey(mode));
    return raw ? CreateSandboxResponseSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function saveSession(
  storage: StoragePort | null,
  session: CreateSandboxResponse,
  mode: SessionMode = "fixture"
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(
      sessionKey(mode),
      JSON.stringify(CreateSandboxResponseSchema.parse(session))
    );
    return true;
  } catch {
    return false;
  }
}
export function browserStorage(): StoragePort | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
export function adminLink(session: CreateSandboxResponse): string {
  return `/admin#${new URLSearchParams({ sandbox: session.sandboxId, token: session.approverToken })}`;
}
export function parseAdminFragment(
  hash: string
): { sandboxId: string; token: string } | null {
  if (!hash || hash === "#") return null;
  const params = new URLSearchParams(hash.slice(1));
  return {
    sandboxId: SandboxIdSchema.parse(params.get("sandbox")),
    token: CreateSandboxResponseSchema.shape.approverToken.parse(
      params.get("token")
    )
  };
}
