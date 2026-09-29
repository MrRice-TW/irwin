import { bsonType } from "../shared/exploration";
export type GridCell = { row: number; field: string };
// Escape reserved-prefix root names as paths too, so they cannot collide.
const prefix = "\u001f";
export function columnPath(key: string): string[] {
  return key.startsWith(prefix) ? JSON.parse(key.slice(1)) : [key];
}
export function columnLabel(key: string) {
  return columnPath(key)
    .map((s, i) => (i ? (/^\d+$/.test(s) ? `[${s}]` : `.${s}`) : s))
    .join("");
}
export function cellValue(document: any, key: string): any {
  return columnPath(key).reduce(
    (v, k) =>
      v !== null && typeof v === "object" && Object.hasOwn(v, k)
        ? v[k]
        : undefined,
    document,
  );
}
export function safeColumnPath(key: string): string | undefined {
  const path = columnPath(key);
  return path.every(
    (s) =>
      s &&
      !s.includes(".") &&
      !s.startsWith("$") &&
      !["__proto__", "constructor", "prototype"].includes(s),
  )
    ? path.join(".")
    : undefined;
}
export function tableColumns(
  documents: any[],
  expanded: string[] = [],
  order: string[] = [],
): string[] {
  const root = [...new Set(documents.flatMap((d) => Object.keys(d)))].map(
    (k) => (k.startsWith(prefix) ? prefix + JSON.stringify([k]) : k),
  );
  const result: string[] = [];
  const visit = (key: string, depth: number) => {
    if (result.length >= 500) return;
    result.push(key);
    if (!expanded.includes(key) || depth > 8) return;
    const children = new Set<string>();
    for (const doc of documents) {
      const value = cellValue(doc, key);
      if (["Array", "Object"].includes(bsonType(value)))
        for (const child of Object.keys(value).slice(0, 100))
          children.add(child);
    }
    for (const child of children)
      visit(prefix + JSON.stringify([...columnPath(key), child]), depth + 1);
  };
  root.forEach((k) => visit(k, 0));
  return rememberColumnOrder(order, result).filter((key) =>
    result.includes(key),
  );
}
/** Keep established positions, including temporarily projected-out fields. */
export function rememberColumnOrder(previous: string[], discovered: string[]) {
  const result = [...previous];
  for (const key of discovered) {
    if (result.includes(key)) continue;
    const path = columnPath(key);
    const parent = path.slice(0, -1);
    const parentIndex = parent.length
      ? result.findIndex(
          (candidate) =>
            JSON.stringify(columnPath(candidate)) === JSON.stringify(parent),
        )
      : -1;
    if (parentIndex < 0) result.push(key);
    else {
      let index = parentIndex + 1;
      while (index < result.length) {
        const next = columnPath(result[index]);
        if (
          next.length <= parent.length ||
          !parent.every((part, i) => next[i] === part)
        )
          break;
        index++;
      }
      result.splice(index, 0, key);
    }
  }
  // The saved-layout contract caps field lists at 500. Prefer the current
  // result when a tab has encountered more than 500 different fields.
  const bounded =
    result.length > 500
      ? [
          ...result.filter((key) => discovered.includes(key)),
          ...result.filter((key) => !discovered.includes(key)),
        ].slice(0, 500)
      : result;
  return bounded.length === previous.length &&
    bounded.every((key, i) => key === previous[i])
    ? previous
    : bounded;
}
export function reorderColumn(columns: string[], from: string, to: string) {
  if (from === to || !columns.includes(from) || !columns.includes(to))
    return columns;
  const result = columns.filter((c) => c !== from);
  result.splice(result.indexOf(to), 0, from);
  return result;
}
export function moveColumnBy(
  columns: string[],
  field: string,
  direction: -1 | 1,
) {
  const index = columns.indexOf(field);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= columns.length)
    return columns;
  const next = [...columns];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
