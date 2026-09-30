import { describe, expect, it } from "vitest";
import { profileSchema, settingsSchema } from "../src/shared/contracts";
import {
  resetSettingsSection,
  resolveTheme,
  type PreferenceSection,
} from "../src/renderer/preferences";

describe("preferences", () => {
  it("resolves the configured light palette and the dark system palette", () => {
    expect(resolveTheme("system", "light", "azure")).toBe("azure");
    expect(resolveTheme("system", "dark", "azure")).toBe("dark");
    expect(resolveTheme("forest", "dark", "light")).toBe("forest");
  });

  it("keeps current behavior as defaults for newly introduced controls", () => {
    const settings = settingsSchema.parse({});

    expect(settings.systemLightTheme).toBe("light");
    expect(settings.editorFontFamily).toContain("monospace");
    expect(settings.autoRunOnOpen).toBe(true);
    expect(settings.autoCheckUpdates).toBe(true);
    expect(settings.rowDensity).toBe("comfortable");
    expect(settings.longTextDisplay).toBe("truncate");
    expect(settings.jsonExpandedDepth).toBe(0);
    expect(settings.uiScale).toBe(100);
    expect(settings.bsonTypeLabels).toBe("selected");
    expect(settings.jobNotifications).toBe("failures");
    expect(
      profileSchema.parse({
        id: "local",
        name: "Local",
        uri: "mongodb://localhost",
      }).queryTimeoutMS,
    ).toBe(30000);
  });

  it("resets only the selected section and clones nested color defaults", () => {
    const defaults = settingsSchema.parse({});
    const current = settingsSchema.parse({
      ...defaults,
      theme: "forest",
      aiCloudConsent: true,
      aiDefaultProviderId: "provider-a",
      systemLightTheme: "azure",
      fontFamily: "Example UI",
      editorFontFamily: "Example Mono",
      uiScale: 125,
      rowDensity: "compact",
      longTextDisplay: "wrap",
      bsonTypeLabels: "always",
      jobNotifications: "all",
      jsonExpandedDepth: 2,
      autoCheckUpdates: false,
      colors: { ...defaults.colors, string: "#123456" },
    });

    const appearance = resetSettingsSection(current, "appearance", defaults);
    expect(appearance.theme).toBe(defaults.theme);
    expect(appearance.systemLightTheme).toBe(defaults.systemLightTheme);
    expect(appearance.uiScale).toBe(defaults.uiScale);
    expect(appearance.fontFamily).toBe("Example UI");
    expect(appearance.colors.string).toBe("#123456");

    const editor = resetSettingsSection(current, "editor", defaults);
    expect(editor.fontFamily).toBe(defaults.fontFamily);
    expect(editor.editorFontFamily).toBe(defaults.editorFontFamily);
    expect(editor.rowDensity).toBe("compact");

    const queryResults = resetSettingsSection(
      current,
      "query-results",
      defaults,
    );
    expect(queryResults.rowDensity).toBe(defaults.rowDensity);
    expect(queryResults.longTextDisplay).toBe(defaults.longTextDisplay);
    expect(queryResults.bsonTypeLabels).toBe(defaults.bsonTypeLabels);
    expect(queryResults.jobNotifications).toBe(defaults.jobNotifications);
    expect(queryResults.theme).toBe("forest");

    const updates = resetSettingsSection(current, "updates", defaults);
    expect(updates.autoCheckUpdates).toBe(true);
    expect(updates.theme).toBe("forest");

    const dataLanguage = resetSettingsSection(
      current,
      "data-language",
      defaults,
    );
    expect(dataLanguage.colors).toEqual(defaults.colors);
    dataLanguage.colors.string = "#abcdef";
    expect(defaults.colors.string).not.toBe("#abcdef");

    const sections: PreferenceSection[] = [
      "appearance",
      "editor",
      "query-results",
      "data-language",
      "updates",
      "ai",
    ];
    expect(sections).toHaveLength(6);
    const ai = resetSettingsSection(current, "ai", defaults);
    expect(ai.aiCloudConsent).toBe(false);
    expect(ai.aiDefaultProviderId).toBe("");
    expect(ai.theme).toBe("forest");
  });
});
