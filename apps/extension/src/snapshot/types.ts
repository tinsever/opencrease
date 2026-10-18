// Data captured from the page (by content/capture.ts) and handed to the pure layout and emit steps.
// Everything here is plain data so the layout logic can be unit tested without a DOM.
import type { StyleMap } from "@opencrease/model";

/** A rectangle in page (document) coordinates, CSS px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sides {
  t: number;
  r: number;
  b: number;
  l: number;
}

export type CapKind = "frame" | "text" | "image" | "svg";

export interface CapText {
  /** Rendered text: whitespace collapsed like the browser did, "\n" for hard breaks. */
  text: string;
  /** Whitespace must be preserved (white-space: pre / pre-wrap / break-spaces). */
  pre: boolean;
  /** Number of rendered lines. */
  lines: number;
  /** Line height in px (computed, or the measured line box when the computed value is "normal"). */
  lineHeight: number;
  /** Top of the first line box and bottom of the last one (page coordinates). */
  top: number;
  bottom: number;
  /** Horizontal extent of the rendered glyphs (page coordinates). */
  left: number;
  right: number;
}

export interface CapNode {
  kind: CapKind;
  /** Layer name; text layers are named after their text when omitted. */
  name?: string;
  /** Border box, before transforms. */
  rect: Rect;
  /** Paint and text styles, already normalised to OpenCrease's allowlist. Layout styles are added later. */
  styles: StyleMap;
  border: Sides;
  /** CSS padding. The layout step may grow it to absorb spacing (margins) that flex cannot express. */
  padding: Sides;
  /** "abs": absolutely or fixed positioned in the page, placed by coordinates. */
  flow: "in" | "abs";
  zIndex?: number;
  children: CapNode[];
  text?: CapText;
  /** Image source (a data URL once images are inlined). */
  src?: string;
  /** Serialised <svg> markup (styles inlined, ids made unique). */
  svg?: string;
  /** No background, border, shadow or outline: growing its box does not change how it looks. */
  paintless: boolean;
  /** Layout direction of the source element, when it was a flex container. */
  hint?: "row" | "column";
}

/** Output of the layout step: what becomes one OpenCrease node. */
export interface OutNode {
  kind: CapKind;
  name?: string;
  styles: StyleMap;
  children?: OutNode[];
  text?: string;
  pre?: boolean;
  src?: string;
  svg?: string;
}

export interface FontUse {
  family: string;
  weights: number[];
  italic: boolean;
  /** The browser had this family loaded when the page was captured. */
  loaded: boolean;
}

export type CaptureMode = "element" | "viewport" | "page";

export interface CaptureOptions {
  mode: CaptureMode;
  keepFonts: boolean;
}

/** Final result of a capture, ready to be sent to OpenCrease or copied. */
export interface SnapshotPayload {
  /** OpenCrease HTML for one artboard (inline styles, allowlisted properties only). */
  html: string;
  name: string;
  url: string;
  width: number;
  height: number;
  fonts: FontUse[];
  warnings: string[];
  stats: { nodes: number; images: number; absolute: number };
}
