import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { Storage } from "../src/main/storage";

let directory: string;
let storage: Storage;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "saved-pipeline-test-"));
  path = join(directory, "test.sqlite");
  storage = new Storage(path);
});
afterEach(async () => {
  storage.close();
  await rm(directory, { recursive: true, force: true });
});
const value = {
  id: "pipeline-1",
  name: "Team count",
  group: "Reports",
  description: "Reusable in another connection",
  source: {
    connectionName: "Development",
    database: "app",
    collection: "people",
  },
  stages: [
    { id: "a", enabled: true, text: '{ "$match": { "active": true } }' },
    { id: "b", enabled: false, text: '{ "$group": { "_id": "$team" } }' },
  ],
  updatedAt: "2026-09-23T00:00:00.000Z",
};

test("saves, renames, and deletes ordered stages without binding the target", () => {
  storage.savePipeline(value);
  storage.close();
  storage = new Storage(path);
  expect(storage.savedPipelines()).toMatchObject([value]);
  storage.savePipeline({ ...value, name: "Teams" });
  expect(storage.savedPipelines()).toHaveLength(1);
  expect(storage.savedPipelines()[0].name).toBe("Teams");
  storage.deletePipeline(value.id);
  expect(storage.savedPipelines()).toEqual([]);
});

test("migration from v4 retains existing saved queries", () => {
  storage.saveQuery({
    id: "q",
    name: "Old query",
    query: {
      mode: "find",
      filter: "{}",
      sort: "{}",
      projection: "{}",
      limit: 0,
      batchSize: 100,
      code: "",
    },
  });
  storage.close();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version=4");
  db.close();
  storage = new Storage(path);
  storage.close();
  const reopened = new DatabaseSync(path);
  try {
    expect(reopened.prepare("PRAGMA user_version").get()?.user_version).toBe(6);
  } finally {
    reopened.close();
  }
  storage = new Storage(path);
  expect(storage.savedQueries()[0].name).toBe("Old query");
  storage.savePipeline(value);
  expect(storage.savedPipelines()).toHaveLength(1);
});

test("rejects a write pipeline before saving", () => {
  expect(() =>
    storage.savePipeline({
      ...value,
      stages: [{ id: "bad", enabled: true, text: '{ "$out": "x" }' }],
    }),
  ).toThrow(/not approved/i);
  expect(storage.savedPipelines()).toEqual([]);
});
