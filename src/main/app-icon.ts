import { join } from "node:path";

export function developmentIconPath({
  appPath,
  isPackaged,
  platform,
}: {
  appPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}) {
  if (isPackaged) return undefined;
  const filename =
    platform === "darwin"
      ? "icon.icns"
      : platform === "win32"
        ? "icon.ico"
        : "icon.png";
  return join(appPath, "build", filename);
}
