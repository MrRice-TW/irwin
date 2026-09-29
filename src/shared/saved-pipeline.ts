import { z } from "zod";

export const savedPipelineSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  group: z.string().trim().max(160).default(""),
  description: z.string().max(2000).default(""),
  source: z
    .object({
      connectionName: z.string().max(255),
      database: z.string().max(255),
      collection: z.string().max(255),
    })
    .optional(),
  stages: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        enabled: z.boolean(),
        text: z.string().max(1024 * 1024),
      }),
    )
    .max(50),
  updatedAt: z.string().datetime(),
});
export type SavedPipeline = z.infer<typeof savedPipelineSchema>;
