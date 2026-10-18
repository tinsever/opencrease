// Video export: the node is rendered frame by frame with the shader clock stepped deterministically,
// then encoded in the browser with WebCodecs and muxed with mp4-muxer (opaque H.264, VP9 or AV1) or
// webm-muxer (VP9 or VP8 with a separately encoded alpha plane, so the video keeps transparency).
import type { ExportSetting } from "@opencrease/model";
import { videoBitrate, videoTiming } from "./export-settings";
import { captureOptions, FrozenShaders, slotPlaceholder } from "./shader-frames";

export interface VideoProgress {
  frame: number;
  frames: number;
}

export interface EncodedVideo {
  blob: Blob;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  fps: number;
  codec: string;
  /** ids of the animated Shader nodes in the frame */
  animated: string[];
}

export class VideoError extends Error {}

export function videoSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

interface CodecChoice {
  /** WebCodecs codec string */
  codec: string;
  /** container codec name */
  muxer: string;
}

const MP4_CODECS: CodecChoice[] = [
  { codec: "avc1.640034", muxer: "avc" },
  { codec: "avc1.4d0034", muxer: "avc" },
  { codec: "avc1.42003e", muxer: "avc" },
  { codec: "vp09.00.51.08", muxer: "vp9" },
  { codec: "av01.0.12M.08", muxer: "av1" },
];
const WEBM_CODECS: CodecChoice[] = [
  { codec: "vp09.00.51.08", muxer: "V_VP9" },
  { codec: "vp8", muxer: "V_VP8" },
];

async function pickCodec(choices: CodecChoice[], width: number, height: number, fps: number, bitrate: number): Promise<{ choice: CodecChoice; config: VideoEncoderConfig } | null> {
  for (const choice of choices) {
    const config: VideoEncoderConfig = { codec: choice.codec, width, height, bitrate, framerate: fps, latencyMode: "quality" };
    if (choice.muxer === "avc") config.avc = { format: "avc" };
    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) return { choice, config };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Turns the serialised frame template into per-frame SVG markup with the shader images filled in. */
export function splitTemplate(markup: string, keys: string[]): Array<string | { slot: string }> {
  const parts: Array<string | { slot: string }> = [];
  let rest = markup;
  for (;;) {
    let best: { key: string; at: number; len: number } | null = null;
    for (const key of keys) {
      const ph = slotPlaceholder(key);
      const at = rest.indexOf(ph);
      if (at >= 0 && (!best || at < best.at)) best = { key, at, len: ph.length };
    }
    if (!best) break;
    parts.push(rest.slice(0, best.at), { slot: best.key });
    rest = rest.slice(best.at + best.len);
  }
  parts.push(rest);
  return parts;
}

/**
 * Load SVG markup given as URI-encoded parts. It must be a data: URL: Chromium taints a canvas that
 * draws a foreignObject SVG loaded from a blob: URL, and tainted canvases cannot become VideoFrames.
 */
async function loadSvg(encodedParts: string[]): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "sync";
  img.src = `data:image/svg+xml;charset=utf-8,${encodedParts.join("")}`;
  await img.decode();
  return img;
}

