// Image provider adapters. Every call runs on the server, so API keys never reach the browser.
// Each adapter takes a prompt, a target size and optionally a reference image (edits), and returns bytes.
import { providerKindInfo } from "@opencrease/protocol";
import {
  downloadImage, fromBase64, joinUrl, ProviderError, requestJson, sleep,
  type FetchLike, type ImageBytes,
} from "./http-util";
import type { StoredProvider } from "./secrets";

export interface ImageJob {
  prompt: string;
  model: string;
  width: number;
  height: number;
  seed?: number;
  /** edit this image (restyle or in-paint by prompt) instead of generating from scratch */
  reference?: ImageBytes;
}

export interface GeneratedImage extends ImageBytes {
  model: string;
  /** only when the provider honours seeds */
  seed?: number;
}

export interface ImageCallOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** poll interval for async providers (Replicate, ComfyUI) */
  pollMs?: number;
  /** give up polling after this long */
  maxWaitMs?: number;
}

type Ctx = Required<Pick<ImageCallOptions, "pollMs" | "maxWaitMs">> & { fetch: FetchLike; signal?: AbortSignal };

// ---------------------------------------------------------------------------------- sizes

/** Nearest of the given "w:h" ratios to width/height (compared in log space). */
export function nearestRatio(width: number, height: number, ratios: string[]): string {
  const target = Math.log(width / height);
  let best = ratios[0]!;
  let bestD = Infinity;
  for (const r of ratios) {
    const [a, b] = r.split(":").map(Number);
    const d = Math.abs(Math.log(a! / b!) - target);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/** OpenAI Images sizes per model family; other OpenAI-compatible servers get the requested size, capped. */
export function openAiSize(width: number, height: number, model: string): string {
  const r = width / height;
  if (/^gpt-image/i.test(model)) return r > 1.2 ? "1536x1024" : r < 1 / 1.2 ? "1024x1536" : "1024x1024";
  if (/^dall-e-3/i.test(model)) return r > 1.3 ? "1792x1024" : r < 1 / 1.3 ? "1024x1792" : "1024x1024";
  if (/^dall-e-2/i.test(model)) return "1024x1024";
  const s = fitSize(width, height, 1024, 64);
  return `${s.width}x${s.height}`;
}

/** Scale so the longer side is `max`, rounded to multiples of `step`, at least 256. */
export function fitSize(width: number, height: number, max: number, step: number): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const k = max / Math.max(w, h);
  const round = (v: number) => Math.max(256, Math.round((v * k) / step) * step);
  return { width: round(w), height: round(h) };
}

const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const FLUX_RATIOS = ["1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"];

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}

function auth(p: StoredProvider): Record<string, string> {
  return p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
}

// ---------------------------------------------------------------------------------- OpenAI-style

async function openAiImages(p: StoredProvider, job: ImageJob, ctx: Ctx): Promise<GeneratedImage> {
  const who = providerKindInfo(p.kind)?.label ?? p.kind;
  const xai = p.kind === "xai";
  const gptImage = /^gpt-image/i.test(job.model);
  let json: { data?: Array<{ b64_json?: string; url?: string }> };
  if (job.reference) {
    const form = new FormData();
    form.set("model", job.model);
    form.set("prompt", job.prompt);
    if (!xai) form.set("size", openAiSize(job.width, job.height, job.model));
    if (!gptImage) form.set("response_format", "b64_json");
    form.set("image", new Blob([new Uint8Array(job.reference.data)], { type: job.reference.mime }), `reference.${job.reference.mime.split("/")[1] ?? "png"}`);
    json = await requestJson(ctx.fetch, who, joinUrl(p.baseUrl, "images/edits"), { method: "POST", headers: auth(p), body: form, signal: ctx.signal });
  } else {
    const body: Record<string, unknown> = { model: job.model, prompt: job.prompt, n: 1 };
    if (!xai) body.size = openAiSize(job.width, job.height, job.model);
    if (!gptImage) body.response_format = "b64_json";
    json = await requestJson(ctx.fetch, who, joinUrl(p.baseUrl, "images/generations"), { method: "POST", headers: auth(p), json: body, signal: ctx.signal });
  }
  const item = json.data?.[0];
  if (item?.b64_json) return { ...fromBase64(item.b64_json), model: job.model };
  if (item?.url) return { ...(await downloadImage(ctx.fetch, who, item.url)), model: job.model };
  throw new ProviderError(`${who} returned no image.`);
}

// ---------------------------------------------------------------------------------- Gemini

