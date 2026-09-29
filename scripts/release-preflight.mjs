import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const root = resolve(
  argument("--root", fileURLToPath(new URL("..", import.meta.url))),
);
const output = resolve(argument("--output", join(root, "release")));
const platform = argument("--platform", process.platform);
const arch = argument("--arch", process.arch);
const platformName =
  platform === "win32" ? "win" : platform === "darwin" ? "mac" : "linux";
const target = `${platformName}-${arch}`;
const toolTargets = platform === "darwin" ? ["mac-arm64", "mac-x64"] : [target];
const toolExtension = platform === "win32" ? ".exe" : "";
const diagnostics = [];
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );

if (!(await exists(join(root, "package.json"))))
  diagnostics.push("PACKAGE_MISSING");
if (!(await exists(join(root, "pnpm-lock.yaml"))))
  diagnostics.push("LOCKFILE_MISSING");

let toolsVersion = null;
let expectedToolsVersion = null;
try {
  const manifest = JSON.parse(
    await readFile(join(root, "vendor", "tools-manifest.json"), "utf8"),
  );
  expectedToolsVersion = manifest.version;
} catch {
  diagnostics.push("TOOLS_MANIFEST_MISSING");
}

const toolsVersions = {};
for (const toolTarget of toolTargets) {
  const toolsDirectory = join(root, "vendor", "tools", toolTarget);
  const binaries = await Promise.all(
    ["mongodump", "mongorestore"].map((name) =>
      exists(join(toolsDirectory, `${name}${toolExtension}`)),
    ),
  );
  if (binaries.some((present) => !present)) diagnostics.push("TOOLS_MISSING");
  try {
    const staged = JSON.parse(
      await readFile(join(toolsDirectory, "version.json"), "utf8"),
    );
    toolsVersions[toolTarget] = staged.version;
    if (expectedToolsVersion && staged.version !== expectedToolsVersion)
      diagnostics.push("TOOLS_VERSION_MISMATCH");
  } catch {
    if (!diagnostics.includes("TOOLS_MISSING"))
      diagnostics.push("TOOLS_VERSION_MISSING");
  }
}
toolsVersion = toolsVersions[target] || null;

let electronAvailable = false;
try {
  const electronName = (
    await readFile(join(root, "node_modules", "electron", "path.txt"), "utf8")
  ).trim();
  electronAvailable = await exists(
    join(root, "node_modules", "electron", "dist", electronName),
  );
} catch {
  // Missing installation is reported with a stable code below.
}
if (!electronAvailable) diagnostics.push("ELECTRON_MISSING");

let outputWritable = false;
try {
  await mkdir(output, { recursive: true });
  const probe = await mkdtemp(join(output, ".irwin-preflight-"));
  await rm(probe, { recursive: true });
  outputWritable = true;
} catch {
  diagnostics.push("OUTPUT_UNWRITABLE");
}

const result = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  target,
  toolTargets,
  toolsVersions,
  toolsVersion,
  expectedToolsVersion,
  electronAvailable,
  outputWritable,
  signingConfigured: Boolean(
    process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.CSC_NAME,
  ),
  diagnostics,
};

if (process.argv.includes("--json"))
  process.stdout.write(`${JSON.stringify(result)}\n`);
else {
  process.stdout.write(
    `Irwin release preflight: ${diagnostics.length ? "FAILED" : "READY"}\n`,
  );
  for (const code of diagnostics) process.stdout.write(`- ${code}\n`);
}
if (diagnostics.length) process.exitCode = 1;
