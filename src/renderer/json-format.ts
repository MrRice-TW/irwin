import type { Settings } from "../shared/contracts";
import { decode, encode } from "../shared/bson";

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
  if (typeof value.$oid === "string")
    return "ObjectId(" + JSON.stringify(value.$oid) + ")";
  if (value.$numberInt !== undefined)
    return "Int32(" + JSON.stringify(String(value.$numberInt)) + ")";
  if (value.$numberDouble !== undefined)
    return "Double(" + JSON.stringify(String(value.$numberDouble)) + ")";
  if (value.$numberLong !== undefined)
    return "Long(" + JSON.stringify(String(value.$numberLong)) + ")";
  if (value.$numberDecimal !== undefined)
    return "Decimal128(" + JSON.stringify(value.$numberDecimal) + ")";
  if (value.$date) {
    const millis = value.$date.$numberLong ?? value.$date;
    if (typeof millis === "string" && /^-?\d+$/.test(millis)) {
      const exactMillis = BigInt(millis);
      if (exactMillis < -8640000000000000n || exactMillis > 8640000000000000n)
        return JSON.stringify(value);
      return "ISODate(" + JSON.stringify(new Date(Number(exactMillis)).toISOString()) + ")";
    }
    const date = new Date(millis);
    return Number.isNaN(date.valueOf())
      ? JSON.stringify(value)
      : "ISODate(" + JSON.stringify(date.toISOString()) + ")";
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
export function formatDocument(value: string, indent: Settings["tabWidth"]): string {
  return prettyDocument(JSON.parse(encode(decode(value))), { indent });
}
