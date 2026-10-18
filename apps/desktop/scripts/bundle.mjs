#!/usr/bin/env node
// Bundles the desktop app with esbuild into apps/desktop/dist:
//   main.cjs           Electron main process, including the OpenCrease server (apps/server) and all deps
//   preload.cjs        sandboxed preload
//   opencrease-cli.mjs   the `opencrease` CLI as one file, run by the app's binary in Node mode
// Everything is bundled, so the packaged app needs no node_modules.
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: "linked",
  logLevel: "info",
  // optional native speedups of ws; ws falls back to JS when they are missing
  external: ["electron", "playwright", "bufferutil", "utf-8-validate"],
  absWorkingDir: root,
  // jsonc-parser's default entry is a UMD build with dynamic requires esbuild cannot follow
  mainFields: ["module", "main"],
};

/** @type {import("esbuild").BuildOptions[]} */
const configs = [
  {
    ...common,
    entryPoints: ["src/main.ts"],
    outfile: "dist/main.cjs",
    format: "cjs",
    // the server's config.ts uses import.meta.url; give CommonJS a real value
    define: { "import.meta.url": "__opencreaseImportMetaUrl" },
    banner: { js: 'const __opencreaseImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  },
  {
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "dist/preload.cjs",
    format: "cjs",
    sourcemap: false,
  },
  {
    ...common,
    entryPoints: ["src/cli-entry.ts"],
    outfile: "dist/opencrease-cli.mjs",
    format: "esm",
    external: ["playwright", "bufferutil", "utf-8-validate"],
    banner: { js: 'import { createRequire as __ofCreateRequire } from "node:module"; const require = __ofCreateRequire(import.meta.url);' },
  },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}
