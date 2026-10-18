#!/usr/bin/env node
// pnpm dev: runs the OpenCrease server and the Vite dev server together.
// The server opens and links to the Vite URL, which proxies /api, /mcp and /bridge back to it.
import { spawn } from "node:child_process";

const port = process.env.OPENCREASE_PORT || "29880";
const vitePort = process.env.OPENCREASE_VITE_PORT || "5173";
const editorUrl = `http://localhost:${vitePort}`;
const workspace = process.argv[2];

const children = [
  spawn(process.execPath, ["apps/server/bin/opencrease.mjs", "--port", port, ...(workspace ? [workspace] : [])], {
    stdio: "inherit",
    env: { ...process.env, OPENCREASE_EDITOR_URL: editorUrl },
  }),
  spawn("pnpm", ["--filter", "@opencrease/editor", "exec", "vite", "--port", vitePort, "--strictPort"], {
    stdio: "inherit",
    env: { ...process.env, OPENCREASE_PORT: port },
  }),
];

let exiting = false;
const stop = (code = 0) => {
  if (exiting) return;
  exiting = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
};
for (const c of children) c.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
