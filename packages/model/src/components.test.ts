import { describe, expect, it } from "vitest";
import {
  addVariant, createComponent, createComponentSet, createInstance, detachInstance, hasOverrides, instancePropStates,
  listComponents, overrideCount, resetOverrides, setComponentDef, setInstanceProps,
} from "./components";
import { createDocument } from "./document";
import { parseFold, serializeFold } from "./format";
import { applyLibrary, buildLibrarySnapshot, diffIsEmpty, diffLibrary, unsubscribeLibrary } from "./library";
import { DocStore } from "./store";
import type { FoldDocument, NodeId, OFNode } from "./types";

function setup() {
  const doc = createDocument("Test", { id: "F1", now: 1 });
  const store = new DocStore(doc, { now: () => 1000 });
  const rootId = doc.pages[doc.pageList[0].id].rootId;
  return { store, rootId };
}

/** Button main: Frame > [Text "Label", Rectangle "Icon"] */
function makeButton(store: DocStore, rootId: NodeId, name = "Button") {
  return store.transact("Make button", (tx) => {
    const [id] = tx.insertTrees(rootId, [{
      type: "Frame",
      name,
      styles: { position: "absolute", left: 100, top: 100, display: "flex", padding: 12, backgroundColor: "#111111", width: 120 },
      children: [
        { type: "Text", name: "Label", text: "Click me", styles: { color: "#FFFFFF" } },
        { type: "Rectangle", name: "Icon", styles: { width: 16, height: 16, backgroundColor: "#FF0000" } },
      ],
    }]);
    createComponent(tx, id);
    const main = tx.doc.nodes[id];
    return { id, label: main.children[0], icon: main.children[1] };
  });
}

function childBySource(doc: FoldDocument, parentId: NodeId, source: string): OFNode {
  const stack = [...doc.nodes[parentId].children];
  while (stack.length) {
    const n = doc.nodes[stack.shift()!];
    if (n.source === source) return n;
    stack.push(...n.children);
  }
  throw new Error(`no layer ${source}`);
}

function frame(store: DocStore, rootId: NodeId, name = "Page frame") {
  return store.transact("Frame", (tx) => tx.insertTrees(rootId, [{ type: "Frame", name, styles: { display: "flex", width: 400, height: 300 } }])[0]);
}

