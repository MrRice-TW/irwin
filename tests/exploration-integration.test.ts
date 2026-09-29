import { beforeAll, afterAll, expect, test } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Int32, Long } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { ExplorationService } from "../src/core/exploration";
import { profileSchema, querySchema } from "../src/shared/contracts";
let server: MongoMemoryServer, client: MongoClient;
const database = new DatabaseService();
const analysis = new ExplorationService(database, () => {});
const source = {
  connectionId: "a",
  database: "exploration_test",
  collection: "source",
};
const target = { ...source, connectionId: "b", collection: "target" };
beforeAll(async () => {
  server = await MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  });
  client = new MongoClient(server.getUri());
  await client.connect();
  for (const id of ["a", "b"])
    await database.connect({
      profile: profileSchema.parse({
        id,
        name: id,
        uri: server.getUri(),
        readOnly: true,
      }),
      uri: server.getUri(),
      options: {},
    });
  await client
    .db(source.database)
    .collection("source")
    .insertMany(
      Array.from({ length: 250 }, (_, n) => ({
        _id: n as any,
        sku: `sku-${n}`,
        kind: "async",
        config: { enabled: true },
        revision: new Int32(1),
        updatedAt: new Date(0),
      })),
    );
  await client
    .db(source.database)
    .collection("target")
    .insertMany(
      Array.from({ length: 250 }, (_, n) => ({
        _id: n as any,
        sku: `sku-${n}`,
        kind: n === 200 ? "sync" : "async",
        config: { enabled: true },
        revision: n === 201 ? Long.fromNumber(1) : new Int32(1),
        updatedAt: new Date(1000),
      })),
    );
}, 120000);
afterAll(async () => {
  await analysis.close();
  await database.closeAll();
  await client?.close();
  await server?.stop();
});
test("schema samples are bounded and describe actual BSON and nested fields", async () => {
  const report = await analysis.schema({
    ...source,
    filter: "{}",
    sampleSize: 50,
    jobId: "schema",
    maxTimeMS: 10000,
  });
  expect(report.sampled).toBe(50);
  expect(
    report.fields.find((f: any) => f.path === "config.enabled")?.types,
  ).toEqual({ Boolean: 50 });
});
test("read-only compare reads beyond one batch and reports strict BSON differences", async () => {
  const report = await analysis.compare({
    source,
    target,
    sourceFilter: "{}",
    targetFilter: "{}",
    matchKeys: ["sku"],
    ignorePaths: ["updatedAt"],
    jobId: "compare",
    maxTimeMS: 30000,
  });
  expect(report.counts).toMatchObject({
    source: 250,
    target: 250,
    equal: 248,
    changed: 2,
    sourceOnly: 0,
    targetOnly: 0,
    duplicates: 0,
  });
  expect(
    report.differences.some((d: any) => d.paths.includes("revision")),
  ).toBe(true);
  expect(report.snapshot).toBe(false);
  expect(report.complete).toBe(true);
  expect(report.readWindows.source.startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(report.readWindows.source.completedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(report.readWindows.target.startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(report.readWindows.target.completedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(Date.parse(report.readWindows.source.completedAt)).toBeLessThanOrEqual(
    Date.parse(report.readWindows.target.startedAt),
  );
  expect(report.sourceFilter).toBe("{}");
  expect(report.matchKeys).toEqual(["sku"]);
  expect(report.ignorePaths).toEqual(["updatedAt"]);
});
test("duplicate and missing match keys are never treated as unique documents", async () => {
  await client
    .db(source.database)
    .collection("duplicates")
    .insertMany([{ sku: "same" }, { sku: "same" }, { other: true }]);
  const report = await analysis.compare({
    source: { ...source, collection: "duplicates" },
    target: { ...target, collection: "duplicates" },
    sourceFilter: "{}",
    targetFilter: "{}",
    matchKeys: ["sku"],
    ignorePaths: [],
    jobId: "duplicate",
    maxTimeMS: 10000,
  });
  expect(report.counts.duplicates).toBe(1);
  expect(report.counts.missingKeys).toBe(2);
  expect(report.counts.equal).toBe(0);
});
test("explain returns execution metrics on a read-only profile", async () => {
  const raw = await database.execute(
    "queries.explain",
    querySchema.parse({ ...source, filter: '{kind:"async"}' }),
  );
  expect(JSON.parse(raw)).toHaveProperty("executionStats");
});
test("cancelling a running comparison stops cursor consumption without changing either side", async () => {
  const cancelService = new ExplorationService(database, (event) => {
    if (event.jobId === "cancel" && event.processed >= 100)
      cancelService.cancel("cancel");
  });
  await expect(
    cancelService.compare({
      source,
      target,
      matchKeys: ["sku"],
      jobId: "cancel",
      maxTimeMS: 30000,
    }),
  ).rejects.toThrow(/cancel/i);
  expect(
    await client
      .db(source.database)
      .collection(source.collection)
      .countDocuments(),
  ).toBe(250);
  expect(
    await client
      .db(target.database)
      .collection(target.collection)
      .countDocuments(),
  ).toBe(250);
  await cancelService.close();
});
test("bounded difference reports still count all source-only documents", async () => {
  await client
    .db(source.database)
    .collection("large_report")
    .insertMany(Array.from({ length: 510 }, (_, i) => ({ sku: i })));
  const report = await analysis.compare({
    source: { ...source, collection: "large_report" },
    target: { ...target, collection: "absent" },
    matchKeys: ["sku"],
    jobId: "large",
    maxTimeMS: 30000,
  });
  expect(report.counts.sourceOnly).toBe(510);
  expect(report.reportTruncated).toBe(true);
  expect(report.differences).toHaveLength(500);
});
