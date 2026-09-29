import { beforeAll, afterAll, test, expect } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, Long, Decimal128 } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { ShellService } from "../src/core/shell";
import { profileSchema, querySchema } from "../src/shared/contracts";
import { encode, decode } from "../src/shared/bson";
let server: MongoMemoryServer;
let client: MongoClient;
let shell: ShellService;
let uri: string;
const database = new DatabaseService();
let resolved: any;
beforeAll(async () => {
  if (process.env.WORKBENCH_TEST_URI) uri = process.env.WORKBENCH_TEST_URI;
  else {
    server = await MongoMemoryServer.create({
      binary: {
        version: process.env.MONGOMS_VERSION || "8.0.18",
        downloadDir: ".runtime/mongodb",
      },
      instance: { dbName: "workbench_test" },
    });
    uri = server.getUri();
  }
  client = new MongoClient(uri);
  await client.connect();
  resolved = {
    profile: profileSchema.parse({
      id: "test",
      name: "test",
      uri,
      database: "workbench_test",
    }),
    uri,
    options: { serverSelectionTimeoutMS: 5000 },
  };
  await database.connect(resolved);
  shell = new ShellService();
  await shell.open(resolved, "workbench_test");
}, 120000);
afterAll(async () => {
  await shell?.close();
  await database.closeAll();
  await client?.db("workbench_test").dropDatabase();
  await client?.close();
  await server?.stop();
});
test("find cursor pages preserve exact BSON and atomic old-value update conflicts", async () => {
  await client
    .db("workbench_test")
    .collection("docs")
    .insertMany(
      Array.from({ length: 205 }, (_, n) => ({
        n,
        long: Long.fromString("9007199254740993"),
        price: Decimal128.fromString("1.20"),
        nested: { ok: true },
        missing: null,
      })),
    );
  const q = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "docs",
    sort: '{"n":1}',
  });
  const page = await database.run(q);
  expect(page.rows).toHaveLength(100);
  expect(page.hasMore).toBe(true);
  expect(page.rows[0].ejson).toContain("9007199254740993");
  const target = {
    connectionId: "test",
    database: "workbench_test",
    collection: "docs",
    original: page.rows[0].ejson,
    field: "nested.ok",
    value: "false",
  };
  const result = await database.execute("documents.update", target);
  expect(decode(result.row.ejson).nested.ok).toBe(false);
  await expect(database.execute("documents.update", target)).rejects.toThrow(
    "Conflict",
  );
  expect((await database.next(page.cursorId)).rows).toHaveLength(100);
  const last = await database.next(page.cursorId);
  expect(last.rows).toHaveLength(5);
  expect(last.hasMore).toBe(false);
});
test("full document replace succeeds when the original document is unchanged", async () => {
  const coll = client.db("workbench_test").collection("replace_docs");
  await coll.deleteMany({});
  const replaceId = new ObjectId();
  await coll.insertOne({ _id: replaceId, name: "Ada", active: true });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "replace_docs",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const reorderedOriginal = JSON.stringify(
    Object.fromEntries(Object.entries(JSON.parse(original)).reverse()),
  );
  const result = await database.execute("documents.replace", {
    connectionId: "test",
    database: "workbench_test",
    collection: "replace_docs",
    original: reorderedOriginal,
    document: encode({ _id: replaceId, name: "Grace", active: true }),
  });
  expect(decode(result.ejson).name).toBe("Grace");
});

test("refreshes the current server document by its original identity after a conflict", async () => {
  const coll = client.db("workbench_test").collection("refresh_docs");
  const id = new ObjectId();
  await coll.insertOne({ _id: id, name: "Ada", revision: 1 });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "refresh_docs",
  });
  const original = (await database.run(input)).rows[0].ejson;
  await coll.updateOne({ _id: id }, { $set: { revision: 2 } });

  const current = await database.execute("documents.fetch", {
    connectionId: "test",
    database: "workbench_test",
    collection: "refresh_docs",
    original,
  });

  const refreshed = decode(current.ejson);
  expect(refreshed.name).toBe("Ada");
  expect(refreshed.revision.valueOf()).toBe(2);
});

test("count returns documents matching the current filter", async () => {
  const coll = client.db("workbench_test").collection("count_docs");
  await coll.deleteMany({});
  await coll.insertMany([
    { group: "keep", n: 1 },
    { group: "keep", n: 2 },
    { group: "skip", n: 3 },
  ]);
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "count_docs",
    filter: '{"group":"keep"}',
    sort: '{"n":1}',
    projection: '{"_id":0}',
  });
  await expect(database.execute("queries.count", input)).resolves.toBe(2);
});
test("native shell queries, cursor continuation and writes execute once", async () => {
  const coll = client.db("workbench_test").collection("shell_docs");
  await coll.insertMany(Array.from({ length: 105 }, (_, x) => ({ x })));
  const page = await shell.execute("db.shell_docs.find().sort({x:1})");
  expect(page.rows).toHaveLength(100);
  expect(page.hasMore).toBe(true);
  expect((await shell.next()).rows).toHaveLength(5);
  await shell.execute("db.shell_docs.updateOne({x:0}, {$inc:{counter:1}})");
  expect((await coll.findOne({ x: 0 }))?.counter).toBe(1);
  expect(
    (await shell.execute("db.shell_docs.find().limit(10)")).rows,
  ).toHaveLength(10);
  const bson = await shell.execute(
    '({v: NumberLong("9007199254740993"), id:ObjectId()})',
  );
  expect(bson.rows[0].ejson).toContain("$numberLong");
});
test("projection without identity cannot be edited", async () => {
  const page = await database.run(
    querySchema.parse({
      connectionId: "test",
      database: "workbench_test",
      collection: "docs",
      projection: '{"_id":0,"n":1}',
      limit: 1,
    }),
  );
  expect(page.rows[0].editable).toBe(false);
});

test("CAS rejects numeric type changes and scalar-to-array changes", async () => {
  const coll = client.db("workbench_test").collection("cas");
  await coll.insertOne({ _id: 1 as any, value: 42 });
  const input = querySchema.parse({
    connectionId: "test",
    database: "workbench_test",
    collection: "cas",
  });
  const original = (await database.run(input)).rows[0].ejson;
  const edit = {
    connectionId: "test",
    database: "workbench_test",
    collection: "cas",
    original,
    field: "value",
    value: "7",
  };
  await coll.updateOne({}, { $set: { value: Long.fromNumber(42) } });
  await expect(database.execute("documents.update", edit)).rejects.toThrow(
    "Conflict",
  );
  await coll.updateOne({}, { $set: { value: [42] } });
  await expect(database.execute("documents.update", edit)).rejects.toThrow(
    "Conflict",
  );
  const projected = await database.run({
    ...input,
    projection: '{"value":{"$literal":7}}',
  });
  expect(projected.rows[0].editable).toBe(false);
});
