import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, DocStore, getNode, type NodeId, type Tx } from "@opencrease/model";
import type { ToolResult } from "@opencrease/protocol";
import type { ToolEnv } from "../env";
import { REVIEW_THRESHOLD, ReviewTracker } from "../review";
import { runEditorTool } from "./index";

interface Fake {
  env: ToolEnv;
  store: DocStore;
  touched: Set<NodeId>;
  work: Record<NodeId, { client: string }>;
  reviewedIds: NodeId[];
}

function makeEnv(store: DocStore, pageId: string): Fake {
  const touched = new Set<NodeId>();
  const work: Record<NodeId, { client: string }> = {};
  const reviewedIds: NodeId[] = [];
  let tx = 0;
  const env: ToolEnv = {
    fileId: store.doc.id,
    get doc() {
      return store.doc;
    },
    client: { name: "claude-code" },
    activePageId: pageId,
    selection: [],
    editorUrl: (p) => `http://localhost:5193${p}`,
    transact<T>(fn: (t: Tx) => T): T {
      if (tx++ > 0) throw new Error("second transaction");
      return store.transact("Agent", fn, { origin: "agent" });
    },
    touch: (ids) => {
      for (const id of ids) touched.add(id);
    },
    measure: () => null,
    computedStyle: () => null,
    settle: async () => {},
    showPage: async () => {},
    screenshot: async () => ({ data: "AAAA", mimeType: "image/png", width: 1, height: 1 }),
    exportNodes: async (reqs) => ({ files: reqs.map((r) => ({ nodeId: r.nodeId, name: "x", format: r.settings[0].format, scale: r.settings[0].scale, path: `/tmp/${r.nodeId}.png`, width: 1, height: 1 })), errors: [] }),
    exportCombinedPdf: async (ids) => ({ path: "/tmp/a.pdf", pages: ids }),
    fontFamilies: async (names) => ({ fontsPerFamily: Object.fromEntries(names.map((n) => [n, [{ style: "Regular", weight: 400, isItalic: false }]])), errors: [] }),
    fillImage: async () => {
      throw new Error("no image");
    },
    assetMeta: async () => null,
    agentWork: () => work,
    releaseWork: (ids) => {
      for (const id of ids) delete work[id];
    },
    reviewed: (id) => reviewedIds.push(id),
  };
  return { env, store, touched, work, reviewedIds };
}

let review = new ReviewTracker();

async function call(store: DocStore, tool: string, args: Record<string, unknown>, pageId = Object.keys(store.doc.pages)[0], fake?: Fake) {
  const f = fake ?? makeEnv(store, pageId);
  f.reviewedIds.length = 0;
  const out = await runEditorTool(tool, { fileId: store.doc.id, ...args }, f.env, { review, touched: () => f.touched });
  return { ...out, fake: f, json: (i = 1) => JSON.parse((out.result.content[i] as { text: string }).text) };
}

