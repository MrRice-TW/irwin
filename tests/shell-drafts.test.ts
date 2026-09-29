import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Uint8Array) => Buffer.from(value).toString("utf8"),
  },
}));

import { Storage } from "../src/main/storage";
import { shellDraftSchema } from "../src/shared/contracts";

let directory = "";
let storage: Storage;

beforeEach(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "shell-draft-test-"));
  storage = new Storage(join(directory, "workbench.sqlite"));
});

afterEach(async () => {
  storage?.close();
  if (directory.startsWith(resolve(".runtime")))
    await rm(directory, { recursive: true, force: true });
});

describe("Shell drafts", () => {
  test("retains workspace panel dimensions but discards open tabs across restart", () => {
    storage.saveWorkspace({
      version: 1,
      active: "tab",
      sidebarWidth: 280,
      jobsHeight: 220,
      historyHeight: 260,
      tabs: [
        {
          id: "tab",
          connectionId: "connection-1",
          connectionName: "Dev",
          database: "app",
          collection: "orders",
          kind: "collection",
          state: {
            filter: '{kind:"async"}',
            sort: "{}",
            projection: "{}",
            limit: 1000,
            batchSize: 100,
            view: "tree",
            code: "",
            freeMode: false,
            outputHeight: 180,
          },
          rows: ["never persist document values"],
        },
      ],
    } as any);
    storage.saveTableLayout("connection-1/app/orders", {
      widths: { kind: 88 },
      order: ["kind"],
      hidden: [],
      pinned: ["kind"],
      expanded: [],
      remember: true,
    });
    storage.close();
    storage = new Storage(join(directory, "workbench.sqlite"));
    expect(storage.workspace()).toMatchObject({
      version: 1,
      sidebarWidth: 280,
      jobsHeight: 220,
      historyHeight: 260,
    });
    expect(storage.workspace()).not.toHaveProperty("active");
    expect(storage.workspace()).not.toHaveProperty("tabs");
    expect(storage.tableLayout("connection-1/app/orders")?.pinned).toEqual([
      "kind",
    ]);
  });
  test("reusable transfers preserve mappings but reset path grants and overwrite confirmation", () => {
    storage.saveTransferPreset({
      id: "preset",
      name: "Weekly import",
      input: {
        connectionId: "a",
        database: "shop",
        collection: "items",
        direction: "import",
        format: "csv",
        path: "C:/private/data.csv",
        confirmation: "items",
        drop: true,
        csvColumns: [
          { source: "SKU", target: "sku", type: "string", empty: "omit" },
        ],
      },
    });
    const input = storage.transferPresets()[0].input;
    expect(input.path).toBe("");
    expect(input.confirmation).toBe("");
    expect(input.drop).toBe(false);
    expect(input.csvColumns[0]).toMatchObject({ source: "SKU", target: "sku" });
    storage.deleteTransferPreset("preset");
    expect(storage.transferPresets()).toEqual([]);
  });
  test("persists a draft across storage restart and supports explicit discard", () => {
    const draft = shellDraftSchema.parse({
      id: "draft-1",
      connectionId: "connection-1",
      database: "app",
      collection: "",
      code: "const pending = await db.orders.findOne();",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });

    storage.saveShellDraft(draft);
    expect(storage.shellDrafts()).toEqual([draft]);

    storage.close();
    storage = new Storage(join(directory, "workbench.sqlite"));
    expect(storage.shellDrafts()).toEqual([draft]);

    storage.deleteShellDraft(draft.id);
    expect(storage.shellDrafts()).toEqual([]);
  });
});
