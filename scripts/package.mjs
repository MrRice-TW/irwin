import { spawn } from "node:child_process";
import { resolve } from "node:path";

// On Windows the cached Electron archive extraction can leave its staging
// directory temporarily unrenamable (EPERM). The installed, pinned Electron
// runtime is the same distribution and electron-builder can copy it directly.
const args = [
  resolve("node_modules/electron-builder/cli.js"),
  ...process.argv.slice(2),
  ...(process.platform === "win32"
    ? ["--config.electronDist=node_modules/electron/dist"]
    : []),
];
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
