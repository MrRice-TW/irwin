import { expect, test } from "vitest";
import { commands, profileSchema } from "../src/shared/contracts";
import { assertWritable, operationAccess, redact } from "../src/core/policy";

const production = profileSchema.parse({
  id: "production",
  name: "Production",
  uri: "mongodb://127.0.0.1:27017",
  environment: "production",
});

test("every database command has an explicit access classification", () => {
  for (const command of Object.keys(commands).filter((name) =>
    /^(metadata|queries|documents|aggregations)\./.test(name),
  ))
    expect(operationAccess(command), command).not.toBe("unknown");
});

test("read-only commands are allowed while writes and unknown operations are refused", () => {
  for (const command of [
    "queries.run",
    "queries.next",
    "metadata.indexes",
    "documents.fetch",
    "aggregations.run",
    "aggregations.preview",
    "aggregations.explain",
    "aggregations.export",
    "analysis.schema",
    "analysis.compare",
    "transfer.export",
  ])
    expect(() => assertWritable(production, command), command).not.toThrow();
  for (const command of [
    "documents.update",
    "metadata.drop",
    "metadata.editIndex",
    "transfer.import",
    "shell.execute",
    "future.mutation",
  ])
    expect(() => assertWritable(production, command), command).toThrow(
      /read-only/i,
    );
});

test("user and role inspection is read-only while every account mutation is a write", () => {
  expect(operationAccess("usersRoles.inspect")).toBe("read");
  expect(operationAccess("usersRoles.userDetails")).toBe("read");
  for (const operation of [
    "usersRoles.createUser",
    "usersRoles.setPassword",
    "usersRoles.grantRole",
    "usersRoles.revokeRole",
    "usersRoles.dropUser",
  ]) {
    expect(operationAccess(operation), operation).toBe("write");
    expect(() => assertWritable(production, operation), operation).toThrow(
      /read-only/i,
    );
  }
});

test("database errors never expose passwords sent as pwd or password fields", () => {
  expect(redact("Mongo error pwd: super-secret")).toBe(
    "Mongo error pwd: [redacted]",
  );
  expect(redact("Mongo error password=another-secret")).toBe(
    "Mongo error password=[redacted]",
  );
});
