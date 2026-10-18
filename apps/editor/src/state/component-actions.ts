// Component actions for the canvas, layer tree, inspector, Assets tab and command palette (SPEC §4.9).
// Each one is a single undo step; refused edits show a notice instead of throwing.
import {
  addVariant, componentSetOf, createComponent, createComponentSet, createInstance, detachInstance, instanceOwner,
  isComponentSet, isMainComponent, mainComponentOf, pageOfNode, removeComponent, resetOverrides, setInstanceProps,
  type FoldDocument, type NodeId, type OFNode, type PropValue,
} from "@opencrease/model";
import { containingBlockOrigin, flowInsertIndex, pageRootId, viewportCentre } from "../canvas/insert";
import { getWorldRect } from "../canvas/registry";
import { isFlex } from "../canvas/selection-logic";
import { revealNodes, zoomToSelection } from "../canvas/view";
import { showNotice, tryAction } from "../ui/Notice";
import { getActiveFile, openFile, setActivePage, setSelection, setTool } from "./workspace";

/** Can this layer be marked as a main component as it is? */
export function canBecomeComponent(node: OFNode | undefined): boolean {
  return !!node && node.type === "Frame" && !node.component && !node.componentSet && !node.instance && node.source === undefined;
}

/** What "Create component" does for a selection, for menu labels and the palette. */
export function createComponentPlan(doc: FoldDocument, ids: NodeId[]): "none" | "each" | "wrap" | "variants" {
  const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is OFNode => !!n && n.type !== "Root");
  if (!nodes.length) return "none";
  if (nodes.some((n) => n.source !== undefined || n.instance || n.componentSet)) return "none";
  if (nodes.length > 1 && nodes.every((n) => n.component) && new Set(nodes.map((n) => n.parentId)).size === 1 && !componentSetOf(doc.nodes, nodes[0])) {
    return "variants";
  }
  if (nodes.some((n) => n.component)) return "none";
  if (nodes.every(canBecomeComponent)) return "each";
  return new Set(nodes.map((n) => n.parentId)).size === 1 ? "wrap" : "none";
}

/** ⌥⌘K: frames become components; other layers are wrapped in a frame first; several components become variants. */
export function createComponentFromSelection(): void {
  const file = getActiveFile();
  if (!file || !file.selection.length) return;
  const doc = file.store.doc;
  const plan = createComponentPlan(doc, file.selection);
  if (plan === "none") {
    const n = doc.nodes[file.selection[0]];
    if (n?.component && file.selection.length === 1) return showNotice(`"${n.name}" is already a component`);
    if (n?.source !== undefined || n?.instance) return showNotice("Detach the instance first to make a new component from it");
    return showNotice("Select frames or layers that share a parent to create a component");
  }
  if (plan === "variants") return combineAsVariants(file.selection);
  const ids = tryAction(() =>
    file.store.transact("Create component", (tx) => {
      if (plan === "each") {
        for (const id of file.selection) createComponent(tx, id);
        return [...file.selection];
      }
      const first = tx.doc.nodes[file.selection[0]];
      const parent = tx.doc.nodes[first.parentId!];
      const order = file.selection.slice().sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));
      const onPage = parent.type === "Root";
      const rects = order.map((id) => getWorldRect(id)).filter((r) => !!r);
      const styles: Record<string, string | number> = { display: "flex", flexDirection: "column", alignItems: "flex-start" };
      if (onPage && rects.length) {
        styles.left = Math.round(Math.min(...rects.map((r) => r!.x)));
        styles.top = Math.round(Math.min(...rects.map((r) => r!.y)));
      }
      const [wrapId] = tx.insertTrees(parent.id, [{ type: "Frame", name: order.length === 1 ? tx.doc.nodes[order[0]].name : "Component", styles }], parent.children.indexOf(order[0]));
      for (const id of order) {
        tx.moveNode(id, wrapId);
        const n = tx.doc.nodes[id];
        if (onPage) tx.setStyles(id, { position: null, left: null, top: null });
        else if (n.styles.position === "absolute") tx.setStyles(id, { position: null, left: null, top: null });
      }
      createComponent(tx, wrapId);
      return [wrapId];
    }),
  );
  if (ids) setSelection(file.id, ids);
}

