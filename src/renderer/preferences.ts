import type { Settings } from "../shared/contracts";

export const AI_SETTINGS_CHANGED = "irwin:ai-settings-changed";

export type PreferenceSection =
  | "appearance"
  | "editor"
  | "query-results"
  | "data-language"
  | "updates"
  | "ai";

export type ResolvedTheme = Exclude<Settings["theme"], "system">;

export function resolveTheme(
  theme: Settings["theme"],
  systemTheme: "dark" | "light",
  systemLightTheme: Settings["systemLightTheme"],
): ResolvedTheme {
  if (theme !== "system") return theme;
  return systemTheme === "dark" ? "dark" : systemLightTheme;
}

export function resetSettingsSection(
  current: Settings,
  section: PreferenceSection,
  defaults: Settings,
): Settings {
  switch (section) {
    case "appearance":
      return {
        ...current,
        theme: defaults.theme,
        systemLightTheme: defaults.systemLightTheme,
        uiScale: defaults.uiScale,
      };
    case "editor":
      return {
        ...current,
        fontFamily: defaults.fontFamily,
        editorFontFamily: defaults.editorFontFamily,
        fontSize: defaults.fontSize,
        editorLineHeight: defaults.editorLineHeight,
        editorPadding: defaults.editorPadding,
        tabWidth: defaults.tabWidth,
      };
    case "query-results":
      return {
        ...current,
        autoRunOnOpen: defaults.autoRunOnOpen,
        rowDensity: defaults.rowDensity,
        longTextDisplay: defaults.longTextDisplay,
        bsonTypeLabels: defaults.bsonTypeLabels,
        jobNotifications: defaults.jobNotifications,
        jsonExpandedDepth: defaults.jsonExpandedDepth,
      };
    case "data-language":
      return {
        ...current,
        language: defaults.language,
        timezone: defaults.timezone,
        datetimeFormat: defaults.datetimeFormat,
        colors: { ...defaults.colors },
      };
    case "updates":
      return {
        ...current,
        autoCheckUpdates: defaults.autoCheckUpdates,
      };
    case "ai":
      return {
        ...current,
        aiCloudConsent: defaults.aiCloudConsent,
        aiDefaultProviderId: defaults.aiDefaultProviderId,
      };
  }
}
