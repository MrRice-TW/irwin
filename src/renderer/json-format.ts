import type { Settings } from "../shared/contracts";

export const shellJsonLanguage = "mongo-json" as const;

export type JsonFormatOptions = {
  indent?: Settings["tabWidth"];
};

function jsonValue(value: any, depth: number, indent: number): string {
  const pad = " ".repeat(indent * depth);
  const childPad = " ".repeat(indent * (depth + 1));

  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return "[\n" +
      value.map((item) => childPad + jsonValue(item, depth + 1, indent)).join(",\n") +
      "\n" + pad + "]";
  }
  if (value.$oid) return "ObjectId(" + JSON.stringify(value.$oid) + ")";
  if (value.$numberInt !== undefined) return String(Number(value.$numberInt));
  if (value.$numberDouble !== undefined) return String(value.$numberDouble);
  if (value.$numberLong !== undefined) {
    const n = Number(value.$numberLong);
    return Number.isSafeInteger(n)
      ? String(n)
      : "Long(" + JSON.stringify(String(value.$numberLong)) + ")";
  }
  if (value.$numberDecimal !== undefined)
    return "Decimal128(" + JSON.stringify(value.$numberDecimal) + ")";
  if (value.$date) {
    const millis = Number(value.$date.$numberLong ?? value.$date);
    const iso = Number.isNaN(millis) ? String(value.$date) : new Date(millis).toISOString();
    return "ISODate(" + JSON.stringify(iso) + ")";
  }

  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  return "{\n" +
    entries
      .map(([key, item]) =>
        childPad +
        (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)) +
        ": " + jsonValue(item, depth + 1, indent))
      .join(",\n") +
    "\n" + pad + "}";
}

export function prettyDocument(value: any, options: JsonFormatOptions = {}): string {
  return jsonValue(value, 0, options.indent ?? 2);
}
export function formatDocument(value: string, indent: number): string {
  return JSON.stringify(JSON.parse(value), null, indent);
}
