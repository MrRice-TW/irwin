import {
  readFile,
  mkdir,
  readdir,
  copyFile,
  chmod,
  writeFile,
} from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { extractToolArchive } from "./tool-archive.mjs";
const manifest = JSON.parse(
  await readFile(
    new URL("../vendor/tools-manifest.json", import.meta.url),
    "utf8",
  ),
);
const current = `${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"}-${process.arch}`;
const targets = process.argv.includes("--all")
  ? Object.keys(manifest.targets)
  : [process.argv[2] || current];
for (const target of targets) {
  const record = manifest.targets[target];
  if (!record) throw new Error("Unsupported tool target");
  const cache = resolve(".runtime/tools", target);
  const destination = resolve("vendor/tools", target);
  await mkdir(cache, { recursive: true });
  await mkdir(destination, { recursive: true });
  const archive = join(cache, record.url.split("/").pop());
  try {
    await readFile(archive);
  } catch {
    const response = await fetch(record.url);
    if (!response.ok || !response.body)
      throw new Error(`Download failed: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== record.sha256)
    throw new Error("Database Tools SHA-256 mismatch");
  const extracted = join(cache, "unpacked");
  await extractToolArchive(archive, extracted);
  async function collect(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await collect(path);
      else if (
        /^(mongodump|mongorestore)(\.exe)?$/.test(item.name) ||
        /license|notice|readme/i.test(item.name)
      ) {
        await copyFile(path, join(destination, item.name));
        if (!target.startsWith("win"))
          await chmod(join(destination, item.name), 0o755);
      }
    }
  }
  await collect(extracted);
  await writeFile(
    join(destination, "version.json"),
    JSON.stringify({ version: manifest.version, ...record }, null, 2),
  );
  console.log(
    `Verified and staged ${target} Database Tools ${manifest.version}`,
  );
}