describe("components: instances", () => {
  it("materialises an instance from its main component", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const host = frame(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, host));
    const doc = store.doc;
    const node = doc.nodes[inst];
    expect(node.instance).toEqual({ componentId: btn.id, props: {}, overrides: {} });
    expect(node.name).toBe("Button");
    expect(node.styles).toEqual({ display: "flex", padding: 12, backgroundColor: "#111111", width: 120 });
    expect(node.children).toHaveLength(2);
    const label = doc.nodes[node.children[0]];
    expect(label.source).toBe(btn.label);
    expect(label.text).toBe("Click me");
    expect(label.id).not.toBe(btn.label);
    expect(doc.nodes[host].children).toEqual([inst]);
  });

  it("propagates main component changes and keeps overrides", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const host = frame(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, host));
    const instLabel = store.doc.nodes[inst].children[0];

    // override the label colour and text in the instance
    store.transact("Override", (tx) => {
      tx.setStyles(instLabel, { color: "#00FF00" });
      tx.updateNode(instLabel, { text: "Buy now" });
    });
    expect(store.doc.nodes[inst].instance!.overrides[btn.label]).toEqual({ styles: { color: "#00FF00" }, text: "Buy now" });

    // change the main: colour (overridden), font size (not overridden), text (overridden)
    store.transact("Edit main", (tx) => {
      tx.setStyles(btn.label, { color: "#EEEEEE", fontSize: 18 });
      tx.updateNode(btn.label, { text: "Press" });
      tx.setStyles(btn.id, { backgroundColor: "#222222" });
    });
    const label = store.doc.nodes[instLabel];
    expect(label.styles).toEqual({ color: "#00FF00", fontSize: 18 });
    expect(label.text).toBe("Buy now");
    expect(store.doc.nodes[inst].styles.backgroundColor).toBe("#222222");
    expect(hasOverrides(store.doc, label)).toBe(true);
    expect(overrideCount(store.doc.nodes[inst])).toBe(2);
  });

  it("adds and removes layers when the main component's structure changes", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId, { styles: { left: 500, top: 0 } }));
    expect(store.doc.nodes[inst].styles.left).toBe(500);
    const [badge] = store.transact("Add", (tx) => tx.insertTrees(btn.id, [{ type: "Text", name: "Badge", text: "New" }], 0));
    expect(store.doc.nodes[inst].children.map((c) => store.doc.nodes[c].source)).toEqual([badge, btn.label, btn.icon]);
    store.transact("Delete", (tx) => tx.deleteNode(btn.icon));
    expect(store.doc.nodes[inst].children.map((c) => store.doc.nodes[c].source)).toEqual([badge, btn.label]);
    store.transact("Reorder", (tx) => tx.moveNode(badge, btn.id));
    expect(store.doc.nodes[inst].children.map((c) => store.doc.nodes[c].source)).toEqual([btn.label, badge]);
  });

  it("undoes a main component edit together with the instance update", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId));
    const instLabel = store.doc.nodes[inst].children[0];
    store.transact("Edit main", (tx) => tx.updateNode(btn.label, { text: "Changed" }));
    expect(store.doc.nodes[instLabel].text).toBe("Changed");
    store.undo();
    expect(store.doc.nodes[btn.label].text).toBe("Click me");
    expect(store.doc.nodes[instLabel].text).toBe("Click me");
    store.redo();
    expect(store.doc.nodes[instLabel].text).toBe("Changed");
    // undoing the instance creation removes it and its layers
    store.undo();
    store.undo();
    expect(store.doc.nodes[inst]).toBeUndefined();
    expect(store.doc.nodes[instLabel]).toBeUndefined();
  });

  it("refuses structural edits inside instances", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId));
    const instLabel = store.doc.nodes[inst].children[0];
    expect(() => store.transact("Insert", (tx) => tx.insertTrees(inst, [{ type: "Text", text: "x" }]))).toThrow(/instance/);
    expect(() => store.transact("Delete", (tx) => tx.deleteNode(instLabel))).toThrow(/part of the instance/);
    expect(() => store.transact("Move", (tx) => tx.moveNode(instLabel, rootId))).toThrow(/part of the instance/);
    expect(() => store.transact("Dup", (tx) => tx.duplicateNode(instLabel))).toThrow(/instance/);
    // deleting the whole instance is fine
    store.transact("Delete", (tx) => tx.deleteNode(inst));
    expect(store.doc.nodes[instLabel]).toBeUndefined();
  });

  it("detaches an instance into plain layers", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId));
    store.transact("Detach", (tx) => detachInstance(tx, inst));
    const node = store.doc.nodes[inst];
    expect(node.instance).toBeUndefined();
    for (const c of node.children) expect(store.doc.nodes[c].source).toBeUndefined();
    store.transact("Edit main", (tx) => tx.updateNode(btn.label, { text: "Changed" }));
    expect(store.doc.nodes[node.children[0]].text).toBe("Click me");
    store.transact("Insert", (tx) => tx.insertTrees(inst, [{ type: "Text", text: "free" }]));
  });

  it("resets overrides", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId));
    const instLabel = store.doc.nodes[inst].children[0];
    store.transact("Override", (tx) => {
      tx.setStyles(instLabel, { color: "red" });
      tx.setStyles(inst, { padding: 4, left: 40 });
    });
    expect(store.doc.nodes[inst].instance!.overrides[""]).toEqual({ styles: { padding: 4 } });
    store.transact("Reset", (tx) => resetOverrides(tx, inst));
    expect(store.doc.nodes[instLabel].styles.color).toBe("#FFFFFF");
    expect(store.doc.nodes[inst].styles.padding).toBe(12);
    expect(store.doc.nodes[inst].styles.left).toBe(40);
    expect(overrideCount(store.doc.nodes[inst])).toBe(0);
  });

  it("does not record an override when a value goes back to the main component's", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId));
    const instLabel = store.doc.nodes[inst].children[0];
    store.transact("Override", (tx) => tx.setStyles(instLabel, { color: "red" }));
    store.transact("Back", (tx) => tx.setStyles(instLabel, { color: "#FFFFFF" }));
    expect(store.doc.nodes[inst].instance!.overrides).toEqual({});
  });

  it("refuses an instance inside its own main component", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    expect(() => store.transact("Cycle", (tx) => createInstance(tx, btn.id, btn.id))).toThrow(/contain itself/);
    const card = store.transact("Card", (tx) => {
      const [id] = tx.insertTrees(rootId, [{ type: "Frame", name: "Card", styles: { display: "flex" } }]);
      createComponent(tx, id);
      createInstance(tx, btn.id, id);
      return id;
    });
    expect(() => store.transact("Cycle", (tx) => createInstance(tx, card, btn.id))).toThrow(/contain itself/);
  });
});

