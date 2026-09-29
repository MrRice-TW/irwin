import { describe, expect, it } from "vitest";
import { settingsSchema } from "../src/shared/contracts";
import { nativeThemeSource } from "../src/main/theme";

describe("theme settings", () => {
  it("accepts the selectable Mango, Azure, Forest, and Dark themes", () => {
    for (const theme of ["light", "azure", "forest", "dark"] as const) {
      expect(settingsSchema.parse({ theme }).theme).toBe(theme);
    }
  });

  it("uses a native light window frame for every custom light theme", () => {
    expect(nativeThemeSource("light")).toBe("light");
    expect(nativeThemeSource("azure")).toBe("light");
    expect(nativeThemeSource("forest")).toBe("light");
    expect(nativeThemeSource("dark")).toBe("dark");
  });

  it("does not retain the removed startup workspace preference", () => {
    expect(settingsSchema.parse({ restoreWorkspace: true })).not.toHaveProperty(
      "restoreWorkspace",
    );
  });
});
