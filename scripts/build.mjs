import { build } from "esbuild";
import { build as viteBuild } from "vite";
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
await viteBuild();