/** I420 frame whose luma is the alpha channel (chroma neutral), for the alpha stream of VP8/VP9. */
export function alphaPlaneI420(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array<ArrayBuffer> {
  const ySize = width * height;
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const out = new Uint8Array(ySize + 2 * cw * ch);
  for (let i = 0; i < ySize; i++) out[i] = rgba[i * 4 + 3];
  out.fill(128, ySize);
  return out;
}

export interface RenderVideoOptions {
  /** frame element on the canvas */
  el: HTMLElement;
  /** CSS size of the node */
  width: number;
  height: number;
  /** output size in pixels (even) */
  outWidth: number;
  outHeight: number;
  setting: ExportSetting;
  /** opaque videos are drawn on this colour */
  background: string;
  fontCss: string;
  /** extra filter for the DOM capture (overlays) */
  filter?: (n: Node) => boolean;
  onProgress?: (p: VideoProgress) => void;
  signal?: AbortSignal;
}

export async function renderVideo(o: RenderVideoOptions): Promise<EncodedVideo> {
  if (!videoSupported()) throw new VideoError("This browser cannot encode video because WebCodecs is missing. Use a Chromium based browser, or the headless CLI.");
  const transparent = o.setting.format === "webm";
  const { seconds, fps, frames } = videoTiming(o.setting);
  const W = o.outWidth;
  const H = o.outHeight;
  const bitrate = videoBitrate(W, H, fps);
  const picked = await pickCodec(transparent ? WEBM_CODECS : MP4_CODECS, W, H, fps, bitrate);
  if (!picked) throw new VideoError(`This browser cannot encode ${o.setting.format.toUpperCase()} video at ${W} × ${H}. Try a smaller size.`);

  const ratio = W / o.width;
  const shaders = FrozenShaders.freeze(o.el, ratio);
  try {
    // 1. the frame as SVG markup once, with placeholders where the shaders go
    const { domToForeignObjectSvg } = await import("modern-screenshot");
    const cap = captureOptions(null);
    const svg = await domToForeignObjectSvg(o.el, {
      width: o.width,
      height: o.height,
      backgroundColor: null,
      style: { position: "relative", left: "0px", top: "0px", right: "auto", bottom: "auto", margin: "0px", translate: "none" } as Partial<CSSStyleDeclaration>,
      font: o.fontCss ? { cssText: o.fontCss } : false,
      timeout: 15_000,
      filter: (n) => cap.filter(n) && (o.filter?.(n) ?? true),
      onCloneEachNode: cap.onCloneEachNode,
    });
    const template = splitTemplate(new XMLSerializer().serializeToString(svg), shaders.slots.map((s) => s.key)).map((p) =>
      typeof p === "string" ? encodeURIComponent(p) : p,
    );

    // 2. encoders and muxer
    const target = transparent ? new (await import("webm-muxer")).ArrayBufferTarget() : new (await import("mp4-muxer")).ArrayBufferTarget();
    let addChunk: (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined, alpha?: Uint8Array<ArrayBuffer>) => void;
    let finalize: () => void;
    if (transparent) {
      const { Muxer } = await import("webm-muxer");
      const muxer = new Muxer({ target: target as InstanceType<typeof import("webm-muxer").ArrayBufferTarget>, video: { codec: picked.choice.muxer, width: W, height: H, frameRate: fps, alpha: true } });
      addChunk = (chunk, meta, alpha) => muxer.addVideoChunk(chunk, alpha ? { ...(meta ?? {}), alphaSideData: alpha } : meta);
      finalize = () => muxer.finalize();
    } else {
      const { Muxer } = await import("mp4-muxer");
      const muxer = new Muxer({
        target: target as InstanceType<typeof import("mp4-muxer").ArrayBufferTarget>,
        video: { codec: picked.choice.muxer as "avc" | "vp9" | "av1", width: W, height: H, frameRate: fps },
        fastStart: "in-memory",
        firstTimestampBehavior: "offset",
      });
      addChunk = (chunk, meta) => muxer.addVideoChunk(chunk, meta);
      finalize = () => muxer.finalize();
    }

    let failure: Error | null = null;
    const fail = (e: unknown) => {
      failure ??= e instanceof Error ? e : new Error(String(e));
    };
    // colour and alpha chunks arrive from two encoders; pair them by timestamp, in order
    const colour = new Map<number, { chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }>();
    const alpha = new Map<number, Uint8Array<ArrayBuffer>>();
    const order: number[] = [];
    const drain = () => {
      while (order.length) {
        const ts = order[0];
        const c = colour.get(ts);
        if (!c || (transparent && !alpha.has(ts))) return;
        order.shift();
        colour.delete(ts);
        const a = alpha.get(ts);
        alpha.delete(ts);
        try {
          addChunk(c.chunk, c.meta, a);
        } catch (e) {
          fail(e);
        }
      }
    };
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        colour.set(chunk.timestamp, { chunk, meta });
        drain();
      },
      error: fail,
    });
    encoder.configure(picked.config);
    const alphaEncoder = transparent
      ? new VideoEncoder({
          output: (chunk) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            alpha.set(chunk.timestamp, data);
            drain();
          },
          error: fail,
        })
      : null;
    alphaEncoder?.configure({ ...picked.config, bitrate: Math.round(bitrate / 3) });

    // 3. frames
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: transparent })!;
    const static_ = shaders.size === 0;
    let staticImg: HTMLImageElement | null = null;
    const keyEvery = fps * 2;
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new VideoError("Export cancelled.");
      if (failure) throw failure;
      const timestamp = Math.round((i * 1e6) / fps);
      const duration = Math.round(1e6 / fps);
      let img: HTMLImageElement;
      if (static_) {
        staticImg ??= await loadSvg(template.map((p) => (typeof p === "string" ? p : "")));
        img = staticImg;
      } else {
        const shots = shaders.render((i * 1000) / fps, "image/png");
        img = await loadSvg(template.map((p) => (typeof p === "string" ? p : encodeURIComponent(shots.get(p.slot) ?? ""))));
      }
      ctx.clearRect(0, 0, W, H);
      if (!transparent) {
        ctx.fillStyle = o.background;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.drawImage(img, 0, 0, W, H);
      const keyFrame = i % keyEvery === 0;
      order.push(timestamp);
      const frame = new VideoFrame(canvas, { timestamp, duration });
      encoder.encode(frame, { keyFrame });
      frame.close();
      if (alphaEncoder) {
        const data = ctx.getImageData(0, 0, W, H).data;
        const af = new VideoFrame(alphaPlaneI420(data, W, H), { format: "I420", codedWidth: W, codedHeight: H, timestamp, duration });
        alphaEncoder.encode(af, { keyFrame });
        af.close();
      }
      while (encoder.encodeQueueSize > 6 || (alphaEncoder?.encodeQueueSize ?? 0) > 6) await new Promise((r) => setTimeout(r, 2));
      o.onProgress?.({ frame: i + 1, frames });
    }
    await encoder.flush();
    await alphaEncoder?.flush();
    encoder.close();
    alphaEncoder?.close();
    drain();
    if (failure) throw failure;
    finalize();
    const buffer = (target as { buffer: ArrayBuffer }).buffer;
    return {
      blob: new Blob([buffer], { type: transparent ? "video/webm" : "video/mp4" }),
      width: W,
      height: H,
      frames,
      seconds,
      fps,
      codec: picked.choice.codec,
      animated: shaders.animatedNodeIds,
    };
  } finally {
    shaders.restore();
  }
}
