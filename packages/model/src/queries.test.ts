import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { ModelError } from "./errors";
import {
  ancestors, artboardOf, artboards, descendants, findToken, getNode, isAncestor, listPages, pageOfNode, resolveToken,
  treeSummary,
} from "./queries";
import { DocStore } from "./store";

function fixture() {
  const store = new DocStore(createDocument("Q", { id: "F", now: 0 }));
  const pageId = store.doc.pageList[0].id;
  const rootId = store.doc.pages[pageId].rootId;
  const [hero, loose] = store.transact("build", (tx) =>
    tx.insertTrees(rootId, [
      {
        name: "Hero",
        type: "Frame",
        children: [
          { name: "Headline", text: "Fired slow." },
          { name: "Body", type: "Frame", children: [{ text: "A long paragraph of copy that goes on and on past forty characters" }, {}] },
        ],
      },
      { type: "Rectangle", name: "Loose" },
    ]),
  );
  const doc = store.doc;
  const [headline, body] = doc.nodes[hero].children;
  const [para, rect] = doc.nodes[body].children;
  return { store, doc, pageId, rootId, hero, loose, headline, body, para, rect };
}

describe("tree queries", () => {
  it("getNode, ancestors, descendants, isAncestor", () => {
    const { doc, rootId, hero, body, para, rect, headline } = fixture();
    expect(getNode(doc, hero)?.name).toBe("Hero");
    expect(getNode(doc, "missing")).toBeUndefined();
    expect(getNode(doc, "constructor")).toBeUndefined();
    expect(ancestors(doc, para).map((n) => n.id)).toEqual([body, hero, rootId]);
    expect(ancestors(doc, rootId)).toEqual([]);
    expect(descendants(doc, hero).map((n) => n.id)).toEqual([headline, body, para, rect]);
    expect(descendants(doc, para)).toEqual([]);
    expect(isAncestor(doc, hero, para)).toBe(true);
    expect(isAncestor(doc, para, hero)).toBe(false);
    expect(isAncestor(doc, hero, hero)).toBe(false);
  });

  it("pageOfNode, artboardOf, artboards", () => {
    const { store, doc, pageId, rootId, hero, loose, para } = fixture();
    expect(pageOfNode(doc, para)?.id).toBe(pageId);
    expect(pageOfNode(doc, rootId)?.id).toBe(pageId);
    expect(pageOfNode(doc, "missing")).toBeUndefined();
    expect(artboardOf(doc, para)?.id).toBe(hero);
    expect(artboardOf(doc, hero)?.id).toBe(hero);
    expect(artboardOf(doc, loose)).toBeUndefined();
    expect(artboardOf(doc, rootId)).toBeUndefined();
    expect(artboards(doc, pageId).map((n) => n.id)).toEqual([hero]);
    expect(artboards(doc, "missing")).toEqual([]);
    const p2 = store.transact("page", (tx) => tx.createPage());
    expect(listPages(store.doc).map((p) => p.id)).toEqual([pageId, p2]);
  });
});

describe("treeSummary", () => {
  it("prints an indented outline with sizes and text previews", () => {
    const { doc, hero, headline, body, para, rect } = fixture();
    const sizes: Record<string, { width: number; height: number }> = {
      [hero]: { width: 1440, height: 640 },
      [headline]: { width: 272.4, height: 75.6 },
      [body]: { width: 300, height: 200 },
      [rect]: { width: 10, height: 10 },
    };
    const out = treeSummary(doc, hero, 5, (id) => sizes[id] ?? null);
    expect(out).toBe(
      [
        `Frame "Hero" (${hero}) 1440×640`,
        `  Text "Headline" (${headline}) 272×76 "Fired slow."`,
        `  Frame "Body" (${body}) 300×200`,
        `    Text "A long paragraph of copy that goes on an" (${para}) ?×? "A long paragraph of copy that goes on a…"`,
        `    Rectangle "Rectangle" (${rect}) 10×10`,
      ].join("\n"),
    );
  });

  it("omits sizes without measure and summarises beyond depth", () => {
    const { doc, rootId, hero, loose, headline, body } = fixture();
    expect(treeSummary(doc, hero, 0)).toBe(`Frame "Hero" (${hero})\n  ... 2 children`);
    expect(treeSummary(doc, hero, 1)).toBe(
      [`Frame "Hero" (${hero})`, `  Text "Headline" (${headline}) "Fired slow."`, `  Frame "Body" (${body})`, `    ... 2 children`].join("\n"),
    );
    expect(treeSummary(doc, rootId, 0)).toBe(`Root "Root" (${rootId})\n  ... 2 children`);
    expect(treeSummary(doc, loose, 0)).toBe(`Rectangle "Loose" (${loose})`);
  });

  it("escapes quotes and newlines", () => {
    const { store, rootId } = fixture();
    const [id] = store.transact("t", (tx) => tx.insertTrees(rootId, [{ name: 'Say "hi"', text: "a\nb" }]));
    expect(treeSummary(store.doc, id, 1)).toBe(`Text "Say \\"hi\\"" (${id}) "a b"`);
  });

  it("throws for unknown nodes", () => {
    const { doc } = fixture();
    expect(() => treeSummary(doc, "missing", 1)).toThrow(ModelError);
  });
});

describe("resolveToken", () => {
  function withTokens() {
    const store = new DocStore(createDocument("T", { id: "F", now: 0 }));
    store.transact("tokens", (tx) => {
      tx.createToken({ type: "color", name: "--color-base", value: "oklch(0.6 0.2 30)" });
      tx.createToken({ type: "color", name: "--color-primary", value: "var(--color-base)" });
      tx.createToken({ type: "color", name: "--color-button", value: "var( --color-primary )" });
      tx.createToken({ type: "spacing", name: "--spacing-4", value: 16 });
      tx.createToken({ type: "color", name: "--color-dangling", value: "var(--nope, #000)" });
      tx.createToken({ type: "color", name: "--color-broken", value: "var(--nope)" });
      tx.createToken({ type: "color", name: "--color-mix", value: "color-mix(in oklch, var(--color-base) 50%, white)" });
    });
    return store.doc;
  }

  it("follows aliases", () => {
    const doc = withTokens();
    expect(resolveToken(doc, "--color-button")).toBe("oklch(0.6 0.2 30)");
    expect(resolveToken(doc, "color-primary")).toBe("oklch(0.6 0.2 30)");
    expect(resolveToken(doc, "var(--color-button)")).toBe("oklch(0.6 0.2 30)");
    expect(resolveToken(doc, "--spacing-4")).toBe(16);
    expect(resolveToken(doc, "--color-mix")).toBe("color-mix(in oklch, var(--color-base) 50%, white)");
  });

  it("uses fallbacks, returns undefined for unknown names", () => {
    const doc = withTokens();
    expect(resolveToken(doc, "--color-dangling")).toBe("#000");
    expect(resolveToken(doc, "--color-broken")).toBeUndefined();
    expect(resolveToken(doc, "--missing")).toBeUndefined();
  });

  it("is cycle safe on hand-edited documents", () => {
    const doc = withTokens();
    const cyclic = {
      ...doc,
      tokens: [
        { id: "1", type: "color" as const, name: "--a", value: "var(--b)" },
        { id: "2", type: "color" as const, name: "--b", value: "var(--a)" },
      ],
    };
    expect(resolveToken(cyclic, "--a")).toBeUndefined();
  });

  it("findToken by name or id", () => {
    const doc = withTokens();
    const t = doc.tokens[0];
    expect(findToken(doc, t.id)).toBe(t);
    expect(findToken(doc, "color-base")).toBe(t);
  });
});
