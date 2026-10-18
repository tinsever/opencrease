// Track 4 shortcuts, checked before the base set in shortcuts.ts: transform tools, clipboard extras,
// arrange, repeat duplicate and collapsing the layer tree. Physical keys (e.code) are used with ⌥ because
// macOS turns ⌥ + letter into another character.
import { getActiveFile, setSelection, setTool } from "../state/workspace";
import { getExpanded, setExpanded } from "../panels/shared";
import { arrangeSelection, type ArrangeAction } from "./arrange-actions";
import { copyAsCode, copyAsPng, pasteFromSystem } from "./clipboard-extra";
import { recordDuplicate, repeatDuplicate } from "./duplicate-repeat";

function duplicate() {
  if (repeatDuplicate()) return;
  const file = getActiveFile();
  if (!file || file.selection.length === 0) return;
  const sources = file.selection.filter((id) => file.store.doc.nodes[id]);
  const created = file.store.transact("Duplicate", (tx) => sources.map((id) => tx.duplicateNode(id).newId));
  setSelection(file.id, created);
  recordDuplicate(file.id, sources, created);
}

const ALT_ARRANGE: Record<string, ArrangeAction> = {
  KeyA: { kind: "align", align: "left" },
  KeyD: { kind: "align", align: "right" },
  KeyW: { kind: "align", align: "top" },
  KeyS: { kind: "align", align: "bottom" },
  KeyH: { kind: "align", align: "hcenter" },
  KeyV: { kind: "align", align: "vcenter" },
};

/** Handle a keydown; returns true when it was one of these shortcuts. Typing contexts are filtered by the caller. */
export function handleExtraShortcut(e: KeyboardEvent): boolean {
  const meta = e.metaKey || e.ctrlKey;
  const file = getActiveFile();
  if (!file) return false;
  const run = (fn: () => unknown) => {
    e.preventDefault();
    fn();
    return true;
  };

  if (meta && e.shiftKey && !e.altKey && e.code === "KeyR") return run(() => void pasteFromSystem({ replace: true }));
  if (meta && e.shiftKey && !e.altKey && e.code === "KeyC") return run(() => void copyAsPng());
  if (meta && !e.shiftKey && !e.altKey && e.code === "KeyD") return run(duplicate);
  if (meta) return false;

  if (e.altKey && !e.shiftKey && !e.ctrlKey) {
    if (e.code === "KeyR") return run(() => void copyAsCode("react"));
    if (e.code === "KeyT") return run(() => void copyAsCode("tailwind"));
    if (e.code === "KeyL") return run(() => setExpanded(file.id, Object.keys(getExpanded(file.id)), false));
    const a = ALT_ARRANGE[e.code];
    if (a) return run(() => arrangeSelection(a));
  }
  if (e.altKey && e.shiftKey && !e.ctrlKey) {
    if (e.code === "KeyH") return run(() => arrangeSelection({ kind: "distribute", axis: "horizontal" }));
    if (e.code === "KeyV") return run(() => arrangeSelection({ kind: "distribute", axis: "vertical" }));
  }
  if (e.altKey && e.shiftKey && e.code === "KeyT") return run(() => arrangeSelection({ kind: "tidy" }));

  if (!e.altKey && !e.shiftKey) {
    if (e.code === "KeyZ") return run(() => setTool("zoom"));
    if (e.code === "KeyK") return run(() => setTool("scale"));
  }
  return false;
}