async function gemini(p: StoredProvider, job: ImageJob, ctx: Ctx): Promise<GeneratedImage> {
  const parts: Array<Record<string, unknown>> = [];
  if (job.reference) parts.push({ inlineData: { mimeType: job.reference.mime, data: job.reference.data.toString("base64") } });
  parts.push({ text: job.reference ? `Edit this image: ${job.prompt}` : job.prompt });
  const json = await requestJson<{ candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string } }>(
    ctx.fetch,
    "Google Gemini",
    joinUrl(p.baseUrl, `models/${encodeURIComponent(job.model)}:generateContent`),
    {
      method: "POST",
      headers: { "x-goog-api-key": p.apiKey },
      json: {
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: nearestRatio(job.width, job.height, GEMINI_RATIOS) } },
      },
      signal: ctx.signal,
    },
  );
  const out = json.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
  if (out?.inlineData?.data) return { ...fromBase64(out.inlineData.data, out.inlineData.mimeType), model: job.model };
  const why = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? json.candidates?.[0]?.content?.parts?.find((x) => x.text)?.text;
  throw new ProviderError(`Google Gemini returned no image${why ? ` (${String(why).slice(0, 200)})` : ""}.`);
}

// ---------------------------------------------------------------------------------- Replicate

interface Prediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: string };
}

async function replicate(p: StoredProvider, job: ImageJob, ctx: Ctx): Promise<GeneratedImage> {
  const seed = job.seed ?? randomSeed();
  const input: Record<string, unknown> = { prompt: job.prompt, aspect_ratio: nearestRatio(job.width, job.height, FLUX_RATIOS), seed, output_format: "png" };
  if (job.reference) input.input_image = `data:${job.reference.mime};base64,${job.reference.data.toString("base64")}`;
  const [owner, rest] = job.model.split("/");
  const version = rest?.includes(":") ? rest.split(":")[1] : undefined;
  const url = version ? joinUrl(p.baseUrl, "predictions") : joinUrl(p.baseUrl, `models/${owner}/${rest}/predictions`);
  const headers = { ...auth(p), prefer: "wait" };
  let pred = await requestJson<Prediction>(ctx.fetch, "Replicate", url, { method: "POST", headers, json: version ? { version, input } : { input }, signal: ctx.signal });
  const started = Date.now();
  while (pred.status && !["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() - started > ctx.maxWaitMs) throw new ProviderError("Replicate did not finish the image in time.");
    if (!pred.urls?.get) break;
    await sleep(ctx.pollMs, ctx.signal);
    pred = await requestJson<Prediction>(ctx.fetch, "Replicate", pred.urls.get, { headers: auth(p), signal: ctx.signal });
  }
  if (pred.status === "failed" || pred.status === "canceled") throw new ProviderError(`Replicate could not make the image: ${String(pred.error ?? pred.status)}`);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof out !== "string") throw new ProviderError("Replicate returned no image.");
  return { ...(await downloadImage(ctx.fetch, "Replicate", out)), model: job.model, seed };
}

// ---------------------------------------------------------------------------------- fal

async function fal(p: StoredProvider, job: ImageJob, ctx: Ctx): Promise<GeneratedImage> {
  const seed = job.seed ?? randomSeed();
  const size = fitSize(job.width, job.height, 1024, 16);
  const body: Record<string, unknown> = { prompt: job.prompt, image_size: size, seed, num_images: 1, enable_safety_checker: true };
  if (job.reference) body.image_url = `data:${job.reference.mime};base64,${job.reference.data.toString("base64")}`;
  const json = await requestJson<{ images?: Array<{ url?: string; content_type?: string }>; seed?: number }>(ctx.fetch, "fal", joinUrl(p.baseUrl, job.model), {
    method: "POST",
    headers: { authorization: `Key ${p.apiKey}` },
    json: body,
    signal: ctx.signal,
  });
  const url = json.images?.[0]?.url;
  if (!url) throw new ProviderError("fal returned no image.");
  return { ...(await downloadImage(ctx.fetch, "fal", url)), model: job.model, seed: typeof json.seed === "number" ? json.seed : seed };
}

// ---------------------------------------------------------------------------------- ComfyUI

