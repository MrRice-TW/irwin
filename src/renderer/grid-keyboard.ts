export type GridSelection = { row: number; field: string };

/** Reveal a grid item in the portion of the viewport not covered by frozen cells. */
export function gridScrollOffset(
  start: number,
  size: number,
  offset: number,
  viewportSize: number,
  frozenSize: number,
): number {
  if (start < offset + frozenSize || size > viewportSize - frozenSize)
    return Math.max(0, start - frozenSize);
  if (start + size > offset + viewportSize)
    return Math.max(0, start + size - viewportSize);
  return offset;
}

export function moveGridSelection(
  selected: GridSelection,
  columns: readonly string[],
  rowCount: number,
  key: string,
): GridSelection {
  if (!columns.length || !rowCount) return selected;
  const index = Math.max(0, columns.indexOf(selected.field));
  if (key === "ArrowLeft")
    return { row: selected.row, field: columns[Math.max(0, index - 1)] };
  if (key === "ArrowRight")
    return {
      row: selected.row,
      field: columns[Math.min(columns.length - 1, index + 1)],
    };
  if (key === "ArrowUp")
    return { row: Math.max(0, selected.row - 1), field: columns[index] };
  if (key === "ArrowDown")
    return {
      row: Math.min(rowCount - 1, selected.row + 1),
      field: columns[index],
    };
  if (key === "Home") return { row: selected.row, field: columns[0] };
  if (key === "End") return { row: selected.row, field: columns.at(-1)! };
  return selected;
}
