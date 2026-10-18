import { describe, expect, it, vi } from "vitest";
import { createDocument, DocStore } from "@opencrease/model";
import { installPreviewPublisher, parsePreviewPath, previewArtboard, previewPath } from "./preview";
import { previewHtml } from "./html";

const workspace = vi.hoisted(() => ({ files: [] as Array<{ id: string; store: { doc: unknown } }>, changed: () => {} }));
vi.mock("../state/workspace", () => ({
  getState: () => ({ openFiles: workspace.files }),
  getOpenFile: (id: string) => workspace.files.find((file) => file.id === id),
  subscribe: (changed: () => void) => { workspace.changed = changed; return () => { workspace.changed = () => {}; }; },
}));

function fixture() {
  const store = new DocStore(createDocument("Preview"));
  const page = Object.values(store.doc.pages)[0];
  const ids = store.transact("fixture", (tx) => tx.insertTrees(page.rootId, [
    { type: "Rectangle", name: "Loose" },
    { type: "Frame", name: "First", styles: { position: "absolute", left: 800, top: 400, width: 1440, height: 900 }, children: [{ type: "Text", text: "Hello <script>", styles: { fontFamily: "Inter", fontWeight: 600 } }] },
    { type: "Frame", name: "Second", children: [{ type: "Text", text: "World" }] },
  ]));
  return { store, page, ids };
}

describe("artboard preview", () => {
  it("uses the selected board or its container, then the first frame on the active page", () => {
    const { store, page, ids } = fixture();
    const doc = store.doc;
    expect(previewArtboard(doc, [ids[2]], page.id)).toBe(ids[2]);
    expect(previewArtboard(doc, doc.nodes[ids[2]].children, page.id)).toBe(ids[2]);
    expect(previewArtboard(doc, [ids[0], "missing"], page.id)).toBe(ids[1]);
    expect(previewArtboard(doc, [], page.id)).toBe(ids[1]);
    expect(previewArtboard(doc, [], "missing")).toBeUndefined();
  });

  it("coalesces live document updates and releases channels when files close", () => {
    vi.useFakeTimers();
    const channels: Channel[] = [];
    class Channel {
      onmessage?: (event: { data: { type: string } }) => void;
      postMessage = vi.fn(); close = vi.fn();
      constructor(public name: string) { channels.push(this); }
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    try {
      workspace.files = [{ id: "f", store: { doc: { version: 1 } } }];
      const stop = installPreviewPublisher();
      expect(channels).toHaveLength(1);
      expect(channels[0].postMessage).not.toHaveBeenCalled();
      channels[0].onmessage?.({ data: { type: "request" } });
      expect(channels[0].postMessage).toHaveBeenLastCalledWith({ type: "document", doc: { version: 1 } });
      workspace.files[0].store.doc = { version: 2 }; workspace.changed();
      workspace.files[0].store.doc = { version: 3 }; workspace.changed();
      vi.advanceTimersByTime(80);
      expect(channels[0].postMessage).toHaveBeenCalledTimes(2);
      expect(channels[0].postMessage).toHaveBeenLastCalledWith({ type: "document", doc: { version: 3 } });
      workspace.changed(); vi.advanceTimersByTime(80);
      expect(channels[0].postMessage).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(6000);
      workspace.files[0].store.doc = { version: 4 }; workspace.changed(); vi.advanceTimersByTime(80);
      expect(channels[0].postMessage).toHaveBeenCalledTimes(2);
      workspace.files = []; workspace.changed();
      expect(channels[0].close).toHaveBeenCalledOnce();
      stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it("round trips preview URLs and rejects malformed routes", () => {
    expect(parsePreviewPath(previewPath("file /?", "node /#"))).toEqual({ fileId: "file /?", nodeId: "node /#" });
    for (const path of ["/", "/preview/f", "/preview/f/n/extra", "/preview/%/n"]) expect(parsePreviewPath(path)).toBeNull();
  });

  it("exports HTML at the page origin with fonts, assets and tokens, preserving the document", () => {
    const { store, ids, page } = fixture();
    const hash = "a".repeat(64);
    store.transact("assets", (tx) => {
      tx.insertTrees(ids[1], [{ type: "Image", src: `asset://${hash}` }]);
      tx.createToken({ name: "--ink", type: "color", value: "#123456" });
    });
    const before = JSON.stringify(store.doc);
    const html = previewHtml(store.doc, ids[1], "http://localhost:5212");
    expect(html).toContain("position: relative");
    expect(html).toContain("left: 0");
    expect(html).not.toContain("left: 800");
    expect(html).toContain(`http://localhost:5212/api/files/${store.doc.id}/assets/${hash}`);
    expect(html).toContain("http://localhost:5212/api/fonts/css2?family=Inter");
    expect(html).toContain('font-family:"Geist Variable"');
    expect(html).toContain("--ink: #123456");
    expect(html).toContain("Hello &lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(JSON.stringify(store.doc)).toBe(before);
    expect(() => previewHtml(store.doc, "deleted", "http://localhost:5212")).toThrow(/artboard was removed/);
    expect(previewArtboard(store.doc, [], page.id)).toBe(ids[1]);
  });
});
