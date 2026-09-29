import { afterAll, beforeAll, expect, test } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { aggregationSchema, profileSchema } from "../src/shared/contracts";
import { decode } from "../src/shared/bson";

let server: MongoMemoryServer;
let client: MongoClient;
const database = new DatabaseService();
let uri: string;
const makeStage = (text: string) => ({
  id: crypto.randomUUID(),
  enabled: true,
  text,
});

beforeAll(async () => {
  server = await MongoMemoryServer.create({
    binary: {
      version: process.env.MONGOMS_VERSION || "8.0.18",
      downloadDir: ".runtime/mongodb",
    },
  });
  uri = server.getUri();
  client = new MongoClient(uri);
  await client.connect();
  await client
    .db("aggregation_test")
    .collection("people")
    .insertMany(
      Array.from({ length: 205 }, (_, n) => ({
        personId: new ObjectId(),
        n,
        team: n % 2 ? "Research" : "Engineering",
      })),
    );
  for (const [id, readOnly] of [
    ["production", true],
    ["writable", false],
  ] as const)
    await database.connect({
      profile: profileSchema.parse({
        id,
        name: id,
        uri,
        database: "aggregation_test",
        environment: readOnly ? "production" : "development",
        readOnly,
      }),
      uri,
      options: {},
    });
}, 120000);

afterAll(async () => {
  await database.closeAll();
  await client?.close();
  await server?.stop();
});

test("read-only profile runs a grouped pipeline and returns uneditable rows", async () => {
  const input = aggregationSchema.parse({
    connectionId: "production",
    database: "aggregation_test",
    collection: "people",
    stages: [
      makeStage('{ "$group": { "_id": "$team", "total": { "$sum": 1 } } }'),
      makeStage('{ "$sort": { "_id": 1 } }'),
    ],
  });
  const page = await database.execute("aggregations.run", input);
  expect(page.rows).toHaveLength(2);
  expect(page.rows.every((row: { editable: boolean }) => !row.editable)).toBe(
    true,
  );
  expect(decode(page.rows[0].ejson)._id).toBe("Engineering");
  expect(page.hasMore).toBe(false);
});

test("aggregate cursor supports paging and cancellation", async () => {
  const input = aggregationSchema.parse({
    connectionId: "production",
    database: "aggregation_test",
    collection: "people",
    batchSize: 100,
    stages: [makeStage('{ "$sort": { "n": 1 } }')],
  });
  const first = await database.execute("aggregations.run", input);
  expect(first.rows).toHaveLength(100);
  expect(first.hasMore).toBe(true);
  const second = await database.execute("queries.next", {
    cursorId: first.cursorId,
  });
  expect(second.rows).toHaveLength(100);
  await database.execute("queries.cancel", { cursorId: first.cursorId });
  await expect(
    database.execute("queries.next", { cursorId: first.cursorId }),
  ).rejects.toThrow(/expired/i);
});

test("preview stops at a selected stage and limits results", async () => {
  const input = aggregationSchema.parse({
    connectionId: "production",
    database: "aggregation_test",
    collection: "people",
    throughIndex: 0,
    stages: [
      makeStage('{ "$match": { "team": "Research" } }'),
      makeStage('{ "$match": { "team": "Engineering" } }'),
    ],
  });
  const preview = await database.execute("aggregations.preview", input);
  expect(preview.rows).toHaveLength(20);
  expect(
    preview.rows.every(
      (row: { ejson: string }) => decode(row.ejson).team === "Research",
    ),
  ).toBe(true);
  expect(preview.hasMore).toBe(false);
});

test.each(["production", "writable"])(
  "%s rejects output stage before the driver sees it",
  async (id) => {
    const input = aggregationSchema.parse({
      connectionId: id,
      database: "aggregation_test",
      collection: "people",
      stages: [makeStage('{ "$out": "corrupted" }')],
    });
    await expect(database.execute("aggregations.run", input)).rejects.toThrow(
      /not approved/i,
    );
    await expect(
      database.execute("aggregations.preview", input),
    ).rejects.toThrow(/not approved/i);
    expect(
      await client
        .db("aggregation_test")
        .listCollections({ name: "corrupted" })
        .hasNext(),
    ).toBe(false);
  },
);
