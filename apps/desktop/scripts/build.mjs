#!/usr/bin/env node
// pnpm --filter @opencrease/desktop build [--dir] [-- <electron-builder args>]
// Builds the editor, bundles main/preload/CLI, then packages the app for the current platform with
// electron-builder into apps/desktop/release. --dir skips installers (just the .app / unpacked folder).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dirOnly = args.includes("--dir");
const extra = args.filter((a) => a !== "--dir" && a !== "--");

function run(cmd, cmdArgs, cwd = root) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["--filter", "@opencrease/editor", "build"]);
run(process.execPath, [join(root, "scripts", "bundle.mjs")]);
run("pnpm", ["exec", "electron-builder", "--config", "electron-builder.yml", "--publish", "never", ...(dirOnly ? ["--dir"] : []), ...extra]);
