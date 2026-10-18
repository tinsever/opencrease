// Screenshots and exports. Raster formats rasterise the real DOM with modern-screenshot (AVIF is
// encoded in WebAssembly when the browser cannot), PDFs are printed by headless Chromium on the server
// with vector text (raster fallback), SVG comes from the model, and videos step the shader clock frame
// by frame (see video.ts). Used by the agent tools (get_screenshot, export, export_combined_pdf), the
// Export section and the headless CLI.
import { svgCaptureRoot } from "./svg-capture";
import { worldAngle } from "../canvas/measure-dom";
import { nodeToHtml } from "@opencrease/css";
import { getNode, tokenCssVars, type ExportSetting, type FoldDocument, type NodeId } from "@opencrease/model";
import { api } from "../state/api";
import { getOpenFile, openFile } from "../state/workspace";
import { embeddedFontCss, findNodeElement, measureNode, renderOffscreen, showNode, waitForImages } from "./dom";
import {
  DEFAULT_EXPORT, IMAGE_FORMATS, MAX_VIDEO_SIDE, MIME, VIDEO_FORMATS, canvasOrder, clampRatio, evenSize, exportFileName,
  outputSize, parseExportScale, pdfJpegQuality, uniqueNames,
} from "./export-settings";
import { pdfPageHtml, PdfUnavailable, printPdf, type PdfOptions, type PdfPage } from "./pdf";
import { captureOptions, FrozenShaders } from "./shader-frames";
import { renderVideo, type VideoProgress } from "./video";

export type ExportDestination = "download" | "workspace" | "none";

export interface ExportedFile {
  nodeId: NodeId;
  name: string;
  format: ExportSetting["format"];
  scale: string;
  filename: string;
  width: number;
  height: number;
  blob: Blob;
  /** absolute path when saved to the workspace */
  path?: string;
  /** videos */
  durationSeconds?: number;
  fps?: number;
  codec?: string;
}

export interface ExportOutcome {
  files: ExportedFile[];
  errors: string[];
  /** things that worked differently than asked (raster PDF fallback, video without animation) */
  warnings: string[];
}

export interface ExportProgress {
  /** 0..1 over the whole run */
  fraction: number;
  label: string;
}

interface Captured {
  canvas: HTMLCanvasElement;
  /** node size in CSS px */
  width: number;
  height: number;
}

class ExportError extends Error {}

async function fileDoc(fileId: string): Promise<FoldDocument> {
  const file = getOpenFile(fileId) ?? (await openFile(fileId, undefined, { focus: false }));
  return file.store.doc;
}

const notOverlay = (n: Node) => !(n instanceof Element && n.hasAttribute("data-of-overlay"));

/** The rendered element of a node and its CSS size; `dispose` removes an offscreen fallback render. */
async function resolveElement(fileId: string, doc: FoldDocument, nodeId: NodeId): Promise<{ el: HTMLElement; width: number; height: number; offscreen: boolean; dispose?: () => void }> {
  const node = getNode(doc, nodeId);
  if (!node) throw new ExportError(`No node with id "${nodeId}".`);
  if (!node.visible) throw new ExportError(`Layer "${node.name}" is hidden.`);
  let el = findNodeElement(fileId, nodeId);
  if (!el || el.hasAttribute("data-of-virtual")) el = await showNode(fileId, nodeId);
  let dispose: (() => void) | undefined;
  if (!el) {
    const off = renderOffscreen(fileId, doc, nodeId);
    el = off.el;
    dispose = off.dispose;
  }
  await waitForImages(el);
  const rect = dispose ? null : measureNode(fileId, nodeId);
  const width = Math.max(1, Math.round(rect?.width ?? el.offsetWidth ?? el.getBoundingClientRect().width));
  const height = Math.max(1, Math.round(rect?.height ?? el.offsetHeight ?? el.getBoundingClientRect().height));
  if (node.type === "SVGElement" && el instanceof SVGGraphicsElement) {
    const wrapped = svgCaptureRoot(el, width, height);
    const previous = dispose;
    return { el: wrapped.el, width, height, offscreen: true, dispose: () => { wrapped.dispose(); previous?.(); } };
  }
  return { el, width, height, offscreen: !!dispose, dispose };
}

