import { expect, test } from "vitest";
import type { MongoClient } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { TransferService } from "../src/core/transfers";
import { profileSchema, transferSchema } from "../src/shared/contracts";
import { requiredTransferConfirmation } from "../src/shared/operation-safety";

const target = {
  connectionId: "p",
  database: "orders",
  collection: "items",
  direction: "import" as const,
  format: "json" as const,
  path: "C:\\sample.jsonl",
};

test("replacement and Production imports require the full namespace", () => {
  expect(
    requiredTransferConfirmation(
      { ...target, mode: "replace", drop: false },
      "development",
    ),
  ).toBe("orders.items");
  expect(
    requiredTransferConfirmation(
      { ...target, mode: "insert", drop: false },
      "production",
    ),
  ).toBe("orders.items");
  expect(
    requiredTransferConfirmation(
      { ...target, mode: "insert", drop: false },
      "development",
    ),
  ).toBeUndefined();
  expect(
    requiredTransferConfirmation(
      { ...target, collection: "", mode: "insert", drop: false },
      "development",
    ),
  ).toBe("orders");
});

test("worker refuses an unconfirmed replacement before creating a job", () => {
  const database = new DatabaseService();
  const profile = profileSchema.parse({
    id: "p",
    name: "Dev",
    uri: "mongodb://127.0.0.1:27017",
  });
  database.connections.set("p", {
    client: {} as MongoClient,
    profile,
    version: "8.0",
  });
  const transfers = new TransferService(database, () => {});
  const input = transferSchema.parse({
    ...target,
    mode: "replace",
    confirmation: "items",
  });
  expect(() =>
    transfers.start({
      ...input,
      resolved: { profile, uri: profile.uri, options: {} },
      toolsPath: "",
    }),
  ).toThrow(/confirmation/i);
  expect(transfers.jobs.size).toBe(0);
});
