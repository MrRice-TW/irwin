import { randomUUID } from "node:crypto";
import { open, lstat, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { csvFormulaEscapingSidecar } from "../shared/csv";

function sidecarPath(csvPath: string): string {
  return resolve(csvPath + ".mapping.json");
}

export async function assertCsvSidecarTargetSafe(csvPath: string) {
  const target = sidecarPath(csvPath);
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      throw new Error("Refusing to write through a symbolic link: " + target);
    }
    if (!metadata.isFile()) {
      throw new Error("Refusing to replace a non-file CSV sidecar: " + target);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") return;
    }
    throw error;
  }
}

export async function writeCsvSidecar(csvPath: string, content: string) {
  const target = sidecarPath(csvPath);
  await assertCsvSidecarTargetSafe(csvPath);

  const temporary = resolve(
    dirname(target),
    "." + basename(target) + "." + randomUUID() + ".tmp",
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  try {
    await assertCsvSidecarTargetSafe(csvPath);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeCsvFormulaSidecar(csvPath: string) {
  await writeCsvSidecar(csvPath, csvFormulaEscapingSidecar());
}