describe("components: props", () => {
  it("binds text and boolean props", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    store.transact("Props", (tx) =>
      setComponentDef(tx, btn.id, {
        props: [
          { name: "label", type: "text", target: btn.label },
          { name: "showIcon", type: "boolean", target: btn.icon },
        ],
      }),
    );
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId, { props: { label: "Shop the firing", showIcon: false } }));
    const [label, icon] = store.doc.nodes[inst].children.map((c) => store.doc.nodes[c]);
    expect(label.text).toBe("Shop the firing");
    expect(icon.visible).toBe(false);
    // editing the bound text on the canvas sets the prop
    store.transact("Edit", (tx) => tx.updateNode(label.id, { text: "Visit" }));
    expect(store.doc.nodes[inst].instance!.props.label).toBe("Visit");
    expect(store.doc.nodes[inst].instance!.overrides).toEqual({});
    const states = instancePropStates(store.doc, store.doc.nodes[inst]);
    expect(states.map((s) => [s.def.name, s.value])).toEqual([["label", "Visit"], ["showIcon", false]]);
    // main text change does not override a prop value
    store.transact("Main", (tx) => tx.updateNode(btn.label, { text: "Default" }));
    expect(store.doc.nodes[label.id].text).toBe("Visit");
    store.transact("Clear", (tx) => setInstanceProps(tx, inst, { label: null }));
    expect(store.doc.nodes[label.id].text).toBe("Default");
  });

  it("validates prop definitions", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    expect(() => store.transact("P", (tx) => setComponentDef(tx, btn.id, { props: [{ name: "x", type: "text", target: btn.icon }] }))).toThrow(/Text layer/);
    expect(() => store.transact("P", (tx) => setComponentDef(tx, btn.id, { props: [{ name: "x", type: "text", target: "nope" }] }))).toThrow(/no layer/);
    expect(() => store.transact("P", (tx) => setComponentDef(tx, btn.id, { props: [{ name: "v", type: "enum", target: "" }] }))).toThrow(/variants/);
    expect(() =>
      store.transact("P", (tx) => setComponentDef(tx, btn.id, { props: [{ name: "a", type: "boolean", target: btn.icon }, { name: "a", type: "boolean", target: btn.icon }] })),
    ).toThrow(/twice/);
  });

  it("keeps slot content per instance", () => {
    const { store, rootId } = setup();
    const card = store.transact("Card", (tx) => {
      const [id] = tx.insertTrees(rootId, [{
        type: "Frame",
        name: "Card",
        styles: { display: "flex", flexDirection: "column" },
        children: [
          { type: "Text", name: "Title", text: "Title" },
          { type: "Frame", name: "Body", styles: { display: "flex" }, children: [{ type: "Text", text: "Default body" }] },
        ],
      }]);
      createComponent(tx, id);
      const body = tx.doc.nodes[id].children[1];
      setComponentDef(tx, id, { props: [{ name: "body", type: "slot", target: body }] });
      return { id, body };
    });
    const inst = store.transact("Instance", (tx) => createInstance(tx, card.id, rootId));
    const slot = childBySource(store.doc, inst, card.body);
    expect(store.doc.nodes[slot.children[0]].text).toBe("Default body");
    expect(store.doc.nodes[slot.children[0]].source).toBeUndefined();
    store.transact("Fill slot", (tx) => {
      tx.deleteNode(slot.children[0]);
      tx.insertTrees(slot.id, [{ type: "Text", text: "My content" }]);
    });
    store.transact("Main", (tx) => {
      tx.setStyles(card.body, { gap: 8 });
      tx.updateNode(tx.doc.nodes[card.body].children[0], { text: "New default" });
    });
    const after = store.doc.nodes[slot.id];
    expect(after.styles.gap).toBe(8);
    expect(after.children.map((c) => store.doc.nodes[c].text)).toEqual(["My content"]);
  });
});