/** The default text-to-image graph (ComfyUI API format) with a single checkpoint. */
export function comfyWorkflow(job: ImageJob & { seed: number }): Record<string, unknown> {
  const size = fitSize(job.width, job.height, 1024, 8);
  return {
    "3": { class_type: "KSampler", inputs: { seed: job.seed, steps: 24, cfg: 6.5, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: job.model } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: size.width, height: size.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: job.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, low quality, watermark, text", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "opencrease", images: ["8", 0] } },
  };
}

async function comfy(p: StoredProvider, job: ImageJob, ctx: Ctx): Promise<GeneratedImage> {
  if (job.reference) throw new ProviderError("Image edits are not available for ComfyUI yet. Generate a new image instead.");
  if (!job.model) throw new ProviderError("Set the ComfyUI model to a checkpoint file name in Settings, AI providers.");
  const seed = job.seed ?? randomSeed();
  const queued = await requestJson<{ prompt_id?: string; error?: unknown; node_errors?: unknown }>(ctx.fetch, "ComfyUI", joinUrl(p.baseUrl, "prompt"), {
    method: "POST",
    json: { prompt: comfyWorkflow({ ...job, seed }), client_id: "opencrease" },
    signal: ctx.signal,
  });
  if (!queued.prompt_id) throw new ProviderError(`ComfyUI did not queue the image${queued.error ? `: ${JSON.stringify(queued.error).slice(0, 200)}` : ""}.`);
  const started = Date.now();
  for (;;) {
    const hist = await requestJson<Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>; status?: { status_str?: string } }>>(
      ctx.fetch, "ComfyUI", joinUrl(p.baseUrl, `history/${queued.prompt_id}`), { signal: ctx.signal },
    );
    const entry = hist[queued.prompt_id];
    if (entry?.status?.status_str === "error") throw new ProviderError("ComfyUI reported an error while making the image.");
    const img = entry ? Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0] : undefined;
    if (img) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
      return { ...(await downloadImage(ctx.fetch, "ComfyUI", joinUrl(p.baseUrl, `view?${q}`))), model: job.model, seed };
    }
    if (Date.now() - started > ctx.maxWaitMs) throw new ProviderError("ComfyUI did not finish the image in time.");
    await sleep(ctx.pollMs, ctx.signal);
  }
}

// ---------------------------------------------------------------------------------- Automatic1111

async function a1111(p: StoredProvider, job: ImageJob, ctx: Ctx): Promise<GeneratedImage> {
  const seed = job.seed ?? randomSeed();
  const size = fitSize(job.width, job.height, 1024, 8);
  const body: Record<string, unknown> = { prompt: job.prompt, width: size.width, height: size.height, seed, steps: 25, cfg_scale: 6.5, batch_size: 1, n_iter: 1 };
  if (job.model) body.override_settings = { sd_model_checkpoint: job.model };
  if (job.reference) {
    body.init_images = [job.reference.data.toString("base64")];
    body.denoising_strength = 0.6;
  }
  const json = await requestJson<{ images?: string[]; info?: string }>(ctx.fetch, "Automatic1111", joinUrl(p.baseUrl, job.reference ? "sdapi/v1/img2img" : "sdapi/v1/txt2img"), {
    method: "POST",
    json: body,
    signal: ctx.signal,
  });
  const b64 = json.images?.[0];
  if (!b64) throw new ProviderError("Automatic1111 returned no image.");
  let used = seed;
  try {
    const info = JSON.parse(json.info ?? "{}") as { seed?: number };
    if (typeof info.seed === "number") used = info.seed;
  } catch {
    // keep the requested seed
  }
  return { ...fromBase64(b64), model: job.model, seed: used };
}

// ---------------------------------------------------------------------------------- entry

export async function generateImage(p: StoredProvider, job: ImageJob, opts: ImageCallOptions = {}): Promise<GeneratedImage> {
  const info = providerKindInfo(p.kind);
  if (!info?.capabilities.includes("image")) throw new ProviderError(`${p.label} cannot make images.`);
  if (info.key === "required" && !p.apiKey) throw new ProviderError(`${p.label} has no API key. Add one in Settings, AI providers.`);
  if (job.reference && !info.imageEdits) throw new ProviderError(`${p.label} cannot edit images. Pick a provider that supports edits, or generate a new image.`);
  if (!job.model && p.kind !== "automatic1111" && p.kind !== "comfyui") throw new ProviderError(`Set an image model for ${p.label} in Settings, AI providers.`);
  const ctx: Ctx = { fetch: opts.fetch ?? fetch, signal: opts.signal, pollMs: opts.pollMs ?? 1000, maxWaitMs: opts.maxWaitMs ?? 240_000 };
  switch (p.kind) {
    case "openai":
    case "openai-compatible":
    case "xai":
      return openAiImages(p, job, ctx);
    case "gemini":
      return gemini(p, job, ctx);
    case "replicate":
      return replicate(p, job, ctx);
    case "fal":
      return fal(p, job, ctx);
    case "comfyui":
      return comfy(p, job, ctx);
    case "automatic1111":
      return a1111(p, job, ctx);
    default:
      throw new ProviderError(`${p.label} cannot make images.`);
  }
}
