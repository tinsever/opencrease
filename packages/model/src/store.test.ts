import { describe, expect, it, vi } from "vitest";
import { createDocument } from "./document";
import { ModelError } from "./errors";
import { DocStore } from "./store";
import type { ChangeEvent, FoldDocument } from "./types";

function setup(opts: ConstructorParameters<typeof DocStore>[1] = {}) {
  let t = 10_000;
  const store = new DocStore(createDocument("Test", { id: "F", now: 1000 }), { now: () => t, ...opts });
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  return { store, rootId, setTime: (v: number) => (t = v) };
}

describe("DocStore transactions", () => {
  it("commits atomically and freezes state", () => {
    const { store, rootId } = setup();
    const before = store.doc;
    const ids = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{ name: "a" }]));
    expect(store.doc).not.toBe(before);
    expect(before.nodes[rootId].children).toEqual([]);
    expect(store.doc.nodes[rootId].children).toEqual(ids);
    expect(Object.isFrozen(store.doc.nodes[ids[0]])).toBe(true);
    expect(store.canUndo).toBe(true);
  });

  it("propagates errors and applies nothing", () => {
    const { store, rootId } = setup();
    const before = store.doc;
    expect(() =>
      store.transact("Bad", (tx) => {
        tx.insertTrees(rootId, [{ name: "a" }]);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.doc).toBe(before);
    expect(store.canUndo).toBe(false);
    // the store stays usable
    store.transact("Ok", (tx) => tx.insertTrees(rootId, [{}]));
    expect(store.canUndo).toBe(true);
  });

  it("bumps updatedAt on every commit, strictly increasing", () => {
    const { store, rootId, setTime } = setup();
    store.transact("a", (tx) => tx.insertTrees(rootId, [{}]));
    expect(store.doc.updatedAt).toBe(10_000);
    store.transact("b", (tx) => tx.insertTrees(rootId, [{}]));
    expect(store.doc.updatedAt).toBe(10_001);
    setTime(20_000);
    store.undo();
    expect(store.doc.updatedAt).toBe(20_000);
  });

  it("treats empty transactions as no-ops", () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.doc;
    expect(store.transact("Nothing", () => 42)).toBe(42);
    expect(store.doc).toBe(before);
    expect(store.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("joins nested transactions into the outer one", () => {
    const { store, rootId } = setup();
    store.transact("Outer", (tx) => {
      tx.insertTrees(rootId, [{}]);
      store.transact("Inner", (inner) => inner.insertTrees(rootId, [{}]));
    });
    expect(store.undoLabels).toEqual(["Outer"]);
    expect(store.doc.nodes[rootId].children).toHaveLength(2);
  });

  it("refuses undo/redo/reset inside a transaction", () => {
    const { store, rootId } = setup();
    store.transact("a", (tx) => tx.insertTrees(rootId, [{}]));
    expect(() => store.transact("b", () => store.undo())).toThrow(ModelError);
  });

  it("exposes the draft as tx.doc", () => {
    const { store, rootId } = setup();
    store.transact("a", (tx) => {
      const [id] = tx.insertTrees(rootId, [{ name: "x" }]);
      expect(tx.doc.nodes[id].name).toBe("x");
      tx.updateNode(id, { name: "y" });
      expect(tx.doc.nodes[id].name).toBe("y");
    });
  });
});

describe("undo/redo", () => {
  it("undoes and redoes steps", () => {
    const { store, rootId } = setup();
    const docs: FoldDocument[] = [store.doc];
    const [a] = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{ name: "a", styles: { width: 1 } }]));
    docs.push(store.doc);
    store.transact("Style", (tx) => tx.setStyles(a, { width: 2 }));
    docs.push(store.doc);
    store.transact("Delete", (tx) => tx.deleteNode(a));

    expect(store.undo()).toBe(true);
    expect(store.doc.nodes[a].styles.width).toBe(2);
    expect(store.undo()).toBe(true);
    expect(store.doc.nodes[a].styles.width).toBe(1);
    expect(store.undo()).toBe(true);
    expect(store.doc.nodes[a]).toBeUndefined();
    expect(store.doc.nodes).toEqual(docs[0].nodes);
    expect(store.undo()).toBe(false);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    expect(store.redo()).toBe(true);
    expect(store.doc.nodes).toEqual(docs[1].nodes);
    expect(store.redo()).toBe(true);
    expect(store.doc.nodes).toEqual(docs[2].nodes);
    expect(store.redo()).toBe(true);
    expect(store.doc.nodes[a]).toBeUndefined();
    expect(store.redo()).toBe(false);
  });

  it("clears redo on a new commit", () => {
    const { store, rootId } = setup();
    store.transact("a", (tx) => tx.insertTrees(rootId, [{}]));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.transact("b", (tx) => tx.insertTrees(rootId, [{}]));
    expect(store.canRedo).toBe(false);
  });

  it("never rewinds the id clock", () => {
    const { store, rootId } = setup();
    const [a] = store.transact("a", (tx) => tx.insertTrees(rootId, [{}]));
    const clock = store.doc.clock;
    store.undo();
    expect(store.doc.clock).toBe(clock);
    const [b] = store.transact("b", (tx) => tx.insertTrees(rootId, [{}]));
    expect(b).not.toBe(a);
  });

  it("restores tokens, pages and document name", () => {
    const { store } = setup();
    const original = store.doc;
    store.transact("All", (tx) => {
      tx.createToken({ type: "color", name: "--x", value: "red" });
      tx.createPage("Two");
      tx.setDocName("Renamed");
    });
    store.undo();
    expect(store.doc.tokens).toEqual(original.tokens);
    expect(store.doc.pages).toEqual(original.pages);
    expect(store.doc.pageList).toEqual(original.pageList);
    expect(store.doc.name).toBe("Test");
  });

  it("merges consecutive steps with the same mergeKey", () => {
    const { store, rootId } = setup();
    const [a] = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{ styles: { left: 0 } }]));
    for (let x = 1; x <= 5; x++) store.transact("Drag", (tx) => tx.setStyles(a, { left: x }), { mergeKey: "drag-1" });
    expect(store.undoLabels).toEqual(["Insert", "Drag"]);
    expect(store.doc.nodes[a].styles.left).toBe(5);
    store.undo();
    expect(store.doc.nodes[a].styles.left).toBe(0);
    store.redo();
    expect(store.doc.nodes[a].styles.left).toBe(5);
  });

  it("does not merge across different keys, origins or an undo", () => {
    const { store, rootId } = setup();
    const [a] = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{ styles: { left: 0 } }]));
    store.transact("Drag", (tx) => tx.setStyles(a, { left: 1 }), { mergeKey: "k" });
    store.transact("Drag", (tx) => tx.setStyles(a, { left: 2 }), { mergeKey: "other" });
    store.transact("Drag", (tx) => tx.setStyles(a, { left: 3 }), { mergeKey: "other", origin: "agent" });
    expect(store.undoLabels).toHaveLength(4);
    store.undo();
    store.transact("Drag", (tx) => tx.setStyles(a, { left: 4 }), { mergeKey: "other" });
    expect(store.undoLabels).toHaveLength(4);
    store.undo();
    expect(store.doc.nodes[a].styles.left).toBe(2);
  });

  it("caps history at 500 entries by default", () => {
    const { store, rootId } = setup();
    const [a] = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{}]));
    for (let i = 1; i <= 520; i++) store.transact(`s${i}`, (tx) => tx.setStyles(a, { width: i }));
    expect(store.undoLabels).toHaveLength(500);
    expect(store.undoLabels[0]).toBe("s21");
    let steps = 0;
    while (store.undo()) steps++;
    expect(steps).toBe(500);
    expect(store.doc.nodes[a].styles.width).toBe(20);
  });

  it("honours a custom history limit", () => {
    const { store, rootId } = setup({ historyLimit: 2 });
    for (let i = 0; i < 5; i++) store.transact(`s${i}`, (tx) => tx.insertTrees(rootId, [{}]));
    expect(store.undoLabels).toEqual(["s3", "s4"]);
  });
});

