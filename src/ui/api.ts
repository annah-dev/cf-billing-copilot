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
export const SESSION_KEY = "billing-copilot.session.v2.fixture";
export type SessionMode = "fixture" | "live";
/**
 * Which backend the UI talks to. A production build defaults to the live API; the dev server
 * defaults to the fixture preview, which makes no model calls. VITE_BILLING_API_MODE set to
 * "live" or "fixture" overrides either default.
 */
export function apiMode(env: {
  VITE_BILLING_API_MODE?: string;
  DEV?: boolean;
}): SessionMode {
  const mode = env.VITE_BILLING_API_MODE;
  if (mode === "live" || mode === "fixture") return mode;
  return env.DEV ? "fixture" : "live";
}
/**
 * True while a decided credit request is still being finished by the Workflow: approved but not
 * yet applied, or a decision recorded while the status still reads pending_approval.
 */
export function awaitingWorkflow(request: {
  status: string;
  decision: unknown;
}): boolean {
  return (
    request.status === "approved" ||
    (request.status === "pending_approval" && request.decision != null)
  );
}
/**
 * Runs async tasks one at a time in call order: a task starts only after the previous one has
 * settled, whether it resolved or failed.
 */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
type DecisionList = {
  requests: { id: string; status: string; decision: unknown }[];
};
/**
 * After a decision, read the list once, then again every `delayMs` (at most `attempts` more
 * reads) while the Workflow has not finished `requestId`. Stops at a terminal state, at a failed
 * read (`read` returns null) or when `active()` turns false, which is checked again after every
 * delay. Returns the number of reads made.
 */
export async function followUpDecision({
  requestId,
  read,
  sleep,
  active,
  attempts,
  delayMs
}: {
  requestId: string;
  read: () => Promise<DecisionList | null | undefined>;
  sleep: (ms: number) => Promise<void>;
  active: () => boolean;
  attempts: number;
  delayMs: number;
}): Promise<number> {
  const unfinished = (list: DecisionList | null | undefined) =>
    list?.requests.some((r) => r.id === requestId && awaitingWorkflow(r)) ??
    false;
  if (!active()) return 0;
  let latest = await read();
  let reads = 1;
  for (let i = 0; i < attempts && unfinished(latest); i++) {
    await sleep(delayMs);
    if (!active()) break;
    latest = await read();
    reads++;
  }
  return reads;
}
const sessionKey = (mode: SessionMode) =>
  mode === "fixture" ? SESSION_KEY : "billing-copilot.session.v1.live";
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
