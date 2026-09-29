import { access, readFile } from "node:fs/promises";
const target = `${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"}-${process.arch}`;
const targets =
  process.platform === "darwin" ? ["mac-arm64", "mac-x64"] : [target];
const ext = process.platform === "win32" ? ".exe" : "";
const expected = JSON.parse(
  await readFile("vendor/tools-manifest.json", "utf8"),
);
for (const targetName of targets) {
  for (const tool of ["mongodump", "mongorestore"])
    await access(`vendor/tools/${targetName}/${tool}${ext}`).catch(() => {
      throw new Error(
        `Run pnpm tools:fetch${targets.length > 1 ? " --all" : ""} before packaging (${targetName} is missing).`,
      );
    });
  const actual = JSON.parse(
    await readFile(`vendor/tools/${targetName}/version.json`, "utf8"),
  );
  if (actual.version !== expected.version)
    throw new Error(
      `Bundled Database Tools version mismatch for ${targetName}`,
    );
}