/** Render a node to a canvas at `ratio` device pixels per CSS px. Shaders are captured at that resolution. */
export async function captureNode(
  fileId: string,
  nodeId: NodeId,
  ratio: number | ((size: { width: number; height: number }) => number),
  opts: { backgroundColor?: string | null } = {},
): Promise<Captured> {
  const doc = await fileDoc(fileId);
  const { el, width, height, dispose } = await resolveElement(fileId, doc, nodeId);
  let shaders: FrozenShaders | null = null;
  try {
    const r = clampRatio(typeof ratio === "function" ? ratio({ width, height }) : ratio, width, height);
    const angle = dispose ? 0 : worldAngle(doc, nodeId);
    const layoutWidth = el.offsetWidth || width;
    const layoutHeight = el.offsetHeight || height;
    const fontCss = await embeddedFontCss(el).catch(() => "");
    const { domToCanvas } = await import("modern-screenshot");
    shaders = FrozenShaders.freeze(el, r);
    const cap = captureOptions(shaders.render());
    const canvas = await domToCanvas(el, {
      width,
      height,
      scale: r,
      backgroundColor: opts.backgroundColor ?? null,
      // the capture root must sit at the origin of the image, whatever its canvas position
      style: { position: "relative", left: `${angle ? (width - layoutWidth) / 2 : 0}px`, top: `${angle ? (height - layoutHeight) / 2 : 0}px`, right: "auto", bottom: "auto", margin: "0px", translate: "none", ...(angle ? { rotate: `${angle}deg` } : {}) } as Partial<CSSStyleDeclaration>,
      font: fontCss ? { cssText: fontCss } : false,
      timeout: 15_000,
      filter: (n) => notOverlay(n) && cap.filter(n),
      onCloneEachNode: cap.onCloneEachNode,
    });
    return { canvas, width, height };
  } finally {
    shaders?.restore();
    dispose?.();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ExportError(`The browser could not encode ${mime}.`))), mime, quality),
  );
}

/** AVIF: the browser's own encoder when it has one, otherwise libavif compiled to WebAssembly. */
async function encodeAvif(canvas: HTMLCanvasElement): Promise<Blob> {
  const native = await canvasToBlob(canvas, MIME.avif, 0.8).catch(() => null);
  if (native?.type === MIME.avif) return native;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ExportError("Could not read the rendered pixels for AVIF encoding.");
  const { default: encode } = await import("@jsquash/avif/encode.js");
  const data = await encode(ctx.getImageData(0, 0, canvas.width, canvas.height), { quality: 70, speed: 7 });
  return new Blob([data], { type: MIME.avif });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * The colour showing through behind an element: its own background if opaque, otherwise the nearest
 * ancestor's. Lets a screenshot of a transparent section match what the canvas shows.
 */
function backdropColor(el: Element): string | null {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (!cur.hasAttribute("data-of-id")) break;
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return null;
}

/** Screenshot for agents: PNG, longest side capped (2000 px at scale 1, 4000 px at scale 2). */
export async function screenshotNode(fileId: string, nodeId: NodeId, scale: 1 | 2): Promise<{ data: string; mimeType: string; width: number; height: number }> {
  const maxSide = scale === 2 ? 4000 : 2000;
  const el = findNodeElement(fileId, nodeId) ?? (await showNode(fileId, nodeId));
  const shot = await captureNode(fileId, nodeId, ({ width, height }) => Math.min(scale, maxSide / Math.max(width, height)), {
    backgroundColor: el ? backdropColor(el) : null,
  });
  const blob = await canvasToBlob(shot.canvas, "image/png");
  return { data: await blobToBase64(blob), mimeType: "image/png", width: shot.canvas.width, height: shot.canvas.height };
}

function resolveVars(markup: string, vars: Record<string, string>): string {
  let out = markup;
  for (let i = 0; i < 4 && out.includes("var("); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name: string, fallback?: string) => vars[name] ?? fallback?.trim() ?? m);
  }
  return out;
}

/** Standalone SVG markup for an SVG node (tokens resolved, editor attributes removed). */
export function svgMarkup(doc: FoldDocument, nodeId: NodeId): string {
  const node = getNode(doc, nodeId);
  if (!node || node.type !== "SVG") throw new ExportError("SVG export only works for SVG layers. Use PNG or PDF for other layers.");
  let markup = nodeToHtml(doc, nodeId).replace(/\s(?:layer-name|data-of-id)="[^"]*"/g, "");
  if (!/^<svg[^>]*\sxmlns=/.test(markup)) markup = markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `${resolveVars(markup, tokenCssVars(doc))}\n`;
}

