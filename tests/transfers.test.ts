import { beforeAll, afterAll, test, expect } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Long, Decimal128, ObjectId } from "mongodb";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseService } from "../src/core/database";
import { TransferService } from "../src/core/transfers";
import { profileSchema, transferSchema } from "../src/shared/contracts";
import { csvContent } from "../src/renderer/helpers";
import { csvFormulaEscapingSidecar } from "../src/shared/csv";
let server: MongoMemoryServer;
let client: MongoClient;
let directory: string;
let resolved: any;
const database = new DatabaseService();
const completed = new Map<string, any>();
const transfers = new TransferService(database, (p) => {
  if (p.status !== "running") completed.set(p.jobId, p);
});
const toolsTarget = `${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"}-${process.arch}`;
beforeAll(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "transfer-test-"));
  server = await MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  });
  const uri = server.getUri();
  client = new MongoClient(uri);
  await client.connect();
  resolved = {
    profile: profileSchema.parse({
      id: "test",
      name: "test",
      uri,
      database: "transfer_test",
    }),
    uri,
    options: {},
  };
  await database.connect(resolved);
});
afterAll(async () => {
  await database.closeAll();
  await client?.close();
  await server?.stop();
  if (
    directory &&
    (directory.startsWith(resolve(".runtime") + "\\") ||
      directory.startsWith(resolve(".runtime") + "/"))
  )
    await rm(directory, { recursive: true, force: true });
});
async function job(overrides: any) {
  const input = transferSchema.parse({
    connectionId: "test",
    database: "transfer_test",
    collection: "source",
    direction: "export",
    format: "json",
    path: join(directory, "export.jsonl"),
    ...overrides,
  });
  const { jobId } = transfers.start({
    ...input,
    resolved,
    toolsPath: resolve("vendor/tools", toolsTarget),
  });
  await transfers.jobs.get(jobId)!.done;
  return completed.get(jobId);
}
test("JSON export/import and replace retain BSON and report duplicate keys", async () => {
  const source = client.db("transfer_test").collection("source");
  await source.insertMany(
    Array.from({ length: 201 }, (_, n) => ({
      _id: new ObjectId(),
      n,
      long: Long.fromString("9007199254740993"),
      decimal: Decimal128.fromString("4.20"),
      nested: { ok: true },
    })),
  );
  const exported = await job({});
  expect(exported.status).toBe("completed");
  expect(exported.processed).toBe(201);
  expect((await stat(join(directory, "export.jsonl"))).size).toBeGreaterThan(0);
  const imported = await job({ collection: "copy", direction: "import" });
  expect(imported.status).toBe("completed");
  expect(imported.processed).toBe(201);
  const duplicate = await job({ collection: "copy", direction: "import" });
  expect(duplicate.failed).toBe(201);
  expect(duplicate.processed).toBe(0);
  await client
    .db("transfer_test")
    .collection("copy")
    .updateMany({}, { $set: { extra: true } });
  const replaced = await job({
    collection: "copy",
    direction: "import",
    mode: "replace",
    confirmation: "transfer_test.copy",
  });
  expect(replaced.status).toBe("completed");
  expect(
    await client
      .db("transfer_test")
      .collection("copy")
      .countDocuments({ extra: { $exists: true } }),
  ).toBe(0);
  const doc = await client.db("transfer_test").collection("copy").findOne({});
  expect(doc?.long.toString()).toBe("9007199254740993");
  expect(doc?.decimal.toString()).toBe("4.20");
});
test("default CSV full-document export reimports using mapping sidecar", async () => {
  const path = join(directory, "export.csv");
  expect((await job({ format: "csv", path })).status).toBe("completed");
  const result = await job({
    format: "csv",
    path,
    direction: "import",
    collection: "csv_copy",
  });
  expect(result.status).toBe("completed");
  expect(
    await client.db("transfer_test").collection("csv_copy").countDocuments(),
  ).toBe(201);
  const doc = await client
    .db("transfer_test")
    .collection("csv_copy")
    .findOne({});
  expect(doc?.long.toString()).toBe("9007199254740993");
});
test("mapped CSV formula escapes round-trip original text through its sidecar", async () => {
  const source = client.db("transfer_test").collection("formula_source");
  await source.insertOne({
    expression: "=1+1",
    quotedExpression: "'=2+2",
    spaceExpression: " =3+3",
    lineFeedExpression: "\n=4+4",
    negativeNumber: -42,
  });
  const path = join(directory, "formula-mapped.csv");
  const csvColumns = [
    {
      source: "=expression",
      target: "expression",
      type: "string",
      empty: "string",
    },
    {
      source: "quotedExpression",
      target: "quotedExpression",
      type: "string",
      empty: "string",
    },
    {
      source: "spaceExpression",
      target: "spaceExpression",
      type: "string",
      empty: "string",
    },
    {
      source: "lineFeedExpression",
      target: "lineFeedExpression",
      type: "string",
      empty: "string",
    },
    {
      source: "negativeNumber",
      target: "negativeNumber",
      type: "int32",
      empty: "string",
    },
  ];

  const exported = await job({
    collection: "formula_source",
    format: "csv",
    path,
    csvColumns,
  });
  expect(exported.status).toBe("completed");
  const csv = await readFile(path, "utf8");
  expect(csv).toContain("'=expression");
  expect(csv).toContain("'=1+1");
  expect(csv).toContain("''=2+2");
  expect(csv).toContain("' =3+3");
  expect(csv).toContain("'\n=4+4");
  expect(csv).toContain("-42");
  expect(
    JSON.parse(await readFile(`${path}.mapping.json`, "utf8")),
  ).toMatchObject({
    version: 2,
    formulaEscaping: "apostrophe-v1",
  });
  const preview = await transfers.preview(path);
  expect(preview.columns).toEqual([
    "=expression",
    "quotedExpression",
    "spaceExpression",
    "lineFeedExpression",
    "negativeNumber",
  ]);
  expect(preview.rows[0]).toMatchObject({
    "=expression": "=1+1",
    quotedExpression: "'=2+2",
    spaceExpression: " =3+3",
    lineFeedExpression: "\n=4+4",
  });

  const imported = await job({
    path,
    format: "csv",
    direction: "import",
    collection: "formula_copy",
  });
  expect(imported.status).toBe("completed");
  const doc = await client
    .db("transfer_test")
    .collection("formula_copy")
    .findOne({});
  expect(doc?.expression).toBe("=1+1");
  expect(doc?.quotedExpression).toBe("'=2+2");
  expect(doc?.spaceExpression).toBe(" =3+3");
  expect(doc?.lineFeedExpression).toBe("\n=4+4");
  expect(doc?.negativeNumber.toString()).toBe("-42");
});

