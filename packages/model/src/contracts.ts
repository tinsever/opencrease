// Public API contract of @opencrease/model. Other packages code against these
// signatures; the implementation lives in store.ts / queries.ts / format.ts.
import type {
  ChangeEvent, FoldDocument, ModeCollection, NodeId, NodeTree, OFNode, Page, PageIcon, PageId,
  PageListItem, StyleMap, TextStyle, Token, TokenType,
} from "./types";

/** Optional node fields added after v0.1 (`undefined` removes the field). */
export interface NodeFieldPatch {
  constraints?: OFNode["constraints"];
}

/** Mutation API available inside a transaction. All methods throw `ModelError` on invalid input. */
export interface Tx {
  /** current (draft) state, read freely */
  readonly doc: FoldDocument;

  /** Insert a subtree under parentId at index (default: append). Returns the root ids created (one per tree), in order. */
  insertTrees(parentId: NodeId, trees: NodeTree[], index?: number): NodeId[];
  /**
   * Shallow patch of non-structural fields: name, visible, locked, text, src, tag, attrs, shader, exports,
   * paint, constraints, gen, spans (Text), mode (Frame) and textStyle (Text, prefer applyTextStyle). Changing
   * `text` without `spans` drops the spans unless the new text equals them.
   */
  updateNode(id: NodeId, patch: Partial<Pick<OFNode, "name" | "visible" | "locked" | "text" | "src" | "tag" | "attrs" | "shader" | "exports" | "paint" | "gen" | "spans" | "mode" | "textStyle">> & NodeFieldPatch): void;
  /** Merge styles. A value of null or "" removes the property. mode "replace" swaps the whole map. */
  setStyles(id: NodeId, styles: Record<string, string | number | null>, mode?: "merge" | "replace"): void;
  /** Reparent/reorder. index clamps to [0, childCount]; omitted = append. Moving into own subtree throws. */
  moveNode(id: NodeId, parentId: NodeId, index?: number): void;
  /** Delete node and descendants. Root nodes cannot be deleted. */
  deleteNode(id: NodeId): void;
  /** Deep clone. Default parent = same parent, placed right after the source. */
  duplicateNode(id: NodeId, parentId?: NodeId, index?: number): { newId: NodeId; idMap: Record<NodeId, NodeId> };

  createPage(name?: string, icon?: PageIcon | null, afterPageId?: PageId): PageId;
  updatePage(id: PageId, patch: { name?: string; icon?: PageIcon | null }): void;
  /** Full reorder; items are page ids, existing divider ids, or { type: "divider" } to create one. */
  arrangePages(order: Array<string | { type: "divider" }>, removeDividerIds?: string[]): PageListItem[];
  deletePage(id: PageId): void;

  createToken(t: { type: TokenType; name: string; value: string | number; description?: string; modes?: Record<string, string | number> }): Token;
  updateToken(nameOrId: string, patch: Partial<Omit<Token, "id">>): Token;
  deleteToken(nameOrId: string): void;
  /** Moves a token to `index` in the ordered list (clamped). */
  moveToken(nameOrId: string, index: number): void;

  /** A mode collection; mode names are normalised ("Dark" → "dark") and must be unique across collections. */
  createModeCollection(name: string, modes: string[]): ModeCollection;
  /**
   * `modes` is the new ordered list, written with the new names of modes renamed in `renames` (old → new).
   * Removed modes lose their token values and frame pins; a new first mode becomes the default (`value`).
   */
  updateModeCollection(id: string, patch: { name?: string; modes?: string[]; renames?: Record<string, string> }): ModeCollection;
  /** Deletes the collection with its per-mode token values and frame pins (default values stay). */
  deleteModeCollection(id: string): void;
  /** Value of a token in one mode; the default mode writes `value`. null removes the mode value. */
  setTokenModeValue(nameOrId: string, mode: string, value: string | number | null): Token;

  createTextStyle(s: { name: string; styles: StyleMap; description?: string }): TextStyle;
  /** Changing styles updates every linked Text node, except properties a node overrides. */
  updateTextStyle(id: string, patch: { name?: string; styles?: StyleMap; description?: string }): TextStyle;
  /** Deletes the style; linked nodes keep their values and lose the link. */
  deleteTextStyle(id: string): void;
  /** Links a Text node to a style and copies its values, or unlinks it (null) keeping the values. */
  applyTextStyle(nodeId: NodeId, styleId: string | null): void;

  setDocName(name: string): void;
  /** Register asset metadata (bytes are stored elsewhere). */
  addAsset(meta: FoldDocument["assets"][string]): void;
}

export interface TransactOptions {
  origin?: "user" | "agent" | "system";
  /** merge into the previous undo step if it has the same mergeKey (e.g. continuous drag) */
  mergeKey?: string;
}

export interface IDocStore {
  readonly doc: FoldDocument;
  /** Run mutations as one atomic undo step. Throws are propagated and nothing is applied. */
  transact<T>(label: string, fn: (tx: Tx) => T, opts?: TransactOptions): T;
  undo(): boolean;
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Called after every committed change (including undo/redo). Returns unsubscribe. */
  subscribe(listener: (doc: FoldDocument, change: ChangeEvent) => void): () => void;
  /** Replace the whole document (load), clears history. */
  reset(doc: FoldDocument): void;
}

/** Read-only helpers (pure functions over a FoldDocument). */
export interface Queries {
  getNode(doc: FoldDocument, id: NodeId): OFNode | undefined;
  pageOfNode(doc: FoldDocument, id: NodeId): Page | undefined;
  /** top-level Frame under the page root that contains id (or id itself if it is an artboard) */
  artboardOf(doc: FoldDocument, id: NodeId): OFNode | undefined;
  ancestors(doc: FoldDocument, id: NodeId): OFNode[]; // nearest first
  descendants(doc: FoldDocument, id: NodeId): OFNode[]; // depth-first, excluding id
  isAncestor(doc: FoldDocument, ancestorId: NodeId, id: NodeId): boolean;
  artboards(doc: FoldDocument, pageId: PageId): OFNode[];
  /** Paper-style indented summary: `Frame "name" (id) WxH` (sizes come from an optional measure fn) */
  treeSummary(doc: FoldDocument, id: NodeId, depth: number, measure?: (id: NodeId) => { width: number; height: number } | null): string;
  resolveToken(doc: FoldDocument, name: string): string | number | undefined; // follows var() aliases, cycle-safe
}

export type { ChangeEvent };
export type StylePatch = StyleMap;