describe("components: variants", () => {
  function makeSet(store: DocStore, rootId: NodeId) {
    const primary = makeButton(store, rootId, "Button/Primary");
    const ghost = makeButton(store, rootId, "Button/Ghost");
    store.transact("Ghost style", (tx) => tx.setStyles(ghost.id, { backgroundColor: "transparent" }));
    const setId = store.transact("Set", (tx) => {
      for (const b of [primary, ghost]) setComponentDef(tx, b.id, { props: [{ name: "label", type: "text", target: b.label }] });
      return createComponentSet(tx, [primary.id, ghost.id]);
    });
    return { primary, ghost, setId };
  }

  it("groups components into a set with an enum prop", () => {
    const { store, rootId } = setup();
    const { primary, ghost, setId } = makeSet(store, rootId);
    const set = store.doc.nodes[setId];
    expect(set.componentSet).toEqual({});
    expect(set.name).toBe("Button");
    expect(set.children).toEqual([primary.id, ghost.id]);
    expect(store.doc.nodes[primary.id].component!.variant).toEqual({ variant: "primary" });
    expect(store.doc.nodes[primary.id].styles.left).toBeUndefined();
    const listed = listComponents(store.doc).find((c) => c.id === ghost.id)!;
    expect(listed.label).toBe("Button ghost");
    expect(listed.props[0]).toMatchObject({ name: "variant", type: "enum", options: ["primary", "ghost"] });
  });

  it("switches variants and keeps prop values and overrides", () => {
    const { store, rootId } = setup();
    const { primary, ghost } = makeSet(store, rootId);
    const inst = store.transact("Instance", (tx) => createInstance(tx, primary.id, rootId, { props: { label: "Hi" } }));
    const iconId = store.doc.nodes[inst].children[1];
    store.transact("Override", (tx) => tx.setStyles(iconId, { backgroundColor: "blue" }));
    store.transact("Variant", (tx) => setInstanceProps(tx, inst, { variant: "ghost" }));
    const node = store.doc.nodes[inst];
    expect(node.instance!.componentId).toBe(ghost.id);
    expect(node.styles.backgroundColor).toBe("transparent");
    const [label, icon] = node.children.map((c) => store.doc.nodes[c]);
    expect(label.text).toBe("Hi");
    expect(icon.source).toBe(ghost.icon);
    expect(icon.styles.backgroundColor).toBe("blue");
    expect(() => store.transact("Bad", (tx) => setInstanceProps(tx, inst, { variant: "nope" }))).toThrow(/one of/);
  });

  it("adds a variant with remapped prop targets", () => {
    const { store, rootId } = setup();
    const { primary, setId } = makeSet(store, rootId);
    const added = store.transact("Add variant", (tx) => addVariant(tx, primary.id, "variant", "link"));
    const def = store.doc.nodes[added].component!;
    expect(def.variant).toEqual({ variant: "link" });
    expect(def.props[0].target).toBe(store.doc.nodes[added].children[0]);
    expect(store.doc.nodes[setId].children).toContain(added);
  });
});

