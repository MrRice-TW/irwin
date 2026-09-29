import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_COLUMN_WIDTH,
  fitInitialTableColumnWidths,
  initialTableLayout,
  isExtendedJsonScalar,
  rememberedTableLayout,
  reconcileTableColumnWidths,
} from "../src/renderer/result-layout";

describe("result layout", () => {
  it("uses own widths for fields that share Object prototype names", () => {
    expect(
      reconcileTableColumnWidths({}, ["constructor", "__proto__"]),
    ).toEqual(JSON.parse('{"constructor":220,"__proto__":220}'));
  });
  it("treats canonical BSON scalar wrappers as tree leaves", () => {
    expect(isExtendedJsonScalar({ $oid: "6a4f6bffbed892721b94b460" })).toBe(
      true,
    );
    expect(isExtendedJsonScalar({ $numberInt: "1" })).toBe(true);
    expect(isExtendedJsonScalar({ $date: { $numberLong: "0" } })).toBe(true);
    expect(isExtendedJsonScalar({ nested: { $oid: "id" } })).toBe(false);
    expect(isExtendedJsonScalar({ name: "Ada" })).toBe(false);
  });

  it("only shrinks initial table columns whose loaded values fit", () => {
    const widths = fitInitialTableColumnWidths(["name", "description"], {
      name: ["Ada", "Grace Hopper"],
      description: [
        "A deliberately long value that should retain its default column width because it would otherwise be clipped.",
      ],
    });

    expect(widths.name).toBeLessThan(DEFAULT_TABLE_COLUMN_WIDTH);
    expect(widths.description).toBe(DEFAULT_TABLE_COLUMN_WIDTH);
  });

  it("fits short type-like columns below the former 110 pixel floor", () => {
    const widths = fitInitialTableColumnWidths(["type", "kind"], {
      type: ["test", "table", "filterList"],
      kind: ["async"],
    });

    expect(widths.type).toBeGreaterThanOrEqual(76);
    expect(widths.type).toBeLessThan(110);
    expect(widths.kind).toBeLessThan(110);
  });

  it("ignores transient workspace widths until the user chooses to remember a layout", () => {
    const transient = {
      widths: {
        type: DEFAULT_TABLE_COLUMN_WIDTH,
        kind: DEFAULT_TABLE_COLUMN_WIDTH,
      },
      order: [],
      hidden: [],
      pinned: [],
      expanded: [],
      remember: false,
    };

    expect(rememberedTableLayout(transient)).toBeUndefined();
    expect(rememberedTableLayout({ ...transient, remember: true })).toEqual({
      ...transient,
      remember: true,
    });
  });

  it("recalculates column widths when opening a collection with a remembered layout", () => {
    const saved = {
      widths: { type: DEFAULT_TABLE_COLUMN_WIDTH, kind: 160 },
      order: ["type", "kind"],
      hidden: ["internal"],
      pinned: ["type"],
      expanded: [],
      remember: true,
    };

    expect(initialTableLayout(saved, true)).toEqual({
      ...saved,
      widths: {},
    });
    expect(initialTableLayout(saved, false)).toEqual(saved);
  });

  it("retains widths for columns temporarily omitted by a projection", () => {
    expect(
      reconcileTableColumnWidths({ type: 97, kind: 76 }, ["kind"]),
    ).toEqual({ type: 97, kind: 76 });
  });
  it("considers all rows in the first loaded batch rather than only the first 100", () => {
    const widths = fitInitialTableColumnWidths(["category"], {
      category: [
        ...Array(100).fill("a"),
        "Long content that must keep the default width",
      ],
    });
    expect(widths.category).toBe(220);
  });
});