export function combineAsVariants(ids: NodeId[]): void {
  const file = getActiveFile();
  if (!file) return;
  const setId = tryAction(() => file.store.transact("Combine as variants", (tx) => createComponentSet(tx, ids)));
  if (setId) setSelection(file.id, [setId]);
}

export function addVariantOf(componentId: NodeId): void {
  const file = getActiveFile();
  if (!file) return;
  const id = tryAction(() => file.store.transact("Add variant", (tx) => addVariant(tx, componentId)));
  if (id) setSelection(file.id, [id]);
}

export function removeComponentDef(componentId: NodeId): void {
  const file = getActiveFile();
  if (!file) return;
  tryAction(() => file.store.transact("Remove component", (tx) => removeComponent(tx, componentId)));
}

/** Instance roots in the selection (or the instances that own selected layers). */
function selectedInstances(doc: FoldDocument, ids: NodeId[]): NodeId[] {
  const out = new Set<NodeId>();
  for (const id of ids) {
    const n = doc.nodes[id];
    if (n?.instance && n.source === undefined) out.add(n.id);
  }
  return [...out];
}

export function detachSelection(ids?: NodeId[]): void {
  const file = getActiveFile();
  if (!file) return;
  const targets = selectedInstances(file.store.doc, ids ?? file.selection);
  if (!targets.length) return showNotice("Select an instance to detach");
  tryAction(() => file.store.transact("Detach instance", (tx) => {
    for (const id of targets) detachInstance(tx, id);
  }));
}

/** Clears overrides of instances, or of a layer inside an instance. */
export function resetOverridesOf(ids?: NodeId[]): void {
  const file = getActiveFile();
  if (!file) return;
  const doc = file.store.doc;
  const targets = (ids ?? file.selection).filter((id) => doc.nodes[id]?.instance || doc.nodes[id]?.source !== undefined);
  if (!targets.length) return showNotice("Select an instance to reset its overrides");
  tryAction(() => file.store.transact("Reset overrides", (tx) => {
    for (const id of targets) if (tx.doc.nodes[id]) resetOverrides(tx, id);
  }));
}

export function setPropValue(instanceId: NodeId, name: string, value: PropValue | null, mergeKey?: string): void {
  const file = getActiveFile();
  if (!file) return;
  tryAction(() => file.store.transact("Change property", (tx) => setInstanceProps(tx, instanceId, { [name]: value }), mergeKey ? { mergeKey } : undefined));
}

export function selectOwnerInstance(id: NodeId): void {
  const file = getActiveFile();
  const owner = file ? instanceOwner(file.store.doc, id) : undefined;
  if (file && owner) setSelection(file.id, [owner.id]);
}

/** Selects the main component of an instance, switching page or opening the library file when needed. */
export async function goToMainComponent(instanceId: NodeId): Promise<void> {
  const file = getActiveFile();
  const node = file?.store.doc.nodes[instanceId];
  if (!file || !node?.instance) return;
  if (!mainComponentOf(file.store.doc, node)) return showNotice("The main component of this instance no longer exists");
  await revealComponent(node.instance.componentId, node.instance.library);
}

/** Selects a main component: on its page in this file, or in its library file. */
export async function revealComponent(componentId: NodeId, library?: string): Promise<void> {
  const file = getActiveFile();
  if (!file) return;
  const doc = file.store.doc;
  if (library) {
    try {
      const lib = await openFile(library);
      if (!lib.store.doc.nodes[componentId]) return showNotice("The component is no longer in its library file");
      const page = pageOfNode(lib.store.doc, componentId);
      if (page) setActivePage(lib.id, page.id);
      setSelection(lib.id, [componentId]);
      afterRender(() => zoomToSelection());
    } catch {
      showNotice(`The library "${doc.libraries?.[library]?.name ?? "file"}" is not in this workspace`);
    }
    return;
  }
  if (!doc.nodes[componentId]) return showNotice("That component no longer exists");
  const page = pageOfNode(doc, componentId);
  if (page && page.id !== file.activePageId) setActivePage(file.id, page.id);
  setSelection(file.id, [componentId]);
  afterRender(() => revealNodes([componentId]));
}

