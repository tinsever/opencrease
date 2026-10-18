// Per-node change subscriptions. One listener on the DocStore fans each change out to the components of
// the nodes it touched, so an edit wakes a handful of node views instead of every node on the page
// (with 50k nodes, a store-wide subscription per node made every keystroke walk 50k callbacks).
import type { DocStore, NodeId } from "@opencrease/model";

interface Subs {
  byId: Map<NodeId, Set<() => void>>;
  unsubscribe: () => void;
}

const registry = new WeakMap<DocStore, Subs>();

function subsFor(store: DocStore): Subs {
  let s = registry.get(store);
  if (s) return s;
  const byId = new Map<NodeId, Set<() => void>>();
  const unsubscribe = store.subscribe((_doc, change) => {
    const all = change.origin === "system" && change.label === "Reset";
    if (all) {
      for (const set of [...byId.values()]) for (const l of [...set]) l();
      return;
    }
    for (const id of change.touched) {
      const set = byId.get(id);
      if (set) for (const l of [...set]) l();
    }
  });
  s = { byId, unsubscribe };
  registry.set(store, s);
  return s;
}

/** Subscribe to changes of one node (its own object: styles, children list, text, ...). */
export function subscribeNode(store: DocStore, id: NodeId, listener: () => void): () => void {
  const { byId } = subsFor(store);
  let set = byId.get(id);
  if (!set) byId.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) byId.delete(id);
  };
}

/** Number of node listeners (for tests and the perf script). */
export function nodeListenerCount(store: DocStore): number {
  let n = 0;
  for (const set of subsFor(store).byId.values()) n += set.size;
  return n;
}
