// The environment a tool runs in. Tools only touch the document and the DOM through this
// interface, so they can be unit-tested with a fake environment (see tools/*.test.ts).
import type { AssetMeta, ExportSetting, FoldDocument, NodeId, PageId, Tx } from "@opencrease/model";
import type { AgentClientInfo, ContentBlock } from "@opencrease/protocol";
import type { VersionApi } from "./versions";

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedImage {
  /** base64 without the data: prefix */
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface SavedExport {
  nodeId: NodeId;
  name: string;
  format: ExportSetting["format"];
  scale: string;
  path: string;
  width: number;
  height: number;
  /** videos */
  durationSeconds?: number;
  fps?: number;
  codec?: string;
}

export interface FontLookup {
  fontsPerFamily: Record<string, Array<{ style: string; weight: number; isItalic: boolean }>>;
  errors: string[];
  sources?: Record<string, "google" | "local" | "bundled" | "generic">;
}

export interface ToolEnv {
  readonly fileId: string;
  /** Current document (always the latest committed state). */
  readonly doc: FoldDocument;
  readonly client: AgentClientInfo;
  readonly activePageId: PageId;
  readonly selection: NodeId[];
  /** Absolute editor URL for a path like "/file/<id>/<pageId>". */
  editorUrl(path: string): string;
  /** The single undo step of this call (origin "agent", labelled with the tool). */
  transact<T>(fn: (tx: Tx) => T): T;
  /** Nodes this call changed; their artboards get the "agent working" marker and count towards review nudges. */
  touch(ids: Iterable<NodeId>): void;
  /** World rect of a rendered node, null when it is not measured. */
  measure(id: NodeId): WorldRect | null;
  /** Raw computed style reader for a rendered node (kebab-case property → value), null when not rendered. */
  computedStyle(id: NodeId): ((prop: string) => string) | null;
  /** Wait for the canvas to render pending changes (two animation frames). */
  settle(): Promise<void>;
  /** Show a page in the editor (used before measuring nodes on it). */
  showPage(pageId: PageId): Promise<void>;
  screenshot(id: NodeId, scale: number): Promise<CapturedImage>;
  exportNodes(requests: Array<{ nodeId: NodeId; settings: ExportSetting[] }>): Promise<{ files: SavedExport[]; errors: string[]; warnings?: string[] }>;
  exportCombinedPdf(nodeIds: NodeId[]): Promise<{ path: string; pages: NodeId[]; warning?: string }>;
  fontFamilies(names: string[]): Promise<FontLookup>;
  fillImage(id: NodeId): Promise<{ src: string; image: CapturedImage; naturalWidth: number; naturalHeight: number }>;
  /** Metadata of an uploaded asset (by sha256), null when unknown. */
  assetMeta(hash: string): Promise<AssetMeta | null>;
  /** Artboards currently marked as worked on in this file, with the client name. */
  agentWork(): Record<NodeId, { client: string }>;
  releaseWork(artboardIds: NodeId[]): void;
  /** A screenshot of this artboard was taken (resets the review nudge). */
  reviewed(artboardId: NodeId): void;
  /** Version history of the file (absent in unit tests). */
  versions?: VersionApi;
}

/** A raw content block in a tool body (images). */
export class RawBlock {
  constructor(readonly block: ContentBlock) {}
}

/** What a tool returns: text parts (strings as-is, objects as JSON) and raw blocks, in order. */
export type ToolBody = Array<string | object | RawBlock>;

/** An error meant for the agent; the message is returned as-is. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface EditorTool<A = Record<string, unknown>> {
  /** Writes count towards review nudges and mark artboards as worked on. */
  write: boolean;
  /** Page that must be shown while the tool runs (switched to before run). */
  page?(args: A, doc: FoldDocument): PageId | undefined;
  /** Short activity label, e.g. "Writing Hero". */
  label?(args: A, doc: FoldDocument): string;
  run(args: A, env: ToolEnv): Promise<ToolBody> | ToolBody;
}
