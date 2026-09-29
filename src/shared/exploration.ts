import { encode, object, validPath } from "./bson";

export function bsonType(value: any): string {
  if (value === undefined) return "Missing";
  if (value === null) return "Null";
  if (Array.isArray(value)) return "Array";
  if (typeof value !== "object")
    return (
      ({ string: "String", number: "Number", boolean: "Boolean" } as any)[
        typeof value
      ] || typeof value
    );
  const wrappers: Record<string, string> = {
    $oid: "ObjectId",
    $numberInt: "Int32",
    $numberLong: "Int64",
    $numberDouble: "Double",
    $numberDecimal: "Decimal128",
    $date: "Date",
    $binary: "Binary",
    $timestamp: "Timestamp",
    $regularExpression: "Regex",
  };
  return Object.keys(value).length === 1
    ? wrappers[Object.keys(value)[0]] || "Object"
    : "Object";
}
export type FilterAction = "only" | "and" | "or" | "exclude" | "today" | "week";
export function buildCellFilter(
  current: string,
  path: string,
  value: any,
  action: FilterAction,
  now = new Date(),
): string {
  if (!validPath(path))
    throw new Error(
      "This field cannot be represented safely as a MongoDB path",
    );
  let condition: any;
  if (action === "today" || action === "week") {
    const start = new Date(now);
    if (action === "today") start.setHours(0, 0, 0, 0);
    else start.setDate(start.getDate() - 7);
    const end = new Date(now);
    if (action === "today") end.setHours(24, 0, 0, 0);
    condition = {
      $gte: { $date: { $numberLong: String(+start) } },
      $lt: { $date: { $numberLong: String(+end) } },
    };
  } else if (value === undefined) condition = { $exists: action === "exclude" };
  else
    condition = {
      [action === "exclude" ? "$ne" : "$eq"]: value,
      ...(value === null && action !== "exclude" ? { $exists: true } : {}),
    };
  const next = { [path]: condition };
  if (action === "only") return JSON.stringify(next);
  const previous = JSON.parse(encode(object(current)));
  return JSON.stringify(
    Object.keys(previous).length
      ? { [action === "or" ? "$or" : "$and"]: [previous, next] }
      : next,
  );
}

