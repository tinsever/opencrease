import { describe, expect, it } from "vitest";
import { providerKindInfo, type AiProviderKind } from "@opencrease/protocol";
import { comfyWorkflow, fitSize, generateImage, nearestRatio, openAiSize } from "./images";
import type { StoredProvider } from "./secrets";
import { fakePng } from "./testing/fake-provider";
import { bytesResponse, jsonResponse, mockFetch } from "./testing/mock-fetch";

const PNG = fakePng(8, 6, "x");
const B64 = PNG.toString("base64");

function provider(kind: AiProviderKind, extra: Partial<StoredProvider> = {}): StoredProvider {
  const info = providerKindInfo(kind)!;
  return { id: `${kind}-1`, kind, label: info.label, baseUrl: info.baseUrl || "http://127.0.0.1:9/v1", imageModel: info.imageModels[0] ?? "", chatModel: "", apiKey: "sk-test-1234", ...extra };
}

const job = { prompt: "A clay vase on linen", model: "", width: 1600, height: 900 };

describe("size helpers", () => {
  it("snaps to provider sizes and ratios", () => {
    expect(openAiSize(1600, 900, "gpt-image-1")).toBe("1536x1024");
    expect(openAiSize(400, 900, "gpt-image-1")).toBe("1024x1536");
    expect(openAiSize(500, 520, "gpt-image-1")).toBe("1024x1024");
    expect(openAiSize(1600, 900, "dall-e-3")).toBe("1792x1024");
    expect(openAiSize(1600, 900, "local-sd")).toBe("1024x576");
    expect(nearestRatio(1600, 900, ["1:1", "16:9", "4:3"])).toBe("16:9");
    expect(nearestRatio(390, 844, ["1:1", "9:16", "3:4"])).toBe("9:16");
    expect(fitSize(1440, 900, 1024, 8)).toEqual({ width: 1024, height: 640 });
  });
});

describe("OpenAI Images", () => {
  it("posts a generation and decodes b64_json", async () => {
    const f = mockFetch(() => jsonResponse({ data: [{ b64_json: B64 }] }));
    const out = await generateImage(provider("openai"), { ...job, model: "gpt-image-1" }, { fetch: f });
    expect(f.calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(f.calls[0]!.headers.authorization).toBe("Bearer sk-test-1234");
    expect(f.calls[0]!.body).toEqual({ model: "gpt-image-1", prompt: job.prompt, n: 1, size: "1536x1024" });
    expect(out.mime).toBe("image/png");
    expect(out.data.equals(PNG)).toBe(true);
    expect(out.seed).toBeUndefined();
  });

  it("sends edits as multipart with the reference image", async () => {
    const f = mockFetch(() => jsonResponse({ data: [{ b64_json: B64 }] }));
    await generateImage(provider("openai"), { ...job, model: "gpt-image-1", reference: { data: PNG, mime: "image/png" } }, { fetch: f });
    expect(f.calls[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    const form = f.calls[0]!.body as FormData;
    expect(form.get("prompt")).toBe(job.prompt);
    expect(form.get("size")).toBe("1536x1024");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("asks compatible servers for b64 and follows url responses", async () => {
    const f = mockFetch((c) => (c.url.endsWith("/images/generations") ? jsonResponse({ data: [{ url: "http://img.local/out.png" }] }) : bytesResponse(PNG)));
    const p = provider("openai-compatible", { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "" });
    const out = await generateImage(p, { ...job, model: "sdxl" }, { fetch: f });
    expect(f.calls[0]!.body).toMatchObject({ response_format: "b64_json", size: "1024x576" });
    expect(f.calls[0]!.headers.authorization).toBeUndefined();
    expect(f.calls[1]!.url).toBe("http://img.local/out.png");
    expect(out.data.equals(PNG)).toBe(true);
  });

  it("does not send a size to xAI", async () => {
    const f = mockFetch(() => jsonResponse({ data: [{ b64_json: B64 }] }));
    await generateImage(provider("xai"), { ...job, model: "grok-2-image" }, { fetch: f });
    expect(f.calls[0]!.url).toBe("https://api.x.ai/v1/images/generations");
    expect(f.calls[0]!.body).toEqual({ model: "grok-2-image", prompt: job.prompt, n: 1, response_format: "b64_json" });
  });

  it("turns provider errors into readable messages", async () => {
    const f = mockFetch(() => jsonResponse({ error: { message: "Billing hard limit reached" } }, 400));
    await expect(generateImage(provider("openai"), { ...job, model: "gpt-image-1" }, { fetch: f })).rejects.toThrow("OpenAI answered 400: Billing hard limit reached.");
    const g = mockFetch(() => jsonResponse({ error: { message: "bad key" } }, 401));
    await expect(generateImage(provider("openai"), { ...job, model: "gpt-image-1" }, { fetch: g })).rejects.toThrow(/Check the API key/);
  });
});

describe("Gemini", () => {
  it("requests an image modality with an aspect ratio and reads inlineData", async () => {
    const f = mockFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: "Here" }, { inlineData: { mimeType: "image/png", data: B64 } }] } }] }));
    const out = await generateImage(provider("gemini"), { ...job, model: "gemini-2.5-flash-image", reference: { data: PNG, mime: "image/png" } }, { fetch: f });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
    expect(call.headers["x-goog-api-key"]).toBe("sk-test-1234");
    const body = call.body as { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: Record<string, unknown> };
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } });
    expect(body.contents[0]!.parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: B64 } });
    expect(body.contents[0]!.parts[1]).toEqual({ text: `Edit this image: ${job.prompt}` });
    expect(out.data.equals(PNG)).toBe(true);
  });

  it("explains blocked prompts", async () => {
    const f = mockFetch(() => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } }));
    await expect(generateImage(provider("gemini"), { ...job, model: "gemini-2.5-flash-image" }, { fetch: f })).rejects.toThrow("Google Gemini returned no image (SAFETY).");
  });
});

