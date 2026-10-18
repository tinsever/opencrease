import { describe, expect, it } from "vitest";
import { htmlToTrees } from "@opencrease/css";
import { layoutSnapshot } from "./layout";
import { emitNode, wrapForClipboard } from "./emit";
import type { CapNode, Rect } from "./types";

function node(rect: Rect, children: CapNode[] = [], painted = false): CapNode {
  return { kind: "frame", rect, children, border: { t: 0, r: 0, b: 0, l: 0 }, padding: { t: 0, r: 0, b: 0, l: 0 }, styles: painted ? { backgroundColor: "#fff" } : {}, flow: "in", paintless: !painted };
}

describe("Snapshot layout and HTML", () => {
  it("converts measured margins into padding and gap", () => {
    const root = node({ x: 30, y: 20, w: 300, h: 180 }, [node({ x: 50, y: 40, w: 260, h: 40 }, [], true), node({ x: 50, y: 100, w: 260, h: 40 }, [], true)]);
    root.padding.l = root.padding.r = 20;
    const { node: out, stats } = layoutSnapshot(root);
    expect(out.styles).toMatchObject({ display: "flex", flexDirection: "column", gap: 20, paddingTop: 20, paddingBottom: 60 });
    expect(stats.absolute).toBe(0);
    expect(JSON.stringify(out)).not.toContain("margin");
  });

  it("preserves overlapping boxes using absolute positions relative to the border", () => {
    const root = node({ x: 100, y: 200, w: 100, h: 100 }, [node({ x: 110, y: 210, w: 50, h: 50 }), node({ x: 120, y: 220, w: 50, h: 50 })]);
    root.border.l = root.border.t = 2;
    const { node: out, stats } = layoutSnapshot(root);
    expect(stats.absolute).toBe(2);
    expect(out.styles.position).toBe("relative");
    expect(out.children?.[0].styles).toMatchObject({ position: "absolute", left: 8, top: 8, width: 50, height: 50 });
  });

  it("escapes text and attributes and emits parseable clipboard layers", () => {
    const html = emitNode({ kind: "frame", name: 'A "frame"', styles: { width: 200 }, children: [{ kind: "text", text: "A < B & C\nNext", styles: { fontSize: 16 } }] });
    expect(html).toContain("&quot;frame&quot;");
    expect(html).toContain("A &lt; B &amp; C<br>Next");
    const parsed = htmlToTrees(html);
    expect(parsed.trees[0].children?.[0]).toMatchObject({ type: "Text", text: "A < B & C\nNext" });
    expect(wrapForClipboard(html)).toContain('data-opencrease="snapshot"');
  });
});
