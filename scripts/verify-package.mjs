import { access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile } from "@electron/asar";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const root = resolve(
  option("--root", fileURLToPath(new URL("..", import.meta.url))),
);
const platform = option("--platform", process.platform);
const unpacked = resolve(
  option(
    "--unpacked",
    join(
      root,
      "release",
      platform === "win32"
        ? "win-unpacked"
        : platform === "darwin"
          ? "mac/Irwin.app"
          : "linux-unpacked",
    ),
  ),
);
const resources =
  platform === "darwin"
    ? join(unpacked, "Contents", "Resources")
    : join(unpacked, "resources");
const executable =
  platform === "darwin"
    ? join(unpacked, "Contents", "MacOS", "Irwin")
    : join(unpacked, platform === "win32" ? "Irwin.exe" : "irwin");
const archive = join(resources, "app.asar");
const tools = join(resources, "tools");
const diagnostics = [];
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
let version = null;
let embeddedVersion = null;
let toolsVersion = null;
let expectedToolsVersion = null;
let packageMetadata = null;

try {
  packageMetadata = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  version = packageMetadata.version;
} catch {
  diagnostics.push("PACKAGE_VERSION_MISSING");
}
try {
  expectedToolsVersion = JSON.parse(
    await readFile(join(root, "vendor/tools-manifest.json"), "utf8"),
  ).version;
} catch {
  diagnostics.push("TOOLS_MANIFEST_MISSING");
}
if (!(await exists(executable))) diagnostics.push("APP_BINARY_MISSING");
if (!(await exists(archive))) diagnostics.push("ASAR_MISSING");
else {
  try {
    const embedded = JSON.parse(
      extractFile(archive, "package.json").toString(),
    );
    embeddedVersion = embedded.version;
    if (version && embeddedVersion !== version)
      diagnostics.push("VERSION_MISMATCH");
    const normalizeDependencies = (dependencies = {}) =>
      JSON.stringify(
        Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
      );
    if (
      packageMetadata &&
      normalizeDependencies(embedded.dependencies) !==
        normalizeDependencies(packageMetadata.dependencies)
    )
      diagnostics.push("APP_DEPENDENCIES_MISMATCH");
    for (const path of [
      embedded.main || "dist/main.cjs",
      "dist/renderer/index.html",
    ])
      try {
        extractFile(archive, join(...path.split(/[\\/]/)));
      } catch {
        diagnostics.push("STARTUP_FILE_MISSING");
      }
    try {
      const expectedLicense = await readFile(join(root, "LICENSE"));
      if (!extractFile(archive, "LICENSE").equals(expectedLicense))
        diagnostics.push("LICENSE_MISMATCH");
    } catch {
      diagnostics.push("LICENSE_MISSING");
    }
  } catch {
    diagnostics.push("APP_PACKAGE_INVALID");
  }
}
for (const name of ["mongodump", "mongorestore"])
  if (
    !(await exists(join(tools, `${name}${platform === "win32" ? ".exe" : ""}`)))
  )
    diagnostics.push("TOOLS_MISSING");
const thirdPartyLicenses = join(resources, "third-party-licenses");
if (!(await exists(join(thirdPartyLicenses, "THIRD_PARTY_NOTICES.md"))))
  diagnostics.push("THIRD_PARTY_NOTICES_MISSING");
try {
  const review = await readFile(
    join(thirdPartyLicenses, "license-review.txt"),
    "utf8",
  );
  if (/^Review required for [1-9]\d* /m.test(review))
    diagnostics.push("LICENSES_PENDING_REVIEW");
} catch {
  diagnostics.push("LICENSE_REVIEW_MISSING");
}
try {
  toolsVersion = JSON.parse(
    await readFile(join(tools, "version.json"), "utf8"),
  ).version;
  if (expectedToolsVersion && toolsVersion !== expectedToolsVersion)
    diagnostics.push("TOOLS_VERSION_MISMATCH");
} catch {
  diagnostics.push("TOOLS_VERSION_MISSING");
}
const result = {
  platform,
  unpacked,
  version,
  embeddedVersion,
  toolsVersion,
  expectedToolsVersion,
  diagnostics: [...new Set(diagnostics)],
};
if (process.argv.includes("--json"))
  process.stdout.write(`${JSON.stringify(result)}\n`);
else {
  process.stdout.write(
    `Irwin package verification: ${result.diagnostics.length ? "FAILED" : "PASSED"}\n`,
  );
  for (const code of result.diagnostics) process.stdout.write(`- ${code}\n`);
}
if (result.diagnostics.length) process.exitCode = 1;