describe("components: nesting", () => {
  it("updates nested instances and keeps overrides that reach into them", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const card = store.transact("Card", (tx) => {
      const [id] = tx.insertTrees(rootId, [{ type: "Frame", name: "Card", styles: { display: "flex", flexDirection: "column", gap: 8 }, children: [{ type: "Text", name: "Title", text: "Card" }] }]);
      createComponent(tx, id);
      const nested = createInstance(tx, btn.id, id);
      return { id, nested };
    });
    const inst = store.transact("Instance", (tx) => createInstance(tx, card.id, rootId));
    const nestedCopy = childBySource(store.doc, inst, card.nested);
    expect(nestedCopy.instance?.componentId).toBe(btn.id);
    const nestedLabel = childBySource(store.doc, inst, `${card.nested}/${btn.label}`);
    expect(nestedLabel.text).toBe("Click me");

    // override inside the nested instance from the outer one
    store.transact("Override", (tx) => tx.updateNode(nestedLabel.id, { text: "Read more" }));
    expect(store.doc.nodes[inst].instance!.overrides[`${card.nested}/${btn.label}`]).toEqual({ text: "Read more" });

    // change the inner main component
    store.transact("Edit button", (tx) => tx.setStyles(btn.label, { fontWeight: 700 }));
    const label = store.doc.nodes[nestedLabel.id];
    expect(label.styles.fontWeight).toBe(700);
    expect(label.text).toBe("Read more");
    // the nested instance inside the Card main updated too
    expect(store.doc.nodes[store.doc.nodes[card.nested].children[0]].styles.fontWeight).toBe(700);

    // structural guard reaches nested layers
    expect(() => store.transact("Del", (tx) => tx.deleteNode(nestedLabel.id))).toThrow(/instance/);

    // detaching the outer instance keeps the nested one as an instance
    store.transact("Detach", (tx) => detachInstance(tx, inst));
    const promoted = store.doc.nodes[nestedCopy.id];
    expect(promoted.source).toBeUndefined();
    expect(promoted.instance?.componentId).toBe(btn.id);
    expect(store.doc.nodes[nestedLabel.id].source).toBe(btn.label);
    store.transact("Edit button", (tx) => tx.setStyles(btn.label, { fontWeight: 400 }));
    expect(store.doc.nodes[nestedLabel.id].styles.fontWeight).toBe(400);
    expect(store.doc.nodes[nestedLabel.id].text).toBe("Read more");
  });

  it("swaps nested instances with an instance-swap prop", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    const alt = makeButton(store, rootId, "Alt");
    store.transact("Alt", (tx) => tx.updateNode(alt.label, { text: "Alt label" }));
    const card = store.transact("Card", (tx) => {
      const [id] = tx.insertTrees(rootId, [{ type: "Frame", name: "Card", styles: { display: "flex" } }]);
      createComponent(tx, id);
      const nested = createInstance(tx, btn.id, id);
      setComponentDef(tx, id, { props: [{ name: "action", type: "instance-swap", target: nested }] });
      return { id, nested };
    });
    const inst = store.transact("Instance", (tx) => createInstance(tx, card.id, rootId, { props: { action: alt.id } }));
    const nested = childBySource(store.doc, inst, card.nested);
    expect(nested.instance!.componentId).toBe(alt.id);
    expect(store.doc.nodes[nested.children[0]].text).toBe("Alt label");
    expect(store.doc.nodes[nested.children[0]].source).toBe(`${card.nested}/${alt.label}`);
  });

  it("sets props of a nested instance as overrides of the outer instance", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    store.transact("Props", (tx) => setComponentDef(tx, btn.id, { props: [{ name: "label", type: "text", target: btn.label }] }));
    const card = store.transact("Card", (tx) => {
      const [id] = tx.insertTrees(rootId, [{ type: "Frame", name: "Card", styles: { display: "flex" } }]);
      createComponent(tx, id);
      return { id, nested: createInstance(tx, btn.id, id) };
    });
    const inst = store.transact("Instance", (tx) => createInstance(tx, card.id, rootId));
    const nested = childBySource(store.doc, inst, card.nested);
    store.transact("Prop", (tx) => setInstanceProps(tx, nested.id, { label: "Nested label" }));
    expect(store.doc.nodes[inst].instance!.overrides[card.nested]).toEqual({ props: { label: "Nested label" } });
    expect(store.doc.nodes[store.doc.nodes[nested.id].children[0]].text).toBe("Nested label");
  });
});

