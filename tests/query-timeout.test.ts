import { describe, expect, it } from "vitest";
import { capInteractiveQueryTimeout } from "../src/shared/query-timeout";

describe("connection query timeout", () => {
  it("caps interactive reads and explain without increasing a shorter request", () => {
    expect(
      capInteractiveQueryTimeout("queries.run", { maxTimeMS: 30000 }, 15000),
    ).toEqual({ maxTimeMS: 15000 });
    expect(
      capInteractiveQueryTimeout(
        "aggregations.explain",
        { maxTimeMS: 5000 },
        15000,
      ),
    ).toEqual({ maxTimeMS: 5000 });
  });

  it("leaves full exports and unrelated operations unchanged", () => {
    const exportRequest = { maxTimeMS: 300000, path: "archive.jsonl" };
    expect(
      capInteractiveQueryTimeout("aggregations.export", exportRequest, 15000),
    ).toEqual(exportRequest);
  });
});
