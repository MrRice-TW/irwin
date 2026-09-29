import { afterAll, beforeAll, expect, test } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Long, ObjectId } from "mongodb";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseService } from "../src/core/database";
import { TransferService } from "../src/core/transfers";
import {
  aggregationExportSchema,
  profileSchema,
} from "../src/shared/contracts";

let server: MongoMemoryServer;
let client: MongoClient;
let directory: string;
const database = new DatabaseService();
const completed = new Map<string, any>();
const transfers = new TransferService(database, (event) => {
  if (event.status !== "running") completed.set(event.jobId, event);
});
beforeAll(async () => {
  directory = await mkdtemp(
    join(resolve(".runtime"), "aggregation-export-test-"),
  );
  server = await MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  });
  const uri = server.getUri();
  client = new MongoClient(uri);
  await client.connect();
  await client
    .db("aggregation_export")
    .collection("source")
    .insertMany(
      Array.from({ length: 250 }, (_, n) => ({
        id: new ObjectId(),
        category: n < 210 ? "keep" : "skip",
        number: Long.fromString("9007199254740993"),
        sequence: n,
      })),
    );
  await database.connect({
    profile: profileSchema.parse({
      id: "locked",
      name: "Production",
      uri,
      database: "aggregation_export",
      environment: "production",
    }),
    uri,
    options: {},
  });
}, 120000);
afterAll(async () => {
  await database.closeAll();
  await client?.close();
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("exports the complete read-only pipeline result as Canonical JSONL", async () => {
  const path = join(directory, "all.jsonl");
  const input = aggregationExportSchema.parse({
    connectionId: "locked",
    database: "aggregation_export",
    collection: "source",
    path,
    stages: [
      {
        id: "match",
        enabled: true,
        text: '{ "$match": { "category": "keep" } }',
      },
    ],
  });
  const { jobId } = transfers.startAggregation(input);
  await transfers.aggregationJobs.get(jobId)!.done;
  expect(completed.get(jobId).status).toBe("completed");
  expect(completed.get(jobId).processed).toBe(210);
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(210);
  expect(JSON.parse(lines[0]).number).toEqual({
    $numberLong: "9007199254740993",
  });
  await expect(stat(`${path}.partial`)).rejects.toThrow();
});

test("rejects output stage before opening a partial file", async () => {
  const path = join(directory, "unsafe.jsonl");
  const input = aggregationExportSchema.parse({
    connectionId: "locked",
    database: "aggregation_export",
    collection: "source",
    path,
    stages: [{ id: "out", enabled: true, text: '{ "$out": "x" }' }],
  });
  expect(() => transfers.startAggregation(input)).toThrow(/not approved/i);
  await expect(stat(`${path}.partial`)).rejects.toThrow();
});

test("cancel leaves a partial file and never reports a completed export", async () => {
  const path = join(directory, "cancelled.jsonl");
  const mockDatabase = new DatabaseService();
  let signal: AbortSignal;
  const cursor = {
    async *[Symbol.asyncIterator]() {
      yield { value: 1 };
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
    close: async () => {},
  };
  const fakeClient = {
    db: () => ({
      collection: () => ({
        aggregate: (_pipeline: unknown, options: { signal: AbortSignal }) => {
          signal = options.signal;
          return cursor;
        },
      }),
    }),
  } as unknown as MongoClient;
  mockDatabase.connections.set("mock", {
    client: fakeClient,
    profile: profileSchema.parse({
      id: "mock",
      name: "Mock",
      uri: "mongodb://127.0.0.1:27017",
    }),
    version: "8.0",
  });
  let firstRow!: () => void;
  const first = new Promise<void>((resolve) => {
    firstRow = resolve;
  });
  const final = new Map<string, any>();
  const service = new TransferService(mockDatabase, (event) => {
    if (event.processed === 1) firstRow();
    if (event.status !== "running") final.set(event.jobId, event);
  });
  const { jobId } = service.startAggregation(
    aggregationExportSchema.parse({
      connectionId: "mock",
      database: "app",
      collection: "source",
      path,
      stages: [{ id: "match", enabled: true, text: '{ "$match": {} }' }],
    }),
  );
  const done = service.aggregationJobs.get(jobId)!.done;
  await first;
  service.cancel(jobId);
  await done;
  expect(final.get(jobId).status).toBe("cancelled");
  expect((await readFile(`${path}.partial`, "utf8")).trim()).toBeTruthy();
  await expect(stat(path)).rejects.toThrow();
});
