import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { developmentIconPath } from "../src/main/app-icon";

describe("developmentIconPath", () => {
  it("uses the platform-native Irwin icon when running unpackaged", () => {
    expect(
      developmentIconPath({
        appPath: "C:/workspace/irwin",
        isPackaged: false,
        platform: "win32",
      }),
    ).toBe(join("C:/workspace/irwin", "build", "icon.ico"));
  });

  it("lets the packaged executable provide its own icon", () => {
    expect(
      developmentIconPath({
        appPath: "/Applications/Irwin.app",
        isPackaged: true,
        platform: "darwin",
      }),
    ).toBeUndefined();
  });
});
