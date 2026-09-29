import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let projectRoot: string | undefined;

afterEach(() => {
  if (!projectRoot) return;
  rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

function createProject(
  version: string,
  licenseFile = "LICENSE",
  packageName = "fixture",
): string {
  projectRoot = mkdtempSync(join(tmpdir(), "irwin-license-test-"));
  const packageRoot = join(projectRoot, "node_modules", "fixture");
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(join(projectRoot, "build"), { recursive: true });
  writeFileSync(
    join(projectRoot, "package.json"),
    JSON.stringify({ name: "fixture-app", version: "1.0.0" }),
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
      license: "MIT",
      licenseFile,
    }),
  );
  writeFileSync(join(packageRoot, "LICENSE"), "fixture license text\n");

  const treePath = join(projectRoot, "dependency-tree.json");
  writeFileSync(
    treePath,
    JSON.stringify([
      {
        dependencies: {
          fixture: { path: packageRoot, from: "fixture", version },
        },
      },
    ]),
  );
  return projectRoot;
}

function writeEvidence(root: string, packages: Record<string, unknown>): void {
  const directory = join(root, "vendor", "license-evidence");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, packages }),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function generateNotices(root: string): Promise<void> {
  const { generateThirdPartyNotices } = (await import(
    /* @vite-ignore */ new URL(
      "../scripts/third-party-notices.mjs",
      import.meta.url,
    ).href
  )) as {
    generateThirdPartyNotices: (args: {
      root: string;
      packageJson: { name: string; version: string };
      tree: unknown;
    }) => void;
  };
  generateThirdPartyNotices({
    root,
    packageJson: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    tree: JSON.parse(readFileSync(join(root, "dependency-tree.json"), "utf8")),
  });
}

