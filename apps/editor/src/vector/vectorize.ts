// Vectorise a raster: trace an Image node with imagetracerjs (public domain) into a fitted SVG layer
// that replaces the image at the same place and size. Runs in the browser (needs a canvas).
import type { NodeId, NodeTree, StyleMap } from "@opencrease/model";
import { htmlToTrees } from "@opencrease/css";
import { resolveSrc } from "../state/api";
import { getOpenFile } from "../state/workspace";
import { getNodeElement, getWorldRect } from "../canvas/registry";
import { vectorSvgTree } from "./shapes";
import { rasterPlacement } from "./raster";

export type TraceDetail = "low" | "medium" | "high";

const PRESETS: Record<TraceDetail, Record<string, number | boolean>> = {
  low: { numberofcolors: 6, pathomit: 16, ltres: 1, qtres: 1, blurradius: 1, colorquantcycles: 3 },
  medium: { numberofcolors: 16, pathomit: 8, ltres: 1, qtres: 1, colorquantcycles: 3 },
  high: { numberofcolors: 32, pathomit: 2, ltres: 0.5, qtres: 0.5, colorquantcycles: 4 },
};

const WORK_SIZE = { low: 256, medium: 512, high: 900 };

interface Tracer {
  imagedataToSVG(data: ImageData, options: Record<string, unknown>): string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image could not be loaded for tracing."));
    img.src = src;
  });
}

/** Trace an image node and replace it with an SVG layer. Returns the new node id. */
export async function vectorizeImage(fileId: string, imageId: NodeId, detail: TraceDetail = "medium"): Promise<NodeId> {
  const file = getOpenFile(fileId);
  const node = file?.store.doc.nodes[imageId];
  if (!file || !node || node.type !== "Image") throw new Error("Select an image to vectorise.");
  const src = resolveSrc(fileId, node.src);
  if (!src) throw new Error("This image has no source to trace.");
  const rect = getWorldRect(imageId);
  const img = await loadImage(src);
  const element = getNodeElement(imageId);
  const dispW = element?.offsetWidth || rect?.width || img.naturalWidth;
  const dispH = element?.offsetHeight || rect?.height || img.naturalHeight;
  // trace at a working resolution with the displayed aspect ratio, then scale up to the displayed size
  const longest = Math.max(dispW, dispH);
  const k = Math.min(1, WORK_SIZE[detail] / longest, Math.max(img.naturalWidth, img.naturalHeight) / longest);
  const workW = Math.max(1, Math.round(dispW * k));
  const workH = Math.max(1, Math.round(dispH * k));
  const canvas = document.createElement("canvas");
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const placement = rasterPlacement(img.naturalWidth, img.naturalHeight, dispW, dispH, String(node.styles.objectFit ?? "fill"), String(node.styles.objectPosition ?? "50% 50%"));
  ctx.drawImage(img, placement.x * workW / dispW, placement.y * workH / dispH, placement.width * workW / dispW, placement.height * workH / dispH);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, workW, workH);
  } catch {
    throw new Error("The image comes from another site that does not allow reading its pixels, so it cannot be traced.");
  }
  const mod = (await import("imagetracerjs")) as unknown as { default?: Tracer } & Tracer;
  const tracer: Tracer = mod.default ?? mod;
  const svg = tracer.imagedataToSVG(data, { ...PRESETS[detail], scale: 1, roundcoords: 2, viewbox: true, desc: false, strokewidth: 1 });
  const { trees } = htmlToTrees(svg);
  const traced = trees[0];
  const paths: NodeTree[] = (traced?.children ?? [])
    .filter((c) => c.tag === "path" && c.attrs?.opacity !== "0" && Number(c.attrs?.opacity ?? 1) > 0.02)
    .map((c) => ({ type: "SVGElement", tag: "path", attrs: c.attrs }));
  if (paths.length === 0) throw new Error("Tracing found no shapes in this image.");

  const position: StyleMap = { ...node.styles };
  for (const key of ["objectFit", "objectPosition", "width", "height"]) delete position[key];
  const tree = vectorSvgTree(`${node.name || "Image"} (vector)`, dispW, dispH, paths, position);
  tree.attrs = { ...tree.attrs, viewBox: `0 0 ${workW} ${workH}` };
  if (file.store.doc.nodes[imageId] !== node) throw new Error("The image changed while tracing. Try again.");
  return file.store.transact("Vectorise image", (tx) => {
    const parentId = tx.doc.nodes[imageId].parentId!;
    const index = tx.doc.nodes[parentId].children.indexOf(imageId);
    const [id] = tx.insertTrees(parentId, [tree], index + 1);
    tx.deleteNode(imageId);
    return id;
  });
}
