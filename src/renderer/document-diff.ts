import { decode, encode } from "../shared/bson";
import { prettyDocument } from "./json-format";

export type DocumentChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
};

function valueText(value: unknown) {
  if (value === undefined) return "undefined";
  const displayValue =
    value !== null && typeof value === "object"
      ? JSON.parse(encode(value))
      : value;
  return prettyDocument(displayValue);
}

function isDocument(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function diff(
  before: any,
  after: any,
  path: string,
  output: DocumentChange[],
) {
  if (isDocument(before) && isDocument(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const child = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key))
        output.push({ path: child, kind: "added", after: valueText(after[key]) });
      else if (!Object.hasOwn(after, key))
        output.push({ path: child, kind: "removed", before: valueText(before[key]) });
      else diff(before[key], after[key], child, output);
    }
    return;
  }
  if (valueText(before) !== valueText(after))
    output.push({ path: path || "$", kind: "changed", before: valueText(before), after: valueText(after) });
}

export function documentChanges(original: string, current: string): DocumentChange[] {
  const output: DocumentChange[] = [];
  diff(decode(original), decode(current), "", output);
  return output;
}