describe("components: copies and files", () => {
  it("duplicates instances and main components", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    store.transact("Props", (tx) => setComponentDef(tx, btn.id, { props: [{ name: "label", type: "text", target: btn.label }] }));
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId));
    const dup = store.transact("Dup", (tx) => tx.duplicateNode(inst).newId);
    expect(store.doc.nodes[dup].instance!.componentId).toBe(btn.id);
    store.transact("Main", (tx) => tx.updateNode(btn.label, { text: "Both" }));
    expect(store.doc.nodes[store.doc.nodes[dup].children[0]].text).toBe("Both");
    const mainCopy = store.transact("Dup main", (tx) => tx.duplicateNode(btn.id).newId);
    const copyDef = store.doc.nodes[mainCopy].component!;
    expect(copyDef.props[0].target).toBe(store.doc.nodes[mainCopy].children[0]);
  });

  it("builds instances from node trees (x-instance)", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    store.transact("Props", (tx) =>
      setComponentDef(tx, btn.id, {
        props: [{ name: "label", type: "text", target: btn.label }],
        codeRef: { package: "@acme/ui", export: "Button", propsMap: { label: "children" } },
      }),
    );
    const [a, b, c] = store.transact("Insert", (tx) =>
      tx.insertTrees(rootId, [
        { instance: { component: "Button", props: { label: "By name" } }, styles: { left: 10, top: 10 } },
        { instance: { component: btn.id, props: { children: "By code prop" } } },
        { instance: { component: "Missing" }, children: [{ type: "Text", text: "fallback" }] },
      ]),
    );
    expect(store.doc.nodes[store.doc.nodes[a].children[0]].text).toBe("By name");
    expect(store.doc.nodes[a].styles.left).toBe(10);
    expect(store.doc.nodes[store.doc.nodes[b].children[0]].text).toBe("By code prop");
    expect(store.doc.nodes[c].instance).toBeUndefined();
    expect(store.doc.nodes[store.doc.nodes[c].children[0]].text).toBe("fallback");
    expect(() => store.transact("Bad", (tx) => tx.insertTrees(rootId, [{ instance: { component: "Missing" } }]))).toThrow(/oc_list_components/);
  });

  it("round-trips through .fold serialisation", () => {
    const { store, rootId } = setup();
    const btn = makeButton(store, rootId);
    store.transact("Props", (tx) =>
      setComponentDef(tx, btn.id, { props: [{ name: "label", type: "text", target: btn.label }], codeRef: { package: "@acme/ui", export: "Button" } }),
    );
    const inst = store.transact("Instance", (tx) => createInstance(tx, btn.id, rootId, { props: { label: "Saved" } }));
    store.transact("Override", (tx) => tx.setStyles(store.doc.nodes[inst].children[1], { backgroundColor: null }));
    const loaded = parseFold(serializeFold(store.doc).documentJson);
    expect(loaded.nodes[btn.id].component).toEqual(store.doc.nodes[btn.id].component);
    expect(loaded.nodes[inst].instance).toEqual(store.doc.nodes[inst].instance);
    expect(loaded.nodes[inst].instance!.overrides[btn.icon]).toEqual({ styles: { backgroundColor: null } });
    expect(loaded.nodes[loaded.nodes[inst].children[0]].source).toBe(btn.label);
    // the loaded document keeps working
    const again = new DocStore(loaded);
    again.transact("Main", (tx) => tx.setStyles(btn.icon, { backgroundColor: "#000000", width: 20 }));
    const icon = again.doc.nodes[again.doc.nodes[inst].children[1]];
    expect(icon.styles.backgroundColor).toBeUndefined();
    expect(icon.styles.width).toBe(20);
  });

  it("publishes a library and updates subscribers", () => {
    const lib = setup();
    const btn = makeButton(lib.store, lib.rootId);
    lib.store.transact("Token", (tx) => tx.createToken({ type: "color", name: "--color-brand", value: "#111111" }));
    const snap1 = buildLibrarySnapshot(lib.store.doc, 5);
    expect(snap1.version).toBe(1);
    expect(snap1.componentIds).toEqual([btn.id]);
    expect(snap1.nodes[btn.id].parentId).toBeNull();

    const app = new DocStore(createDocument("App", { id: "F2", now: 1 }));
    const appRoot = app.doc.pages[app.doc.pageList[0].id].rootId;
    app.transact("Subscribe", (tx) => applyLibrary(tx, snap1));
    expect(app.doc.tokens.map((t) => t.name)).toEqual(["--color-brand"]);
    const inst = app.transact("Instance", (tx) => createInstance(tx, btn.id, appRoot, { library: "F1" }));
    expect(app.doc.nodes[inst].instance!.library).toBe("F1");
    expect(app.doc.nodes[app.doc.nodes[inst].children[0]].text).toBe("Click me");
    expect(listComponents(app.doc).map((c) => [c.name, c.library])).toEqual([["Button", "F1"]]);

    lib.store.transact("Edit", (tx) => {
      tx.updateNode(btn.label, { text: "Updated" });
      tx.updateToken("--color-brand", { value: "#222222" });
    });
    const snap2 = { ...buildLibrarySnapshot(lib.store.doc, 6), version: 2 };
    const diff = diffLibrary(app.doc.libraries!.F1, snap2);
    expect(diff.components.changed.map((e) => e.name)).toEqual(["Button"]);
    expect(diff.tokens.changed.map((e) => e.name)).toEqual(["--color-brand"]);
    expect(diffIsEmpty(diffLibrary(snap2, snap2))).toBe(true);

    app.transact("Update library", (tx) => applyLibrary(tx, snap2));
    expect(app.doc.libraries!.F1.version).toBe(2);
    expect(app.doc.nodes[app.doc.nodes[inst].children[0]].text).toBe("Updated");
    expect(app.doc.tokens[0].value).toBe("#222222");

    app.transact("Unsubscribe", (tx) => unsubscribeLibrary(tx, "F1"));
    expect(app.doc.libraries).toBeUndefined();
    expect(app.doc.nodes[inst].instance).toBeUndefined();
    expect(app.doc.nodes[app.doc.nodes[inst].children[0]].text).toBe("Updated");
  });
});
