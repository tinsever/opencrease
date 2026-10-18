// Renders icons/icon.svg to the PNG sizes the manifests use. Usage: node scripts/icons.mjs icons
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const dir = process.argv[2];
const svg = await readFile(`${dir}/icon.svg`, "utf8");
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: `${dir}/icon-${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
