import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const text = (path: string) => readFileSync(resolve(root, path), "utf8");
const packageJson = JSON.parse(text("package.json")) as {
  build: {
    appId: string;
    productName: string;
    win: { artifactName?: string };
    linux: { artifactName?: string; executableName?: string };
    mac: { artifactName?: string };
  };
};

describe("release identity", () => {
  it("uses deterministic Irwin artifact names without changing the preview app id", () => {
    expect(packageJson.build.productName).toBe("Irwin");
    expect(packageJson.build.appId).toBe("dev.mongoworkbench.desktop");
    expect(packageJson.build.win.artifactName).toBe(
      "Irwin-${version}-win-${arch}.${ext}",
    );
    expect(packageJson.build.linux.artifactName).toBe(
      "Irwin-${version}-linux-${arch}.${ext}",
    );
    expect(packageJson.build.linux.executableName).toBe("irwin");
    expect(packageJson.build.mac.artifactName).toBe(
      "Irwin-${version}-mac-${arch}.${ext}",
    );
  });

  it("keeps the Debian helper and installation guide on the Irwin launcher contract", () => {
    const deb = text("scripts/package-deb.sh");
    expect(deb).toContain('app_name="irwin"');
    expect(deb).toContain('test -x "release/linux-unpacked/$app_name"');
    expect(deb).toContain('exec "/opt/$app_name/$app_name" "$@"');
    expect(deb).toContain("Package: irwin");

    const readme = text("README.md");
    expect(readme).toContain("Irwin-0.1.0-win-x64.exe");
    expect(readme).toContain("Irwin-0.1.0-linux-x64.deb");
    expect(readme).not.toContain("Mongo Workbench Setup");
  });
});