async function rasterPdf(pages: Array<{ canvas: HTMLCanvasElement; width: number; height: number }>, quality: number): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | undefined;
  for (const p of pages) {
    const orientation = p.width > p.height ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ unit: "px", format: [p.width, p.height], orientation, hotfixes: ["px_scaling"], compress: true });
    else pdf.addPage([p.width, p.height], orientation);
    pdf.addImage(p.canvas.toDataURL("image/jpeg", quality), "JPEG", 0, 0, p.width, p.height, undefined, "FAST");
  }
  return pdf!.output("blob");
}

const RASTER_PDF_NOTE = "The PDF text is rasterised because the server could not print it with vector text";

/**
 * PDF of one or more nodes, one page each. Vector text through the server when it can print,
 * otherwise images of the pages. Returns a warning when it fell back.
 */
async function nodesToPdf(fileId: string, doc: FoldDocument, nodeIds: NodeId[], opts: PdfOptions, title: string): Promise<{ blob: Blob; width: number; height: number; warning?: string }> {
  const pages: PdfPage[] = [];
  let first: { width: number; height: number } | null = null;
  for (const id of nodeIds) {
    const r = await resolveElement(fileId, doc, id);
    try {
      first ??= { width: r.width, height: r.height };
      pages.push(await pdfPageHtml(doc, r.el, { width: r.width, height: r.height }, getNode(doc, id)?.name ?? title, opts));
    } finally {
      r.dispose?.();
    }
  }
  try {
    return { blob: await printPdf(pages, title), ...first! };
  } catch (err) {
    if (!(err instanceof PdfUnavailable)) throw err;
    const ratio = opts.resampling === "basic" ? 1 : 2;
    const shots: Captured[] = [];
    for (const id of nodeIds) shots.push(await captureNode(fileId, id, ratio, { backgroundColor: "#FFFFFF" }));
    return { blob: await rasterPdf(shots, pdfJpegQuality(opts.quality)), ...first!, warning: `${RASTER_PDF_NOTE}: ${err.message}` };
  }
}

type Rendered = Omit<ExportedFile, "filename" | "path" | "name" | "nodeId"> & { warning?: string };

async function renderOne(fileId: string, doc: FoldDocument, nodeId: NodeId, setting: ExportSetting, onVideoProgress?: (p: VideoProgress) => void, signal?: AbortSignal): Promise<Rendered> {
  const fmt = setting.format;
  if (VIDEO_FORMATS.has(fmt)) return renderVideoFile(fileId, doc, nodeId, setting, onVideoProgress, signal);
  if (fmt === "svg") {
    const markup = svgMarkup(doc, nodeId);
    const rect = measureNode(fileId, nodeId);
    return { format: fmt, scale: setting.scale, width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0), blob: new Blob([markup], { type: MIME.svg }) };
  }
  if (fmt === "pdf") {
    const name = getNode(doc, nodeId)?.name ?? doc.name;
    const pdf = await nodesToPdf(fileId, doc, [nodeId], { quality: setting.pdfQuality, resampling: setting.pdfResampling }, name);
    return { format: fmt, scale: setting.scale, width: pdf.width, height: pdf.height, blob: pdf.blob, warning: pdf.warning };
  }
  if (!IMAGE_FORMATS.has(fmt)) throw new ExportError(`Unknown export format "${fmt}".`);
  const shot = await captureNode(fileId, nodeId, ({ width, height }) => parseExportScale(setting.scale, width, height), {
    backgroundColor: fmt === "jpg" ? "#FFFFFF" : null,
  });
  const blob = fmt === "avif" ? await encodeAvif(shot.canvas) : await canvasToBlob(shot.canvas, MIME[fmt], fmt === "png" ? undefined : 0.92);
  if (blob.type !== MIME[fmt]) throw new ExportError(`This browser cannot encode ${fmt.toUpperCase()} images. Use PNG, JPG or WebP.`);
  const size = outputSize(shot.width, shot.height, shot.canvas.width / shot.width);
  return { format: fmt, scale: setting.scale, width: size.width, height: size.height, blob };
}