describe("subscribe", () => {
  it("emits change events for commits, undo and redo", () => {
    const { store, rootId } = setup();
    const events: ChangeEvent[] = [];
    const docs: FoldDocument[] = [];
    const off = store.subscribe((doc, change) => {
      docs.push(doc);
      events.push(change);
    });
    const [a] = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{ children: [{}] }]), { origin: "agent" });
    const child = store.doc.nodes[a].children[0];
    store.undo();
    store.redo();
    expect(events.map((e) => [e.label, e.origin])).toEqual([
      ["Insert", "agent"],
      ["Insert", "undo"],
      ["Insert", "redo"],
    ]);
    for (const e of events) expect(new Set(e.touched)).toEqual(new Set([rootId, a, child]));
    expect(docs[2]).toBe(store.doc);
    off();
    store.undo();
    expect(events).toHaveLength(3);
  });

  it("defaults origin to user and reports touched nodes for style edits", () => {
    const { store, rootId } = setup();
    const [a, b] = store.transact("Insert", (tx) => tx.insertTrees(rootId, [{}, {}]));
    const listener = vi.fn();
    store.subscribe(listener);
    store.transact("Style", (tx) => tx.setStyles(b, { width: 3 }));
    expect(listener).toHaveBeenCalledWith(store.doc, { label: "Style", origin: "user", touched: [b] });
    expect(listener.mock.calls[0][1].touched).not.toContain(a);
  });

  it("keeps notifying when a listener throws", () => {
    const { store, rootId } = setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    store.subscribe(() => {
      throw new Error("bad listener");
    });
    store.subscribe(good);
    store.transact("x", (tx) => tx.insertTrees(rootId, [{}]));
    expect(good).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("reset", () => {
  it("replaces the document, clears history and notifies", () => {
    const { store, rootId } = setup();
    store.transact("x", (tx) => tx.insertTrees(rootId, [{}]));
    store.undo();
    const listener = vi.fn();
    store.subscribe(listener);
    const next = createDocument("Other", { id: "G", now: 5 });
    store.reset(next);
    expect(store.doc).toBe(next);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(listener).toHaveBeenCalledWith(next, { label: "Reset", origin: "system", touched: Object.keys(next.nodes) });
  });
});
