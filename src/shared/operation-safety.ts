import { z } from "zod";
import type { JobProgress, Profile, TransferInput } from "./contracts";

export const operationReceiptSchema = z.strictObject({
  id: z.string().min(1).max(128),
  occurredAt: z.string().datetime(),
  connectionName: z.string().max(255),
  environment: z.enum(["development", "staging", "production"]),
  namespace: z.string().max(512),
  action: z.string().min(1).max(64),
  mode: z.string().max(64),
  scope: z.enum(["collection", "database", "file"]),
  status: z.enum(["completed", "failed", "cancelled", "unknown"]),
  processed: z.number().int().min(0).optional(),
  failed: z.number().int().min(0).optional(),
  bytes: z.number().int().min(0).optional(),
  outputFile: z.string().max(255).optional(),
  reversible: z.literal(false),
  errorCode: z.string().max(64).optional(),
});
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;
export type ReceiptContext = Pick<
  OperationReceipt,
  "connectionName" | "environment" | "namespace" | "action" | "mode" | "scope"
>;
export function receiptFromCommand(
  context: ReceiptContext,
  id: string,
  status: "completed" | "unknown",
  processed?: number,
): OperationReceipt {
  return operationReceiptSchema.parse({
    id,
    occurredAt: new Date().toISOString(),
    ...context,
    status,
    ...(status === "completed" && processed !== undefined ? { processed } : {}),
    reversible: false,
    ...(status === "unknown" ? { errorCode: "UNKNOWN" } : {}),
  });
}
export function requiredTransferConfirmation(
  input: Pick<
    TransferInput,
    "direction" | "database" | "collection" | "mode" | "drop"
  >,
  environment: Profile["environment"],
): string | undefined {
  if (input.direction !== "import") return undefined;
  if (
    input.mode !== "replace" &&
    !input.drop &&
    input.collection &&
    environment !== "production"
  )
    return undefined;
  return input.collection
    ? `${input.database}.${input.collection}`
    : input.database;
}
type JobOutcome = Omit<JobProgress, "status"> & {
  status: JobProgress["status"] | "unknown";
};

export function receiptFromJob(
  context: ReceiptContext,
  outcome: JobOutcome,
): OperationReceipt {
  if (outcome.status === "running")
    throw new Error("Cannot record a running job as a final receipt");
  const countsKnown = outcome.status !== "unknown";
  return operationReceiptSchema.parse({
    id: outcome.jobId,
    occurredAt: new Date().toISOString(),
    ...context,
    status: outcome.status,
    ...(countsKnown
      ? {
          processed: outcome.processed,
          failed: outcome.failed,
          bytes: outcome.bytes,
        }
      : {}),
    ...(outcome.path
      ? {
          outputFile:
            outcome.path.replaceAll("\\", "/").split("/").at(-1) || "",
        }
      : {}),
    reversible: false,
    ...(outcome.status !== "completed"
      ? { errorCode: outcome.status.toUpperCase() }
      : {}),
  });
}
