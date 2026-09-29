import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

// These tiny archives contain only disposable text tool/license fixtures.
const archives = {
  zip: "UEsDBBQAAAAAAAAAAAA+OddrEwAAABMAAAAPAAAAdG9vbHMvbW9uZ29kdW1wdGVzdCBkYXRhYmFzZSB0b29sClBLAwQUAAAAAAAAAAAAS4Te9BQAAAAUAAAADQAAAHRvb2xzL0xJQ0VOU0V0ZXN0IGxpY2Vuc2Ugbm90aWNlClBLAQIUABQAAAAAAAAAAAA+OddrEwAAABMAAAAPAAAAAAAAAAAAAAAAAAAAAAB0b29scy9tb25nb2R1bXBQSwECFAAUAAAAAAAAAAAAS4Te9BQAAAAUAAAADQAAAAAAAAAAAAAAAABAAAAAdG9vbHMvTElDRU5TRVBLBQYAAAAAAgACAHgAAAB/AAAAAAA=",
  tgz: "H4sIAAAAAAAACu3UMQ7CMAwF0MycIjfgh1BxANQBCXXhBKGNUKU0RsS9PyILUhamBCT8Flte7OWbiULaLhRvNK3LXdUAAIeuyxVAWYGdffevuTGwVmlUuaawJnYPhSa7fhD7xHpy7K4uec1EYfPtk0RDnPN/Ph374dJX2vE5//si/zDGSP5byPkP8+hj8joSz6OXByCEEH/gCfHW5kgADAAA",
};
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("irwin-tool-archive-")
    )
      throw new Error(
        "Refusing to remove a directory outside the test fixtures",
      );
    await rm(root, { recursive: true, force: true });
  }
});

async function extraction() {
  const result: {
    module?: {
      extractToolArchive: (archive: string, output: string) => Promise<void>;
    };
    cause?: unknown;
  } = await import(
    /* @vite-ignore */ new URL("../scripts/tool-archive.mjs", import.meta.url)
      .href
  ).then(
    (module) => ({ module }),
    (cause) => ({ cause }),
  );
  expect(result, String(result.cause)).toHaveProperty("module");
  return result.module!.extractToolArchive;
}

test.each(["zip", "tgz"] as const)(
  "extracts %s Database Tools archives including their license notices",
  async (extension) => {
    const root = await mkdtemp(join(tmpdir(), "irwin-tool-archive-"));
    roots.push(root);
    const archive = join(root, `fixture.${extension}`);
    const output = join(root, "directory with spaces");
    await writeFile(archive, Buffer.from(archives[extension], "base64"));
    const extractToolArchive = await extraction();
    await extractToolArchive(archive, output);
    expect(await readFile(join(output, "tools/mongodump"), "utf8")).toBe(
      "test database tool\n",
    );
    expect(await readFile(join(output, "tools/LICENSE"), "utf8")).toBe(
      "test license notice\n",
    );
  },
);

test("rejects a corrupt ZIP instead of reporting successful staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "irwin-tool-archive-"));
  roots.push(root);
  const archive = join(root, "corrupt.zip");
  await writeFile(archive, "this is not a ZIP archive");
  const extractToolArchive = await extraction();
  await expect(
    extractToolArchive(archive, join(root, "output")),
  ).rejects.toThrow();
});
