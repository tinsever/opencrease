// Core document model for OpenCrease. Pure data, no DOM, no Node APIs.
// Everything here must stay JSON-serialisable: it is written to disk as-is.

import type { ComponentDef, ComponentSetDef, InstanceData, InstanceTreeSpec, LibraryCopy, LibraryPublishInfo } from "./component-types";

export type NodeId = string;
export type PageId = string;

export type NodeType =
  | "Root" // one per page, holds artboards and loose layers
  | "Frame" // <div>, can have children
  | "Text" // <div> with white-space: pre-wrap, optional rich text spans
  | "Rectangle" // <div> without children
  | "Image" // <img>
  | "SVG" // inline <svg>, children are SVGElement
  | "SVGElement" // path, circle, rect, g, line, polyline, polygon, ellipse, defs, linearGradient, radialGradient, stop, ...
  | "Shader"; // <canvas> rendered by @paper-design/shaders

/** camelCase CSS properties, like React.CSSProperties. Numbers are px for length properties. */
export type StyleValue = string | number;
export type StyleMap = Record<string, StyleValue>;

export interface ExportSetting {
  format: "png" | "jpg" | "webp" | "avif" | "svg" | "pdf" | "mp4" | "webm";
  /** "2x", "512w", "512h", "720p" */
  scale: string;
  suffix?: string;
  /** Video length in seconds, 1 to 300 (mp4/webm, default 10) */
  durationSeconds?: number;
  /** Video frame rate: 24, 30 or 60 (mp4/webm, default 30) */
  fps?: number;
  /** Image quality inside PDFs (default "high") */
  pdfQuality?: "low" | "medium" | "high";
  /** "detailed" keeps images at up to 2x their size in PDFs, "basic" at 1x (default "detailed") */
  pdfResampling?: "detailed" | "basic";
}

export interface ShaderSpec {
  /** Export name from @paper-design/shaders-react, e.g. "MeshGradient" */
  name: string;
  params: Record<string, unknown>;
}

export interface OFNode {
  id: NodeId;
  type: NodeType;
  name: string;
  parentId: NodeId | null; // null only for Root
  children: NodeId[]; // ordered back-to-front (last renders on top)
  visible: boolean;
  locked: boolean;
  styles: StyleMap;
  /** Text nodes */
  text?: string;
  /** Image nodes: "asset://<sha256>" or an http(s)/data URL */
  src?: string;
  /** SVG and SVGElement: tag name ("svg", "path", ...) */
  tag?: string;
  /** SVG and SVGElement: raw attributes except style (viewBox, d, fill, stroke, ...) */
  attrs?: Record<string, string>;
  /** Shader nodes */
  shader?: ShaderSpec;
  exports?: ExportSetting[];
  /** AI generated image: how it was made, so it can be regenerated (SPEC §10) */
  gen?: GenSpec;
  /** Paint without a CSS form: shader fill and hidden fill layers (SPEC §4.4). */
  paint?: NodePaint;
  /** Resize behaviour for absolute children; absence means left/top. */
  constraints?: Constraints;
  /** Frame: main component (components.ts) */
  component?: ComponentDef;
  /** Frame: component set holding variants */
  componentSet?: ComponentSetDef;
  /** Frame: instance of a main component */
  instance?: InstanceData;
  /** Layer generated inside an instance: id path of the layer it mirrors in the main component */
  source?: string;
  /** Text nodes: rich text runs. Their texts joined equal `text`; absent for plain text. */
  spans?: TextSpan[];
  /** Frames: pinned token modes, space separated (rendered as `data-mode`), e.g. "dark" or "dark compact". */
  mode?: string;
  /** Text nodes: id of the applied text style (its values are copied into `styles`). */
  textStyle?: string;
}

/** One run of a rich Text node. `styles` override the node's own text styles for this run. */
export interface TextSpan {
  text: string;
  styles?: StyleMap;
}

/**
 * A set of token modes such as light/dark or comfortable/compact. The first mode is the default and
 * uses each token's `value`; the other modes take values from `Token.modes`. Mode names are lowercase
 * identifiers, unique across all collections, since a frame pins them by name (`data-mode="dark"`).
 */
export interface ModeCollection {
  id: string;
  name: string;
  modes: string[];
}

/** A named bundle of typography values (literals or var() tokens), applied to Text nodes in one click. */
export interface TextStyle {
  id: string;
  name: string;
  styles: StyleMap;
  description?: string;
}

/**
 * Paint stored next to `styles`. A shader fill renders above the CSS background layers and below the
 * children. Hidden fill layers live here so they neither render nor export, and come back in place.
 */
