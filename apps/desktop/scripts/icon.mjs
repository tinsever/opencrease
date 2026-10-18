#!/usr/bin/env node
// Renders build/icon.png (1024 px app icon) from the OpenCrease mark with headless Chromium.
// electron-builder derives the .icns and .ico files from it. Run again after changing the mark.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// macOS icon grid: an 824 px tile centred on a 1024 px canvas, the mark in the tile's middle.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EDEDE9"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#tile)" filter="url(#shadow)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185.5" fill="none" stroke="#000" stroke-opacity="0.08"/>
  <g transform="translate(240 240) scale(34)">
    <path d="M2 2h8l4 4v8H2z" fill="#141414"/>
    <path d="M10 2v4h4z" fill="#FF5B14"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
await writeFile(join(root, "build", "icon.png"), png);
console.log("wrote build/icon.png");
