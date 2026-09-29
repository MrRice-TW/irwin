import { expect, test } from "vitest";
import type { MongoClient } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { TransferService } from "../src/core/transfers";
import { ShellService } from "../src/core/shell";
import { profileSchema, transferSchema } from "../src/shared/contracts";

const profile = profileSchema.parse({
  id: "locked",
  name: "Production replica",
  uri: "mongodb://127.0.0.1:27017",
  environment: "production",
  readOnly: true,
});

test("read-only profiles reject GUI writes before a database operation begins", async () => {
  const database = new DatabaseService();
  database.connections.set("locked", {
    client: { db: () => { throw new Error("database should not be called"); } } as unknown as MongoClient,
    profile,
    version: "8.0",
  });

  await expect(
    database.execute("documents.insert", {
      connectionId: "locked",
      database: "app",
      collection: "orders",
      document: '{"_id":1}',
    }),
  ).rejects.toThrow(/production connection is read-only/i);
  await expect(
    database.execute("metadata.drop", {
      connectionId: "locked",
      database: "app",
      collection: "orders",
      confirmation: "orders",
    }),
  ).rejects.toThrow(/production connection is read-only/i);
});

test("read-only profiles reject import tools before a transfer job is created", () => {
  const database = new DatabaseService();
  database.connections.set("locked", {
    client: {} as MongoClient,
    profile,
    version: "8.0",
  });
  const transfers = new TransferService(database, () => {});
  const input = transferSchema.parse({
    connectionId: "locked",
    database: "app",
    collection: "orders",
    direction: "import",
    format: "json",
    path: "C:\\fixture.jsonl",
  });

  expect(() =>
    transfers.start({
      ...input,
      resolved: { profile, uri: profile.uri, options: {} },
      toolsPath: "",
    }),
  ).toThrow(/production connection is read-only/i);
});

test("read-only profiles reject shell execution", async () => {
  const shell = new ShellService();
  try {
    await shell.open({ profile, uri: profile.uri, options: {} }, "app", true);
    await expect(shell.execute("db.orders.insertOne({ _id: 1 })")).rejects.toThrow(
      /production connection is read-only/i,
    );
  } finally {
    await shell.close();
  }
});