async function renderVideoFile(fileId: string, doc: FoldDocument, nodeId: NodeId, setting: ExportSetting, onProgress?: (p: VideoProgress) => void, signal?: AbortSignal): Promise<Rendered> {
  const node = getNode(doc, nodeId);
  if (!node) throw new ExportError(`No node with id "${nodeId}".`);
  if (!node.visible) throw new ExportError(`Layer "${node.name}" is hidden.`);
  const el = findNodeElement(fileId, nodeId) ?? (await showNode(fileId, nodeId));
  if (!el) throw new ExportError(`"${node.name}" is not on the canvas, so it cannot be recorded. Open its page and try again.`);
  await waitForImages(el);
  const rect = measureNode(fileId, nodeId);
  const width = Math.max(1, Math.round(rect?.width ?? el.offsetWidth));
  const height = Math.max(1, Math.round(rect?.height ?? el.offsetHeight));
  const ratio = Math.min(parseExportScale(setting.scale, width, height), MAX_VIDEO_SIDE / Math.max(width, height));
  const out = outputSize(width, height, ratio);
  const even = evenSize(out.width, out.height);
  const fontCss = await embeddedFontCss(el).catch(() => "");
  const video = await renderVideo({
    el, width, height, outWidth: even.width, outHeight: even.height, setting,
    background: backdropColor(el) ?? "#FFFFFF",
    fontCss,
    filter: notOverlay,
    onProgress,
    signal,
  });
  return {
    format: setting.format,
    scale: setting.scale,
    width: video.width,
    height: video.height,
    blob: video.blob,
    durationSeconds: video.seconds,
    fps: video.fps,
    codec: video.codec,
    warning: video.animated.length ? undefined : `"${node.name}" has no animated shader, so its video shows a still frame.`,
  };
}