describe("Replicate", () => {
  it("creates a prediction with Prefer: wait, polls until done and downloads the output", async () => {
    const f = mockFetch((c, i) => {
      if (i === 0) return jsonResponse({ id: "p1", status: "processing", urls: { get: "https://api.replicate.com/v1/predictions/p1" } }, 201);
      if (i === 1) return jsonResponse({ id: "p1", status: "succeeded", output: ["https://replicate.delivery/out.png"] });
      return bytesResponse(PNG);
    });
    const out = await generateImage(provider("replicate"), { ...job, model: "black-forest-labs/flux-schnell", seed: 7 }, { fetch: f, pollMs: 1 });
    expect(f.calls[0]!.url).toBe("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions");
    expect(f.calls[0]!.headers.prefer).toBe("wait");
    expect(f.calls[0]!.body).toEqual({ input: { prompt: job.prompt, aspect_ratio: "16:9", seed: 7, output_format: "png" } });
    expect(f.calls[1]!.url).toBe("https://api.replicate.com/v1/predictions/p1");
    expect(f.calls[2]!.url).toBe("https://replicate.delivery/out.png");
    expect(out.seed).toBe(7);
  });

  it("uses the versions endpoint for owner/name:version and reports failures", async () => {
    const f = mockFetch(() => jsonResponse({ status: "failed", error: "NSFW content detected" }));
    await expect(generateImage(provider("replicate"), { ...job, model: "acme/model:abc123" }, { fetch: f })).rejects.toThrow("NSFW content detected");
    expect(f.calls[0]!.url).toBe("https://api.replicate.com/v1/predictions");
    expect((f.calls[0]!.body as { version: string }).version).toBe("abc123");
  });
});