function afterRender(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** Instances of a local main component (selects them on the current page first). */
export function selectInstancesOf(componentId: NodeId): void {
  const file = getActiveFile();
  if (!file) return;
  const doc = file.store.doc;
  const all = Object.values(doc.nodes).filter((n) => n.instance && n.source === undefined && !n.instance.library && n.instance.componentId === componentId);
  if (!all.length) return showNotice("This component has no instances yet");
  const onPage = all.filter((n) => pageOfNode(doc, n.id)?.id === file.activePageId);
  if (onPage.length) return setSelection(file.id, onPage.map((n) => n.id));
  const page = pageOfNode(doc, all[0].id);
  if (page) {
    setActivePage(file.id, page.id);
    setSelection(file.id, all.filter((n) => pageOfNode(doc, n.id)?.id === page.id).map((n) => n.id));
  }
}

/** Frame that takes the new instance: never a layer generated inside an instance, except slot frames. */
function acceptingParent(doc: FoldDocument, id: NodeId | null): NodeId | null {
  let cur = id ? doc.nodes[id] : undefined;
  while (cur && cur.type !== "Root") {
    const slot = cur.source !== undefined && isSlotFrame(doc, cur);
    if (cur.type === "Frame" && !cur.locked && !cur.instance && !cur.componentSet && (cur.source === undefined || slot)) return cur.id;
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return null;
}

function isSlotFrame(doc: FoldDocument, node: OFNode): boolean {
  const owner = instanceOwner(doc, node.id);
  const main = mainComponentOf(doc, owner);
  return !!main?.component?.props.some((p) => p.type === "slot" && p.target === node.source);
}

/**
 * Places an instance. With a world point (drag from the Assets tab) it goes into the frame under the point,
 * otherwise into the selected frame or next to the view centre on the page.
 */
export function placeInstance(componentId: NodeId, library: string | undefined, at?: { world: { x: number; y: number }; containerId: NodeId | null }): NodeId | undefined {
  const file = getActiveFile();
  if (!file) return undefined;
  const doc = file.store.doc;
  const rootId = pageRootId(doc, file.activePageId);
  if (!rootId) return undefined;
  const main = library ? doc.libraries?.[library]?.nodes[componentId] : doc.nodes[componentId];
  if (!main?.component) {
    showNotice("That component is no longer available");
    return undefined;
  }
  const sel = file.selection.length === 1 ? file.selection[0] : null;
  const parentId = at ? (acceptingParent(doc, at.containerId) ?? rootId) : (acceptingParent(doc, sel) ?? rootId);
  const mainRect = !library ? getWorldRect(componentId) : null;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const w = mainRect?.width ?? num(main.styles.width);
  const h = mainRect?.height ?? num(main.styles.height);
  const centre = at?.world ?? viewportCentre();
  const styles: Record<string, string | number> = {};
  let index: number | undefined;
  if (parentId === rootId) {
    styles.left = Math.round(centre.x - w / 2);
    styles.top = Math.round(centre.y - h / 2);
  } else {
    const parent = doc.nodes[parentId];
    if (isFlex(parent) || !at) {
      if (at) index = flowInsertIndex(doc, parentId, centre).index;
    } else {
      const o = containingBlockOrigin(parentId);
      styles.position = "absolute";
      styles.left = Math.round(centre.x - w / 2 - o.x);
      styles.top = Math.round(centre.y - h / 2 - o.y);
    }
  }
  const id = tryAction(() =>
    file.store.transact("Place instance", (tx) => createInstance(tx, componentId, parentId, { library, styles, index })),
  );
  if (id) {
    setSelection(file.id, [id]);
    setTool("move");
    revealNodes([id]);
  }
  return id;
}

export function isComponentish(node: OFNode | undefined): boolean {
  return isMainComponent(node) || isComponentSet(node) || !!node?.instance;
}

