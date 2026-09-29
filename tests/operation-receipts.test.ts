import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { Storage } from "../src/main/storage";
import {
  receiptFromCommand,
  receiptFromJob,
} from "../src/shared/operation-safety";

let directory: string;
let storage: Storage;
beforeEach(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "receipt-test-"));
  storage = new Storage(join(directory, "test.sqlite"));
});
afterEach(async () => {
  storage.close();
  await rm(directory, { recursive: true, force: true });
});

test("receipt keeps counts and basename without secrets or document content", () => {
  const receipt = receiptFromJob(
    {
      connectionName: "Production orders",
      environment: "production",
      namespace: "app.orders",
      action: "import",
      mode: "replace",
      scope: "collection",
    },
    {
      jobId: "j1",
      status: "failed",
      processed: 4,
      failed: 2,
      bytes: 120,
      path: "C:\\private\\exports\\orders.jsonl",
      message:
        "mongodb://user:secret@host/app password=secret document={sensitive:true}",
    },
  );
  expect(receipt).toMatchObject({
    id: "j1",
    status: "failed",
    processed: 4,
    failed: 2,
    bytes: 120,
    outputFile: "orders.jsonl",
    reversible: false,
    errorCode: "FAILED",
  });
  const serialized = JSON.stringify(receipt);
  for (const secret of ["secret", "private", "sensitive", "mongodb://"])
    expect(serialized).not.toContain(secret);
});

test("receipt migration persists results and keeps the newest 500", () => {
  for (let n = 0; n < 510; n++)
    storage.saveReceipt({
      id: `job-${n}`,
      occurredAt: new Date(Date.now() + n * 1000).toISOString(),
      connectionName: "Local",
      environment: "development",
      namespace: "app.items",
      action: "import",
      mode: "insert",
      scope: "collection",
      status: "completed",
      processed: n,
      failed: 0,
      bytes: n,
      reversible: false,
    });
  expect(storage.receipts()).toHaveLength(500);
  expect(storage.receipts()[0].id).toBe("job-509");
  storage.close();
  storage = new Storage(join(directory, "test.sqlite"));
  expect(storage.receipts()).toHaveLength(500);
  storage.clearReceipts();
  expect(storage.receipts()).toEqual([]);
});

test("unknown outcome does not invent processed counts", () => {
  const receipt = receiptFromJob(
    {
      connectionName: "Production orders",
      environment: "production",
      namespace: "app.orders",
      action: "restore",
      mode: "drop",
      scope: "collection",
    },
    {
      jobId: "j2",
      status: "unknown",
      processed: 0,
      failed: 0,
      bytes: 0,
      message: "worker exited",
    },
  );
  expect(receipt.status).toBe("unknown");
  expect(receipt.processed).toBeUndefined();
  expect(receipt.failed).toBeUndefined();
});

test("GUI write receipt records outcome without command payload", () => {
  const context = {
    connectionName: "Production orders",
    environment: "production" as const,
    namespace: "app.orders",
    action: "documents.delete",
    mode: "single",
    scope: "collection" as const,
  };
  const completed = receiptFromCommand(context, "write-1", "completed", 1);
  expect(completed).toMatchObject({
    id: "write-1",
    status: "completed",
    processed: 1,
    reversible: false,
  });
  const unknown = receiptFromCommand(context, "write-2", "unknown");
  expect(unknown).toMatchObject({ status: "unknown", errorCode: "UNKNOWN" });
  expect(unknown.processed).toBeUndefined();
  expect(JSON.stringify(unknown)).not.toContain("original");
});
