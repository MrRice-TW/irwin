import { describe, expect, it } from "vitest";
import {
  gridScrollOffset,
  moveGridSelection,
} from "../src/renderer/grid-keyboard";

describe("grid keyboard selection", () => {
  it("reveals keyboard targets beside frozen columns and below the header", () => {
    expect(gridScrollOffset(252, 220, 1100, 800, 252)).toBe(0);
    expect(gridScrollOffset(900, 220, 0, 800, 252)).toBe(320);
    expect(gridScrollOffset(400, 100, 100, 800, 252)).toBe(100);
    expect(gridScrollOffset(36, 36, 360, 500, 36)).toBe(0);
  });
  it("aligns the start of a cell wider than the unfrozen viewport", () => {
    expect(gridScrollOffset(300, 640, 0, 600, 252)).toBe(48);
  });
  it("moves through visible rows and columns while retaining boundaries", () => {
    const columns = ["_id", "type", "kind"];
    expect(
      moveGridSelection({ row: 1, field: "type" }, columns, 3, "ArrowRight"),
    ).toEqual({ row: 1, field: "kind" });
    expect(
      moveGridSelection({ row: 1, field: "type" }, columns, 3, "ArrowUp"),
    ).toEqual({ row: 0, field: "type" });
    expect(
      moveGridSelection({ row: 0, field: "_id" }, columns, 3, "ArrowLeft"),
    ).toEqual({ row: 0, field: "_id" });
    expect(
      moveGridSelection({ row: 2, field: "kind" }, columns, 3, "ArrowDown"),
    ).toEqual({ row: 2, field: "kind" });
  });

  it("uses Home and End to select the first and last visible columns", () => {
    const columns = ["_id", "type", "kind"];
    expect(
      moveGridSelection({ row: 1, field: "type" }, columns, 3, "Home"),
    ).toEqual({ row: 1, field: "_id" });
    expect(
      moveGridSelection({ row: 1, field: "type" }, columns, 3, "End"),
    ).toEqual({ row: 1, field: "kind" });
  });
});