export interface SchemaField {
  path: string;
  present: number;
  missing: number;
  types: Record<string, number>;
  values: { value: any; count: number }[];
  distinctAtLeast: number;
  min?: number | string;
  max?: number | string;
  array?: { min: number; max: number; average: number };
}
export function analyzeDocuments(documents: any[]) {
  const fields = new Map<string, SchemaField>();
  const lengths = new Map<string, number[]>();
  const distributions = new Map<
    string,
    Map<string, { value: any; count: number }>
  >();
  const omittedValues = new Set<string>();
  let fieldsTruncated = false;
  for (const document of documents) {
    const visit = (value: any, path: string, depth: number) => {
      if (depth > 12) {
        fieldsTruncated = true;
        return;
      }
      const type = bsonType(value);
      if (path) {
        if (!fields.has(path)) {
          if (fields.size >= 500) {
            fieldsTruncated = true;
            return;
          }
          fields.set(path, {
            path,
            present: 0,
            missing: 0,
            types: {},
            values: [],
            distinctAtLeast: 0,
          });
        }
        const field = fields.get(path)!;
        field.present++;
        field.types[type] = (field.types[type] || 0) + 1;
        if (type === "Array") {
          const list = lengths.get(path) || [];
          list.push(value.length);
          lengths.set(path, list);
        } else if (type !== "Object") {
          const encoded = JSON.stringify(value);
          const distribution = distributions.get(path) || new Map();
          distributions.set(path, distribution);
          if (encoded.length >= 2048) omittedValues.add(path);
          else {
            const same = distribution.get(encoded);
            if (same) same.count++;
            else distribution.set(encoded, { value, count: 1 });
          }
          let scalar: number | string | undefined;
          if (type === "Date") {
            const date = new Date(
              Number(value.$date?.$numberLong ?? value.$date),
            );
            if (Number.isFinite(+date)) scalar = date.toISOString();
          } else if (["Number", "Int32", "Double"].includes(type)) {
            const n = Number(
              value?.$numberInt ?? value?.$numberDouble ?? value,
            );
            if (Number.isFinite(n)) scalar = n;
          }
          if (scalar !== undefined) {
            if (field.min === undefined || scalar < field.min)
              field.min = scalar;
            if (field.max === undefined || scalar > field.max)
              field.max = scalar;
          }
        }
      }
      if (type === "Object")
        for (const key of Object.keys(value)) {
          // Literal dots/dollars cannot safely be turned into a MongoDB dotted path.
          if (key.includes(".") || !validPath(key)) {
            fieldsTruncated = true;
            continue;
          }
          visit(value[key], path ? `${path}.${key}` : key, depth + 1);
        }
    };
    visit(document, "", 0);
  }
  for (const field of fields.values()) {
    field.missing = documents.length - field.present;
    const distribution = distributions.get(field.path);
    field.distinctAtLeast =
      (distribution?.size || 0) + (omittedValues.has(field.path) ? 1 : 0);
    field.values = [...(distribution?.values() || [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    const list = lengths.get(field.path);
    if (list)
      field.array = {
        min: Math.min(...list),
        max: Math.max(...list),
        average: list.reduce((a, b) => a + b, 0) / list.length,
      };
    field.values.sort((a, b) => b.count - a.count);
  }
  return {
    sampled: documents.length,
    fields: [...fields.values()].sort((a, b) => a.path.localeCompare(b.path)),
    fieldsTruncated,
  };
}
export interface FieldHint {
  path: string;
  types: string[];
}
export function fieldCatalog(documents: any[]): FieldHint[] {
  return analyzeDocuments(documents).fields.map((f) => ({
    path: f.path,
    types: Object.keys(f.types),
  }));
}
export interface CompletionContext {
  fields: FieldHint[];
  collections: string[];
}
export interface MongoSuggestion {
  label: string;
  insertText: string;
  detail: string;
}
export function mongoSuggestions(
  prefix: string,
  context: CompletionContext,
): MongoSuggestion[] {
  if (/getCollection\(\s*["'][^"']*$/.test(prefix))
    return context.collections.map((name) => ({
      label: name,
      insertText: name,
      detail: "Collection",
    }));
  const methods = [
    ["find", "find({})", "find(filter, projection) → cursor"],
    ["findOne", "findOne({})", "findOne(filter) → document"],
    ["sort", "sort({ _id: -1 })", "sort(fields) → cursor"],
    ["limit", "limit(100)", "limit(number) → cursor"],
    ["aggregate", "aggregate([])", "aggregate(pipeline) → cursor"],
    [
      "getCollection",
      'getCollection("collection")',
      "getCollection(name) → collection",
    ],
    ["countDocuments", "countDocuments({})", "countDocuments(filter) → count"],
    ["ObjectId", 'ObjectId("000000000000000000000000")', "ObjectId(hexString)"],
    [
      "ISODate",
      `ISODate("${new Date().toISOString()}")`,
      "ISODate(ISO string)",
    ],
    [
      "Last 7 days",
      "{ $gte: new Date(Date.now() - 7 * 86400000) }",
      "Date range · Shell",
    ],
  ].map(([label, insertText, detail]) => ({ label, insertText, detail }));
  const operators = [
    "$eq",
    "$ne",
    "$gt",
    "$gte",
    "$lt",
    "$lte",
    "$in",
    "$nin",
    "$exists",
    "$type",
    "$and",
    "$or",
    "$regex",
    "$elemMatch",
  ].map((label) => ({ label, insertText: label, detail: "MongoDB operator" }));
  return [
    ...context.fields.map((f) => ({
      label: f.path,
      insertText: /^[\w$]+$/.test(f.path) ? f.path : JSON.stringify(f.path),
      detail: f.types.join(" / "),
    })),
    ...operators,
    ...methods,
  ];
}

const numeric = (n: any): number | undefined => {
  if (n === undefined) return;
  const v = Number(n?.$numberInt ?? n?.$numberLong ?? n?.$numberDouble ?? n);
  return Number.isFinite(v) ? v : undefined;
};
export interface PlanNode {
  stage: string;
  index?: string;
  children: PlanNode[];
}
export function summarizeExplain(raw: any) {
  const indexes = new Set<string>();
  let collectionScan = false;
  const visit = (node: any): PlanNode[] => {
    if (!node || typeof node !== "object") return [];
    const children = Object.entries(node)
      .filter(([key]) => !["rejectedPlans", "allPlansExecution"].includes(key))
      .flatMap(([, value]) => visit(value));
    if (node.indexName) indexes.add(node.indexName);
    if (node.stage === "COLLSCAN") collectionScan = true;
    return node.stage
      ? [{ stage: node.stage, index: node.indexName, children }]
      : children;
  };
  const tree = visit(raw.queryPlanner?.winningPlan || raw.stages || raw);
  const stats =
    raw.executionStats ||
    raw.stages?.find((s: any) => s.$cursor)?.$cursor?.executionStats ||
    {};
  const returned = numeric(stats.nReturned),
    examined = numeric(stats.totalDocsExamined);
  return {
    returned,
    examined,
    keys: numeric(stats.totalKeysExamined),
    elapsed: numeric(stats.executionTimeMillis),
    ratio: returned && examined !== undefined ? examined / returned : undefined,
    indexes: [...indexes],
    collectionScan,
    tree,
  };
}