test("query result CSV formula escaping sidecar preserves headers and text on reimport", async () => {
  const path = join(directory, "query-results.csv");
  const rows = [
    {
      ejson: JSON.stringify({
        "=header": "=1+1",
        leadingSpace: " =2+2",
        originalApostrophe: "'=3+3",
      }),
      editable: true,
    },
  ];
  await writeFile(path, csvContent(rows));
  await writeFile(`${path}.mapping.json`, csvFormulaEscapingSidecar());

  const preview = await transfers.preview(path);
  expect(preview.columns).toEqual([
    "=header",
    "leadingSpace",
    "originalApostrophe",
  ]);
  expect(preview.rows[0]).toEqual({
    "=header": "=1+1",
    leadingSpace: " =2+2",
    originalApostrophe: "'=3+3",
  });

  const imported = await job({
    path,
    format: "csv",
    direction: "import",
    collection: "query_result_copy",
  });
  expect(imported.status).toBe("completed");
  const doc = await client
    .db("transfer_test")
    .collection("query_result_copy")
    .findOne({});
  expect(doc).toMatchObject({
    "=header": "=1+1",
    leadingSpace: " =2+2",
    originalApostrophe: "'=3+3",
  });
});

test("CSV database manifests retain formula escape metadata for reimport", async () => {
  const source = client.db("formula_database").collection("records");
  await source.insertOne({ expression: "=1+1", note: "safe" });
  const path = join(directory, "formula-database");
  const csvColumns = [
    {
      source: "expression",
      target: "expression",
      type: "string",
      empty: "string",
    },
    { source: "note", target: "note", type: "string", empty: "string" },
  ];

  const exported = await job({
    database: "formula_database",
    collection: "",
    format: "csv",
    path,
    csvColumns,
  });
  expect(exported.status).toBe("completed");
  const manifest = JSON.parse(
    await readFile(join(path, "manifest.json"), "utf8"),
  );
  expect(manifest.collections[0].csvFormulaEscaping).toBe("apostrophe-v1");

  const imported = await job({
    database: "formula_database_copy",
    collection: "",
    direction: "import",
    format: "csv",
    path,
    confirmation: "formula_database_copy",
  });
  expect(imported.status).toBe("completed");
  expect(
    await client
      .db("formula_database_copy")
      .collection("records")
      .findOne({ expression: "=1+1", note: "safe" }),
  ).not.toBeNull();
});
test("query export streams all 250 matching documents beyond the visible 100-row batch", async () => {
  const source = client.db("transfer_test").collection("query_scope");
  await source.insertMany(
    Array.from({ length: 250 }, (_, n) => ({
      _id: new ObjectId(),
      category: "selected",
      sequence: n,
    })),
  );
  await source.insertMany(
    Array.from({ length: 30 }, (_, n) => ({
      _id: new ObjectId(),
      category: "other",
      sequence: n,
    })),
  );
  const path = join(directory, "all-matching.jsonl");
  const exported = await job({
    collection: "query_scope",
    path,
    filter: '{"category":"selected"}',
    sort: '{"sequence":1}',
  });

  expect(exported.status).toBe("completed");
  expect(exported.processed).toBe(250);
  const content = (await readFile(path, "utf8")).trim().split("\n");
  expect(content).toHaveLength(250);
  expect(JSON.parse(content[0]).sequence).toEqual({ $numberInt: "0" });
  expect(JSON.parse(content.at(-1)!).sequence).toEqual({
    $numberInt: "249",
  });
});
test("database manifest round trip", async () => {
  const path = join(directory, "db");
  expect((await job({ collection: "", path })).status).toBe("completed");
  const result = await job({
    collection: "",
    database: "db_copy",
    direction: "import",
    path,
    confirmation: "db_copy",
  });
  expect(result.status).toBe("completed");
  expect(await client.db("db_copy").collection("source").countDocuments()).toBe(
    201,
  );
});
test("BSON archive round trip with bundled official tools", async () => {
  const path = join(directory, "backup.gz");
  const result = await job({ format: "bson", path });
  expect(result.status, result.message).toBe("completed");
  await client.db("transfer_test").collection("source").deleteMany({});
  const restored = await job({ format: "bson", path, direction: "import" });
  expect(restored.status, restored.message).toBe("completed");
  expect(
    await client.db("transfer_test").collection("source").countDocuments(),
  ).toBe(201);
});
test("cancelled transfer reports cancellation and keeps partial output separate", async () => {
  const path = join(directory, "cancel.jsonl");
  const p = transferSchema.parse({
    connectionId: "test",
    database: "transfer_test",
    collection: "source",
    direction: "export",
    format: "json",
    path,
  });
  const { jobId } = transfers.start({ ...p, resolved, toolsPath: "" });
  const done = transfers.jobs.get(jobId)!.done;
  transfers.cancel(jobId);
  await done;
  expect(completed.get(jobId).status).toBe("cancelled");
  await expect(stat(path)).rejects.toThrow();
});

test("CSV type failures are reported per record while valid rows continue", async () => {
  const path = join(directory, "partial.csv");
  await writeFile(path, "n\n1\ninvalid\n3\n");
  const result = await job({
    path,
    format: "csv",
    direction: "import",
    collection: "partial",
    csvColumns: [{ source: "n", target: "n", type: "int32", empty: "string" }],
  });
  expect(result.status).toBe("completed");
  expect(result.failed).toBe(1);
  expect(result.processed).toBe(2);
  expect(
    JSON.parse((await readFile(result.errorPath, "utf8")).trim()).line,
  ).toBe(2);
});
test("BSON restore rejects conflicting source version before changing data", async () => {
  const path = join(directory, "backup.gz");
  const metadata = `${path}.metadata.json`;
  const original = await readFile(metadata, "utf8");
  const value = JSON.parse(original);
  value.serverVersion = "7.0.0";
  await writeFile(metadata, JSON.stringify(value));
  const result = await job({ path, format: "bson", direction: "import" });
  expect(result.status).toBe("failed");
  expect(result.message).toContain("major versions must match");
  await writeFile(metadata, original);
});
