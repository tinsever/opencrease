// Component entries shared by the layer context menu and the inspector's layer actions menu.
import type { FoldDocument, NodeId } from "@opencrease/model";
import {
  addVariantOf, createComponentFromSelection, createComponentPlan, detachSelection, goToMainComponent, resetOverridesOf,
  selectInstancesOf, selectOwnerInstance,
} from "../../state/component-actions";
import type { MenuItem } from "../../ui";
import "../components.css";

export function componentMenuItems(doc: FoldDocument, ids: NodeId[]): MenuItem[] {
  const items: MenuItem[] = [];
  const plan = createComponentPlan(doc, ids);
  if (plan === "variants") items.push({ label: "Combine as variants", shortcut: "⌥⌘K", onSelect: createComponentFromSelection });
  else if (plan !== "none") items.push({ label: ids.length > 1 && plan === "each" ? "Create components" : "Create component", shortcut: "⌥⌘K", onSelect: createComponentFromSelection });
  const single = ids.length === 1 ? doc.nodes[ids[0]] : undefined;
  if (single?.component) {
    if (single.component.variant) items.push({ label: "Add variant", onSelect: () => addVariantOf(single.id) });
    items.push({ label: "Select instances", onSelect: () => selectInstancesOf(single.id) });
  }
  if (single?.instance) {
    items.push({ label: "Go to main component", onSelect: () => void goToMainComponent(single.id) });
  }
  if (single && single.source !== undefined) items.push({ label: "Select instance", onSelect: () => selectOwnerInstance(single.id) });
  const roots = ids.filter((id) => doc.nodes[id]?.instance && doc.nodes[id]?.source === undefined);
  const linked = ids.filter((id) => doc.nodes[id]?.instance || doc.nodes[id]?.source !== undefined);
  if (linked.length) items.push({ label: "Reset overrides", onSelect: () => resetOverridesOf(linked) });
  if (roots.length) items.push({ label: roots.length > 1 ? "Detach instances" : "Detach instance", shortcut: "⌥⌘B", onSelect: () => detachSelection(roots) });
  if (items.length) items.push({ type: "separator" });
  return items;
}
