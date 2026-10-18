import { describe, expect, it } from "vitest";
import { AI_PROVIDER_KINDS, buildGenUrl, genUrlsInCss, inAppAgentClient, isGenUrl, parseGenUrl } from "./ai";

describe("gen:// URLs", () => {
  it("parses prompt, model, size and seed, with paper-gen:// as an alias", () => {
    expect(parseGenUrl("gen://image?prompt=Clay%20vase%20on%20linen&model=flux&w=800&h=600&seed=42")).toEqual({ prompt: "Clay vase on linen", model: "flux", width: 800, height: 600, seed: 42 });
    expect(parseGenUrl("paper-gen://image?prompt=Fog&width=1440&height=900")).toEqual({ prompt: "Fog", width: 1440, height: 900 });
    expect(parseGenUrl("gen://image?prompt=a+b&w=-3&h=abc")).toEqual({ prompt: "a b" });
    expect(parseGenUrl("gen://image?model=x")).toBeNull();
    expect(parseGenUrl("https://example.com/a.png")).toBeNull();
    expect(isGenUrl(" PAPER-GEN://image?prompt=x")).toBe(true);
  });

  it("builds URLs that parse back", () => {
    const spec = { prompt: "Morning fog; pines & lake", model: "m", width: 1440.4, height: 900, seed: 7 };
    expect(parseGenUrl(buildGenUrl(spec))).toEqual({ ...spec, width: 1440 });
  });

  it("finds gen URLs inside CSS values", () => {
    expect(genUrlsInCss('url("gen://image?prompt=a"), linear-gradient(red, blue), url(paper-gen://image?prompt=b&w=2)')).toEqual(["gen://image?prompt=a", "paper-gen://image?prompt=b&w=2"]);
    expect(genUrlsInCss("url(/api/files/x/assets/abc)")).toEqual([]);
  });
});

describe("provider catalogue", () => {
  it("covers every adapter and marks Claude agents", () => {
    expect(AI_PROVIDER_KINDS.map((k) => k.kind).sort()).toEqual(["anthropic", "automatic1111", "comfyui", "fal", "gemini", "openai", "openai-compatible", "replicate", "xai"]);
    expect(AI_PROVIDER_KINDS.find((k) => k.kind === "anthropic")!.chatModels[0]).toBe("claude-opus-5-5");
    expect(inAppAgentClient("anthropic")).toMatch(/claude/);
    expect(inAppAgentClient("openai-compatible")).not.toMatch(/claude/);
  });
});
