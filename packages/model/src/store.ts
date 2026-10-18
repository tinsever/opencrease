import { applyPatches, enablePatches, freeze, produce, produceWithPatches, type Patch } from "immer";
import type { IDocStore, TransactOptions, Tx } from "./contracts";
import { ModelError } from "./errors";
import { TxImpl } from "./tx";
import type { ChangeEvent, FoldDocument, NodeId } from "./types";

enablePatches();

type Origin = NonNullable<TransactOptions["origin"]>;
type Listener = (doc: FoldDocument, change: ChangeEvent) => void;

interface HistoryEntry {
  label: string;
  origin: Origin;
  mergeKey?: string;
  patches: Patch[];
  inverse: Patch[];
}

export interface DocStoreOptions {
  /** max undo steps kept (default 500) */
  historyLimit?: number;
  /** clock for `updatedAt` (default Date.now) */
  now?: () => number;
}

export const HISTORY_LIMIT = 500;

/** `updatedAt` and `clock` are bookkeeping: never undone, and a change to only them is not a change. */
function isHistoryPatch(p: Patch): boolean {
  return !(p.path.length === 1 && (p.path[0] === "updatedAt" || p.path[0] === "clock"));
}

function touchedBy(patches: Patch[]): NodeId[] {
  const ids = new Set<NodeId>();
  for (const p of patches) {
    if (p.path[0] === "nodes") {
      if (p.path.length >= 2) ids.add(String(p.path[1]));
      else if (p.value && typeof p.value === "object") for (const id of Object.keys(p.value)) ids.add(id);
    }
  }
  return [...ids];
}

export class DocStore implements IDocStore {
  #doc: FoldDocument;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #listeners = new Set<Listener>();
  #tx: TxImpl | null = null;
  /** false after undo/redo/reset so the next transaction never merges into an older step */
  #canMerge = false;
  readonly #limit: number;
  readonly #now: () => number;

  constructor(doc: FoldDocument, opts: DocStoreOptions = {}) {
    this.#doc = freeze(doc, true);
    this.#limit = Math.max(1, opts.historyLimit ?? HISTORY_LIMIT);
    this.#now = opts.now ?? Date.now;
  }

  get doc(): FoldDocument {
    return this.#doc;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Labels of the undo stack, oldest first (for history UI and tests). */
  get undoLabels(): string[] {
    return this.#undo.map((e) => e.label);
  }

  get redoLabels(): string[] {
    return this.#redo.map((e) => e.label);
  }

  get inTransaction(): boolean {
    return this.#tx !== null;
  }

  /** Nested calls join the outer transaction. */
  transact<T>(label: string, fn: (tx: Tx) => T, opts: TransactOptions = {}): T {
    if (this.#tx) return fn(this.#tx);
    const base = this.#doc;
    let result!: T;
    let next: FoldDocument;
    let patches: Patch[];
    let inverse: Patch[];
    try {
      [next, patches, inverse] = produceWithPatches(base, (draft) => {
        const tx = new TxImpl(draft as FoldDocument);
        this.#tx = tx;
        result = fn(tx);
        tx.finalize();
        draft.updatedAt = this.#stamp(base.updatedAt);
      });
    } finally {
      this.#tx = null;
    }
    patches = patches.filter(isHistoryPatch);
    inverse = inverse.filter(isHistoryPatch);
    if (patches.length === 0) return result;

    const origin = opts.origin ?? "user";
    this.#doc = next;
    this.#record({ label, origin, mergeKey: opts.mergeKey, patches, inverse });
    this.#emit({ label, origin, touched: touchedBy(patches) });
    return result;
  }

  undo(): boolean {
    this.#assertIdle("undo");
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#doc = this.#apply(entry.inverse);
    this.#redo.push(entry);
    this.#canMerge = false;
    this.#emit({ label: entry.label, origin: "undo", touched: touchedBy(entry.inverse) });
    return true;
  }

  redo(): boolean {
    this.#assertIdle("redo");
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#doc = this.#apply(entry.patches);
    this.#undo.push(entry);
    this.#canMerge = false;
    this.#emit({ label: entry.label, origin: "redo", touched: touchedBy(entry.patches) });
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Replaces the document and clears history. Emits a "system" change touching every node. */
  reset(doc: FoldDocument): void {
    this.#assertIdle("reset");
    this.#doc = freeze(doc, true);
    this.#undo = [];
    this.#redo = [];
    this.#canMerge = false;
    this.#emit({ label: "Reset", origin: "system", touched: Object.keys(doc.nodes) });
  }

  /** Drops undo/redo history without touching the document. */
  clearHistory(): void {
    this.#undo = [];
    this.#redo = [];
    this.#canMerge = false;
  }

  #record(entry: HistoryEntry): void {
    const top = this.#undo.at(-1);
    if (entry.mergeKey !== undefined && this.#canMerge && top && top.mergeKey === entry.mergeKey && top.origin === entry.origin) {
      top.patches = [...top.patches, ...entry.patches];
      top.inverse = [...entry.inverse, ...top.inverse];
    } else {
      this.#undo.push(entry);
      if (this.#undo.length > this.#limit) this.#undo.splice(0, this.#undo.length - this.#limit);
    }
    this.#redo = [];
    this.#canMerge = true;
  }

  #apply(patches: Patch[]): FoldDocument {
    const applied = applyPatches(this.#doc, patches);
    return produce(applied, (draft) => {
      draft.updatedAt = this.#stamp(this.#doc.updatedAt);
    });
  }

  /** Strictly increasing so `updatedAt` can be compared to detect changes. */
  #stamp(previous: number): number {
    return Math.max(this.#now(), previous + 1);
  }

  #assertIdle(what: string): void {
    if (this.#tx) throw new ModelError("in_transaction", `Cannot ${what} inside a transaction`);
  }

  #emit(change: ChangeEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#doc, change);
      } catch (err) {
        // one broken subscriber must not break the store or the others
        console.error("DocStore listener failed", err);
      }
    }
  }
}
