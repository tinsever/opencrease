import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { parseDtcg, tokensToDtcg } from "./dtcg";
import { DocStore } from "./store";
import { importTokens } from "./token-import";

function themedStore() {
  const store = new DocStore(createDocument("T"));
  store.transact("t", (tx) => {
    tx.createModeCollection("Theme", ["light", "dark"]);
    tx.createToken({ type: "color", name: "--color-surface", value: "#ffffff", modes: { dark: "#111111" }, description: "Page background" });
    tx.createToken({ type: "color", name: "--brand", value: "var(--color-surface)" });
    tx.createToken({ type: "spacing", name: "--spacing-4", value: 16 });
    tx.createToken({ type: "radius", name: "--radius-lg", value: "12px" });
    tx.createToken({ type: "fontFamily", name: "--font-display", value: '"Instrument Serif", serif' });
    tx.createToken({ type: "fontWeight", name: "--font-weight-bold", value: 700 });
    tx.createToken({ type: "lineHeight", name: "--leading-tight", value: 1.2 });
    tx.createToken({ type: "opacity", name: "--opacity-muted", value: 0.6 });
  });
  return store;
}

describe("DTCG export", () => {
  it("groups by type, writes references and keeps modes in extensions", () => {
    const json = JSON.parse(tokensToDtcg(themedStore().doc));
    expect(json.color.$type).toBe("color");
    expect(json.color.surface.$value).toBe("#ffffff");
    expect(json.color.surface.$description).toBe("Page background");
    expect(json.color.surface.$extensions.opencrease.modes).toEqual({ dark: "#111111" });
    expect(json.color.brand.$value).toBe("{color.surface}");
    expect(json.spacing.$type).toBe("dimension");
    expect(json.spacing["4"].$value).toBe("16px");
    expect(json.fontFamily.display.$value).toEqual(["Instrument Serif", "serif"]);
    expect(json.fontWeight.bold.$value).toBe(700);
    expect(json.$extensions.opencrease.modeCollections).toEqual([{ name: "Theme", modes: ["light", "dark"] }]);
  });
});

describe("DTCG round trip", () => {
  it("re-imports into an empty file with the same tokens and modes", () => {
    const source = themedStore();
    const parsed = parseDtcg(tokensToDtcg(source.doc));
    expect(parsed.warnings).toEqual([]);
    const target = new DocStore(createDocument("Copy"));
    target.transact("import", (tx) => importTokens(tx, parsed));
    const strip = (d: typeof source.doc) => d.tokens.map(({ id: _id, ...rest }) => rest);
    const expected = strip(source.doc).map((t) => (t.name === "--spacing-4" ? { ...t, value: "16px" } : t));
    expect(strip(target.doc)).toEqual(expected);
    expect(target.doc.modeCollections?.map((c) => [c.name, c.modes])).toEqual([["Theme", ["light", "dark"]]]);
  });
});

describe("DTCG import from other tools", () => {
  it("handles nested groups, inherited types, object dimensions and references", () => {
    const parsed = parseDtcg({
      color: {
        $type: "color",
        brand: { primary: { $value: "#2f64d6" }, hover: { $value: "{color.brand.primary}" } },
        srgb: { $value: { colorSpace: "srgb", components: [1, 0, 0] } },
      },
      space: { $type: "dimension", sm: { $value: { value: 8, unit: "px" } } },
      radius: { $type: "dimension", md: { $value: "6px" } },
      font: { body: { $type: "fontFamily", $value: ["Inter", "sans-serif"] } },
      motion: { fast: { $type: "duration", $value: "100ms" } },
    });
    const byName = Object.fromEntries(parsed.tokens.map((t) => [t.name, t]));
    expect(byName["--color-brand-primary"]).toMatchObject({ type: "color", value: "#2f64d6" });
    expect(byName["--color-brand-hover"].value).toBe("var(--color-brand-primary)");
    expect(byName["--color-srgb"].value).toBe("color(srgb 1 0 0)");
    expect(byName["--space-sm"]).toMatchObject({ type: "spacing", value: "8px" });
    expect(byName["--radius-md"].type).toBe("radius");
    expect(byName["--font-body"]).toMatchObject({ type: "fontFamily", value: "Inter, sans-serif" });
    expect(parsed.warnings.some((w) => w.includes("motion.fast"))).toBe(true);
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(parseDtcg("{nope").warnings[0]).toMatch(/Not valid JSON/);
  });
});