export interface NodePaint {
  shader?: ShaderSpec;
  shaderHidden?: boolean;
  hiddenFills?: HiddenFill[];
}

/** A hidden background layer: its CSS and its index in the full fill stack (top-most first). */
export interface HiddenFill {
  index: number;
  css: string;
  size?: string;
  position?: string;
  repeat?: string;
  blend?: string;
}

export type HorizontalConstraint = "left" | "right" | "center" | "scale" | "stretch";
export type VerticalConstraint = "top" | "bottom" | "center" | "scale" | "stretch";

export interface Constraints {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
}

/** Prompt, model and seed of an AI generated image on a node (its src, or its background fill). */
export interface GenSpec {
  prompt: string;
  /** "src" for Image nodes, "fill" for a background image layer */
  target: "src" | "fill";
  /** provider id from Settings, AI (omitted: the default image provider) */
  provider?: string;
  model?: string;
  /** only stored when the provider honours seeds */
  seed?: number;
  width?: number;
  height?: number;
  /** the image was made by editing the previous one */
  edit?: boolean;
}

export type PageIcon =
  | "arrow" | "padlock" | "check" | "cross" | "info" | "question" | "design" | "vector"
  | "images" | "table" | "presentation" | "blueprint" | "swatches" | "bar-chart"
  | "line-chart" | "pie-chart" | "paper";

export interface Page {
  id: PageId;
  name: string;
  icon: PageIcon | null;
  rootId: NodeId;
}

export type PageListItem = { type: "page"; id: PageId } | { type: "divider"; id: string };

export type TokenType =
  | "color" | "spacing" | "radius" | "fontFamily" | "fontWeight" | "fontSize"
  | "lineHeight" | "letterSpacing" | "opacity" | "container" | "breakpoint";

export interface Token {
  id: string;
  type: TokenType;
  /** CSS custom property name, e.g. "--color-primary" */
  name: string;
  /** literal or alias "var(--other)" */
  value: string | number;
  description?: string;
  /** Values in non-default modes, keyed by mode name. All keys belong to one mode collection. */
  modes?: Record<string, string | number>;
}

export interface AssetMeta {
  hash: string; // sha256 hex
  mime: string;
  name?: string;
  size: number;
  width?: number;
  height?: number;
}

/** Design brief an agent posted before building (SPEC §8.5 "Brief first"). */
export interface DesignBrief {
  id: string;
  /** artboard the brief is about, null for the whole file */
  artboardId: NodeId | null;
  subject?: string;
  mood: string;
  palette: string;
  type: string;
  direction: string;
  /** agent client that posted it */
  author?: string;
  createdAt: number;
}

export interface FoldDocument {
  formatVersion: 1;
  id: string; // file id (ULID-like)
  name: string;
  createdAt: number;
  updatedAt: number;
  pageList: PageListItem[];
  pages: Record<PageId, Page>;
  nodes: Record<NodeId, OFNode>; // every node of every page, including Root nodes
  tokens: Token[]; // ordered
  assets: Record<string, AssetMeta>;
  /** monotonic counter used for id generation */
  clock: number;
  /** client id suffix used in generated ids ("0" for the local app) */
  clientId: string;
  briefs?: DesignBrief[];
  /** token mode collections (absent in files without modes) */
  modeCollections?: ModeCollection[];
  /** text styles, ordered (absent in files without text styles) */
  textStyles?: TextStyle[];
  /** Subscribed libraries by library file id (components.ts) */
  libraries?: Record<string, LibraryCopy>;
  /** Set once this file has published itself as a library */
  library?: LibraryPublishInfo;
}

/**
 * Input shape for inserting a subtree (output of the HTML parser).
 * `cloneOf` copies an existing node (deep) and then applies `styles` on top.
 */
export interface NodeTree {
  type?: Exclude<NodeType, "Root">;
  name?: string;
  styles?: StyleMap;
  text?: string;
  src?: string;
  tag?: string;
  attrs?: Record<string, string>;
  shader?: ShaderSpec;
  children?: NodeTree[];
  visible?: boolean;
  locked?: boolean;
  cloneOf?: NodeId;
  paint?: NodePaint;
  constraints?: Constraints;
  spans?: TextSpan[];
  mode?: string;
  textStyle?: string;
  /** Creates an instance of a component; `children` are only used when the component cannot be found */
  instance?: InstanceTreeSpec;
}

/** A change notification emitted after each transaction. */
export interface ChangeEvent {
  label: string;
  origin: "user" | "agent" | "system" | "undo" | "redo";
  /** ids of nodes created/updated/deleted (best effort, for rendering invalidation) */
  touched: NodeId[];
}
