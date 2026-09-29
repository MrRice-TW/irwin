import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("every installed production dependency can ship its license identity and notices", async () => {
  const root = resolve(import.meta.dirname, "..");
  const pnpmCli = process.env.npm_execpath;
  expect(pnpmCli, "Run the suite with pnpm test").toBeTruthy();
  const tree = JSON.parse(
    execFileSync(
      process.execPath,
      [pnpmCli!, "list", "--prod", "--depth", "Infinity", "--json"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    ),
  );
  const { generateThirdPartyNotices } = await import(
    /* @vite-ignore */ new URL(
      "../scripts/third-party-notices.mjs",
      import.meta.url,
    ).href
  );
  generateThirdPartyNotices({
    root,
    packageJson: JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ),
    tree,
  });
  const review = readFileSync(
    resolve(root, "build/third-party-licenses/license-review.txt"),
    "utf8",
  );
  expect(review).toContain(
    "All installed production packages have a verified license identity and included license or notice text.",
  );
  expect(review).not.toMatch(/^Review required/m);
});
