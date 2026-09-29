import { expect, test } from "vitest";
import type { QueryInput } from "../src/shared/contracts";
import { allMatchingTransfer } from "../src/renderer/query-export";

test("all-matching export keeps the query conditions but never uses the visible-page skip", () => {
  const query: QueryInput = {
    connectionId: "connection-1",
    database: "app",
    collection: "orders",
    filter: '{"status":"open"}',
    sort: '{"createdAt":-1}',
    projection: '{"_id":1,"total":1}',
    limit: 0,
    skip: 100,
    batchSize: 100,
    maxTimeMS: 30000,
  };

  expect(allMatchingTransfer(query, "csv")).toMatchObject({
    connectionId: "connection-1",
    database: "app",
    collection: "orders",
    direction: "export",
    format: "csv",
    filter: query.filter,
    sort: query.sort,
    projection: query.projection,
    limit: 0,
  });
  expect(allMatchingTransfer(query, "csv")).not.toHaveProperty("skip");
});
