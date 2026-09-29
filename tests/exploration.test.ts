import { describe, expect, it } from "vitest";
import {
  buildCellFilter,
  fieldCatalog,
  mongoSuggestions,
  summarizeExplain,
  analyzeDocuments,
} from "../src/shared/exploration";
describe("MongoDB exploration", () => {
  it("adds typed predicates without overwriting an existing condition", () => {
    const value = { $oid: "6a4f6bffbed892721b94b460" };
    expect(
      JSON.parse(buildCellFilter('{kind:"sync"}', "kind", "async", "and")),
    ).toEqual({ $and: [{ kind: "sync" }, { kind: { $eq: "async" } }] });
    expect(JSON.parse(buildCellFilter("{}", "_id", value, "only"))).toEqual({
      _id: { $eq: value },
    });
    expect(
      JSON.parse(buildCellFilter("{}", "absent", undefined, "only")),
    ).toEqual({ absent: { $exists: false } });
    expect(JSON.parse(buildCellFilter("{}", "value", null, "only"))).toEqual({
      value: { $eq: null, $exists: true },
    });
  });
  it("rejects ambiguous field paths and never executes a filter expression", () => {
    expect(() => buildCellFilter("{}", "$bad", 1, "only")).toThrow();
    expect(() =>
      buildCellFilter("process.exit()", "kind", "x", "and"),
    ).toThrow();
  });
  it("collects nested field types and scopes completions to the active namespace", () => {
    const fields = fieldCatalog([
      {
        kind: "async",
        config: { enabled: true },
        amount: { $numberLong: "9007199254740993" },
      },
    ]);
    expect(fields.find((f) => f.path === "config.enabled")?.types).toEqual([
      "Boolean",
    ]);
    expect(fields.find((f) => f.path === "amount")?.types).toEqual(["Int64"]);
    expect(
      mongoSuggestions('db.getCollection("', {
        fields,
        collections: ["orders", "users"],
      }).map((s) => s.label),
    ).toEqual(["orders", "users"]);
    expect(
      mongoSuggestions("{ki", { fields, collections: [] }).some(
        (s) => s.label === "kind",
      ),
    ).toBe(true);
  });
  it("describes real explain counts without inventing missing execution metrics", () => {
    const plan = summarizeExplain({
      queryPlanner: {
        winningPlan: {
          stage: "FETCH",
          inputStage: { stage: "IXSCAN", indexName: "kind_1" },
        },
      },
      executionStats: {
        nReturned: 2,
        totalDocsExamined: 20,
        totalKeysExamined: 20,
        executionTimeMillis: 3,
      },
    });
    expect(plan).toMatchObject({
      returned: 2,
      examined: 20,
      ratio: 10,
      indexes: ["kind_1"],
      collectionScan: false,
    });
    expect(
      summarizeExplain({ queryPlanner: { winningPlan: { stage: "COLLSCAN" } } })
        .returned,
    ).toBeUndefined();
  });
  it("counts missing documents separately from null and reports array bounds", () => {
    const report = analyzeDocuments([
      { age: { $numberInt: "2" }, tags: [1, 2] },
      { age: "2", tags: [] },
      { age: null },
      {},
    ]);
    expect(report.fields.find((f) => f.path === "age")).toMatchObject({
      present: 3,
      missing: 1,
      types: { Int32: 1, String: 1, Null: 1 },
    });
    expect(report.fields.find((f) => f.path === "tags")?.array).toEqual({
      min: 0,
      max: 2,
      average: 1,
    });
  });
  it("finds frequent values even after the first twenty distinct values and reports skipped paths", () => {
    const docs = [
      ...Array.from({ length: 25 }, (_, n) => ({ status: `s${n}` })),
      ...Array.from({ length: 30 }, () => ({ status: "common" })),
      { "unsafe.name": "value" },
    ];
    const report = analyzeDocuments(docs);
    expect(report.fields.find((f) => f.path === "status")?.values[0]).toEqual({
      value: "common",
      count: 30,
    });
    expect(report.fieldsTruncated).toBe(true);
  });
});
