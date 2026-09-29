import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/release-manifest.mjs");
const roots: string[] = [];
const commit = "0123456789abcdef0123456789abcdef01234567";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "irwin-manifest-"));
  roots.push(root);
  mkdirSync(join(root, "vendor"), { recursive: true });
  mkdirSync(join(root, "release"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  writeFileSync(
    join(root, "vendor/tools-manifest.json"),
    JSON.stringify({ version: "100.18.0" }),
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("release manifest hashes the exact installer bytes and records provenance", () => {
  const root = fixture();
  writeFileSync(join(root, "release/Irwin-0.1.0-win-x64.exe"), "abc");
  writeFileSync(
    join(root, "release/Irwin-0.1.0-win-x64.exe.blockmap"),
    "builder blockmap",
  );
  const result = spawnSync(
    process.execPath,
    [script, "--root", root, "--commit", commit],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  const manifest = JSON.parse(
    readFileSync(join(root, "release/release-manifest.json"), "utf8"),
  );
  expect(manifest).toMatchObject({
    version: "0.1.0",
    commit,
    databaseToolsVersion: "100.18.0",
    artifacts: [
      {
        file: "Irwin-0.1.0-win-x64.exe",
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        bytes: 3,
        platform: "win",
        arch: "x64",
      },
    ],
  });
});

test("rejects an unknown Irwin release artifact instead of skipping it", () => {
  const root = fixture();
  writeFileSync(join(root, "release/Irwin-0.1.0-win-x64.exe"), "abc");
  writeFileSync(join(root, "release/Irwin-0.1.0-win-x64.exe.sig"), "signature");
  const result = spawnSync(
    process.execPath,
    [script, "--root", root, "--commit", commit],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unexpected release artifact name");
});
