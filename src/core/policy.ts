import type { Profile } from "../shared/contracts";
import { getPath, validPath } from "../shared/bson";

const readOnlyOperations = new Set([
  "metadata.databases",
  "metadata.collections",
  "metadata.indexes",
  "queries.run",
  "queries.count",
  "queries.next",
  "queries.cancel",
  "queries.explain",
  "aggregations.run",
  "aggregations.preview",
  "aggregations.explain",
  "aggregations.export",
  "documents.fetch",
  "transfer.export",
  "analysis.schema",
  "analysis.compare",
  "analysis.cancel",
  "usersRoles.inspect",
  "usersRoles.userDetails",
]);
const writeOperations = new Set([
  "metadata.createCollection",
  "metadata.drop",
  "metadata.createIndex",
  "metadata.dropIndex",
  "metadata.editIndex",
  "documents.update",
  "documents.insert",
  "documents.delete",
  "documents.replace",
  "transfer.import",
  "shell.execute",
  "usersRoles.createUser",
  "usersRoles.setPassword",
  "usersRoles.grantRole",
  "usersRoles.revokeRole",
  "usersRoles.dropUser",
]);

export function operationAccess(
  operation: string,
): "read" | "write" | "unknown" {
  if (readOnlyOperations.has(operation)) return "read";
  if (writeOperations.has(operation)) return "write";
  return "unknown";
}

/**
 * The renderer may disable destructive controls, but database-facing processes
 * must enforce the policy as well. Database credentials remain the final
 * authority: configure a MongoDB read-only role for a production connection.
 */
export function assertWritable(profile: Profile, operation: string) {
  if (!profile.readOnly || operationAccess(operation) === "read") return;
  throw new Error(
    `This ${profile.environment} connection is read-only; ${operation} is blocked.`,
  );
}

export function partitionKey(
  profile: Profile,
  database: string,
  collection: string,
) {
  return profile.partitionKeys[`${database}.${collection}`];
}
export function identity(
  doc: any,
  profile: Profile,
  database: string,
  collection: string,
) {
  if (!Object.hasOwn(doc, "_id"))
    throw new Error("Document has no _id; refresh with full identity");
  const filter: any = { _id: { $eq: doc._id } };
  const key = partitionKey(profile, database, collection);
  if (profile.provider === "cosmos" && !key)
    throw new Error(
      "Configure the Cosmos partition key for this collection before writing",
    );
  if (key) {
    if (!validPath(key)) throw new Error("Invalid partition key");
    const v = getPath(doc, key);
    if (!v.exists) throw new Error("Missing partition key");
    filter[key] = { $eq: v.value };
  }
  return filter;
}
export function updateSpec(
  original: any,
  field: string,
  value: any,
  profile: Profile,
  database: string,
  collection: string,
) {
  if (!validPath(field))
    throw new Error(
      "This field name cannot safely be edited with a dotted update path",
    );
  const key = partitionKey(profile, database, collection);
  if (
    field === "_id" ||
    field.startsWith("_id.") ||
    (key &&
      (field === key ||
        field.startsWith(`${key}.`) ||
        key.startsWith(`${field}.`)))
  )
    throw new Error("Identity fields are immutable");
  const old = getPath(original, field);
  if (
    profile.provider === "cosmos" &&
    ((old.value !== null &&
      typeof old.value === "object" &&
      !old.value?._bsontype &&
      !(old.value instanceof Date)) ||
      Array.isArray(value))
  )
    throw new Error(
      "Cosmos conditional editing of object/array values is not supported",
    );
  const match = old.exists
    ? { [field]: { $eq: old.value, $exists: true } }
    : { [field]: { $exists: false } };
  const predicates: any[] = [
    identity(original, profile, database, collection),
    match,
  ];
  if (old.exists) {
    // Query equality also matches array members and coerces numeric types.
    // Expression equality plus BSON type prevents either from bypassing CAS.
    predicates.push({
      $expr: {
        $and: [
          { $eq: [`$${field}`, { $literal: old.value }] },
          { $eq: [{ $type: `$${field}` }, { $type: { $literal: old.value } }] },
        ],
      },
    });
  }
  return {
    filter: { $and: predicates },
    update: { $set: { [field]: value } },
  };
}
export function replaceSpec(
  original: any,
  replacement: any,
  profile: Profile,
  database: string,
  collection: string,
) {
  const before = identity(original, profile, database, collection);
  const after = identity(replacement, profile, database, collection);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Identity fields are immutable");
  const key = partitionKey(profile, database, collection);
  if (
    key &&
    JSON.stringify(getPath(original, key).value) !==
      JSON.stringify(getPath(replacement, key).value)
  )
    throw new Error("Partition key is immutable");
  return {
    filter: {
      $and: [before, { $expr: { $eq: ["$$ROOT", { $literal: original }] } }],
    },
    replacement,
  };
}
export function redact(message: unknown): string {
  return String(message)
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s]+@/gi, "$1[credentials]@")
    .replace(
      /((?:password|pwd|passphrase|token|secret)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    );
}
