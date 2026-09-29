import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createPackage } from "@electron/asar";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(options: {
  includeAppLicense?: boolean;
  embeddedDependencies?: Record<string, string>;
} = {}) {
  const root = await mkdtemp(join(resolve(".runtime"), "verify-package-test-"));
  directories.push(root);
  const unpacked = join(root, "win-unpacked");
  const source = join(root, "app-source");
  await mkdir(join(root, "vendor"), { recursive: true });
  await mkdir(join(root, "build", "third-party-licenses"), {
    recursive: true,
  });
  await mkdir(join(source, "dist", "renderer"), { recursive: true });
  await mkdir(join(unpacked, "resources", "tools"), { recursive: true });
  await mkdir(join(unpacked, "resources", "third-party-licenses"), {
    recursive: true,
  });
  await writeFile(join(root, "LICENSE"), "MIT license text\n");
  await writeFile(
    join(root, "build", "third-party-licenses", "THIRD_PARTY_NOTICES.md"),
    "Third-party notices\n",
  );
  await writeFile(
    join(unpacked, "resources", "third-party-licenses", "THIRD_PARTY_NOTICES.md"),
    "Third-party notices\n",
  );
  await writeFile(
    join(unpacked, "resources", "third-party-licenses", "license-review.txt"),
    "All installed production packages declare a license and ship a license or notice text file.\n",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      version: "0.1.0",
      dependencies: { exceljs: "4.4.0", "stream-json": "^3.7.0" },
    }),
  );
  await writeFile(
    join(root, "vendor", "tools-manifest.json"),
    JSON.stringify({ version: "100.18.0" }),
  );
  const embeddedPackage = {
    version: "0.1.0",
    main: "dist/main.cjs",
    dependencies: options.embeddedDependencies ?? {
      exceljs: "4.4.0",
      "stream-json": "^3.7.0",
    },
  };
  if (options.includeAppLicense !== false)
    await writeFile(join(source, "LICENSE"), "MIT license text\n");
  await writeFile(
    join(source, "package.json"),
    JSON.stringify(embeddedPackage),
  );
  await writeFile(join(source, "dist", "main.cjs"), "module.exports = {};\n");
  await writeFile(
    join(source, "dist", "renderer", "index.html"),
    "<html></html>",
  );
  await createPackage(source, join(unpacked, "resources", "app.asar"));
  await writeFile(join(unpacked, "Irwin.exe"), "exe");
  for (const name of ["mongodump.exe", "mongorestore.exe"])
    await writeFile(join(unpacked, "resources", "tools", name), "exe");
  await writeFile(
    join(unpacked, "resources", "tools", "version.json"),
    JSON.stringify({ version: "100.18.0" }),
  );
  return { root, unpacked };
}
function verify(root: string, unpacked: string) {
  return execFileSync(
    process.execPath,
    [
      "scripts/verify-package.mjs",
      "--root",
      root,
      "--unpacked",
      unpacked,
      "--platform",
      "win32",
      "--json",
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
    },
  );
}

test("verifies embedded app version, startup files, and Database Tools", async () => {
  const { root, unpacked } = await fixture();
  expect(JSON.parse(verify(root, unpacked))).toMatchObject({
    version: "0.1.0",
    embeddedVersion: "0.1.0",
    toolsVersion: "100.18.0",
    diagnostics: [],
  });
});

test("rejects mismatched embedded version", async () => {
  const { root, unpacked } = await fixture();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: "0.2.0" }),
  );
  expect(() => verify(root, unpacked)).toThrow();
});

test("rejects missing tool binary", async () => {
  const { root, unpacked } = await fixture();
  await rm(join(unpacked, "resources", "tools", "mongorestore.exe"));
  expect(() => verify(root, unpacked)).toThrow();
});

test("rejects an app archive that omits Irwin's MIT license", async () => {
  const { root, unpacked } = await fixture({ includeAppLicense: false });
  expect(() => verify(root, unpacked)).toThrow();
});

test("rejects a candidate built from older production dependencies", async () => {
  const { root, unpacked } = await fixture({
    embeddedDependencies: { xlsx: "0.18.5", "stream-json": "^1.9.1" },
  });
  expect(() => verify(root, unpacked)).toThrow();
});

test("rejects a package whose third-party license review is unresolved", async () => {
  const { root, unpacked } = await fixture();
  await writeFile(
    join(unpacked, "resources", "third-party-licenses", "license-review.txt"),
    "Review required for 1 package:\n- unverified package\n",
  );
  expect(() => verify(root, unpacked)).toThrow();
});

test("rejects a package without its third-party notices", async () => {
  const { root, unpacked } = await fixture();
  await rm(
    join(unpacked, "resources", "third-party-licenses", "THIRD_PARTY_NOTICES.md"),
  );
  expect(() => verify(root, unpacked)).toThrow();
});
