import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import unzipper from "unzipper";

export async function extractToolArchive(archive, destination) {
  const output = resolve(destination);
  await mkdir(output, { recursive: true });
  if (archive.toLowerCase().endsWith(".zip")) {
    const directory = await unzipper.Open.file(archive);
    await directory.extract({ path: output });
    return;
  }
  const result = spawnSync("tar", ["-xf", archive, "-C", output], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Archive extraction failed: ${result.error?.message || result.stderr.trim() || "tar returned a failure"}`,
    );
}
