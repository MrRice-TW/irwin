import { z } from "zod";

// Store input text verbatim to preserve BSON literals and numeric precision.
// Targets are descriptive metadata; applying a query always uses the active tab.
export const savedQuerySchema = z.object({
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
  query: z.object({
    mode: z.enum(["find", "shell"]),
    filter: z.string().max(1000000),
    sort: z.string().max(100000),
    projection: z.string().max(100000),
    batchSize: z.number().int().min(1).max(1000),
    code: z.string().max(1000000),
  }),
});
export type SavedQuery = z.infer<typeof savedQuerySchema>;
