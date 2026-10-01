import { z } from "zod";
import {
  CustomerIdSchema,
  IsoDateTimeSchema,
  TurnRequestSchema,
  TurnResponseSchema,
  ToolSchemas
} from "../src/contracts";

const RecordingBase = z.object({
  formatVersion: z.literal(1),
  seedVersion: z.string().min(1),
  caseId: z.string().regex(/^[a-z0-9-]+$/),
  turns: z
    .array(
      z.object({
        customerId: CustomerIdSchema,
        request: TurnRequestSchema,
        response: TurnResponseSchema
      })
    )
    .min(1)
});
export const RecordingSchema = z.discriminatedUnion("source", [
  RecordingBase.extend({
    source: z.literal("synthetic-engine"),
    recordedAt: z.null()
  }),
  RecordingBase.extend({
    source: z.literal("live"),
    recordedAt: IsoDateTimeSchema,
    baseUrl: z.url().optional(),
    environment: z.enum(["local dev", "deployed"]).optional()
  })
]);
export type Recording = z.infer<typeof RecordingSchema>;

export function parseRecording(value: unknown): Recording {
  const recording = RecordingSchema.parse(value);
  for (const turn of recording.turns) {
    for (const call of turn.response.toolCalls) {
      const input = ToolSchemas[call.name].input.safeParse(call.input);
      if (call.error !== null) {
        if (call.output !== null)
          throw new Error(`Failed tool ${call.name} must have null output`);
        // Rejected calls are valid HTTP records, including schema-invalid inputs.
        // They provide no numeric evidence; a later successful call may recover.
        continue;
      }
      if (!input.success) throw input.error;
      if (call.output === null)
        throw new Error(`Missing output for ${call.name}`);
      ToolSchemas[call.name].output.parse(call.output);
    }
  }
  return recording;
}
