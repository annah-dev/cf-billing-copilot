// STUB from the Stop 2 foundation. Owned by the engine lane, which replaces every
// function below with the real implementation (prompt-history/prompts/02-engine.md).
import { EngineError, type BillingEngine } from "../contracts";

const notImplemented = (name: string): never => {
  throw new EngineError("unsupported", `engine.${name} is not implemented yet (engine lane)`);
};

export const engine: BillingEngine = {
  seed: () => notImplemented("seed"),
  buildInvoice: () => notImplemented("buildInvoice"),
  explainLineItem: () => notImplemented("explainLineItem"),
  compareInvoices: () => notImplemented("compareInvoices"),
  simulatePlan: () => notImplemented("simulatePlan"),
  detectAnomalies: () => notImplemented("detectAnomalies"),
  validateCreditClaim: () => notImplemented("validateCreditClaim"),
  balance: () => notImplemented("balance")
};
