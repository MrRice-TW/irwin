import { expect, test } from "vitest";
import {
  initialQueryLayout,
  queryOptionIndicators,
} from "../src/renderer/query-layout";

test("query layout restores explicit per-tab choices", () => {
  expect(
    initialQueryLayout({ queryOptionsExpanded: false, resultFocus: true }),
  ).toEqual({
    queryOptionsExpanded: false,
    resultFocus: true,
  });
  expect(initialQueryLayout(undefined)).toEqual({
    queryOptionsExpanded: true,
    resultFocus: false,
  });
});

test("collapsed query options still reveal which clauses are active", () => {
  expect(queryOptionIndicators('{"name":1}', "{}")).toEqual(["SORT"]);
  expect(queryOptionIndicators("{}", '{"name":1}')).toEqual(["PROJECTION"]);
  expect(queryOptionIndicators("{}", "{}")).toEqual([]);
});
