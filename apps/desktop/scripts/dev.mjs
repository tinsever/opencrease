#!/usr/bin/env node
// pnpm --filter @opencrease/desktop dev [workspaceDir]
// Bundles the main process (and rebuilds on change), starts Vite for the editor, then runs Electron
// on it. The server runs inside Electron; Vite proxies /api, /mcp and /bridge to it.
// Ports: OPENCREASE_PORT (server, default 29880 or a free one) and OPENCREASE_VITE_PORT (default 5180).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron");

function portFree(port) {
  return new Promise((done) => {
    const s = createServer();
    s.once("error", () => done(false));
    s.listen(port, "127.0.0.1", () => s.close(() => done(true)));
  });
}

async function freePort() {
  return new Promise((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

const port = process.env.OPENCREASE_PORT || String((await portFree(29880)) ? 29880 : await freePort());
const vitePort = process.env.OPENCREASE_VITE_PORT || "5180";
const editorUrl = `http://127.0.0.1:${vitePort}`;
const workspace = process.argv[2] ? resolve(process.argv[2]) : undefined;

const children = [];
let exiting = false;
const stop = (code = 0) => {
  if (exiting) return;
  exiting = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const bundler = spawn(process.execPath, [join(root, "scripts", "bundle.mjs"), "--watch"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
children.push(bundler);
await new Promise((done) => {
  let seen = 0;
  bundler.stdout.on("data", (d) => {
    process.stdout.write(d);
    seen += (String(d).match(/Done in/g) ?? []).length;
    if (seen >= 3) done();
  });
  setTimeout(done, 10_000);
});

const vite = spawn("pnpm", ["--filter", "@opencrease/editor", "exec", "vite", "--host", "127.0.0.1", "--port", vitePort, "--strictPort"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, OPENCREASE_PORT: port },
  shell: process.platform === "win32",
});
children.push(vite);
for (let i = 0; i < 100; i++) {
  const ok = await fetch(editorUrl).then((r) => r.ok, () => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 200));
}

const appEnv = { ...process.env };
delete appEnv.ELECTRON_RUN_AS_NODE; // set by Electron-based terminals; it would start the app as plain Node
const app = spawn(electron, [root], {
  cwd: root,
  stdio: "inherit",
  env: { ...appEnv, OPENCREASE_PORT: port, OPENCREASE_EDITOR_URL: editorUrl, ...(workspace ? { OPENCREASE_WORKSPACE: workspace } : {}) },
});
children.push(app);
app.on("exit", (code) => stop(code ?? 0));
vite.on("exit", (code) => stop(code ?? 0));