function texts(r: ToolResult): string[] {
  return r.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`));
}

describe("editor tools", () => {
  let store: DocStore;
  let pageId: string;
  let rootId: string;

  beforeEach(() => {
    review = new ReviewTracker();
    store = new DocStore(createDocument("Landing", { id: "01TEST", clientId: "0" }));
    pageId = Object.keys(store.doc.pages)[0];
    rootId = store.doc.pages[pageId].rootId;
  });

  async function artboard(name = "Home", styles: Record<string, unknown> = { width: "1440px", height: "900px" }) {
    const r = await call(store, "create_artboard", { name, styles });
    expect(r.ok, texts(r.result).join("\n")).toBe(true);
    return r.json().id as string;
  }

  it("puts the file header first", async () => {
    const r = await call(store, "get_basic_info", {});
    const header = JSON.parse((r.result.content[0] as { text: string }).text);
    expect(header).toMatchObject({ file: { id: "01TEST", name: "Landing" }, contentHash: { tokens: expect.stringMatching(/^[0-9a-f]{8}$/) } });
    expect(r.json()).toMatchObject({ fileName: "Landing", pageId, rootNodeId: rootId, artboardCount: 0, url: `http://localhost:5193/file/01TEST/${pageId}` });
  });

  it("creates artboards with defaults in free space", async () => {
    const a = await artboard("A");
    const b = await artboard("B", { width: 390, height: 844 });
    expect(getNode(store.doc, a)!.styles).toMatchObject({ position: "absolute", left: 0, top: 0, display: "flex", flexDirection: "column", backgroundColor: "#FFFFFF", width: "1440px" });
    expect(getNode(store.doc, b)!.styles).toMatchObject({ left: 1520, top: 0 });
    const info = (await call(store, "get_basic_info", {})).json();
    expect(info.artboards.map((x: { name: string; worldX: number; width: number }) => [x.name, x.worldX, x.width])).toEqual([["A", 0, 1440], ["B", 1520, 390]]);
    expect(store.undoLabels).toHaveLength(2);
  });

  it("writes HTML in insert-children and replace mode, with clones", async () => {
    const a = await artboard();
    const r = await call(store, "write_html", {
      targetNodeId: a,
      mode: "insert-children",
      html: '<div layer-name="Hero" style="display:flex;flex-direction:column;gap:12px;padding:24px;margin:8px"><h1 style="font-size:48px">Hello</h1><p>World</p></div>',
    });
    expect(r.ok, texts(r.result).join("\n")).toBe(true);
    const body = r.json();
    expect(body.createdNodes).toHaveLength(1);
    const hero = body.createdNodes[0];
    expect(hero).toMatchObject({ name: "Hero", component: "Frame" });
    const heroNode = getNode(store.doc, hero.id)!;
    expect(heroNode.children.map((id) => getNode(store.doc, id)!.text)).toEqual(["Hello", "World"]);
    expect(body.warnings?.join(" ") ?? "").toMatch(/margin/);

    const title = heroNode.children[0];
    const c = await call(store, "write_html", { targetNodeId: hero.id, mode: "insert-children", html: `<x-clone node-id="${title}" style="color:red"></x-clone>` });
    const cloneId = c.json().createdNodes[0].id;
    expect(getNode(store.doc, cloneId)).toMatchObject({ type: "Text", text: "Hello", styles: { fontSize: "48px", color: "red" } });

    const rep = await call(store, "write_html", { targetNodeId: title, mode: "replace", html: "<div>Bye</div>" });
    expect(rep.ok).toBe(true);
    expect(getNode(store.doc, title)).toBeUndefined();
    expect(getNode(store.doc, getNode(store.doc, hero.id)!.children[0])!.text).toBe("Bye");
    expect(store.undoLabels).toHaveLength(4);

    const bad = await call(store, "write_html", { targetNodeId: cloneId, mode: "insert-children", html: "<div>x</div>" });
    expect(bad.ok).toBe(false);
    expect(texts(bad.result)[0]).toMatch(/cannot have children/);
  });

  it("places top-level HTML and replaced artboards on the canvas", async () => {
    const a = await artboard();
    const r = await call(store, "write_html", { targetNodeId: rootId, mode: "insert-children", html: '<div style="width:400px;height:300px">x</div>' });
    expect(getNode(store.doc, r.json().createdNodes[0].id)!.styles).toMatchObject({ position: "absolute", left: 1520, top: 0 });
    const rep = await call(store, "write_html", { targetNodeId: a, mode: "replace", html: '<div style="width:100px;height:100px"><span>new</span></div>' });
    expect(getNode(store.doc, rep.json().createdNodes[0].id)!.styles).toMatchObject({ position: "absolute", left: 0, top: 0 });
  });

  it("updates styles, reports ignored ones and undoes in one step", async () => {
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: '<div style="padding:8px"><span>x</span></div>' });
    const id = w.json().createdNodes[0].id;
    const r = await call(store, "update_styles", { updates: [{ nodeIds: [id, a], styles: { padding: "", gap: 12, display: "inline-flex", marginTop: "4px", top: "10px" } }] });
    expect(r.ok).toBe(true);
    const updated = r.json().updatedNodes;
    const child = updated.find((u: { id: string }) => u.id === id);
    expect(child.ignoredStyles).toEqual(expect.arrayContaining(["marginTop", "display: inline-flex (converted to flex)", "top (only works with position: absolute or relative)"]));
    expect(getNode(store.doc, id)!.styles).toEqual({ gap: 12, display: "flex" });
    expect(getNode(store.doc, a)!.styles.top).toBe("10px");
    store.undo();
    expect(getNode(store.doc, id)!.styles).toEqual({ padding: "8px" });
  });

  it("sets text, renames, rejects non-text and locked layers", async () => {
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: "<div><p>One</p><p>Two</p></div>" });
    const frame = w.json().createdNodes[0].id;
    const [one, two] = getNode(store.doc, frame)!.children;
    expect((await call(store, "set_text_content", { updates: [{ nodeId: one, textContent: "Uno" }] })).ok).toBe(true);
    expect(getNode(store.doc, one)!.text).toBe("Uno");
    const bad = await call(store, "set_text_content", { updates: [{ nodeId: two, textContent: "x" }, { nodeId: frame, textContent: "y" }] });
    expect(bad.ok).toBe(false);
    expect(getNode(store.doc, two)!.text).toBe("Two");
    await call(store, "rename_nodes", { updates: [{ nodeId: frame, name: "List" }] });
    expect(getNode(store.doc, frame)!.name).toBe("List");
    store.transact("lock", (tx) => tx.updateNode(frame, { locked: true }));
    const locked = await call(store, "update_styles", { updates: [{ nodeIds: [one], styles: { color: "red" } }] });
    expect(locked.ok).toBe(false);
    expect(texts(locked.result)[0]).toMatch(/locked/);
  });

  it("moves nodes relative to siblings and across the root boundary", async () => {
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: "<div><p>A</p><p>B</p><p>C</p></div>" });
    const frame = w.json().createdNodes[0].id;
    const [pa, pb, pc] = getNode(store.doc, frame)!.children;
    const r = await call(store, "move_nodes", { moves: [{ nodeId: pc, before: pa }, { nodeId: pa, parentId: a, index: 0 }] });
    expect(r.ok, texts(r.result).join("\n")).toBe(true);
    expect(getNode(store.doc, frame)!.children).toEqual([pc, pb]);
    expect(getNode(store.doc, a)!.children[0]).toBe(pa);
    expect(r.json().affectedParents.map((p: { id: string }) => p.id).sort()).toEqual([a, frame].sort());
    await call(store, "move_nodes", { moves: [{ nodeId: frame, parentId: "root" }] });
    expect(getNode(store.doc, frame)!.parentId).toBe(rootId);
    expect(getNode(store.doc, frame)!.styles).toMatchObject({ position: "absolute", top: 0 });
    await call(store, "move_nodes", { moves: [{ nodeId: frame, parentId: a }] });
    expect(getNode(store.doc, frame)!.styles.position).toBeUndefined();
    const cyc = await call(store, "move_nodes", { moves: [{ nodeId: a, parentId: frame }] });
    expect(cyc.ok).toBe(false);
  });

  it("duplicates with a descendant id map and places artboard copies", async () => {
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: "<div><p>A</p></div>" });
    const frame = w.json().createdNodes[0].id;
    const r = await call(store, "duplicate_nodes", { nodes: [{ id: frame }, { id: a }] });
    const [d1, d2] = r.json().duplicatedNodes;
    expect(getNode(store.doc, a)!.children).toEqual([frame, d1.id]);
    const childOrig = getNode(store.doc, frame)!.children[0];
    expect(d1.descendantIdMap[childOrig]).toBe(getNode(store.doc, d1.id)!.children[0]);
    expect(getNode(store.doc, d2.id)!.styles).toMatchObject({ left: 1520, top: 0 });
  });

  it("deletes nodes and skips descendants of deleted nodes", async () => {
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: "<div><p>A</p></div>" });
    const frame = w.json().createdNodes[0].id;
    const child = getNode(store.doc, frame)!.children[0];
    const r = await call(store, "delete_nodes", { nodeIds: [child, frame] });
    expect(r.json()).toEqual({ deletedNodeIds: [frame], deletedLayerCount: 2 });
    expect((await call(store, "delete_nodes", { nodeIds: [rootId] })).ok).toBe(false);
  });

  it("appends the review checkpoint after five writes without a screenshot", async () => {
    const a = await artboard("Pricing"); // write 1
    for (let i = 2; i < REVIEW_THRESHOLD; i++) {
      const r = await call(store, "update_styles", { updates: [{ nodeIds: [a], styles: { gap: i } }] });
      expect(texts(r.result).some((t) => t.startsWith("Review checkpoint"))).toBe(false);
    }
    const fifth = await call(store, "update_styles", { updates: [{ nodeIds: [a], styles: { gap: 99 } }] });
    expect(texts(fifth.result).at(-1)).toBe('Review checkpoint: take a screenshot of "Pricing" and check spacing, type, contrast, alignment and clipping before continuing.');
    const shot = await call(store, "get_screenshot", { nodeId: a, scale: 1 });
    expect(shot.result.content[1]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
    expect(shot.fake.reviewedIds).toEqual([a]);
  });

  it("creates and renames tokens, rewriting references", async () => {
    const a = await artboard();
    const r = await call(store, "create_tokens", {
      tokens: [
        { type: "color", name: "--color-bg", value: "#fafafa" },
        { type: "color", name: "--color-surface", value: "var(--color-bg)" },
        { type: "color", name: "--color-bg", value: "#000" },
      ],
    });
    expect(r.json().results.map((x: { status: string }) => x.status)).toEqual(["created", "created", "error"]);
    await call(store, "update_styles", { updates: [{ nodeIds: [a], styles: { backgroundColor: "var(--color-bg)" } }] });
    const s = await call(store, "set_tokens", { updates: [{ name: "--color-bg", newName: "--color-canvas" }], deletes: ["--nope"] });
    expect(s.ok).toBe(true);
    expect(getNode(store.doc, a)!.styles.backgroundColor).toBe("var(--color-canvas)");
    expect(store.doc.tokens.map((t) => [t.name, t.value])).toEqual([["--color-canvas", "#fafafa"], ["--color-surface", "var(--color-canvas)"]]);
    const cyc = await call(store, "set_tokens", { updates: [{ name: "--color-canvas", value: "var(--color-surface)" }] });
    expect(cyc.ok).toBe(false);
    expect(store.doc.tokens[0].value).toBe("#fafafa");
    const del = await call(store, "set_tokens", { deletes: ["--color-surface"] });
    expect(del.json().results[0]).toMatchObject({ status: "deleted" });
    const css = await call(store, "get_tokens", { format: "css" });
    expect(texts(css.result)[1]).toContain("--color-canvas: #fafafa;");
    const filtered = await call(store, "get_tokens", { namePattern: "*canvas*" });
    expect(filtered.json().tokens).toHaveLength(1);
  });

  it("creates, updates and arranges pages with strict validation", async () => {
    const c = await call(store, "create_page", { name: "Mobile", icon: "arrow" });
    const newPage = c.json().pageId;
    expect(c.json().pages.map((p: { name: string }) => p.name)).toEqual(["Page 1", "Mobile"]);
    await call(store, "update_pages", { updates: [{ pageId: newPage, name: "Phone", icon: null }] });
    expect(store.doc.pages[newPage]).toMatchObject({ name: "Phone", icon: null });
    const incomplete = await call(store, "arrange_pages", { order: [newPage] });
    expect(incomplete.ok).toBe(false);
    expect(texts(incomplete.result)[0]).toMatch(/missing from order/);
    const ok = await call(store, "arrange_pages", { order: [newPage, { type: "divider" }, pageId] });
    expect(ok.json().pages.map((p: { type: string }) => p.type)).toEqual(["page", "divider", "page"]);
  });

  it("finds nodes by colour, token and text", async () => {
    const a = await artboard();
    await call(store, "create_tokens", { tokens: [{ type: "color", name: "--color-ink", value: "#111111" }] });
    await call(store, "write_html", {
      targetNodeId: a,
      mode: "insert-children",
      html: '<div><p style="color:#111">Get started</p><p style="color:var(--color-ink)">Pricing</p><p style="border:1px solid rgb(17,17,17)">Other</p></div>',
    });
    const byColor = (await call(store, "find_nodes", { filters: [{ styleValue: "#111111" }] })).json();
    expect(byColor.count).toBe(3);
    expect(byColor.nodes.map((n: { matched: Array<{ styleValue: string }> }) => n.matched[0].styleValue)).toEqual(["#111", "var(--color-ink)", "rgb(17,17,17)"]);
    const byToken = (await call(store, "find_nodes", { filters: [{ styleName: "color", styleValue: "--color-ink" }] })).json();
    expect(byToken.nodes.map((n: { name: string }) => n.name)).toEqual(["Pricing"]);
    const byText = (await call(store, "find_nodes", { textValue: "get *" })).json();
    expect(byText.nodes).toHaveLength(1);
    expect((await call(store, "find_nodes", { filters: [{ styleName: "border*" }], textValue: "*her" })).json().count).toBe(1);
  });

  it("reads tree summary, children, node info, jsx and selection", async () => {
    const a = await artboard("Card", { width: 320, height: 200 });
    await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: '<div layer-name="Body"><p>Hi</p></div>' });
    const summary = (await call(store, "get_tree_summary", { nodeId: a, depth: 1 })).json().summary;
    expect(summary.split("\n")[0]).toBe(`Frame "Card" (${a}) 320×200`);
    expect(summary).toContain("... 1 child");
    const kids = (await call(store, "get_children", { nodeId: a })).json();
    expect(kids.children[0]).toMatchObject({ name: "Body", component: "Frame", childCount: 1, worldX: null });
    const info = (await call(store, "get_node_info", { nodeId: a })).json();
    expect(info).toMatchObject({ id: a, component: "Frame", width: 320, height: 200, worldX: 0, worldY: 0, parentId: rootId, artboardId: a, isVisible: true });
    const jsx = await call(store, "get_jsx", { nodeId: a, format: "inline-styles", includeNodeIds: false });
    expect(texts(jsx.result)[1]).toContain("Hi");
    expect((await call(store, "get_selection", {})).json()).toEqual({ selectedNodes: [], count: 0 });
    const missing = await call(store, "get_node_info", { nodeId: "nope" });
    expect(missing.ok).toBe(false);
    expect(texts(missing.result)[0]).toMatch(/No node with id "nope"/);
  });

  it("exports images and videos through the environment", async () => {
    const a = await artboard();
    const r = await call(store, "export", { nodes: { [a]: [] } });
    expect(r.json().exports[0]).toMatchObject({ nodeId: a, format: "png", scale: "2x" });
    const v = await call(store, "export", { nodes: { [a]: [] }, type: "video" });
    expect(v.json().exports[0]).toMatchObject({ nodeId: a, format: "mp4", scale: "1x" });
    const mixed = await call(store, "export", { nodes: { [a]: [{ format: "png", scale: "1x" }, { format: "webm", scale: "720p" }] }, type: "video" });
    expect(mixed.json().exports).toHaveLength(1);
    expect(mixed.json().errors[0]).toMatch(/not a video format/);
    const none = await call(store, "export", { nodes: "nodes-with-exports-only" });
    expect(none.ok).toBe(false);
    const pdf = await call(store, "export_combined_pdf", { nodeIds: [a] });
    expect(pdf.json()).toMatchObject({ path: "/tmp/a.pdf", pageCount: 1 });
  });

  it("sets up token modes, writes per-mode values and pins frames", async () => {
    const setup = await call(store, "oc_set_mode", { collections: [{ name: "Theme", modes: ["Light", "Dark"] }] });
    expect(setup.json().results[0]).toMatchObject({ status: "created", modes: ["light", "dark"], defaultMode: "light" });
    const created = await call(store, "create_tokens", {
      tokens: [
        { type: "color", name: "--color-bg", value: "#fff", modes: { dark: "#000" } },
        { type: "color", name: "--color-fg", value: "#111" },
      ],
    });
    expect(created.json().results[0]).toMatchObject({ status: "created", modes: { dark: "#000" } });
    const dark = await call(store, "create_tokens", { mode: "dark", tokens: [{ type: "color", name: "--color-fg", value: "#eee" }] });
    expect(dark.json().results[0]).toMatchObject({ status: "updated", mode: "dark" });
    const set = await call(store, "set_tokens", { mode: "dark", updates: [{ name: "--color-bg", value: "#0a0a0a" }] });
    expect(set.json().results[0].token).toMatchObject({ value: "#fff", modes: { dark: "#0a0a0a" } });
    const cycle = await call(store, "set_tokens", { mode: "dark", updates: [{ name: "--color-bg", value: "var(--color-bg)" }] });
    expect(cycle.ok).toBe(false);
    expect(texts(cycle.result)[0]).toMatch(/cycle in mode "dark"/);

    const inDark = await call(store, "get_tokens", { mode: "dark" });
    expect(inDark.json().tokens.map((t: { value: string }) => t.value)).toEqual(["#0a0a0a", "#eee"]);
    const css = await call(store, "get_tokens", { format: "css" });
    expect(texts(css.result)[1]).toContain('[data-mode~="dark"] {\n  --color-bg: #0a0a0a;');
    const unknown = await call(store, "get_tokens", { mode: "sepia" });
    expect(texts(unknown.result)[0]).toMatch(/Modes in this file: light, dark/);

    const a = await artboard("Dark home");
    const pin = await call(store, "oc_set_mode", { pins: [{ nodeId: a, mode: "dark" }] });
    expect(pin.json().results[0]).toMatchObject({ status: "pinned", mode: "dark" });
    expect(getNode(store.doc, a)!.mode).toBe("dark");
    const jsx = await call(store, "get_jsx", { nodeId: a, format: "inline-styles" });
    expect(texts(jsx.result)[1]).toContain('data-mode="dark"');
    const badPin = await call(store, "oc_set_mode", { pins: [{ nodeId: a, mode: "sepia" }] });
    expect(badPin.ok).toBe(false);
  });

  it("keeps inline formatting from write_html as spans and set_text_content still works", async () => {
    const a = await artboard();
    const r = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: '<p style="font-size:20px">Save <b>40%</b> today</p>' });
    expect(r.json().warnings).toBeUndefined();
    const id = r.json().createdNodes[0].id;
    expect(getNode(store.doc, id)!.spans).toEqual([{ text: "Save " }, { text: "40%", styles: { fontWeight: 700 } }, { text: " today" }]);
    const info = await call(store, "get_node_info", { nodeId: id });
    expect(info.json().spans).toHaveLength(3);
    await call(store, "set_text_content", { updates: [{ nodeId: id, textContent: "Plain now" }] });
    expect(getNode(store.doc, id)).toMatchObject({ text: "Plain now" });
    expect(getNode(store.doc, id)!.spans).toBeUndefined();
  });

  it("creates, applies and updates text styles", async () => {
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: "<div>Title</div>" });
    const id = w.json().createdNodes[0].id;
    const r = await call(store, "oc_set_text_styles", {
      styles: [{ name: "Display", styles: { "font-size": "48px", fontWeight: 700, margin: "4px" } }],
      apply: [{ nodeIds: [id], style: "Display" }],
    });
    expect(r.json().results[0]).toMatchObject({ status: "created", ignoredStyles: ["margin"] });
    expect(getNode(store.doc, id)!.styles).toMatchObject({ fontSize: "48px", fontWeight: 700 });
    await call(store, "oc_set_text_styles", { styles: [{ name: "Display", styles: { fontSize: "56px", fontWeight: 700 } }] });
    expect(getNode(store.doc, id)!.styles.fontSize).toBe("56px");
    const tw = await call(store, "get_jsx", { nodeId: id, format: "tailwind" });
    expect(texts(tw.result)[1]).toContain('className="type-display"');
  });

  it("rewrites references in modes, spans and text styles when a token is renamed", async () => {
    await call(store, "oc_set_mode", { collections: [{ name: "Theme", modes: ["light", "dark"] }] });
    await call(store, "create_tokens", {
      tokens: [
        { type: "color", name: "--color-accent", value: "#f60" },
        { type: "color", name: "--color-link", value: "#00f", modes: { dark: "var(--color-accent)" } },
      ],
    });
    const a = await artboard();
    const w = await call(store, "write_html", { targetNodeId: a, mode: "insert-children", html: '<p>Go <span style="color:var(--color-accent)">now</span></p>' });
    const id = w.json().createdNodes[0].id;
    await call(store, "oc_set_text_styles", { styles: [{ name: "Link", styles: { color: "var(--color-accent)" } }] });
    await call(store, "set_tokens", { updates: [{ name: "--color-accent", newName: "--color-brand" }] });
    expect(store.doc.tokens.find((t) => t.name === "--color-link")!.modes).toEqual({ dark: "var(--color-brand)" });
    expect(getNode(store.doc, id)!.spans![1].styles).toEqual({ color: "var(--color-brand)" });
    expect(store.doc.textStyles![0].styles.color).toBe("var(--color-brand)");
  });

  it("builds components, variants and instances through the oc_ tools", async () => {
    const board = (await call(store, "create_artboard", { name: "Components", styles: { width: 800, height: 400 } })).json().id as string;
    const html = (bg: string, name: string) =>
      `<div layer-name="${name}" style="display:flex;padding:12px;background-color:${bg}"><div layer-name="Label" style="color:#fff">Shop</div></div>`;
    const written = await call(store, "write_html", { targetNodeId: board, mode: "insert-children", html: html("#111", "Button/Primary") + html("#eee", "Button/Ghost") });
    const [primary, ghost] = (written.json().createdNodes as Array<{ id: string }>).map((n) => n.id);
    const label = (id: string) => store.doc.nodes[id].children[0];

    const created = await call(store, "oc_create_component", { nodeIds: [primary, ghost] });
    expect(created.ok, texts(created.result).join()).toBe(true);
    for (const id of [primary, ghost]) {
      const r = await call(store, "oc_set_component_props", { componentId: id, props: [{ name: "label", type: "text", target: label(id) }] });
      expect(r.ok, texts(r.result).join()).toBe(true);
    }
    const set = await call(store, "oc_create_component_set", { componentIds: [primary, ghost], codeRef: { package: "@kiln/ui", export: "Button", propsMap: { label: "children" } } });
    expect(set.json().props[0]).toMatchObject({ name: "variant", options: ["primary", "ghost"] });

    const listed = await call(store, "oc_list_components", {});
    expect(listed.json().count).toBe(2);

    const inst = await call(store, "oc_create_instance", { componentId: "Button", parentId: rootId, props: { variant: "ghost", label: "Visit" } });
    expect(inst.ok, texts(inst.result).join()).toBe(true);
    const instId = inst.json().instance.id as string;
    expect(inst.json().instance).toMatchObject({ kind: "instance", componentId: ghost, props: { variant: "ghost", label: "Visit" } });

    const jsx = await call(store, "get_jsx", { nodeId: instId, includeNodeIds: false });
    expect(texts(jsx.result)[1]).toBe('import { Button } from "@kiln/ui";\n\n<Button variant="ghost">Visit</Button>');

    const summary = await call(store, "get_tree_summary", { nodeId: rootId, depth: 3 });
    expect(summary.json().summary).toContain(`Instance "Button" (${instId})`);
    expect(summary.json().summary).toContain("ComponentSet");

    const info = await call(store, "get_node_info", { nodeId: store.doc.nodes[instId].children[0] });
    expect(info.json().componentInfo).toMatchObject({ kind: "instance-layer", instanceId: instId });

    // write_html accepts the code component tag back
    const back = await call(store, "write_html", { targetNodeId: board, mode: "insert-children", html: '<Button variant="primary">Again</Button>' });
    const backId = back.json().createdNodes[0].id as string;
    expect(store.doc.nodes[backId].instance?.componentId).toBe(primary);

    // structure edits inside instances are refused with a clear message
    const del = await call(store, "delete_nodes", { nodeIds: [store.doc.nodes[instId].children[0]] });
    expect(del.ok).toBe(false);

    const props = await call(store, "oc_set_instance_props", { updates: [{ instanceId: instId, props: { variant: "primary" } }] });
    expect(props.json().instances[0].componentId).toBe(primary);
    const detached = await call(store, "oc_detach_instance", { nodeIds: [instId] });
    expect(detached.ok).toBe(true);
    expect(store.doc.nodes[instId].instance).toBeUndefined();
  });

  it("releases only the calling client's artboards", async () => {
    const fake = makeEnv(store, pageId);
    fake.work.A = { client: "claude-code" };
    fake.work.B = { client: "codex" };
    const r = await call(store, "finish_working_on_nodes", {}, pageId, fake);
    expect(r.json().released.map((x: { id: string }) => x.id)).toEqual(["A"]);
    expect(Object.keys(fake.work)).toEqual(["B"]);
  });

  it("combines SVGs through the vector tool in one agent undo step", async () => {
    const added = await call(store, "write_html", { targetNodeId: rootId, mode: "insert-children", html: '<svg width="100" height="100" style="left:0px;top:0px"><rect width="100" height="100" fill="red" /></svg><svg width="100" height="100" style="left:50px;top:0px"><ellipse cx="50" cy="50" rx="50" ry="50" /></svg>' });
    const ids = added.json().createdNodes.map((n: { id: string }) => n.id);
    const before = store.doc;
    const fake = makeEnv(store, pageId);
    fake.env.measure = (id) => {
      const n = store.doc.nodes[id];
      return n ? { x: parseFloat(String(n.styles.left ?? 0)), y: parseFloat(String(n.styles.top ?? 0)), width: parseFloat(String(n.styles.width ?? 0)), height: parseFloat(String(n.styles.height ?? 0)) } : null;
    };
    const result = await call(store, "oc_boolean_op", { nodeIds: ids, operation: "subtract" }, pageId, fake);
    expect(result.ok, texts(result.result).join("\n")).toBe(true);
    const id = result.json().createdNodes[0].id;
    expect(result.json().removedNodeIds).toEqual(ids);
    expect(fake.touched.has(id)).toBe(true);
    const path = store.doc.nodes[store.doc.nodes[id].children[0]];
    expect(path.attrs?.d).toContain("C");
    const html = await call(store, "get_jsx", { nodeId: id, format: "inline-styles" });
    expect(texts(html.result)[1]).toContain('fill="red"');
    store.undo();
    expect(store.doc.nodes).toEqual(before.nodes);
  });

  it("converts primitives in place and rejects invalid or locked vector operands", async () => {
    const added = await call(store, "write_html", { targetNodeId: rootId, mode: "insert-children", html: '<svg width="20" height="20"><rect width="20" height="20" /></svg><p>Text</p>' });
    const [svg, text] = added.json().createdNodes.map((n: { id: string }) => n.id);
    const result = await call(store, "oc_flatten", { nodeIds: [svg], operation: "convert-to-path" });
    expect(result.ok).toBe(true);
    expect(store.doc.nodes[store.doc.nodes[svg].children[0]].tag).toBe("path");
    expect(result.fake.touched.has(svg)).toBe(true);
    const before = store.doc;
    expect((await call(store, "oc_boolean_op", { nodeIds: [svg, text], operation: "union" })).ok).toBe(false);
    expect((await call(store, "oc_flatten", { nodeIds: [svg], operation: "unknown" })).ok).toBe(false);
    expect(store.doc).toBe(before);
    store.transact("Lock", (tx) => tx.updateNode(svg, { locked: true }));
    const locked = await call(store, "oc_flatten", { nodeIds: [svg] });
    expect(locked.ok).toBe(false);
    expect(texts(locked.result)[0]).toContain("locked");
  });

});
