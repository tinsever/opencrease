#!/usr/bin/env node
// Browser-only compatibility check, with isolated services and headless Chromium.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const editorRequire = createRequire(join(root, "apps/editor/package.json"));
const viteEntry = join(dirname(editorRequire.resolve("vite/package.json")), "bin/vite.js");
const temp = await mkdtemp(join(tmpdir(), "of-desktop-browser-"));
const home = join(temp, "home");
await mkdir(home);
const env = { ...process.env, HOME: home, OPENCREASE_HOME: join(home, ".opencrease"), OPENCREASE_PORT: "29908" };
const out = resolve(process.argv[2] ?? join(tmpdir(), "opencrease-desktop-browser-shots"));
await mkdir(out, { recursive: true });
const children = [];
let browser;
const logs = [];
function start(command, args, extra = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => logs.push(String(data)));
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(logs.join(""));
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Service did not start: ${url}\n${logs.join("")}`);
}
try {
  const server = start(process.execPath, ["apps/server/bin/opencrease.mjs", join(temp, "ws"), "--no-open", "--port", "29908"]);
  await ready("http://127.0.0.1:29908/api/status", server);
  const vite = start(process.execPath, [viteEntry, "apps/editor", "--config", "apps/editor/vite.config.ts", "--port", "5208", "--strictPort", "--host", "127.0.0.1"], { OPENCREASE_EDITOR_URL: "http://127.0.0.1:5208" });
  await ready("http://127.0.0.1:5208", vite);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5208");
  const open = page.getByRole("button", { name: "Open folder", exact: true });
  await open.waitFor();
  assert.equal(await open.isDisabled(), true);
  assert.equal(await page.evaluate(() => typeof window.opencreaseDesktop), "undefined");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ofDesktop), undefined);
  await page.screenshot({ path: join(out, "09-browser-home.png") });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("opencrease:connect-agent")));
  await page.locator(".of-agent-row").first().getByRole("button", { name: "Set up" }).click();
  assert.equal(await page.getByRole("button", { name: "Add automatically" }).count(), 0);
  await page.screenshot({ path: join(out, "10-browser-connect.png") });
  assert.deepEqual(errors, []);
  console.log("[browser] folder picker stays disabled, automatic config setup is absent, no page errors");
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await new Promise((done) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); done(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); done(); });
    });
  }
  await rm(temp, { recursive: true, force: true });
}
