import type { TableLayout } from "../shared/workspace";

export const DEFAULT_TABLE_COLUMN_WIDTH = 220;
export const MIN_TABLE_COLUMN_WIDTH = 76;

const extendedJsonScalarKeys = new Set([
  "$oid",
  "$numberInt",
  "$numberLong",
  "$numberDouble",
  "$numberDecimal",
  "$date",
  "$binary",
  "$regularExpression",
  "$timestamp",
  "$minKey",
  "$maxKey",
  "$undefined",
  "$symbol",
  "$code",
  "$dbPointer",
]);

/** Canonical Extended JSON wrappers represent one BSON value, not a tree object. */
export function isExtendedJsonScalar(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && extendedJsonScalarKeys.has(keys[0]);
}

function textWidth(text: string) {
  return [...text].reduce(
    (width, character) => width + (character.charCodeAt(0) > 0xff ? 12 : 7.25),
    0,
  );
}

/**
 * Uses the first loaded result set to make short table columns compact. Long
 * values intentionally retain the normal width, so opening a collection never
 * lets a description or JSON field dominate the table.
 */
export function fitInitialTableColumnWidths(
  columns: readonly string[],
  values: Readonly<Record<string, readonly string[]>>,
): Record<string, number> {
  return Object.fromEntries(
    columns.map((column) => {
      const widest = [column, ...(values[column] ?? [])].reduce(
        (width, value) => Math.max(width, textWidth(value)),
        0,
      );
      const desired = Math.ceil(widest + 24);
      return [
        column,
        desired < DEFAULT_TABLE_COLUMN_WIDTH
          ? Math.max(MIN_TABLE_COLUMN_WIDTH, desired)
          : DEFAULT_TABLE_COLUMN_WIDTH,
      ];
    }),
  );
}

/**
 * Only explicitly remembered layouts become Collection preferences. A fresh
 * tab still discards remembered widths when first-result auto fit is enabled.
 */
export function rememberedTableLayout(
  layout?: TableLayout,
): TableLayout | undefined {
  return layout?.remember ? layout : undefined;
}

/**
 * A remembered Collection configuration retains which fields the user chose
 * to show and how they are arranged. Widths are deliberately omitted for a
 * fresh Collection tab so its first loaded data can fit them again.
 */
export function initialTableLayout(
  layout: TableLayout | undefined,
  autoFit: boolean,
): TableLayout | undefined {
  const remembered = rememberedTableLayout(layout);
  return remembered && autoFit ? { ...remembered, widths: {} } : remembered;
}

/**
 * A Collection tab owns its table widths for its whole lifetime. A query can
 * temporarily omit fields through Projection, but that must not erase the
 * user's width when the field returns in a later query.
 */
export function reconcileTableColumnWidths(
  previous: Readonly<Record<string, number>>,
  columns: readonly string[],
): Record<string, number> {
  return {
    ...previous,
    ...Object.fromEntries(
      columns
        .filter((column) => !Object.hasOwn(previous, column))
        .map((column) => [column, DEFAULT_TABLE_COLUMN_WIDTH]),
    ),
  };
}
