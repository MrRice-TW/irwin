import { build } from "esbuild";
import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
await build({
  entryPoints: {
    main: "src/main/main.ts",
    preload: "src/main/preload.ts",
    database: "src/workers/database.ts",
    shell: "src/workers/shell.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
const env = { ...process.env, WORKBENCH_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
