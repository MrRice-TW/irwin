import { EJSON, BSON, Decimal128, Int32, Long, ObjectId, Double } from "bson";
import { parseExpression } from "@babel/parser";
export function encode(value: unknown): string {
  return EJSON.stringify(value, { relaxed: false });
}
function shellKey(node: any): string {
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral")
    return String(node.value);
  throw new Error("Mongo shell object keys must be identifiers or literals");
}
function shellValue(node: any): any {
  switch (node.type) {
    case "ObjectExpression": {
      const value: Record<string, any> = {};
      for (const property of node.properties) {
        if (
          property.type !== "ObjectProperty" ||
          property.computed ||
          property.method ||
          property.shorthand
        )
          throw new Error("Only literal Mongo shell object properties are supported");
        const key = shellKey(property.key);
        Object.defineProperty(value, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: shellValue(property.value),
        });
      }
      return value;
    }
    case "ArrayExpression":
      return node.elements.map((element: any) => {
        if (!element) throw new Error("Sparse arrays are not supported");
        return shellValue(element);
      });
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "UnaryExpression":
      if ((node.operator === "-" || node.operator === "+") && node.argument.type === "NumericLiteral")
        return node.operator === "-" ? -node.argument.value : node.argument.value;
      throw new Error("Only numeric unary operators are supported");
    case "ParenthesizedExpression":
      return shellValue(node.expression);
    default:
      throw new Error(`Unsupported Mongo shell expression: ${node.type}`);
  }
}
function parseDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (jsonError) {
    try {
      return shellValue(parseExpression(text, { sourceType: "module" }));
    } catch (shellError) {
      throw new Error(
        `Expected JSON or a Mongo shell document: ${(shellError as Error).message}`,
        { cause: jsonError },
      );
    }
  }
}
export function decode(text: string): any {
  const raw = parseDocument(text);
  validateExtendedJson(raw);
  return EJSON.deserialize(raw as any, { relaxed: false });
}
function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}
export function sameDocument(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(JSON.parse(encode(left)))) ===
    JSON.stringify(canonicalize(JSON.parse(encode(right))));
}
export function validateExtendedJson(raw: unknown) {
  const visit = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (Object.keys(v).length === 1) {
      if (Object.hasOwn(v, "$numberLong"))
        csvValue(String(v.$numberLong), "int64");
      if (Object.hasOwn(v, "$numberInt"))
        csvValue(String(v.$numberInt), "int32");
    }
    for (const child of Object.values(v)) visit(child);
  };
  visit(raw);
}
export function object(text: string): Record<string, any> {
  const value = decode(text);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value._bsontype
  )
    throw new Error("Expected a JSON document");
  return value;
}
export function size(value: any): number {
  return BSON.calculateObjectSize(value);
}
export function getPath(
  doc: any,
  path: string,
): { exists: boolean; value: any } {
  let value = doc;
  for (const part of path.split(".")) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return { exists: false, value: undefined };
    value = value[part];
  }
  return { exists: true, value };
}
export function validPath(path: string): boolean {
  return path
    .split(".")
    .every(
      (p) =>
        p.length > 0 &&
        !p.startsWith("$") &&
        !["__proto__", "prototype", "constructor"].includes(p) &&
        !p.includes("\0"),
    );
}
export function setPath(doc: any, path: string, value: any) {
  if (!validPath(path)) throw new Error("Unsafe field path");
  const parts = path.split(".");
  let ref = doc;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(ref, part)) ref[part] = {};
    if (!ref[part] || typeof ref[part] !== "object")
      throw new Error("Conflicting CSV paths");
    ref = ref[part];
  }
  ref[parts.at(-1)!] = value;
}
export function csvValue(text: string, type: string): any {
  switch (type) {
    case "string":
      return text;
    case "int32": {
      if (!/^-?\d+$/.test(text)) throw new Error("Invalid int32");
      const n = Number(text);
      if (n < -2147483648 || n > 2147483647)
        throw new Error("int32 out of range");
      return new Int32(n);
    }
    case "int64": {
      if (
        !/^-?\d+$/.test(text) ||
        BigInt(text) < -(1n << 63n) ||
        BigInt(text) >= 1n << 63n
      )
        throw new Error("Invalid int64");
      return Long.fromString(text);
    }
    case "double": {
      if (!text.trim() || !Number.isFinite(Number(text)))
        throw new Error("Invalid number");
      return new Double(Number(text));
    }
    case "decimal":
      return Decimal128.fromString(text);
    case "objectId":
      return new ObjectId(text);
    case "boolean":
      if (text === "true") return true;
      if (text === "false") return false;
      throw new Error("Boolean must be true or false");
    case "date": {
      const d = new Date(text);
      if (Number.isNaN(d.valueOf())) throw new Error("Invalid date");
      return d;
    }
    case "json":
      return decode(text);
    default:
      throw new Error("Unknown CSV type");
  }
}
