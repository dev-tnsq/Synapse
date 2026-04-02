import { z } from "zod";

export const invokeOperationBodySchema = z.object({
  idempotencyKey: z.string().min(1),
  query: z.record(z.string(), z.string()).default({}),
  body: z.json().optional(),
  headers: z.record(z.string(), z.string()).default({}),
});

export type InvokeOperationBody = z.infer<typeof invokeOperationBodySchema>;
