// Worker entry: exports every bound class and delegates HTTP to src/http/router.ts
// (docs/ARCHITECTURE.md, "HTTP surface"). Static assets are served before the Worker runs,
// except for /agents/* and /api/* (wrangler.jsonc, run_worker_first).
import { handleRequest } from "./http/router";

export { BillingAgent } from "./agent/billing-agent";
export { Ledger } from "./ledger/ledger";
export { Quota } from "./quota/quota";
export { CreditRequestWorkflow } from "./workflows/credit-request";

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("unhandled error", err);
      return Response.json(
        { error: { code: "internal", message: "Internal error" } },
        { status: 500 }
      );
    }
  }
} satisfies ExportedHandler<Env>;
