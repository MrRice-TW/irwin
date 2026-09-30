import { EJSON, BSON, Decimal128, Int32, Long, ObjectId, Double } from "bson";
import { parseExpression } from "@babel/parser";

class LocatedShellError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(
    message: string,
    location?: { line?: number; column?: number },
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocatedShellError";
    this.line = location?.line;
    this.column =
      location?.column === undefined ? undefined : location.column + 1;
  }
}

function parseErrorLocation(error: unknown) {
  if (error instanceof LocatedShellError)
    return { line: error.line, column: error.column };
  const location = (error as any)?.loc?.start ?? (error as any)?.loc;
  if (!location || !Number.isInteger(location.line)) return undefined;
  return {
    line: location.line as number,
    column: Number.isInteger(location.column)
      ? (location.column as number) + 1
      : undefined,
  };
}

function parseErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /\s+\(\d+:\d+\)$/,
    "",
  );
}

export function encode(value: unknown): string {
  return EJSON.stringify(value, { relaxed: false });
}
function shellKey(node: any): string {
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral")
    return String(node.value);
  throw new Error("Mongo shell object keys must be identifiers or literals");
}
function shellDate(node: any, constructor: "ISODate" | "Date"): unknown {
  if (constructor === "Date" && node.arguments?.length === 0) {
    return { $date: { $numberLong: String(Date.now()) } };
  }
  if (
    node.arguments?.length !== 1 ||
    node.arguments[0].type === "SpreadElement"
  )
    throw new Error(
      constructor === "Date"
        ? "Date accepts zero arguments or one literal argument"
        : "ISODate requires one literal argument",
    );
  const argument = node.arguments[0];
  let value: string | number;
  if (argument.type === "StringLiteral") {
    const stringValue: string = argument.value;
    value = stringValue;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(stringValue);
    const dateTime =
      /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(
        stringValue,
      );
    if (!dateOnly && !dateTime)
      throw new Error(`${constructor} requires an ISO date string`);
    const [year, month, day] = stringValue
      .slice(0, 10)
      .split("-")
      .map(Number);
    const calendarDate = new Date(0);
    calendarDate.setUTCHours(0, 0, 0, 0);
    calendarDate.setUTCFullYear(year, month - 1, day);
    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    )
      throw new Error(`${constructor} received an invalid calendar date`);
  } else if (
    constructor === "Date" &&
    (argument.type === "NumericLiteral" ||
      (argument.type === "UnaryExpression" &&
        ["-", "+"].includes(argument.operator) &&
        argument.argument.type === "NumericLiteral"))
  ) {
    value =
      argument.type === "NumericLiteral"
        ? argument.value
        : argument.operator === "-"
          ? -argument.argument.value
          : argument.argument.value;
    if (!Number.isSafeInteger(value))
      throw new Error("Date timestamp must be a safe integer in milliseconds");
  } else {
    throw new Error(
      `${constructor} accepts only an ISO date string${constructor === "Date" ? " or integer timestamp" : ""}`,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new Error(`${constructor} received an invalid date`);
  return { $date: { $numberLong: String(date.valueOf()) } };
}
function shellStringArgument(node: any, constructor: string): string {
  if (
    node.arguments?.length !== 1 ||
    node.arguments[0].type !== "StringLiteral"
  )
    throw new Error(`${constructor} requires one string literal`);
  return node.arguments[0].value;
}
function shellValue(node: any): any {
  try {
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
    case "CallExpression": {
      if (node.optional || node.callee.type !== "Identifier")
        throw new Error("Only literal Mongo BSON constructors are supported");
      const constructor = node.callee.name;
      if (constructor === "ISODate") return shellDate(node, "ISODate");
      if (constructor === "ObjectId") {
        const value = shellStringArgument(node, constructor);
        if (!/^[\da-fA-F]{24}$/.test(value))
          throw new Error("ObjectId requires 24 hexadecimal characters");
        return { $oid: value };
      }
      if (["Int32", "NumberInt"].includes(constructor)) {
        const value = shellStringArgument(node, constructor);
        csvValue(value, "int32");
        return { $numberInt: value };
      }
      if (["Long", "NumberLong"].includes(constructor)) {
        const value = shellStringArgument(node, constructor);
        csvValue(value, "int64");
        return { $numberLong: value };
      }
      if (constructor === "Double") {
        const value = shellStringArgument(node, constructor);
        if (
          !/^(?:NaN|Infinity|-Infinity|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.test(
            value,
          )
        )
          throw new Error("Double requires a valid numeric string");
        return { $numberDouble: value };
      }
      if (["Decimal128", "NumberDecimal"].includes(constructor)) {
        const value = shellStringArgument(node, constructor);
        Decimal128.fromString(value);
        return { $numberDecimal: value };
      }
      throw new Error(`Unsupported Mongo BSON constructor: ${constructor}`);
    }
    case "NewExpression":
      if (node.callee.type === "Identifier" && node.callee.name === "Date")
        return shellDate(node, "Date");
      throw new Error(
        "Only Date with a literal ISO date or timestamp is supported",
      );
      default:
        throw new Error(`Unsupported Mongo shell expression: ${node.type}`);
    }
  } catch (error) {
    if (error instanceof LocatedShellError) throw error;
    throw new LocatedShellError(
      parseErrorMessage(error),
      node.loc?.start,
      error,
    );
  }
}
function parseDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (jsonError) {
    try {
      return shellValue(parseExpression(text, { sourceType: "module" }));
    } catch (shellError) {
      const location = parseErrorLocation(shellError);
      const where = location?.line
        ? `line ${location.line}${location.column ? `, column ${location.column}` : ""}: `
        : "";
      throw new Error(
        `Expected JSON or a Mongo shell document: ${where}${parseErrorMessage(shellError)}`,
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
