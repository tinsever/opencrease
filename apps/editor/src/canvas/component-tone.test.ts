import { describe, expect, it } from "vitest";
import type { FoldDocument, OFNode } from "@opencrease/model";
import { inComponent, ownTone, selectionInComponent } from "./component-tone";

const node = (id: string, parentId: string | null, extra: Partial<OFNode> = {}): OFNode => ({
  id, type: "Frame", name: id, parentId, children: [], visible: true, locked: false, styles: {}, ...extra,
});

const doc = {
  nodes: {
    R: node("R", null, { type: "Root", children: ["A", "C", "I"] }),
    A: node("A", "R", { children: ["B"] }),
    B: node("B", "A"),
    C: node("C", "R", { component: { props: [] }, children: ["D"] }),
    D: node("D", "C", { type: "Text" }),
    I: node("I", "R", { instance: { componentId: "C", props: {}, overrides: {} }, children: ["J"] }),
    J: node("J", "I", { source: "D", type: "Text" }),
  },
} as unknown as FoldDocument;

describe("component tone", () => {
  it("marks components, sets and instances", () => {
    expect(ownTone(doc.nodes.C)).toBe("main");
    expect(ownTone(doc.nodes.I)).toBe("instance");
    expect(ownTone(node("S", null, { componentSet: {} }))).toBe("set");
    expect(ownTone(doc.nodes.A)).toBeNull();
  });

  it("colours layers inside components and instances", () => {
    expect(inComponent(doc, "D")).toBe(true);
    expect(inComponent(doc, "J")).toBe(true);
    expect(inComponent(doc, "B")).toBe(false);
    expect(selectionInComponent(doc, ["C", "J"])).toBe(true);
    expect(selectionInComponent(doc, ["C", "B"])).toBe(false);
    expect(selectionInComponent(doc, [])).toBe(false);
  });
});
