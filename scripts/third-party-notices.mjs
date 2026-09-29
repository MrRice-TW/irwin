import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function isChildPath(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function existingPath(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function safeSegment(value, maxLength) {
  return (
    String(value)
      .replaceAll("/", "__")
      .replaceAll("\\", "__")
      .replace(/[^a-zA-Z0-9._@+-]/g, "_")
      .slice(0, maxLength) || "unknown"
  );
}

function packageDirectory(name, version) {
  const key = `${name}@${version}`;
  const label = `${safeSegment(name, 52)}@${safeSegment(version, 28)}`;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `${label}-${digest}`;
}

function safeFileName(value) {
  let name = basename(String(value))
    .replace(/[^a-zA-Z0-9._+-]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  if (!name || name === "." || name === "..") name = "LICENSE";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    name = `_${name}`;
  }
  return name;
}

function safeMarkdownCell(value) {
  return String(value)
    .replace(/[\r\n\t]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;");
}

function safeLogLine(value) {
  return String(value).replace(/[\r\n\t]/g, " ");
}

function licenseFileWithin(packageRoot, sourcePath) {
  const resolvedSource = resolve(packageRoot, sourcePath);
  if (!isChildPath(packageRoot, resolvedSource)) return undefined;
  try {
    const realSource = realpathSync(resolvedSource);
    if (!isChildPath(packageRoot, realSource)) return undefined;
    if (!statSync(realSource).isFile()) return undefined;
    return realSource;
  } catch {
    return undefined;
  }
}

function readEvidenceManifest(repositoryRoot) {
  const directory = resolve(repositoryRoot, "vendor", "license-evidence");
  const path = resolve(directory, "manifest.json");
  if (!existsSync(path)) return { directory, packages: {} };
  if (!isChildPath(repositoryRoot, realpathSync(directory))) {
    throw new Error(
      "Refusing to read license evidence outside the repository.",
    );
  }
  if (!isChildPath(directory, realpathSync(path))) {
    throw new Error("Refusing to read an external license evidence manifest.");
  }
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    !manifest.packages ||
    typeof manifest.packages !== "object" ||
    Array.isArray(manifest.packages)
  ) {
    throw new Error("Invalid license evidence manifest.");
  }
  return { directory, packages: manifest.packages };
}

function pinnedEvidence(record, roots, key, label, warnings) {
  if (!record) return undefined;
  if (
    (record.source !== "package" && record.source !== "vendor") ||
    typeof record.path !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    typeof record.sourceUrl !== "string" ||
    !record.sourceUrl.startsWith("https://")
  ) {
    throw new Error(`Invalid license evidence for ${safeLogLine(key)}.`);
  }
  const sourceRoot =
    record.source === "package" ? roots.packageRoot : roots.evidenceRoot;
  const source = licenseFileWithin(sourceRoot, record.path);
  if (!source) {
    warnings.push(
      `${safeLogLine(key)}: ${label} evidence file missing or outside its source`,
    );
    return undefined;
  }
  const actualHash = createHash("sha256")
    .update(readFileSync(source))
    .digest("hex");
  if (actualHash !== record.sha256) {
    warnings.push(`${safeLogLine(key)}: ${label} evidence hash mismatch`);
    return undefined;
  }
  return {
    source,
    name: safeFileName(record.path),
    sourceUrl: record.sourceUrl,
    sha256: actualHash,
  };
}

export function generateThirdPartyNotices({ root, packageJson, tree }) {
  const repositoryRoot = realpathSync(root);
  const evidence = readEvidenceManifest(repositoryRoot);
  const buildDirectory = resolve(repositoryRoot, "build");
  if (!isChildPath(repositoryRoot, buildDirectory)) {
    throw new Error(
      `Refusing to write outside the repository: ${buildDirectory}`,
    );
  }

  const buildStats = existingPath(buildDirectory);
  if (
    buildStats?.isSymbolicLink() ||
    (buildStats && !buildStats.isDirectory())
  ) {
    throw new Error(
      `Refusing to use a non-directory build path: ${buildDirectory}`,
    );
  }
  if (!buildStats) mkdirSync(buildDirectory);
  if (!isChildPath(repositoryRoot, realpathSync(buildDirectory))) {
    throw new Error(
      `Refusing to use a build directory outside the repository.`,
    );
  }

  const output = resolve(buildDirectory, "third-party-licenses");
  if (!isChildPath(buildDirectory, output)) {
    throw new Error(
      `Refusing to write license files outside build/: ${output}`,
    );
  }
  const outputStats = existingPath(output);
  if (
    outputStats?.isSymbolicLink() ||
    (outputStats && !outputStats.isDirectory())
  ) {
    throw new Error(
      `Refusing to replace a non-directory license output: ${output}`,
    );
  }
  if (outputStats) rmSync(output, { recursive: true, force: true });
  mkdirSync(output);
  const packageOutput = resolve(output, "packages");
  if (!isChildPath(output, packageOutput)) {
    throw new Error(
      `Refusing to write package licenses outside the output directory.`,
    );
  }
  mkdirSync(packageOutput);

  const nodeModulesRoot = realpathSync(resolve(repositoryRoot, "node_modules"));
  if (!isChildPath(repositoryRoot, nodeModulesRoot)) {
    throw new Error(`Refusing to read dependencies outside node_modules/.`);
  }

  const packages = new Map();
  const uninstalled = new Set();
  function visitDependencies(dependencies = {}) {
    if (!dependencies || typeof dependencies !== "object") return;
    for (const dependency of Object.values(dependencies)) {
      if (!dependency || typeof dependency !== "object") continue;
      const packagePath =
        typeof dependency.path === "string" ? dependency.path : "";
      if (packagePath) {
        const resolvedPackageRoot = resolve(repositoryRoot, packagePath);
        if (!existsSync(resolvedPackageRoot)) {
          uninstalled.add(
            safeLogLine(
              `${dependency.from || "unknown"}@${dependency.version || "unknown"}`,
            ),
          );
        } else {
          const realPackageRoot = realpathSync(resolvedPackageRoot);
          if (!isChildPath(nodeModulesRoot, realPackageRoot)) {
            throw new Error(
              `Refusing to read dependency outside node_modules/: ${resolvedPackageRoot}`,
            );
          }
          const metadataPath = resolve(realPackageRoot, "package.json");
          const realMetadataPath = realpathSync(metadataPath);
          if (!isChildPath(realPackageRoot, realMetadataPath)) {
            throw new Error(
              `Refusing to read package metadata outside its package: ${metadataPath}`,
            );
          }
          try {
            const metadata = JSON.parse(readFileSync(realMetadataPath, "utf8"));
            if (
              !metadata ||
              typeof metadata.name !== "string" ||
              !metadata.name ||
              typeof metadata.version !== "string" ||
              !metadata.version
            ) {
              throw new Error("Package name and version must be strings.");
            }
            packages.set(`${metadata.name}@${metadata.version}`, {
              metadata,
              packageRoot: realPackageRoot,
            });
          } catch (error) {
            throw new Error(
              `Could not read installed dependency metadata: ${metadataPath}`,
              { cause: error },
            );
          }
        }
      }
      visitDependencies(dependency.dependencies);
    }
  }

  for (const project of Array.isArray(tree) ? tree : [tree]) {
    visitDependencies(project?.dependencies);
  }

  const markdown = [
    "# Production dependency licenses and notices",
    "",
    `Generated for ${safeMarkdownCell(packageJson.name)}@${safeMarkdownCell(packageJson.version)} from the installed production dependency tree. Do not edit by hand; run pnpm release:licenses after a frozen install.`,
    "",
    `Packages: ${packages.size}. Package-supplied or pinned upstream license and notice files are copied under packages/. Missing license identity or text needs maintainer review.`,
    `Packages absent from this platform's installation and therefore omitted: ${uninstalled.size}. These are commonly optional platform packages; verify this list when reviewing each target build.`,
    "",
    "| Package | Version | License | Included files | Additional evidence |",
    "| --- | --- | --- | --- | --- |",
  ];
  const warnings = [];
  for (const [key, entry] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const { metadata, packageRoot } = entry;
    const evidenceRecord = evidence.packages[key];
    const evidenceRoots = { packageRoot, evidenceRoot: evidence.directory };
    const directory = packageDirectory(metadata.name, metadata.version);
    const destination = resolve(packageOutput, directory);
    if (!isChildPath(packageOutput, destination)) {
      throw new Error(
        `Refusing to write package licenses outside packages/: ${destination}`,
      );
    }
    const licenseEntries = [];
    for (const item of readdirSync(packageRoot, { withFileTypes: true })) {
      if (
        !/(?:^|[-.])(?:LICEN[CS]ES?|NOTICE|COPYING|PATENTS)(?:[.-].*)?$/i.test(
          item.name,
        ) ||
        !item.isFile()
      ) {
        continue;
      }
      const source = licenseFileWithin(packageRoot, item.name);
      if (source)
        licenseEntries.push({ source, name: safeFileName(item.name) });
    }

    if (typeof metadata.licenseFile === "string") {
      const source = licenseFileWithin(packageRoot, metadata.licenseFile);
      if (source && !licenseEntries.some((item) => item.source === source)) {
        licenseEntries.push({
          source,
          name: safeFileName(metadata.licenseFile),
        });
      }
    }

    const evidenceSources = [];
    if (evidenceRecord?.notice) {
      const notice = pinnedEvidence(
        evidenceRecord.notice,
        evidenceRoots,
        key,
        "notice",
        warnings,
      );
      if (notice) {
        if (!licenseEntries.some((item) => item.source === notice.source)) {
          licenseEntries.push({ source: notice.source, name: notice.name });
        }
        evidenceSources.push(notice);
      }
    }

    const declaredLicenses = metadata.license ?? metadata.licenses;
    const licenseParts = (
      Array.isArray(declaredLicenses) ? declaredLicenses : [declaredLicenses]
    )
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof entry?.type === "string"
            ? entry.type
            : typeof entry?.name === "string"
              ? entry.name
              : "",
      )
      .filter(Boolean);
    if (licenseParts.length === 0 && evidenceRecord?.declaredLicense) {
      if (
        typeof evidenceRecord.declaredLicense !== "string" ||
        !evidenceRecord.licenseProof
      ) {
        throw new Error(
          `Missing pinned license proof for ${safeLogLine(key)}.`,
        );
      }
      const proof = pinnedEvidence(
        evidenceRecord.licenseProof,
        evidenceRoots,
        key,
        "license",
        warnings,
      );
      if (proof) {
        licenseParts.push(evidenceRecord.declaredLicense);
        evidenceSources.push(proof);
      }
    }
    const license = licenseParts.length
      ? licenseParts.join(" OR ")
      : "MISSING LICENSE METADATA";
    if (licenseParts.length === 0)
      warnings.push(`${safeLogLine(key)}: no license metadata`);
    if (licenseEntries.length === 0)
      warnings.push(`${safeLogLine(key)}: no license or notice text shipped`);

    let included = "none found";
    if (licenseEntries.length > 0) {
      mkdirSync(destination, { recursive: true });
      const copied = [];
      const usedNames = new Set();
      for (const file of licenseEntries) {
        let name = file.name;
        let suffix = 2;
        while (usedNames.has(name.toLowerCase())) {
          name = `${file.name}-${suffix++}`;
        }
        usedNames.add(name.toLowerCase());
        const destinationFile = resolve(destination, name);
        if (!isChildPath(destination, destinationFile)) {
          throw new Error(
            `Refusing to copy a license outside its package folder.`,
          );
        }
        copyFileSync(file.source, destinationFile);
        copied.push(`packages/${directory}/${name}`);
      }
      included = copied.map((path) => `\`${path}\``).join(", ");
    }
    markdown.push(
      `| ${safeMarkdownCell(metadata.name)} | ${safeMarkdownCell(metadata.version)} | ${safeMarkdownCell(license)} | ${included} | ${evidenceSources.length ? evidenceSources.map((item) => `${safeMarkdownCell(item.sourceUrl)} (SHA-256 ${item.sha256})`).join("; ") : "—"} |`,
    );
  }

  const reviewPackageCount = new Set(
    warnings.map((warning) => warning.split(": ")[0]),
  ).size;

  markdown.push(
    "",
    "## Bundled runtime and tool notices",
    "",
    "Electron and Chromium carry their own runtime notices in the packaged Electron distribution. MongoDB Database Tools notices are shipped beside the downloaded tools in `resources/tools`. See the source repository's `THIRD_PARTY_NOTICES.md` for their provenance.",
    "",
  );

  writeFileSync(resolve(output, "THIRD_PARTY_NOTICES.md"), markdown.join("\n"));
  writeFileSync(
    resolve(output, "license-review.txt"),
    [
      warnings.length
        ? `Review required for ${reviewPackageCount} package(s):\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
        : "All installed production packages have a verified license identity and included license or notice text.",
      uninstalled.size
        ? `Packages absent from this platform's installation (verify target-specific optional packages):\n${[
            ...uninstalled,
          ]
            .sort()
            .map((name) => `- ${name}`)
            .join("\n")}`
        : "No absent production packages were reported.",
      "",
    ].join("\n"),
  );

  console.log(
    `Wrote license inventory for ${packages.size} installed production packages to ${relative(repositoryRoot, output)}${warnings.length || uninstalled.size ? ` (${reviewPackageCount} package(s) requiring license review, ${uninstalled.size} absent package(s))` : ""}.`,
  );
}

function main() {
  const root = realpathSync(process.cwd());
  const packageJson = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) {
    throw new Error("Run this script with `pnpm release:licenses`.");
  }
  const tree = JSON.parse(
    execFileSync(
      process.execPath,
      [pnpmCli, "list", "--prod", "--depth", "Infinity", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        windowsHide: true,
      },
    ),
  );
  generateThirdPartyNotices({ root, packageJson, tree });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