async function saveToWorkspace(fileId: string, filename: string, blob: Blob): Promise<string> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/exports`, {
    method: "POST",
    headers: { "content-type": blob.type || "application/octet-stream", "x-filename": encodeURIComponent(filename) },
    body: blob,
  });
  if (!res.ok) throw new ExportError(`Could not save ${filename}: ${res.status} ${await res.text().catch(() => "")}`);
  return ((await res.json()) as { path: string }).path;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function deliver(fileId: string, files: ExportedFile[], destination: ExportDestination, errors: string[]): Promise<ExportedFile[]> {
  const out: ExportedFile[] = [];
  for (const f of files) {
    try {
      if (destination === "workspace") f.path = await saveToWorkspace(fileId, f.filename, f.blob);
      else if (destination === "download") downloadBlob(f.filename, f.blob);
      out.push(f);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return out;
}

export interface ExportRunOptions {
  destination?: ExportDestination;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * Export nodes with export settings. `settings` applies to every node; when it is omitted or empty,
 * each node uses its own `exports` settings, or PNG at 2x. Files are downloaded by default, or saved
 * to `<workspace>/Exports/<file name>/` with destination "workspace".
 */
export async function exportNodes(fileId: string, nodeIds: NodeId[], settings?: ExportSetting[], opts: ExportRunOptions = {}): Promise<ExportOutcome> {
  const doc = await fileDoc(fileId);
  return exportRequests(
    fileId,
    nodeIds.map((nodeId) => ({ nodeId, settings: settings?.length ? settings : (getNode(doc, nodeId)?.exports ?? []) })),
    opts.destination ?? "download",
    opts,
  );
}

export async function exportRequests(
  fileId: string,
  requests: Array<{ nodeId: NodeId; settings: ExportSetting[] }>,
  destination: ExportDestination,
  opts: Omit<ExportRunOptions, "destination"> = {},
): Promise<ExportOutcome> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rendered: Array<Omit<ExportedFile, "filename"> & { suffix?: string }> = [];
  const jobs = requests.flatMap((r) => (r.settings.length ? r.settings : [DEFAULT_EXPORT]).map((setting) => ({ nodeId: r.nodeId, setting })));
  let done = 0;
  for (const { nodeId, setting } of jobs) {
    if (opts.signal?.aborted) {
      errors.push("Export cancelled.");
      break;
    }
    const doc = await fileDoc(fileId);
    const node = getNode(doc, nodeId);
    if (!node) {
      errors.push(`No node with id "${nodeId}".`);
      done++;
      continue;
    }
    const label = `${node.name} ${setting.format.toUpperCase()}`;
    opts.onProgress?.({ fraction: done / jobs.length, label });
    try {
      const { warning, ...r } = await renderOne(fileId, doc, node.id, setting, (p) => opts.onProgress?.({ fraction: (done + p.frame / p.frames) / jobs.length, label: `${label}, frame ${p.frame} of ${p.frames}` }), opts.signal);
      if (warning && !warnings.includes(warning)) warnings.push(warning);
      rendered.push({ ...r, nodeId: node.id, name: node.name, suffix: setting.suffix });
    } catch (err) {
      errors.push(`${node.name} (${node.id}) ${setting.format} ${setting.scale}: ${(err as Error).message}`);
    }
    done++;
  }
  const names = uniqueNames(rendered.map((r) => exportFileName(r.name, { format: r.format, scale: r.scale, suffix: r.suffix })));
  const files: ExportedFile[] = rendered.map(({ suffix: _suffix, ...r }, i) => ({ ...r, filename: names[i] }));
  opts.onProgress?.({ fraction: 1, label: "Saving" });
  return { files: await deliver(fileId, files, destination, errors), errors, warnings };
}

/** One PDF, one page per node, ordered top to bottom then left to right. */
export async function exportCombinedPdf(
  fileId: string,
  nodeIds: NodeId[],
  opts: { destination?: ExportDestination } & PdfOptions = {},
): Promise<{ file: ExportedFile; pages: NodeId[]; warning?: string }> {
  const doc = await fileDoc(fileId);
  const items = nodeIds.map((id) => {
    const node = getNode(doc, id);
    if (!node) throw new ExportError(`No node with id "${id}".`);
    const rect = measureNode(fileId, id);
    const left = Number.parseFloat(String(node.styles.left ?? 0)) || 0;
    const top = Number.parseFloat(String(node.styles.top ?? 0)) || 0;
    return { id, x: rect?.x ?? left, y: rect?.y ?? top };
  });
  const ordered = canvasOrder(items).map((i) => i.id);
  const pdf = await nodesToPdf(fileId, doc, ordered, { quality: opts.quality, resampling: opts.resampling }, doc.name);
  const filename = exportFileName(doc.name, { format: "pdf", scale: "1x" });
  const file: ExportedFile = { nodeId: ordered[0], name: doc.name, format: "pdf", scale: "1x", filename, width: pdf.width, height: pdf.height, blob: pdf.blob };
  const errors: string[] = [];
  const [saved] = await deliver(fileId, [file], opts.destination ?? "download", errors);
  if (!saved) throw new ExportError(errors.join(" ") || "Could not save the PDF.");
  return { file: saved, pages: ordered, warning: pdf.warning };
}

/** The image of an Image node (or the first url() background), as a JPEG at most 1024 px on its longest side. */
export async function fillImageOf(fileId: string, nodeId: NodeId): Promise<{ src: string; image: { data: string; mimeType: string; width: number; height: number }; naturalWidth: number; naturalHeight: number }> {
  const doc = await fileDoc(fileId);
  const node = getNode(doc, nodeId);
  if (!node) throw new ExportError(`No node with id "${nodeId}".`);
  let src = node.type === "Image" ? node.src : undefined;
  if (!src) {
    const bg = String(node.styles.backgroundImage ?? node.styles.background ?? "");
    src = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(bg)?.[1];
  }
  if (!src) throw new ExportError(`"${node.name}" has no image fill. Only Image layers and layers with a url() background have one.`);
  const url = src.startsWith("asset://") ? api.assetUrl(fileId, src.slice("asset://".length)) : src;
  let bitmap: ImageBitmap;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    bitmap = await createImageBitmap(await res.blob());
  } catch (err) {
    throw new ExportError(`Could not load the image ${src} (${(err as Error).message}). Remote images need CORS access to be read.`);
  }
  const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
  return {
    src,
    image: { data: await blobToBase64(blob), mimeType: "image/jpeg", width: canvas.width, height: canvas.height },
    naturalWidth: bitmap.width,
    naturalHeight: bitmap.height,
  };
}
