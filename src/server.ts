// Worker entry. The Stop 2 foundation ships a minimal router; the agent lane owns
// this file and builds the full HTTP surface (docs/ARCHITECTURE.md, "HTTP surface").
import { routeAgentRequest } from "agents";
import { MODEL_ID, type ErrorResponse } from "./contracts";

export { BillingAgent } from "./agent/billing-agent";
export { Ledger } from "./ledger/ledger";
export { Quota } from "./quota/quota";
export { CreditRequestWorkflow } from "./workflows/credit-request";

function notFound(): Response {
  const body: ErrorResponse = { error: { code: "not_found", message: "Not found" } };
  return Response.json(body, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, model: MODEL_ID });
    }
    return (await routeAgentRequest(request, env)) ?? notFound();
  }
} satisfies ExportedHandler<Env>;
