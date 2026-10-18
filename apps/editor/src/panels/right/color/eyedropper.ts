// Eyedropper. Uses the browser's EyeDropper (picks any pixel on screen, including images and
// shaders) when available; otherwise an in-app sampler that reads pixels from the canvas: shader
// canvases directly (they keep their drawing buffer), everything else from a raster of the artboard.
// Holding Shift while picking (or Shift-clicking the eyedropper button) reports `shift: true`.
import { captureNode } from "../../../agent/exporter";
import { getMountedFileId, screenToWorld, getWorldRect } from "../../../canvas/registry";

export interface Picked {
  color: string;
  shift: boolean;
}

type NativeEyeDropper = new () => { open(opts?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> };

export function nativeEyeDropper(): NativeEyeDropper | undefined {
  return (window as unknown as { EyeDropper?: NativeEyeDropper }).EyeDropper;
}

let shiftHeld = false;
let tracking = false;
function trackShift() {
  if (tracking) return;
  tracking = true;
  const on = (e: KeyboardEvent) => (shiftHeld = e.shiftKey);
  window.addEventListener("keydown", on, true);
  window.addEventListener("keyup", on, true);
  window.addEventListener("pointermove", (e) => (shiftHeld = e.shiftKey), true);
  window.addEventListener("blur", () => (shiftHeld = false));
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

function pixelHex(data: Uint8ClampedArray): string {
  const a = data[3] / 255;
  const base = `#${hex2(data[0])}${hex2(data[1])}${hex2(data[2])}`;
  return a < 0.999 ? `${base}${hex2(data[3])}` : base;
}

/** Reads one pixel of a canvas-like source at source pixel (sx, sy). */
function readPixel(source: CanvasImageSource, sx: number, sy: number): string | null {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(source, Math.floor(sx), Math.floor(sy), 1, 1, 0, 0, 1, 1);
    return pixelHex(ctx.getImageData(0, 0, 1, 1).data);
  } catch {
    return null;
  }
}

/** Colour of the canvas content under a client point. */
export async function sampleCanvasAt(x: number, y: number): Promise<string | null> {
  const hits = document.elementsFromPoint(x, y);
  const top = hits.find((el) => el.closest("[data-of-id]"));
  if (!top) return null;
  if (top instanceof HTMLCanvasElement) {
    const r = top.getBoundingClientRect();
    const px = readPixel(top, ((x - r.left) / r.width) * top.width, ((y - r.top) / r.height) * top.height);
    if (px && !(px.length === 9 && px.endsWith("00"))) return px;
  }
  // raster the artboard holding the point and read the pixel there
  const fileId = getMountedFileId();
  let artboard: Element | null = top.closest("[data-of-id]");
  while (artboard?.parentElement?.closest("[data-of-id]")) artboard = artboard.parentElement.closest("[data-of-id]");
  const id = artboard?.getAttribute("data-of-id");
  if (!fileId || !id) return null;
  const rect = getWorldRect(id);
  if (!rect) return null;
  const w = screenToWorld({ x, y });
  const shot = await captureNode(fileId, id, 1, { backgroundColor: null });
  return readPixel(shot.canvas, ((w.x - rect.x) / rect.width) * shot.canvas.width, ((w.y - rect.y) / rect.height) * shot.canvas.height);
}

/** In-app sampler: a crosshair layer over the window; click picks, Esc cancels. */
function sampleWithOverlay(): Promise<Picked | null> {
  return new Promise((resolve) => {
    const layer = document.createElement("div");
    layer.className = "of-eyedropper-layer of-popover-child";
    layer.innerHTML = `<div class="of-eyedropper-hint">Click the canvas to pick a colour. Shift adds it as a gradient stop. Esc cancels.</div>`;
    document.body.appendChild(layer);
    const done = (v: Picked | null) => {
      window.removeEventListener("keydown", key, true);
      layer.remove();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        done(null);
      }
    };
    window.addEventListener("keydown", key, true);
    layer.addEventListener("pointerdown", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      layer.style.pointerEvents = "none";
      const color = await sampleCanvasAt(e.clientX, e.clientY).catch(() => null);
      done(color ? { color, shift: e.shiftKey } : null);
    });
  });
}

export async function pickColor(opts: { shift?: boolean } = {}): Promise<Picked | null> {
  trackShift();
  const Native = nativeEyeDropper();
  if (Native) {
    try {
      const res = await new Native().open();
      return { color: res.sRGBHex, shift: Boolean(opts.shift) || shiftHeld };
    } catch {
      return null;
    }
  }
  const picked = await sampleWithOverlay();
  return picked ? { ...picked, shift: picked.shift || Boolean(opts.shift) } : null;
}
