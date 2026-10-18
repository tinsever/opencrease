import { describe, expect, it } from "vitest";
import { createDocument, DocStore, type NodeId } from "@opencrease/model";
import { pickTarget, selectionLevel, sizeIntent, sortByDocumentOrder, topmostOnly } from "./selection-logic";
import { clientDisplayName, clientMonogram, isClaudeClient } from "./agent-client";
import { collectFontUsage, googleFontsUrl, webFamilies } from "./fonts";

function setup() {
  const store = new DocStore(createDocument("Test", { clientId: "0" }));
  const page = Object.values(store.doc.pages)[0];
  const rootId = page.rootId;
  const ids = store.transact("seed", (tx) => {
    const [artboard, loose] = tx.insertTrees(rootId, [
      {
        type: "Frame",
        name: "Artboard",
        styles: { left: 0, top: 0, width: 1440, display: "flex", flexDirection: "column" },
        children: [
          {
            type: "Frame",
            name: "Hero",
            styles: { display: "flex", padding: 24 },
            children: [
              { type: "Text", name: "Title", text: "Hello", styles: { fontFamily: "Inter", fontWeight: 700 } },
              { type: "Frame", name: "Button", children: [{ type: "Text", text: "Go", styles: { fontStyle: "italic" } }] },
            ],
          },
          { type: "Rectangle", name: "Box", styles: { height: 40 } },
        ],
      },
      { type: "Text", name: "Loose", text: "Note", styles: { left: 2000, top: 0, fontFamily: "'Instrument Serif', serif" } },
    ]);
    const empty = tx.insertTrees(rootId, [{ type: "Frame", name: "Empty", styles: { left: 0, top: 2000, width: 100, height: 100 } }])[0];
    return { artboard, loose, empty };
  });
  const doc = store.doc;
  const byName = (name: string): NodeId => Object.values(doc.nodes).find((n) => n.name === name)!.id;
  return { store, doc, rootId, byName, ...ids };
}

describe("pickTarget", () => {
  it("selects the artboard's direct child on a plain click", () => {
    const { doc, byName } = setup();
    expect(pickTarget(doc, byName("Title"), [])).toBe(byName("Hero"));
  });
  it("keeps siblings of the selection one click away", () => {
    const { doc, byName } = setup();
    const go = doc.nodes[byName("Button")].children[0];
    expect(pickTarget(doc, go, [byName("Title")])).toBe(byName("Button"));
  });
  it("drills one level with a double click", () => {
    const { doc, byName } = setup();
    expect(pickTarget(doc, byName("Title"), [byName("Hero")], "drill")).toBe(byName("Title"));
    expect(pickTarget(doc, byName("Title"), [byName("Hero")], "normal")).toBe(byName("Hero"));
  });
  it("deep-selects the innermost node", () => {
    const { doc, byName } = setup();
    const go = doc.nodes[byName("Button")].children[0];
    expect(pickTarget(doc, go, [], "deep")).toBe(go);
  });
  it("returns null for an artboard background and the layer for loose layers and empty frames", () => {
    const { doc, artboard, loose, empty } = setup();
    expect(pickTarget(doc, artboard, [])).toBeNull();
    expect(pickTarget(doc, loose, [])).toBe(loose);
    expect(pickTarget(doc, empty, [])).toBe(empty);
  });
});

describe("sizeIntent", () => {
  it("labels fill and hug like the design", () => {
    const { doc, byName, artboard } = setup();
    expect(sizeIntent(doc, doc.nodes[artboard], "width")).toBeNull();
    expect(sizeIntent(doc, doc.nodes[artboard], "height")).toBe("Hug");
    // Hero is a flex-column child without width: stretched (Fill) wide, hugging tall
    expect(sizeIntent(doc, doc.nodes[byName("Hero")], "width")).toBe("Fill");
    expect(sizeIntent(doc, doc.nodes[byName("Hero")], "height")).toBe("Hug");
    expect(sizeIntent(doc, doc.nodes[byName("Box")], "height")).toBeNull();
    // Title in a flex row: hugs its text
    expect(sizeIntent(doc, doc.nodes[byName("Title")], "width")).toBe("Hug");
  });
  it("reads explicit values and flex grow", () => {
    const { store, byName } = setup();
    store.transact("x", (tx) => tx.setStyles(byName("Title"), { flexGrow: 1, height: "fit-content" }));
    const doc = store.doc;
    expect(sizeIntent(doc, doc.nodes[byName("Title")], "width")).toBe("Fill");
    expect(sizeIntent(doc, doc.nodes[byName("Title")], "height")).toBe("Hug");
  });
});

describe("selection helpers", () => {
  it("keeps topmost nodes and sorts by document order", () => {
    const { doc, byName } = setup();
    expect(topmostOnly(doc, [byName("Title"), byName("Hero")])).toEqual([byName("Hero")]);
    expect(sortByDocumentOrder(doc, [byName("Box"), byName("Title"), byName("Hero")])).toEqual([
      byName("Hero"), byName("Title"), byName("Box"),
    ]);
  });
  it("lists the level of the selection for select all", () => {
    const { doc, byName, rootId, artboard, loose, empty } = setup();
    expect(selectionLevel(doc, rootId, [])).toEqual([artboard, loose, empty]);
    expect(selectionLevel(doc, rootId, [byName("Title")])).toEqual([byName("Title"), byName("Button")]);
  });
});

describe("agent clients", () => {
  it("names and monograms", () => {
    expect(isClaudeClient("claude-code")).toBe(true);
    expect(clientDisplayName("claude-code")).toBe("Claude");
    expect(clientDisplayName("codex-mcp-client")).toBe("Codex");
    expect(clientMonogram("cursor")).toBe("Cu");
    expect(clientMonogram("open-code")).toBe("OC");
    expect(clientMonogram("codex-mcp-client")).toBe("Co");
  });
});

describe("fonts", () => {
  it("filters generic and local families", () => {
    expect(webFamilies("'Instrument Serif', Georgia, serif")).toEqual(["Instrument Serif"]);
    expect(webFamilies("Geist, system-ui")).toEqual([]);
  });
  it("collects family variants including inherited weight and style", () => {
    const { doc } = setup();
    const usage = collectFontUsage(doc);
    expect([...usage.get("Inter")!]).toEqual(["0,700"]);
    expect([...usage.get("Instrument Serif")!]).toEqual(["0,400"]);
  });
  it("builds css2 urls", () => {
    expect(googleFontsUrl("Instrument Serif")).toBe("https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap");
    expect(googleFontsUrl("Inter", ["0,700", "1,400", "0,400"])).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700;1,400&display=swap",
    );
  });
});
