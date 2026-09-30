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
      ToolSchemas[call.name].input.parse(call.input);
      if (call.error !== null || call.output === null) {
        throw new Error(
          `Failed tool ${call.name}: ${call.error ?? "missing output"}`
        );
      }
      ToolSchemas[call.name].output.parse(call.output);
    }
  }
  return recording;
}
