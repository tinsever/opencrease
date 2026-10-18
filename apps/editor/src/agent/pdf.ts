// Vector PDFs. The node's live DOM is serialised into a standalone page (fonts inlined, shaders and
// canvases frozen into images, images resampled to the requested quality) and printed by headless
// Chromium on the server (POST /api/render/pdf), which keeps text as real, selectable text with
// embedded font subsets. When the server cannot print (no Chromium), callers fall back to a raster PDF.
import { tokenCssVars, type FoldDocument } from "@opencrease/model";
import { embeddedFontCss } from "./dom";
import { pdfJpegQuality, resampleTarget } from "./export-settings";
import { FrozenShaders, SLOT_ATTR } from "./shader-frames";

export interface PdfOptions {
  quality?: "low" | "medium" | "high";
  resampling?: "detailed" | "basic";
}

export interface PdfPage {
  html: string;
  width: number;
  height: number;
}

/** The server could not print (Chromium missing); the message says why. */
export class PdfUnavailable extends Error {}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function absolute(url: string): string {
  if (/^(data:|blob:|https?:)/i.test(url)) return url;
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

/** Absolute url(...) references inside an inline style attribute. */
function absolutizeStyle(style: string): string {
  return style.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_m, q: string, u: string) => `url(${q}${absolute(u)}${q})`);
}

/** Re-encode an image at its target size and quality. Returns null when it cannot be read (cross-origin). */
function resampleImage(img: HTMLImageElement, opts: Required<PdfOptions>): string | null {
  if (!img.complete || !img.naturalWidth) return null;
  const natural = { width: img.naturalWidth, height: img.naturalHeight };
  const target = resampleTarget(natural, { width: img.offsetWidth || natural.width, height: img.offsetHeight || natural.height }, opts.resampling);
  const reencode = opts.quality !== "high";
  if (!target && !reencode) return null;
  const size = target ?? natural;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  try {
    const src = img.currentSrc || img.src;
    const keepsAlpha = /\.png|\.webp|\.gif|\.svg|image\/(png|webp|gif|svg)/i.test(src);
    return keepsAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", pdfJpegQuality(opts.quality));
  } catch {
    return null; // tainted canvas
  }
}

/** A standalone HTML page that prints exactly like the node renders on the canvas. */
export async function pdfPageHtml(doc: FoldDocument, el: HTMLElement, size: { width: number; height: number }, name: string, options: PdfOptions = {}): Promise<PdfPage> {
  const opts: Required<PdfOptions> = { quality: options.quality ?? "high", resampling: options.resampling ?? "detailed" };
  const shaders = FrozenShaders.freeze(el, opts.resampling === "basic" ? 1 : 2);
  let clone: HTMLElement;
  try {
    const frames = shaders.render();
    clone = el.cloneNode(true) as HTMLElement;
    const srcImgs = [...el.querySelectorAll("img")];
    const cloneImgs = [...clone.querySelectorAll("img")];
    cloneImgs.forEach((img, i) => {
      const resampled = srcImgs[i] ? resampleImage(srcImgs[i], opts) : null;
      img.setAttribute("src", resampled ?? absolute(img.getAttribute("src") ?? ""));
      img.removeAttribute("srcset");
    });
    if (el instanceof HTMLImageElement && clone instanceof HTMLImageElement) clone.setAttribute("src", resampleImage(el, opts) ?? absolute(el.getAttribute("src") ?? ""));
    // shaders: the frozen frame as an image in place of the WebGL canvas
    for (const host of [clone, ...clone.querySelectorAll<HTMLElement>(`[${SLOT_ATTR}]`)]) {
      const key = host.getAttribute(SLOT_ATTR);
      if (!key) continue;
      host.removeAttribute(SLOT_ATTR);
      host.querySelector("canvas")?.remove();
      const img = document.createElement("img");
      img.src = frames.get(key) ?? "";
      img.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;display:block;");
      host.appendChild(img);
    }
    // any other canvas: its current pixels
    const srcCanvases = [...el.querySelectorAll("canvas")].filter((c) => !c.parentElement?.hasAttribute("data-paper-shader"));
    [...clone.querySelectorAll("canvas")].forEach((c, i) => {
      const img = document.createElement("img");
      try {
        img.src = srcCanvases[i]?.toDataURL() ?? "";
      } catch {
        /* tainted */
      }
      img.setAttribute("style", c.getAttribute("style") ?? "");
      c.replaceWith(img);
    });
  } finally {
    shaders.restore();
  }
  for (const node of [clone, ...clone.querySelectorAll<HTMLElement>("[style]")]) {
    const style = node.getAttribute("style");
    if (style?.includes("url(")) node.setAttribute("style", absolutizeStyle(style));
  }
  Object.assign(clone.style, { position: "relative", left: "0px", top: "0px", right: "auto", bottom: "auto", margin: "0px", translate: "none" });
  const fontCss = await embeddedFontCss(el).catch(() => "");
  const vars = Object.entries(tokenCssVars(doc))
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
  const { width, height } = size;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>
${fontCss.replace(/<\/style/gi, "<\\/style")}
* { box-sizing: border-box; }
@page { size: ${width}px ${height}px; margin: 0; }
html, body { margin: 0; padding: 0; background: transparent; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
#of-page { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; font: initial; color: initial; letter-spacing: normal; text-align: start; ${vars.replace(/</g, "\\3c ")} }
</style></head>
<body><div id="of-page">${clone.outerHTML}</div></body></html>`;
  return { html, width, height };
}

/** Print pages to one PDF on the server. Throws PdfUnavailable when the server has no Chromium. */
export async function printPdf(pages: PdfPage[], title: string): Promise<Blob> {
  const res = await fetch("/api/render/pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, pages }),
  });
  if (res.status === 501 || res.status === 404) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new PdfUnavailable(msg ?? "The server cannot print PDFs.");
  }
  if (!res.ok) throw new Error(`PDF rendering failed: ${res.status} ${await res.text().catch(() => "")}`);
  return new Blob([await res.arrayBuffer()], { type: "application/pdf" });
}
