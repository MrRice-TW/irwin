import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransferService, readDocuments } from "../src/core/transfers";
import { writeCsvFormulaSidecar } from "../src/core/csv-sidecar";
import { csvContent } from "../src/renderer/helpers";

let directory = "";

afterEach(async () => {
  if (!directory) return;
  await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("query-result CSV round trip", () => {
  it("restores escaped headers and text from the app sidecar", async () => {
    directory = await mkdtemp(join(tmpdir(), "irwin-csv-roundtrip-"));
    const path = join(directory, "query-results.csv");
    const expected = {
      "=header": "=1+1",
      leadingSpace: " =2+2",
      lineFeed: "\n=3+3",
      originalApostrophe: "'=4+4",
    };
    await writeFile(path, csvContent([{ ejson: JSON.stringify(expected) }]));
    await writeCsvFormulaSidecar(path);
    await writeCsvFormulaSidecar(path);

    const transfers = new TransferService({} as never, () => {});
    const preview = await transfers.preview(path);
    expect(preview.columns).toEqual(Object.keys(expected));
    expect(preview.rows[0]).toEqual(expected);
    expect(preview.mapping).toBeUndefined();

    const imported = [];
    for await (const document of readDocuments(
      path,
      "csv",
      [],
      undefined,
      undefined,
      "apostrophe-v1",
    )) {
      imported.push(document);
    }
    expect(imported).toEqual([expected]);
  });

  it("rejects a symlink sidecar without changing its target", async ({
    skip,
  }) => {
    directory = await mkdtemp(join(tmpdir(), "irwin-csv-sidecar-"));
    const path = join(directory, "query-results.csv");
    const target = join(directory, "outside");
    const sidecar = join(directory, "query-results.csv.mapping.json");
    await mkdir(target);
    await writeFile(join(target, "keep.json"), "keep this file\n");
    try {
      await symlink(
        target,
        sidecar,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      skip("This platform does not allow creating a symlink fixture.");
    }

    await expect(writeCsvFormulaSidecar(path)).rejects.toThrow(
      "Refusing to write through a symbolic link",
    );
    expect(await readFile(join(target, "keep.json"), "utf8")).toBe(
      "keep this file\n",
    );
  });

  it("replaces a linked sidecar without changing the linked file", async () => {
    directory = await mkdtemp(join(tmpdir(), "irwin-csv-hardlink-"));
    const path = join(directory, "query-results.csv");
    const target = join(directory, "external.json");
    const sidecar = join(directory, "query-results.csv.mapping.json");
    await writeFile(target, "keep this file\n");
    await link(target, sidecar);

    await writeCsvFormulaSidecar(path);

    expect(await readFile(target, "utf8")).toBe("keep this file\n");
    expect(JSON.parse(await readFile(sidecar, "utf8"))).toMatchObject({
      version: 2,
      columns: [],
      formulaEscaping: "apostrophe-v1",
    });
  });
});
