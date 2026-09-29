import { expect, test } from "vitest";
import {
  tableColumns,
  cellValue,
  columnLabel,
  reorderColumn,
  moveColumnBy,
  rememberColumnOrder,
} from "../src/renderer/table-tools";
test("expanded fields distinguish literal dots from nested objects and array elements", () => {
  const docs = [
    { "a.b": "literal", a: { b: "nested" }, tags: ["red", "green"] },
  ];
  const cols = tableColumns(docs, ["a", "tags"]);
  const nested = cols.find((c) => c !== "a.b" && columnLabel(c) === "a.b")!;
  expect(cellValue(docs[0], nested)).toBe("nested");
  expect(cellValue(docs[0], "a.b")).toBe("literal");
  expect(cols.some((c) => columnLabel(c) === "tags[1]")).toBe(true);
});
test("column reordering moves a column before its target", () => {
  expect(reorderColumn(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
});
test("keyboard column movement swaps one neighboring column and stays bounded", () => {
  expect(moveColumnBy(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  expect(moveColumnBy(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  expect(moveColumnBy(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
});
test("sorting heterogeneous documents retains the established field order", () => {
  const first = tableColumns([{ _id: 1, type: "a", kind: "b" }]);
  expect(tableColumns([{ _id: 2, kind: "b", type: "a" }], [], first)).toEqual(
    first,
  );
  expect(tableColumns([{ _id: 3, extra: true, kind: "b" }], [], first)).toEqual(
    ["_id", "kind", "extra"],
  );
});
test("remembered field order survives projection and keeps nested expansion beside its parent", () => {
  const previous = ["_id", "config", "kind"];
  const expanded = tableColumns(
    [{ kind: "async", config: { enabled: true }, _id: 1 }],
    ["config"],
    previous,
  );
  expect(expanded.map(columnLabel)).toEqual([
    "_id",
    "config",
    "config.enabled",
    "kind",
  ]);
  expect(rememberColumnOrder(previous, ["_id", "kind"])).toBe(previous);
  const old = Array.from({ length: 500 }, (_, i) => `old${i}`);
  const next = rememberColumnOrder(old, ["new", "old499"]);
  expect(next).toHaveLength(500);
  expect(next).toContain("new");
  expect(next).toContain("old499");
});
test("reserved-prefix field names do not collide with expanded paths", () => {
  const literal = '\u001f["a","b"]';
  const doc = { [literal]: "literal", a: { b: "nested" } };
  const cols = tableColumns([doc], ["a"]);
  expect(new Set(cols).size).toBe(cols.length);
  expect(
    cellValue(
      doc,
      cols.find((c) => columnLabel(c) === literal)!,
    ),
  ).toBe("literal");
  expect(
    cellValue(
      doc,
      cols.find((c) => columnLabel(c) === "a.b")!,
    ),
  ).toBe("nested");
});
