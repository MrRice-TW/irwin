import { describe, expect, it } from "vitest";
import {
  queryResultNotice,
  queryStateAfterInputChange,
} from "../src/renderer/query-state";

describe("query result state", () => {
  it("marks previously successful results as stale when inputs change", () => {
    expect(queryStateAfterInputChange("success")).toBe("stale");
    expect(queryStateAfterInputChange("idle")).toBe("idle");
  });

  it("keeps a visible warning when a newer request fails over prior results", () => {
    expect(queryResultNotice("stale", true)).toBe("stale-results");
    expect(queryResultNotice("error", true)).toBe("previous-results-error");
    expect(queryResultNotice("error", false)).toBe("query-error");
  });
});
