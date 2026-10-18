import { describe, expect, it } from "vitest";
import type { OFNode } from "@opencrease/model";
import { assetHashOf, currentImage, defaultTarget, genSpec, pendingGen, pendingImageStyle, replaceFillUrl, setFillImage } from "./gen-logic";

const H = "a".repeat(64);
function node(partial: Partial<OFNode>): OFNode {
  return { id: "1-a", type: "Frame", name: "N", parentId: "root", children: [], visible: true, locked: false, styles: {}, ...partial };
}

describe("pendingGen", () => {
  it("finds gen URLs in Image src and in background styles", () => {
    expect(pendingGen(node({ type: "Image", src: "gen://image?prompt=Vase&w=400&h=300" }))).toEqual({ target: "src", url: "gen://image?prompt=Vase&w=400&h=300", spec: { prompt: "Vase", width: 400, height: 300 } });
    expect(pendingGen(node({ styles: { backgroundImage: 'linear-gradient(red, blue), url("paper-gen://image?prompt=Fog")' } }))).toMatchObject({ target: "fill", url: "paper-gen://image?prompt=Fog", spec: { prompt: "Fog" } });
    expect(pendingGen(node({ type: "Image", src: `asset://${H}` }))).toBeNull();
    expect(pendingGen(node({ styles: { background: "#fff" } }))).toBeNull();
  });
});

describe("currentImage", () => {
  it("returns the generated image, skipping gen URLs", () => {
    expect(currentImage(node({ type: "Image", src: `asset://${H}` }))).toEqual({ target: "src", url: `asset://${H}` });
    expect(currentImage(node({ type: "Image", src: "gen://image?prompt=x" }))).toBeNull();
    expect(currentImage(node({ styles: { backgroundImage: `url(gen://image?prompt=x), url("/api/files/F/assets/${H}")` } }))).toEqual({ target: "fill", url: `/api/files/F/assets/${H}` });
    expect(assetHashOf(`/api/files/F/assets/${H}`)).toBe(H);
    expect(assetHashOf(`asset://${H}`)).toBe(H);
    expect(assetHashOf("https://x/y.png")).toBeUndefined();
  });
});

describe("fill patches", () => {
  it("swaps one URL inside a background list", () => {
    const styles = { backgroundImage: 'url("gen://image?prompt=a+b&w=1"), linear-gradient(red, blue)', background: "#fff" };
    expect(replaceFillUrl(styles, "gen://image?prompt=a+b&w=1", "/api/x")).toEqual({ backgroundImage: 'url("/api/x"), linear-gradient(red, blue)' });
    expect(replaceFillUrl(styles, "nope", "/api/x")).toBeNull();
  });

  it("replaces a URL in both background keys without leaking regexp state", () => {
    expect(replaceFillUrl({ background: 'url("gen://image?prompt=x")', backgroundImage: 'url("gen://image?prompt=x")' }, "gen://image?prompt=x", "/asset")).toEqual({ background: 'url("/asset")', backgroundImage: 'url("/asset")' });
  });

  it("adds an image fill with cover defaults", () => {
    expect(setFillImage({}, "/api/x")).toEqual({ backgroundImage: 'url("/api/x")', backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" });
    expect(setFillImage({ backgroundSize: "contain" }, "/api/x")).toEqual({ backgroundImage: 'url("/api/x")', backgroundPosition: "center", backgroundRepeat: "no-repeat" });
  });
});

describe("genSpec and targets", () => {
  it("keeps only meaningful fields", () => {
    expect(genSpec({ prompt: "p", target: "src", model: "", seed: 3, width: 400.6, edit: false })).toEqual({ prompt: "p", target: "src", seed: 3, width: 401 });
    expect(defaultTarget(node({ type: "Image" }))).toBe("src");
    expect(defaultTarget(node({ type: "Rectangle" }))).toBe("fill");
    expect(defaultTarget(node({ type: "Text" }))).toBe("new");
    expect(defaultTarget(undefined)).toBe("new");
  });
});

it("renders generation fills as placeholders while preserving other background layers", () => {
  expect(pendingImageStyle('url("paper-gen://image?prompt=fog"), url("https://example.test/image.png")')).toBe('linear-gradient(transparent, transparent), url("https://example.test/image.png")');
});
