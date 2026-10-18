// Command palette entries for components: create, combine, detach, reset, go to main, publish, and one
// "Insert" entry per component in the file and its libraries.
import { listComponents, type FoldDocument, type NodeId } from "@opencrease/model";
import {
  combineAsVariants, createComponentFromSelection, createComponentPlan, detachSelection, goToMainComponent, placeInstance,
  resetOverridesOf,
} from "../state/component-actions";
import { publishLibrary } from "../state/libraries";
import { setLeftTab } from "../state/workspace";
import type { IconName } from "../ui";

export interface ComponentCommand {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

export function componentActions(fileId: string, doc: FoldDocument, sel: NodeId[]): ComponentCommand[] {
  const out: ComponentCommand[] = [];
  const plan = createComponentPlan(doc, sel);
  if (plan === "variants") out.push({ id: "comp-variants", label: "Combine as variants", icon: "componentSet", shortcut: "⌥⌘K", keywords: ["component set"], run: () => combineAsVariants(sel) });
  else if (plan !== "none") out.push({ id: "comp-create", label: "Create component", icon: "mainComponent", shortcut: "⌥⌘K", keywords: ["symbol"], run: createComponentFromSelection });
  const instances = sel.filter((id) => doc.nodes[id]?.instance && doc.nodes[id]?.source === undefined);
  if (instances.length === 1) out.push({ id: "comp-main", label: "Go to main component", icon: "goTo", run: () => void goToMainComponent(instances[0]) });
  if (instances.length) {
    out.push({ id: "comp-detach", label: "Detach instance", icon: "detach", shortcut: "⌥⌘B", run: () => detachSelection(instances) });
    out.push({ id: "comp-reset", label: "Reset overrides", icon: "refresh", run: () => resetOverridesOf(instances) });
  }
  out.push({ id: "comp-assets", label: "Show components", icon: "component", keywords: ["assets", "library"], run: () => setLeftTab("assets") });
  if (Object.values(doc.nodes).some((n) => n.component)) {
    out.push({ id: "comp-publish", label: doc.library ? "Publish library update" : "Publish as library", icon: "upload", keywords: ["library", "share components"], run: () => void publishLibrary(fileId) });
  }
  return out;
}

export function componentInserts(doc: FoldDocument): ComponentCommand[] {
  return listComponents(doc).map((c) => ({
    id: `insert-${c.library ?? ""}-${c.id}`,
    label: `Insert ${c.label}`,
    icon: "component" as IconName,
    hint: c.libraryName,
    keywords: [c.name, c.setName ?? "", "instance"],
    run: () => void placeInstance(c.id, c.library),
  }));
}
