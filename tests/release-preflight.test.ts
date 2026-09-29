import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/release-preflight.mjs");
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "irwin-preflight-"));
  roots.push(root);
  mkdirSync(join(root, "vendor"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(root, "vendor/tools-manifest.json"),
    JSON.stringify({ version: "100.18.0" }),
  );
  return root;
}

function run(
  root: string,
  output = join(root, "release"),
  platform?: string,
  arch?: string,
) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--root",
      root,
      "--output",
      output,
      ...(platform ? ["--platform", platform] : []),
      ...(arch ? ["--arch", arch] : []),
      "--json",
    ],
    { encoding: "utf8" },
  );
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("preflight identifies missing Database Tools without leaking environment secrets", () => {
  const root = fixture();
  const result = run(root);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("TOOLS_MISSING");
  expect(result.stdout).not.toContain("CSC_LINK");
});

test("macOS preflight requires both architecture-specific tool bundles", () => {
  const root = fixture();
  for (const target of ["mac-arm64", "mac-x64"]) {
    const tools = join(root, "vendor", "tools", target);
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(tools, "mongodump"), "fixture");
    writeFileSync(join(tools, "mongorestore"), "fixture");
    writeFileSync(
      join(tools, "version.json"),
      JSON.stringify({ version: "100.18.0" }),
    );
  }
  const result = run(root, join(root, "release"), "darwin", "arm64");
  const report = JSON.parse(result.stdout);
  expect(report.target).toBe("mac-arm64");
  expect(report.toolTargets).toEqual(["mac-arm64", "mac-x64"]);
  expect(report.toolsVersions).toEqual({
    "mac-arm64": "100.18.0",
    "mac-x64": "100.18.0",
  });
  expect(report.diagnostics).not.toContain("TOOLS_MISSING");
  expect(report.diagnostics).not.toContain("TOOLS_VERSION_MISSING");
});