describe("fal", () => {
  it("posts to the model endpoint with a Key header and returns the seed", async () => {
    const f = mockFetch((c) => (c.url.startsWith("https://fal.run") ? jsonResponse({ images: [{ url: `data:image/png;base64,${B64}` }], seed: 99 }) : bytesResponse(PNG)));
    const out = await generateImage(provider("fal"), { ...job, model: "fal-ai/flux/schnell" }, { fetch: f });
    expect(f.calls[0]!.url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect(f.calls[0]!.headers.authorization).toBe("Key sk-test-1234");
    expect(f.calls[0]!.body).toMatchObject({ prompt: job.prompt, image_size: { width: 1024, height: 576 }, num_images: 1 });
    expect(out.seed).toBe(99);
    expect(out.data.equals(PNG)).toBe(true);
  });
});

describe("ComfyUI", () => {
  it("queues the default workflow, polls history and downloads the output", async () => {
    const f = mockFetch((c, i) => {
      if (c.url.endsWith("/prompt")) return jsonResponse({ prompt_id: "abc" });
      if (c.url.includes("/history/") && i === 1) return jsonResponse({});
      if (c.url.includes("/history/")) return jsonResponse({ abc: { outputs: { "9": { images: [{ filename: "opencrease_0001.png", subfolder: "", type: "output" }] } } } });
      return bytesResponse(PNG);
    });
    const out = await generateImage(provider("comfyui", { imageModel: "sdxl.safetensors" }), { ...job, model: "sdxl.safetensors", seed: 5 }, { fetch: f, pollMs: 1 });
    const body = f.calls[0]!.body as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect(body.prompt["4"]!.inputs.ckpt_name).toBe("sdxl.safetensors");
    expect(body.prompt["6"]!.inputs.text).toBe(job.prompt);
    expect(body.prompt["5"]!.inputs).toMatchObject({ width: 1024, height: 576 });
    expect(f.calls[3]!.url).toBe("http://127.0.0.1:8188/view?filename=opencrease_0001.png&subfolder=&type=output");
    expect(out.seed).toBe(5);
    expect(comfyWorkflow({ ...job, model: "m", seed: 1 })["3"]).toMatchObject({ class_type: "KSampler" });
  });

  it("refuses edits honestly and needs a checkpoint", async () => {
    const f = mockFetch(() => jsonResponse({}));
    await expect(generateImage(provider("comfyui"), { ...job, model: "" }, { fetch: f })).rejects.toThrow(/checkpoint/);
    await expect(generateImage(provider("comfyui"), { ...job, model: "m", reference: { data: PNG, mime: "image/png" } }, { fetch: f })).rejects.toThrow(/cannot edit images/);
  });
});

describe("Automatic1111", () => {
  it("uses txt2img and img2img and reads the seed from info", async () => {
    const f = mockFetch(() => jsonResponse({ images: [B64], info: JSON.stringify({ seed: 1234 }) }));
    const p = provider("automatic1111");
    const out = await generateImage(p, { ...job, model: "" }, { fetch: f });
    expect(f.calls[0]!.url).toBe("http://127.0.0.1:7860/sdapi/v1/txt2img");
    expect(f.calls[0]!.body).toMatchObject({ prompt: job.prompt, width: 1024, height: 576, steps: 25 });
    expect(out.seed).toBe(1234);
    await generateImage(p, { ...job, model: "v1-5.ckpt", reference: { data: PNG, mime: "image/png" } }, { fetch: f });
    expect(f.calls[1]!.url).toBe("http://127.0.0.1:7860/sdapi/v1/img2img");
    expect(f.calls[1]!.body).toMatchObject({ init_images: [B64], denoising_strength: 0.6, override_settings: { sd_model_checkpoint: "v1-5.ckpt" } });
  });
});

describe("guards", () => {
  it("needs a key, an image capability and edit support", async () => {
    const f = mockFetch(() => jsonResponse({}));
    await expect(generateImage(provider("openai", { apiKey: "" }), { ...job, model: "gpt-image-1" }, { fetch: f })).rejects.toThrow(/no API key/);
    await expect(generateImage(provider("anthropic"), { ...job, model: "x" }, { fetch: f })).rejects.toThrow(/cannot make images/);
    await expect(generateImage(provider("xai"), { ...job, model: "grok-2-image", reference: { data: PNG, mime: "image/png" } }, { fetch: f })).rejects.toThrow(/cannot edit images/);
    expect(f.calls).toHaveLength(0);
  });
});
