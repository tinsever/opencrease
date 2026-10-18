// Builds the Snapshot extension into dist/chrome and dist/firefox (Manifest V3 for both).
// Usage: node build.mjs [--watch]
import { build, context } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(join(here, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");

const ICONS = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };

function manifest(browser) {
  const base = {
    manifest_version: 3,
    name: "OpenCrease Snapshot",
    short_name: "Snapshot",
    version: pkg.version,
    description: "Capture a page, a section or the visible area as editable OpenCrease layers.",
    icons: ICONS,
    action: { default_title: "Snapshot", default_popup: "popup.html", default_icon: ICONS },
    permissions: ["activeTab", "scripting", "storage", "clipboardWrite"],
    // <all_urls>: download images for inlining regardless of the page's CORS rules, and reach the local
    // OpenCrease server on 127.0.0.1. Nothing is sent anywhere else.
    host_permissions: ["<all_urls>"],
  };
  if (browser === "chrome") {
    return { ...base, minimum_chrome_version: "116", background: { service_worker: "background.js" } };
  }
  return {
    ...base,
    background: { scripts: ["background.js"] },
    browser_specific_settings: { gecko: { id: "snapshot@opencrease.dev", strict_min_version: "128.0" } },
  };
}

const entries = {
  background: join(here, "src/background.ts"),
  content: join(here, "src/content/index.ts"),
  popup: join(here, "src/popup/popup.ts"),
};

async function writeStatic(out, browser) {
  await mkdir(join(out, "icons"), { recursive: true });
  await cp(join(here, "icons"), join(out, "icons"), { recursive: true });
  await cp(join(here, "src/popup/popup.html"), join(out, "popup.html"));
  await cp(join(here, "src/popup/popup.css"), join(out, "popup.css"));
  await cp(join(here, "../../LICENSE"), join(out, "LICENSE"));
  await cp(join(here, "../../THIRD_PARTY_NOTICES"), join(out, "THIRD_PARTY_NOTICES"));
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest(browser), null, 2) + "\n");
}

const options = (browser) => ({
  entryPoints: entries,
  outdir: join(here, "dist", browser),
  bundle: true,
  format: "iife",
  target: browser === "chrome" ? "chrome116" : "firefox128",
  platform: "browser",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "warning",
});

for (const browser of ["chrome", "firefox"]) {
  const out = join(here, "dist", browser);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeStatic(out, browser);
  if (watch) {
    const ctx = await context(options(browser));
    await ctx.watch();
  } else {
    await build(options(browser));
  }
  console.log(`built ${out}`);
}
if (watch) console.log("watching for changes");
