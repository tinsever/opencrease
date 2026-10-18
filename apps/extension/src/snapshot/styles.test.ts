import { describe, expect, it } from "vitest";
import { ALLOWED_STYLES } from "@opencrease/css";
import { genericFamily, hexColors, pxNumber, snapshotStyles } from "./styles";

const read = (values: Record<string, string>) => (key: string) => values[key] ?? "";

describe("Snapshot computed styles", () => {
  it("normalises paint through the shared allowlist without margins or source layout", () => {
    const styles = snapshotStyles(read({
      "background-color": "rgb(255, 255, 255)", "background-image": "linear-gradient(rgb(0, 0, 0), rgb(255, 0, 0))",
      "border-top-style": "solid", "border-top-width": "1.33333px", "border-top-color": "rgb(0, 0, 0)",
      opacity: "0.75", display: "grid", "margin-top": "20px", "box-shadow": "0px 1.33333px 2px rgba(0, 0, 0, 0.5)",
    }), { kind: "frame", keepFonts: true });
    expect(styles).toMatchObject({ backgroundColor: "#FFFFFF", borderTop: "1.33px solid #000000", opacity: 0.75 });
    expect(styles.backgroundImage).toBe("linear-gradient(#000000, #FF0000)");
    expect(styles.boxShadow).toContain("1.33px");
    expect(styles).not.toHaveProperty("marginTop");
    expect(styles).not.toHaveProperty("display");
    expect(Object.keys(styles).every((k) => ALLOWED_STYLES.has(k))).toBe(true);
    expect(snapshotStyles(read({}), { kind: "frame", keepFonts: true })).toEqual({});
  });

  it("preserves font weights and OpenType settings only when requested", () => {
    const source = read({ "font-family": '"News Reader", serif', "font-size": "17.125px", "font-weight": "650", "line-height": "25.5px", "font-feature-settings": '"ss01" 1, "liga" 0', "font-variation-settings": '"wght" 650', "font-variant-numeric": "tabular-nums" });
    expect(snapshotStyles(source, { kind: "text", keepFonts: true })).toMatchObject({ fontFamily: '"News Reader", serif', fontSize: 17.13, fontWeight: 650, lineHeight: "25.5px", fontFeatureSettings: '"ss01" 1, "liga" 0', fontVariantNumeric: "tabular-nums" });
    const generic = snapshotStyles(source, { kind: "text", keepFonts: false });
    expect(generic.fontFamily).toBe("serif");
    expect(generic).not.toHaveProperty("fontFeatureSettings");
  });

  it("handles numeric lengths, alpha colours and generic stacks", () => {
    expect(pxNumber("-0.00001px")).toBe(0);
    expect(pxNumber("50%" )).toBeUndefined();
    expect(hexColors("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(genericFamily('"Private Font", ui-monospace')).toBe("ui-monospace");
  });
});
