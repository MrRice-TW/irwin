import { describe, test, expect } from "vitest";
import {
  ObjectId,
  Long,
  Decimal128,
  Int32,
  Double,
  Binary,
  BSONRegExp,
} from "bson";
import {
  encode,
  decode,
  object,
  sameDocument,
  csvValue,
  setPath,
} from "../src/shared/bson";
import {
  updateSpec,
  identity,
  redact,
  replaceSpec,
  assertWritable,
} from "../src/core/policy";
import { profileSchema, commands } from "../src/shared/contracts";
import { within, readDocuments } from "../src/core/transfers";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const profile = profileSchema.parse({
  id: "test",
  name: "test",
  uri: "mongodb://localhost",
});
describe("BSON fidelity", () => {
  test("Extended JSON refuses overflowing integer edits", () => {
    expect(() => decode('{"$numberLong":"9223372036854775808"}')).toThrow();
    expect(() => decode('{"$numberInt":"2147483648"}')).toThrow();
    expect(csvValue("42", "double")._bsontype).toBe("Double");
  });
  test("accepts Mongo shell object syntax for query documents", () => {
    const value = decode("{_id:-1, name: 'Ada'}");
    expect(value._id.valueOf()).toBe(-1);
    expect(value.name).toBe("Ada");
  });
  const values = [
    new ObjectId(),
    Long.fromString("9223372036854775807"),
    Decimal128.fromString("123.4500"),
    new Int32(42),
    new Double(42),
    new Binary(Buffer.from([1, 2, 3])),
    new Date("2025-01-01Z"),
    null,
    new BSONRegExp("x.*", "i"),
    { nested: [1, null, "a"] },
  ];
  test.each(values.map((v, i) => [i, v]))("round trip %s", (_i, value) => {
    expect(encode(decode(encode({ value })))).toBe(encode({ value }));
  });
  test("document comparison ignores BSON object field order", () => {
    const id = new ObjectId();
    const left = {
      _id: id,
      nested: { first: 1, second: [true, null] },
      name: "Ada",
    };
    const right = {
      name: "Ada",
      nested: { second: [true, null], first: 1 },
      _id: id,
    };
    expect(sameDocument(left, right)).toBe(true);
    expect(sameDocument(left, { ...right, name: "Grace" })).toBe(false);
  });
  test("int64 CSV range validation", () => {
    expect(csvValue("9007199254740993", "int64").toString()).toBe(
      "9007199254740993",
    );
    expect(() => csvValue("9223372036854775808", "int64")).toThrow();
  });
  test("invalid scalar and document values", () => {
    expect(() => csvValue("", "double")).toThrow();
    expect(() => csvValue("yes", "boolean")).toThrow();
    expect(() => object("[]")).toThrow();
  });
});
describe("write targeting", () => {
  test("connection profiles default to development and can require read-only access", () => {
    expect(
      profileSchema.parse({
        id: "dev",
        name: "dev",
        uri: "mongodb://localhost",
      }),
    ).toMatchObject({
      environment: "development",
      readOnly: false,
    });
    const production = profileSchema.parse({
      id: "prod",
      name: "prod",
      uri: "mongodb://localhost",
      environment: "production",
      readOnly: true,
    });
    expect(() => assertWritable(production, "documents.insert")).toThrow(
      /production connection is read-only/i,
    );
    expect(() => assertWritable(production, "queries.run")).not.toThrow();
  });
  test("null and absent fields have different conflict predicates", () => {
    const doc = { _id: new ObjectId(), a: null };
    expect(updateSpec(doc, "a", 1, profile, "db", "c").filter.$and[1]).toEqual({
      a: { $eq: null, $exists: true },
    });
    expect(updateSpec(doc, "b", 1, profile, "db", "c").filter.$and[1]).toEqual({
      b: { $exists: false },
    });
  });
  test("object identifiers are compared literally, not as query operators", () => {
    expect(identity({ _id: { $gt: "" } }, profile, "db", "c")).toEqual({
      _id: { $eq: { $gt: "" } },
    });
  });
  test("replace uses the whole document root for compare-and-swap", () => {
    const original = { _id: new ObjectId(), name: "Ada" };
    const replacement = { ...original, name: "Grace" };
    const spec = replaceSpec(original, replacement, profile, "db", "c");
    expect(spec.filter.$and[1].$expr.$eq[0]).toBe("$$ROOT");
  });

  test("partition key and identity are immutable", () => {
    const cosmos = {
      ...profile,
      provider: "cosmos" as const,
      partitionKeys: { "db.c": "tenant.id" },
    };
    const doc = { _id: 1, tenant: { id: "A" } };
    expect(() => updateSpec(doc, "tenant", {}, cosmos, "db", "c")).toThrow(
      "immutable",
    );
    expect(() => identity({ _id: 1 }, cosmos, "db", "c")).toThrow("partition");
    expect(() => updateSpec(doc, "_id", 2, profile, "db", "c")).toThrow(
      "immutable",
    );
  });
  test("prototype paths and manifest traversal are rejected", () => {
    expect(() => setPath({}, "__proto__.polluted", true)).toThrow();
    expect(() => within(resolve(".runtime"), "../secret")).toThrow();
    expect(() => within(resolve(".runtime"), "C:\\secret")).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });
  test("IPC validation rejects invalid write scope and excessive batch", () => {
    expect(() =>
      commands["documents.update"].parse({ connectionId: "a" }),
    ).toThrow();
    expect(() =>
      commands["queries.run"].parse({
        connectionId: "a",
        database: "db",
        collection: "c",
        batchSize: 1000000,
      }),
    ).toThrow();
  });
  test("URI credentials are redacted", () => {
    expect(redact("mongodb://user:p%40ss@host/db")).not.toContain("p%40ss");
  });
});
test("stream parsers handle JSON arrays, JSONL, multiline CSV and safe full-document CSV", async () => {
  const dir = await mkdtemp(join(resolve(".runtime"), "parser-test-"));
  try {
    const array = join(dir, "array.json");
    const lines = join(dir, "lines.jsonl");
    const csv = join(dir, "data.csv");
    const full = join(dir, "full.csv");
    await writeFile(
      array,
      '[{"n":{"$numberLong":"9007199254740993"}},{"n":null}]',
    );
    await writeFile(lines, '{"a":1}\n{"b":2}\n');
    await writeFile(
      csv,
      'name,note,count\nAda,"first\nsecond",9007199254740993\n',
    );
    await writeFile(full, 'document\n"{""_id"":1,""text"":""ok""}"\n');
    const collect = async (source: AsyncIterable<any>) => {
      const rows = [];
      for await (const v of source) rows.push(v);
      return rows;
    };
    expect((await collect(readDocuments(array, "json")))[0].n.toString()).toBe(
      "9007199254740993",
    );
    expect(await collect(readDocuments(lines, "json"))).toHaveLength(2);
    const parsed = await collect(
      readDocuments(csv, "csv", [
        { source: "name", target: "name", type: "string", empty: "string" },
        { source: "note", target: "note", type: "string", empty: "string" },
        { source: "count", target: "count", type: "int64", empty: "string" },
      ]),
    );
    expect(parsed[0].note).toBe("first\nsecond");
    expect(parsed[0].count.toString()).toBe("9007199254740993");
    expect(
      (
        await collect(
          readDocuments(full, "csv", [
            { source: "document", target: "", type: "json", empty: "string" },
          ]),
        )
      )[0].text,
    ).toBe("ok");
  } finally {
    if (
      dir.startsWith(resolve(".runtime") + "\\") ||
      dir.startsWith(resolve(".runtime") + "/")
    )
      await rm(dir, { recursive: true, force: true });
  }
});

