import { describe, expect, it } from "vitest";
import {
  createComponent, createComponentSet, createDocument, createInstance, DocStore, setComponentDef, setComponentSetDef,
  type NodeId,
} from "@opencrease/model";
import { htmlToTrees } from "./html-to-trees";
import { nodeToHtml } from "./html";
import { nodeToJsx } from "./jsx";

function setup() {
  const store = new DocStore(createDocument("T", { id: "F1", now: 1 }));
  const rootId = store.doc.pages[store.doc.pageList[0].id].rootId;
  const make = (name: string, bg: string) =>
    store.transact("Button", (tx) => {
      const [id] = tx.insertTrees(rootId, [{
        type: "Frame",
        name,
        styles: { display: "flex", padding: 12, backgroundColor: bg },
        children: [
          { type: "Text", name: "Label", text: "Click", styles: { color: "#FFFFFF" } },
          { type: "Rectangle", name: "Icon", styles: { width: 16, height: 16 } },
        ],
      }]);
      createComponent(tx, id);
      const [label, icon] = tx.doc.nodes[id].children;
      setComponentDef(tx, id, {
        props: [
          { name: "label", type: "text", target: label },
          { name: "iconRight", type: "boolean", target: icon },
        ],
      });
      return id;
    });
  const primary = make("Button/Primary", "#111111");
  const ghost = make("Button/Ghost", "transparent");
  const setId = store.transact("Set", (tx) => createComponentSet(tx, [primary, ghost]));
  return { store, rootId, primary, ghost, setId };
}

describe("code components in JSX", () => {
  it("falls back to markup without a code mapping", () => {
    const { store, rootId, primary } = setup();
    const inst = store.transact("I", (tx) => createInstance(tx, primary, rootId));
    const jsx = nodeToJsx(store.doc, inst, { format: "inline-styles" });
    expect(jsx).not.toContain("import");
    expect(jsx).toContain("<div");
    expect(jsx).toContain("Click");
  });

  it("emits the code component with an import line", () => {
    const { store, rootId, primary, setId } = setup();
    store.transact("Code", (tx) => setComponentSetDef(tx, setId, { codeRef: { package: "@kiln/ui", export: "Button", propsMap: { label: "children" } } }));
    const frame = store.transact("Frame", (tx) => {
      const [f] = tx.insertTrees(rootId, [{ type: "Frame", name: "Hero", styles: { display: "flex", gap: 8 } }]);
      createInstance(tx, primary, f, { props: { label: "Shop the firing", variant: "ghost" } });
      createInstance(tx, primary, f, { props: { iconRight: false } });
      return f;
    });
    const jsx = nodeToJsx(store.doc, frame, { format: "tailwind" });
    expect(jsx.split("\n")[0]).toBe('import { Button } from "@kiln/ui";');
    expect(jsx).toContain('<Button variant="ghost" iconRight>Shop the firing</Button>');
    expect(jsx).toContain('<Button variant="primary" iconRight={false}>Click</Button>');
    expect(nodeToJsx(store.doc, frame, { format: "tailwind", codeComponents: false })).not.toContain("<Button");
  });

  it("maps prop names and leaves out props mapped to an empty name", () => {
    const { store, rootId, primary, setId } = setup();
    store.transact("Code", (tx) => setComponentSetDef(tx, setId, { codeRef: { package: "@kiln/ui", export: "default", propsMap: { variant: "kind", iconRight: "" } } }));
    const inst = store.transact("I", (tx) => createInstance(tx, primary, rootId));
    const jsx = nodeToJsx(store.doc, inst, { format: "inline-styles", includeNodeIds: true });
    expect(jsx).toContain('import Button from "@kiln/ui";');
    expect(jsx).toContain(`<Button id="${inst}" kind="primary" label="Click" />`);
  });
});

describe("x-instance round trip", () => {
  function insert(store: DocStore, parentId: NodeId, html: string, componentTags?: string[]) {
    const { trees, warnings } = htmlToTrees(html, { componentTags });
    return { ids: store.transact("Paste", (tx) => tx.insertTrees(parentId, trees)), warnings };
  }

  it("copies an instance with props, overrides and position", () => {
    const { store, rootId, primary } = setup();
    const inst = store.transact("I", (tx) => createInstance(tx, primary, rootId, { props: { label: "Hi" }, styles: { left: 40, top: 50 } }));
    store.transact("Override", (tx) => tx.setStyles(store.doc.nodes[inst].children[1], { backgroundColor: "red" }));
    const html = nodeToHtml(store.doc, inst, { instances: "tags" });
    expect(html).toMatch(/^<x-instance [^>]*component="/);
    const { ids } = insert(store, rootId, html);
    const copy = store.doc.nodes[ids[0]];
    expect(copy.instance).toEqual(store.doc.nodes[inst].instance);
    expect(copy.styles.left).toBe("40px");
    expect(store.doc.nodes[copy.children[1]].styles.backgroundColor).toBe("red");
    // plain markup by default
    expect(nodeToHtml(store.doc, inst)).not.toContain("x-instance");
  });

  it("uses the fallback layers when the component is missing", () => {
    const { store, rootId, primary } = setup();
    const inst = store.transact("I", (tx) => createInstance(tx, primary, rootId));
    const html = nodeToHtml(store.doc, inst, { instances: "tags" }).replace(/component="[^"]+"/, 'component="nope"');
    const { ids } = insert(store, rootId, html);
    const node = store.doc.nodes[ids[0]];
    expect(node.instance).toBeUndefined();
    expect(store.doc.nodes[node.children[0]].text).toBe("Click");
  });

  it("accepts get_jsx output for code components", () => {
    const { store, rootId, setId } = setup();
    store.transact("Code", (tx) => setComponentSetDef(tx, setId, { codeRef: { package: "@kiln/ui", export: "Button", propsMap: { label: "children" } } }));
    const { ids } = insert(store, rootId, '<Button variant="ghost" iconRight={false}>Visit</Button><Button />', ["Button"]);
    expect(ids).toHaveLength(2);
    const a = store.doc.nodes[ids[0]];
    expect(store.doc.nodes[a.instance!.componentId].component!.variant).toEqual({ variant: "ghost" });
    expect(store.doc.nodes[a.children[0]].text).toBe("Visit");
    expect(store.doc.nodes[a.children[1]].visible).toBe(false);
    expect(store.doc.nodes[ids[1]].instance).toBeDefined();
  });

  it("accepts x-instance by component name with attribute props", () => {
    const { store, rootId } = setup();
    const { ids, warnings } = insert(store, rootId, '<x-instance component="Button" label="Read" variant="ghost" style="width: 200px"></x-instance>');
    expect(warnings).toEqual([]);
    const node = store.doc.nodes[ids[0]];
    expect(store.doc.nodes[node.children[0]].text).toBe("Read");
    expect(node.styles.width).toBe("200px");
    expect(node.instance!.overrides[""]).toEqual({ styles: { width: "200px" } });
  });
});
