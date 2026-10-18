// Components get purple chrome (SPEC §4.9): selection, hover, artboard labels and layer rows.
import { isComponentSet, isMainComponent, type FoldDocument, type NodeId, type OFNode } from "@opencrease/model";

export type ComponentTone = "main" | "set" | "instance" | null;

/** How a layer itself is marked: main component, component set or instance (including nested ones). */
export function ownTone(node: OFNode | undefined): ComponentTone {
  if (!node) return null;
  if (isComponentSet(node)) return "set";
  if (isMainComponent(node)) return "main";
  if (node.instance) return "instance";
  return null;
}

/** Is a layer a component, an instance, or part of one? Those are drawn in the component colour. */
export function inComponent(doc: FoldDocument, id: NodeId): boolean {
  let n: OFNode | undefined = doc.nodes[id];
  for (let guard = 0; n && n.type !== "Root" && guard < 512; guard++) {
    if (n.source !== undefined || ownTone(n)) return true;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return false;
}

/** Selection outlines turn purple when every selected layer is component related. */
export function selectionInComponent(doc: FoldDocument, ids: readonly NodeId[]): boolean {
  return ids.length > 0 && ids.every((id) => inComponent(doc, id));
}