test("compiled desktop transfers read JSON arrays and JSONL without losing BSON types", async () => {
  const dir = await mkdtemp(join(resolve(".runtime"), "compiled-parser-test-"));
  const require = createRequire(import.meta.url);
  const bundle = join(dir, "transfers.cjs");
  try {
    await build({
      entryPoints: [resolve("src/core/transfers.ts")],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      packages: "external",
    });
    const { readDocuments: readCompiledDocuments } = require(bundle) as {
      readDocuments(path: string, format: "json"): AsyncIterable<any>;
    };
    const documents = [
      {
        _id: "first",
        integer: { $numberLong: "9007199254740993" },
        decimal: { $numberDecimal: "123.4500" },
        nested: { values: [true, null] },
      },
      {
        _id: "second",
        integer: { $numberLong: "9007199254740994" },
        decimal: { $numberDecimal: "456.7800" },
        nested: { values: [false, "繁體中文"] },
      },
    ];
    for (const [filename, contents] of [
      ["array.json", JSON.stringify(documents)],
      ["lines.jsonl", documents.map((doc) => JSON.stringify(doc)).join("\n")],
    ] as const) {
      const path = join(dir, filename);
      await writeFile(path, contents);
      const actual = [];
      for await (const doc of readCompiledDocuments(path, "json")) {
        actual.push({
          _id: doc._id,
          integer: doc.integer.toString(),
          integerType: doc.integer._bsontype,
          decimal: doc.decimal.toString(),
          decimalType: doc.decimal._bsontype,
          nested: doc.nested,
        });
      }
      expect(actual).toEqual(
        documents.map((doc) => ({
          _id: doc._id,
          integer: doc.integer.$numberLong,
          integerType: "Long",
          decimal: doc.decimal.$numberDecimal,
          decimalType: "Decimal128",
          nested: doc.nested,
        })),
      );
    }
  } finally {
    delete require.cache[bundle];
    if (
      dir.startsWith(resolve(".runtime") + "\\") ||
      dir.startsWith(resolve(".runtime") + "/")
    )
      await rm(dir, { recursive: true, force: true });
  }
});
