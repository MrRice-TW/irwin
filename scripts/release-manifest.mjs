import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const root = resolve(
  argument("--root", fileURLToPath(new URL("..", import.meta.url))),
);
const directory = resolve(argument("--directory", join(root, "release")));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const tools = JSON.parse(
  await readFile(join(root, "vendor", "tools-manifest.json"), "utf8"),
);
const git = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
const commit = argument("--commit", process.env.GITHUB_SHA || git.stdout.trim());
if (!/^[a-f0-9]{40}$/i.test(commit))
  throw new Error("Release manifest requires a 40-character git commit SHA");

const artifacts = [];
const artifactPattern =
  /^Irwin-(.+)-(win|linux|mac)-(x64|arm64)\.(exe|deb|dmg)$/;
for (const file of await readdir(directory)) {
  if (!file.startsWith("Irwin-")) continue;
  if (/^Irwin-.+-(?:win|linux|mac)-(?:x64|arm64)\.(?:exe|deb|dmg)\.blockmap$/.test(file))
    continue;
  const match = artifactPattern.exec(file);
  if (!match) throw new Error(`Unexpected release artifact name: ${file}`);
  const [, version, platform, arch, extension] = match;
  const expectedExtension = { win: "exe", linux: "deb", mac: "dmg" }[platform];
  if (version !== pkg.version || extension !== expectedExtension)
    throw new Error(`Release artifact does not match package version or platform: ${file}`);
  const path = join(directory, file);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  artifacts.push({
    file,
    sha256: hash.digest("hex"),
    bytes: (await stat(path)).size,
    platform,
    arch,
  });
}
if (!artifacts.length) throw new Error("No Irwin installer artifacts found");
artifacts.sort((a, b) => a.file.localeCompare(b.file));
const manifest = {
  version: pkg.version,
  commit: commit.toLowerCase(),
  nodeVersion: process.version,
  databaseToolsVersion: tools.version,
  builtAt: new Date().toISOString(),
  artifacts,
};
await writeFile(
  join(directory, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "w" },
);
process.stdout.write(`Recorded ${artifacts.length} Irwin artifact(s)\n`);
