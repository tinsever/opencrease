import { describe, expect, it } from "vitest";
import { htmlToTrees } from "./html-to-trees";
import { safeCssValue, safeImageUrl, safeSvgAttrs } from "./security";
import { toReactStyle } from "./react-style";

describe("untrusted design content", () => {
  it("discards scripts, frames, event handlers, SVG animation and active links", () => {
    const { trees } = htmlToTrees(`<script>alert(1)</script><iframe srcdoc='<script>bad</script>'></iframe><svg onload="bad()"><foreignObject><img src=x onerror=bad()></foreignObject><animate attributeName="href" to="javascript:bad()"/><a href="javascript:bad()"><text>X</text></a><image href="javascript:bad()" onerror="bad()"/><path d="M0 0L10 10" onclick="bad()"/></svg>`);
    const json = JSON.stringify(trees);
    expect(json).not.toMatch(/script|onload|onerror|onclick|foreignObject|animate|javascript:/);
    expect(json).toContain("M0 0L10 10");
  });
  it("blocks arbitrary network URLs, credentials, disguised schemes and CSS escapes", () => {
    for (const url of ["javascript:alert(1)", "java\nscript:bad", "https://evil.example/a.png", "https://images.unsplash.com.evil.example/x", "https://user@images.unsplash.com/x", "//evil.example/a", "/api/agents", "/auth?token=x"]) expect(safeImageUrl(url), url).toBe(false);
    expect(safeImageUrl("https://images.unsplash.com/photo-a?w=400")).toBe(true);
    expect(safeImageUrl("asset://abc123")).toBe(true);
    for (const value of ['url(https://evil.example/x)', 'image-set("https://evil.example/x" 1x)', 'u\\72l(https://evil.example/x)', 'url("javascript:bad()")']) expect(safeCssValue(value), value).toBe(false);
    expect(toReactStyle({ backgroundImage: 'url(https://evil.example/x)', width: 40 })).toEqual({ width: 40 });
    expect(safeSvgAttrs({ ONLOAD: "bad()", href: "javascript:bad()", d: "M0 0" }, "path")).toEqual({ d: "M0 0" });
  });
});
