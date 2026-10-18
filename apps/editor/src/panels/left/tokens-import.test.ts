import { describe, expect, it } from "vitest";
import { inferTokenType, parseCssTokens } from "./tokens-import";

describe("token import", () => {
  it("infers types from names and values", () => {
    expect(inferTokenType("--brand", "#ff0000")).toBe("color");
    expect(inferTokenType("--color-primary", "var(--x)")).toBe("color");
    expect(inferTokenType("--radius-md", "8px")).toBe("radius");
    expect(inferTokenType("--text-lg", "18px")).toBe("fontSize");
    expect(inferTokenType("--font-display", "Instrument Serif")).toBe("fontFamily");
    expect(inferTokenType("--font-weight-bold", "700")).toBe("fontWeight");
    expect(inferTokenType("--spacing-4", "16px")).toBe("spacing");
    expect(inferTokenType("--leading-tight", "1.2")).toBe("lineHeight");
  });
  it("parses :root and @theme blocks", () => {
    const out = parseCssTokens(":root {\n  --color-ink: #141414; /* text */\n  --spacing-4: 16px;\n  --font-weight-bold: 700;\n}\n@theme { --radius-sm: 4px }");
    expect(out).toEqual([
      { name: "--color-ink", type: "color", value: "#141414" },
      { name: "--spacing-4", type: "spacing", value: 16 },
      { name: "--font-weight-bold", type: "fontWeight", value: 700 },
      { name: "--radius-sm", type: "radius", value: 4 },
    ]);
  });
});
