import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { Storage } from "../src/main/storage";
let directory: string;
let storage: Storage;
beforeEach(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "saved-query-test-"));
  storage = new Storage(join(directory, "test.sqlite"));
});
afterEach(async () => {
  storage.close();
  await rm(directory, { recursive: true, force: true });
});
const query = {
  mode: "find",
  filter: '{kind:"async",_id:ObjectId("6a4f6bffbed892721b94b460")}',
  sort: "{_id:-1}",
  projection: "{kind:1}",
  batchSize: 50,
  code: "",
};
test("saves exact query inputs independently of the source connection and survives restart", () => {
  storage.saveQuery({
    id: "q1",
    name: "Pending jobs",
    group: "Ops/Daily",
    description: "Reusable across environments",
    query,
    source: { connectionName: "Dev", database: "app_dev", collection: "jobs" },
  });
  storage.close();
  storage = new Storage(join(directory, "test.sqlite"));
  expect(storage.savedQueries()).toMatchObject([
    { id: "q1", name: "Pending jobs", group: "Ops/Daily", query },
  ]);
  storage.saveQuery({
    ...storage.savedQueries()[0],
    name: "Jobs",
    group: "Review",
  });
  expect(storage.savedQueries()).toMatchObject([
    { id: "q1", name: "Jobs", group: "Review", query },
  ]);
  expect(storage.savedQueries()).toHaveLength(1);
  storage.deleteQuery("q1");
  expect(storage.savedQueries()).toEqual([]);
});
test("rejects empty names and invalid batch sizes without storing an entry", () => {
  expect(() => storage.saveQuery({ id: "bad", name: "  ", query })).toThrow();
  expect(() =>
    storage.saveQuery({
      id: "bad",
      name: "Bad",
      query: { ...query, batchSize: 0 },
    }),
  ).toThrow();
  expect(storage.savedQueries()).toEqual([]);
});
