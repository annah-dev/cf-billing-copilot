import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CREDIT_TRANSITIONS,
  CreditRequestStatusSchema,
  EnvConfigSchema,
  TERMINAL_CREDIT_STATUSES,
  TOOL_NAMES,
  ToolSchemas,
  TurnRequestSchema,
  AgentInstanceNameSchema,
  agentInstanceName,
  estimateNeurons,
  PanelResponseSchema,
  AdminCreditRequestsResponseSchema,
  DecisionResponseSchema,
  TurnResponseSchema
} from "../../src/contracts";

function wranglerVars(): Record<string, string> {
  // wrangler.jsonc allows comments; strip them before JSON.parse.
  const text = readFileSync(
    new URL("../../wrangler.jsonc", import.meta.url),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text).vars;
}

describe("tool contracts", () => {
  it("exposes exactly the eight tools from the assignment", () => {
    expect(TOOL_NAMES.sort()).toEqual(
      [
        "compareInvoices",
        "detectAnomalies",
        "explainLineItem",
        "getAccount",
        "getCreditRequestStatus",
        "getInvoice",
        "simulatePlan",
        "startCreditRequest"
      ].sort()
    );
  });

  it("never lets the model pass a customer id", () => {
    for (const name of TOOL_NAMES) {
      const shape = (
        ToolSchemas[name].input as unknown as {
          shape?: Record<string, unknown>;
        }
      ).shape;
      if (shape) expect(Object.keys(shape)).not.toContain("customerId");
    }
    expect(
      ToolSchemas.getAccount.input.safeParse({ customerId: "cus_other" }).data
    ).toEqual({});
  });

  it("requires exactly one of period or invoiceId for getInvoice", () => {
    const input = ToolSchemas.getInvoice.input;
    expect(input.safeParse({ period: "2026-09" }).success).toBe(true);
    expect(input.safeParse({ invoiceId: "inv_2026_09_acme" }).success).toBe(
      true
    );
    expect(input.safeParse({}).success).toBe(false);
    expect(
      input.safeParse({ period: "2026-09", invoiceId: "inv_x" }).success
    ).toBe(false);
    expect(input.safeParse({ period: "2026-13" }).success).toBe(false);
  });
});

function propertyNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (obj.properties && typeof obj.properties === "object") {
        names.push(...Object.keys(obj.properties as object));
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(z.toJSONSchema(schema, { unrepresentable: "any", io: "output" }));
  return names;
}

describe("money never reaches the model or the UI as raw cents (D-15)", () => {
  const outputs: Array<[string, z.ZodType]> = [
    ...TOOL_NAMES.map(
      (n) => [`tool ${n}`, ToolSchemas[n].output] as [string, z.ZodType]
    ),
    ["PanelResponse", PanelResponseSchema],
    ["AdminCreditRequestsResponse", AdminCreditRequestsResponseSchema],
    ["DecisionResponse", DecisionResponseSchema],
    ["TurnResponse", TurnResponseSchema]
  ];
  it.each(outputs)("%s has no *Cents or *Bps field", (_name, schema) => {
    const offenders = propertyNames(schema).filter((k) =>
      /(Cents|Bps)$/.test(k)
    );
    expect(offenders).toEqual([]);
  });
});

describe("credit state machine", () => {
  it("has transitions for every status and none out of terminal states", () => {
    for (const status of CreditRequestStatusSchema.options) {
      expect(CREDIT_TRANSITIONS[status]).toBeDefined();
    }
    for (const terminal of TERMINAL_CREDIT_STATUSES) {
      expect(CREDIT_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("only reaches applied through approved", () => {
    const into = CreditRequestStatusSchema.options.filter((s) =>
      CREDIT_TRANSITIONS[s].includes("applied")
    );
    expect(into).toEqual(["approved"]);
  });
});

describe("config", () => {
  it("parses the wrangler vars", () => {
    const config = EnvConfigSchema.parse(wranglerVars());
    expect(config.NEURON_DAILY_STOP).toBe(50_000);
    expect(config.SANDBOXES_PER_DAY_GLOBAL).toBe(200);
  });

  it("keeps the turn message limit equal to MESSAGE_MAX_CHARS", () => {
    const max = EnvConfigSchema.parse(wranglerVars()).MESSAGE_MAX_CHARS;
    expect(
      TurnRequestSchema.safeParse({ message: "x".repeat(max) }).success
    ).toBe(true);
    expect(
      TurnRequestSchema.safeParse({ message: "x".repeat(max + 1) }).success
    ).toBe(false);
  });

  it("estimates neurons with integer math, rounding up", () => {
    // Measured in the Stop 2 round trip: 945 input and 69 output tokens.
    expect(estimateNeurons(945, 69)).toBe(40);
    expect(estimateNeurons(0, 0)).toBe(0);
  });

  it("builds and validates agent instance names", () => {
    const name = agentInstanceName("a".repeat(32), "cus_acme");
    expect(AgentInstanceNameSchema.safeParse(name).success).toBe(true);
    expect(AgentInstanceNameSchema.safeParse("default").success).toBe(false);
    expect(
      AgentInstanceNameSchema.safeParse(`${"a".repeat(32)}.cus_acme/../x`)
        .success
    ).toBe(false);
  });
});
