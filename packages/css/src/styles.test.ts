import { describe, expect, it } from "vitest";
import {
  ALLOWED_STYLES, camelToKebab, canonicalPropName, kebabToCamel, normalizeStyles, parseInlineStyle,
  stylesToCss, toReactStyle,
} from "./index";

describe("case helpers", () => {
  it("converts kebab to camel", () => {
    expect(kebabToCamel("background-color")).toBe("backgroundColor");
    expect(kebabToCamel("border-top-left-radius")).toBe("borderTopLeftRadius");
    expect(kebabToCamel("-webkit-text-stroke")).toBe("WebkitTextStroke");
    expect(kebabToCamel("-ms-transform")).toBe("msTransform");
    expect(kebabToCamel("--color-primary")).toBe("--color-primary");
    expect(kebabToCamel("gap")).toBe("gap");
    expect(kebabToCamel("fontSize")).toBe("fontSize");
  });

  it("converts camel to kebab", () => {
    expect(camelToKebab("backgroundColor")).toBe("background-color");
    expect(camelToKebab("WebkitTextStroke")).toBe("-webkit-text-stroke");
    expect(camelToKebab("WebkitBackgroundClip")).toBe("-webkit-background-clip");
    expect(camelToKebab("msTransform")).toBe("-ms-transform");
    expect(camelToKebab("--x")).toBe("--x");
    expect(camelToKebab("font-size")).toBe("font-size");
  });

  it("canonicalises lower-case vendor camel", () => {
    expect(canonicalPropName("webkitTextStroke")).toBe("WebkitTextStroke");
    expect(canonicalPropName("-webkit-background-clip")).toBe("WebkitBackgroundClip");
  });
});

describe("parseInlineStyle", () => {
  it("parses declarations and camelCases keys", () => {
    expect(parseInlineStyle("display: flex; flex-direction: column;gap:8px")).toEqual({
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });
  });

  it("keeps semicolons inside url(), quotes and parens", () => {
    const css =
      `background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'></svg>"); ` +
      `font-family: "Weird;Font", serif; mask-image: url(data:image/png;base64,AAA=); color: red`;
    expect(parseInlineStyle(css)).toEqual({
      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'></svg>")`,
      fontFamily: `"Weird;Font", serif`,
      maskImage: "url(data:image/png;base64,AAA=)",
      color: "red",
    });
  });

  it("strips !important and comments, last declaration wins", () => {
    expect(parseInlineStyle("color: red !important; /* c: d; */ color: blue ! IMPORTANT;")).toEqual({ color: "blue" });
  });

  it("ignores malformed declarations", () => {
    expect(parseInlineStyle("color; : red; width: ; height: 10px")).toEqual({ height: "10px" });
    expect(parseInlineStyle("")).toEqual({});
  });

  it("keeps vendor and custom properties", () => {
    expect(parseInlineStyle("-webkit-text-stroke: 1px red; --gap: 4px")).toEqual({
      WebkitTextStroke: "1px red",
      "--gap": "4px",
    });
  });

  it("keeps colons inside values", () => {
    expect(parseInlineStyle("background-image: url(https://x.test/a.png)")).toEqual({
      backgroundImage: "url(https://x.test/a.png)",
    });
  });
});