describe("third-party license inventory", () => {
  it("includes a package README with pinned full license terms", async () => {
    const root = createProject("1.0.0");
    const packageRoot = join(root, "node_modules", "fixture");
    rmSync(join(packageRoot, "LICENSE"));
    const readme =
      "License\nPermission is hereby granted to use this software.\n";
    writeFileSync(join(packageRoot, "README.md"), readme);
    writeEvidence(root, {
      "fixture@1.0.0": {
        notice: {
          source: "package",
          path: "README.md",
          sha256: sha256(readme),
          sourceUrl: "https://registry.npmjs.org/fixture/1.0.0",
        },
      },
    });

    await generateNotices(root);

    const output = join(root, "build", "third-party-licenses");
    const packageOutput = join(
      output,
      "packages",
      readdirSync(join(output, "packages"))[0]!,
    );
    expect(readFileSync(join(packageOutput, "README.md"), "utf8")).toBe(readme);
    expect(
      readFileSync(join(output, "license-review.txt"), "utf8"),
    ).not.toContain("Review required");
    expect(
      readFileSync(join(output, "THIRD_PARTY_NOTICES.md"), "utf8"),
    ).toContain("https://registry.npmjs.org/fixture/1.0.0");
  });

  it("rejects evidence when the installed README differs from its pinned hash", async () => {
    const root = createProject("1.0.0");
    const packageRoot = join(root, "node_modules", "fixture");
    rmSync(join(packageRoot, "LICENSE"));
    writeFileSync(join(packageRoot, "README.md"), "changed terms\n");
    writeEvidence(root, {
      "fixture@1.0.0": {
        notice: {
          source: "package",
          path: "README.md",
          sha256: sha256("original terms\n"),
          sourceUrl: "https://registry.npmjs.org/fixture/1.0.0",
        },
      },
    });

    await generateNotices(root);

    const output = join(root, "build", "third-party-licenses");
    expect(readFileSync(join(output, "license-review.txt"), "utf8")).toContain(
      "evidence hash mismatch",
    );
    expect(readdirSync(join(output, "packages"))).toEqual([]);
  });

  it("uses a pinned package license file to fill missing license metadata", async () => {
    const root = createProject("1.0.0");
    const packageRoot = join(root, "node_modules", "fixture");
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    writeEvidence(root, {
      "fixture@1.0.0": {
        declaredLicense: "MIT",
        licenseProof: {
          source: "package",
          path: "LICENSE",
          sha256: sha256("fixture license text\n"),
          sourceUrl: "https://registry.npmjs.org/fixture/1.0.0",
        },
      },
    });

    await generateNotices(root);

    const output = join(root, "build", "third-party-licenses");
    expect(
      readFileSync(join(output, "license-review.txt"), "utf8"),
    ).not.toContain("no license metadata");
    expect(
      readFileSync(join(output, "THIRD_PARTY_NOTICES.md"), "utf8"),
    ).toContain("| fixture | 1.0.0 | MIT |");
  });

  it("includes pinned upstream license text when the package omits it", async () => {
    const root = createProject("1.0.0");
    rmSync(join(root, "node_modules", "fixture", "LICENSE"));
    const directory = join(root, "vendor", "license-evidence");
    const text = "Upstream license terms\n";
    writeEvidence(root, {
      "fixture@1.0.0": {
        notice: {
          source: "vendor",
          path: "UPSTREAM-LICENSE",
          sha256: sha256(text),
          sourceUrl: "https://github.com/example/fixture/blob/v1.0.0/LICENSE",
        },
      },
    });
    writeFileSync(join(directory, "UPSTREAM-LICENSE"), text);

    await generateNotices(root);

    const output = join(root, "build", "third-party-licenses");
    const packageOutput = join(
      output,
      "packages",
      readdirSync(join(output, "packages"))[0]!,
    );
    expect(readFileSync(join(packageOutput, "UPSTREAM-LICENSE"), "utf8")).toBe(
      text,
    );
    expect(
      readFileSync(join(output, "license-review.txt"), "utf8"),
    ).not.toContain("Review required");
  });

  it("counts packages rather than individual missing-license findings", async () => {
    const root = createProject("1.0.0");
    const packageRoot = join(root, "node_modules", "fixture");
    rmSync(join(packageRoot, "LICENSE"));
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );

    await generateNotices(root);

    const report = readFileSync(
      join(root, "build", "third-party-licenses", "license-review.txt"),
      "utf8",
    );
    expect(report).toContain("Review required for 1 package(s)");
    expect(report).toContain("no license metadata");
    expect(report).toContain("no license or notice text shipped");
  });

  it("keeps package metadata output paths inside the package inventory", async () => {
    const root = createProject(
      "../../../../outside",
      "LICENSE",
      "..\\..\\outside",
    );

    await generateNotices(root);

    const output = join(root, "build", "third-party-licenses");
    const packageOutput = join(output, "packages");
    const packageDirectories = readdirSync(packageOutput);
    expect(packageDirectories).toHaveLength(1);
    expect(packageDirectories[0]).not.toMatch(/[\\/]/);
    expect(existsSync(join(root, "build", "outside", "LICENSE"))).toBe(false);
    expect(readdirSync(join(packageOutput, packageDirectories[0]!))).toContain(
      "LICENSE",
    );
    expect(
      readFileSync(join(output, "THIRD_PARTY_NOTICES.md"), "utf8"),
    ).toContain("packages/");
  });

  it("does not copy a license file through a package symlink", async ({
    skip,
  }) => {
    const root = createProject("1.0.0", "linked/secret.txt");
    const packageRoot = join(root, "node_modules", "fixture");
    const outsideDirectory = join(root, "external");
    mkdirSync(outsideDirectory);
    writeFileSync(join(outsideDirectory, "secret.txt"), "outside secret\n");
    try {
      symlinkSync(
        outsideDirectory,
        join(packageRoot, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      skip("This platform does not allow creating a symlink fixture.");
    }

    await generateNotices(root);

    const packageOutput = join(
      root,
      "build",
      "third-party-licenses",
      "packages",
      readdirSync(join(root, "build", "third-party-licenses", "packages"))[0]!,
    );
    expect(readdirSync(packageOutput)).toEqual(["LICENSE"]);
    expect(readFileSync(join(packageOutput, "LICENSE"), "utf8")).toBe(
      "fixture license text\n",
    );
  });

  it("does not replace a license output symlink", async ({ skip }) => {
    const root = createProject("1.0.0");
    const outsideDirectory = join(root, "external-output");
    const output = join(root, "build", "third-party-licenses");
    mkdirSync(outsideDirectory);
    writeFileSync(join(outsideDirectory, "keep.txt"), "keep this file\n");
    try {
      symlinkSync(
        outsideDirectory,
        output,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      skip("This platform does not allow creating a symlink fixture.");
    }

    await expect(generateNotices(root)).rejects.toThrow(
      "Refusing to replace a non-directory license output",
    );
    expect(readFileSync(join(outsideDirectory, "keep.txt"), "utf8")).toBe(
      "keep this file\n",
    );
  });
});
