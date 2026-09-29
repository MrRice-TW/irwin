import type { Settings } from "../shared/contracts";

export function nativeThemeSource(
  theme: Settings["theme"],
): "dark" | "light" | "system" {
  return theme === "system" ? "system" : theme === "dark" ? "dark" : "light";
}