describe("normalizeStyles", () => {
  it("keeps allowlisted keys, camelCases, keeps numbers and px strings", () => {
    const r = normalizeStyles({ "background-color": "#fff", width: 120, height: "40px", fontSize: 14 });
    expect(r.styles).toEqual({ backgroundColor: "#fff", width: 120, height: "40px", fontSize: 14 });
    expect(r.ignored).toEqual([]);
  });

  it("drops and reports non-allowlisted keys", () => {
    const r = normalizeStyles({ cursor: "pointer", gridTemplateAreas: "'a b'", color: "red", transition: "all 1s" });
    expect(r.styles).toEqual({ color: "red" });
    expect(r.ignored).toEqual(["cursor", "gridTemplateAreas", "transition"]);
  });

  it("reports margins, drops zero margins silently", () => {
    const r = normalizeStyles({ margin: "8px", marginTop: 4, "margin-left": "0", marginBottom: "0px 0" });
    expect(r.styles).toEqual({});
    expect(r.ignored).toEqual(["margin", "marginTop"]);
  });

  it("keeps CSS grid and converts inline display with a note", () => {
    expect(normalizeStyles({ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gridRow: "span 2", columnGap: 8 })).toEqual({
      styles: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridRow: "span 2", columnGap: 8 },
      ignored: [],
      removed: [],
    });
    expect(normalizeStyles({ display: "inline-grid" }).styles).toEqual({ display: "grid" });
    expect(normalizeStyles({ display: "inline-block" }).styles).toEqual({ display: "block" });
    expect(normalizeStyles({ display: "inline" }).ignored).toEqual(["display: inline (converted to block)"]);
    expect(normalizeStyles({ display: "inline-flex" }).styles).toEqual({ display: "flex" });
    expect(normalizeStyles({ display: "none" })).toEqual({ styles: { display: "none" }, ignored: [], removed: [] });
    expect(normalizeStyles({ display: "contents" })).toEqual({ styles: {}, ignored: ["display: contents"], removed: [] });
  });

  it("handles position values", () => {
    expect(normalizeStyles({ position: "absolute" }).styles).toEqual({ position: "absolute" });
    expect(normalizeStyles({ position: "static" })).toEqual({ styles: {}, ignored: [], removed: [] });
    expect(normalizeStyles({ position: "fixed" }).styles).toEqual({ position: "absolute" });
    expect(normalizeStyles({ position: "sticky" }).ignored).toEqual(["position: sticky (converted to relative)"]);
  });

  it("strips !important and trims", () => {
    expect(normalizeStyles({ color: "  red !important " }).styles).toEqual({ color: "red" });
  });

  it("turns numeric strings of unitless properties into numbers", () => {
    expect(normalizeStyles({ opacity: "0.5", fontWeight: "700", zIndex: "2", lineHeight: "1.4", width: "10" }).styles).toEqual({
      opacity: 0.5,
      fontWeight: 700,
      zIndex: 2,
      lineHeight: 1.4,
      width: "10",
    });
  });

  it("splits the background shorthand into longhands when unambiguous", () => {
    expect(normalizeStyles({ background: "#fff" }).styles).toEqual({ backgroundColor: "#fff" });
    expect(normalizeStyles({ background: "var(--color-bg)" }).styles).toEqual({ backgroundColor: "var(--color-bg)" });
    expect(normalizeStyles({ background: "linear-gradient(red, blue), url(a.png)" }).styles).toEqual({
      backgroundImage: "linear-gradient(red, blue), url(a.png)",
    });
    expect(normalizeStyles({ background: "url(a.png) center / cover no-repeat" }).styles).toEqual({
      background: "url(a.png) center / cover no-repeat",
    });
  });

  it("reports null and empty values as removed, ignores non-scalar values", () => {
    const r = normalizeStyles({ color: null, width: "", foo: null, height: { a: 1 }, top: Number.NaN });
    expect(r.styles).toEqual({});
    expect(r.removed).toEqual(["color", "width"]);
    expect(r.ignored).toEqual(["height", "top"]);
  });

  it("accepts vendor text properties", () => {
    expect(normalizeStyles({ "-webkit-text-stroke": "1px #000", "-webkit-background-clip": "text", fontSynthesis: "none" }).styles).toEqual({
      WebkitTextStroke: "1px #000",
      WebkitBackgroundClip: "text",
      fontSynthesis: "none",
    });
    expect(ALLOWED_STYLES.has("WebkitTextStroke")).toBe(true);
    expect(ALLOWED_STYLES.has("margin")).toBe(false);
  });

  it("drops custom properties", () => {
    expect(normalizeStyles({ "--x": "1px" })).toEqual({ styles: {}, ignored: ["--x"], removed: [] });
  });
});

describe("stylesToCss", () => {
  it("writes kebab-case declarations with px for lengths", () => {
    expect(stylesToCss({ display: "flex", gap: 16, opacity: 0.5, lineHeight: 1.5, WebkitTextStroke: "1px red", rotate: 45, top: 0 }))
      .toBe("display: flex; gap: 16px; opacity: 0.5; line-height: 1.5; -webkit-text-stroke: 1px red; rotate: 45deg; top: 0");
  });
});

describe("toReactStyle", () => {
  it("keeps numbers and strings", () => {
    expect(toReactStyle({ width: 100, height: "50%", opacity: 0.4 })).toEqual({ width: 100, height: "50%", opacity: 0.4 });
  });

  it("canonicalises vendor keys", () => {
    expect(toReactStyle({ webkitTextStroke: "1px red", "-webkit-text-fill-color": "transparent" })).toEqual({
      WebkitTextStroke: "1px red",
      WebkitTextFillColor: "transparent",
    });
  });

  it("adds companions for line clamp, gradient text and backdrop filter", () => {
    expect(toReactStyle({ lineClamp: 2 })).toEqual({
      WebkitLineClamp: 2,
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    });
    expect(toReactStyle({ backgroundClip: "text", color: "transparent" })).toEqual({
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
    });
    expect(toReactStyle({ backdropFilter: "blur(8px)" })).toEqual({
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
    });
  });

  it("converts numeric rotate to degrees and passes custom properties", () => {
    expect(toReactStyle({ rotate: 15, "--x": "1px" })).toEqual({ rotate: "15deg", "--x": "1px" });
  });
});
