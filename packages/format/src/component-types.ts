// Component model types (SPEC §4.9). Kept apart from types.ts so the core node types stay small.
// All fields that reference these types are optional, so documents without components load unchanged.
import type { AssetMeta, NodeId, OFNode, StyleValue, Token } from "./types";

/**
 * Prop kinds of a main component.
 * - text: drives the text of a Text layer (`target`)
 * - boolean: drives the visibility of a layer (`target`)
 * - enum: a variant axis; lives on a component set, derived from the `variant` values of its components
 * - instance-swap: swaps the component of a nested instance (`target`); the value is a component id
 * - slot: a frame (`target`) whose children belong to each instance (arbitrary content)
 */
export type ComponentPropType = "text" | "boolean" | "enum" | "instance-swap" | "slot";

export type PropValue = string | boolean;

export interface ComponentPropDef {
  /** unique within the component, used as the key in instance prop values */
  name: string;
  type: ComponentPropType;
  /** text: string, boolean: boolean, enum: option, instance-swap: component id */
  default?: PropValue;
  /** enum options (component sets derive these from their variants) */
  options?: string[];
  /** id path of the bound layer inside the main component ("" is the component frame itself) */
  target?: string;
  description?: string;
}

/** Maps a design component to a code component, so code export emits `<Button variant="primary" />`. */
export interface CodeRef {
  /** import source, e.g. "@acme/ui" */
  package: string;
  /** named export, e.g. "Button" ("default" imports the default export under the component name) */
  export: string;
  /** design prop name to code prop name; "" leaves a prop out; unlisted props keep their design name */
  propsMap?: Record<string, string>;
}

/** Marks a Frame as a main component. */
export interface ComponentDef {
  props: ComponentPropDef[];
  /** variant values when the component sits in a component set, e.g. { variant: "primary", size: "md" } */
  variant?: Record<string, string>;
  codeRef?: CodeRef;
  description?: string;
}

/** Marks a Frame as a component set: its child components are variants of one component. */
export interface ComponentSetDef {
  codeRef?: CodeRef;
  description?: string;
}

/**
 * Per-layer override inside an instance, keyed by the layer's id path in the main component.
 * `styles` values of null remove a property the main component sets.
 * `props`/`componentId` apply to nested instances (prop values and variant or swap).
 */
export interface NodeOverride {
  styles?: Record<string, StyleValue | null>;
  text?: string;
  visible?: boolean;
  name?: string;
  src?: string;
  props?: Record<string, PropValue>;
  componentId?: NodeId;
}

/** Marks a Frame as an instance of a main component. */
export interface InstanceData {
  componentId: NodeId;
  /** set when the main component comes from a subscribed library (the library file id) */
  library?: string;
  /** prop values by prop name (text, boolean, instance-swap); variants are picked through componentId */
  props: Record<string, PropValue>;
  /** keyed by id path in the main component: "" is the instance frame, "A-0" a layer, "B1-0/C2-0" a layer of a nested instance */
  overrides: Record<string, NodeOverride>;
}

/** A library this file subscribes to: a copy of the published components and tokens. */
export interface LibraryCopy {
  name: string;
  /** published version this copy was taken from */
  version: number;
  publishedAt: number;
  /** published component and component set ids (roots inside `nodes`) */
  componentIds: NodeId[];
  /** the published subtrees (ids are the library file's ids) */
  nodes: Record<NodeId, OFNode>;
  tokens: Token[];
  assets?: Record<string, AssetMeta>;
}

/** Publish state of this file as a library. */
export interface LibraryPublishInfo {
  version: number;
  publishedAt: number;
}

/** NodeTree input for an instance (from `<x-instance>` in HTML or the agent tools). */
export interface InstanceTreeSpec {
  /** component id, component name, or code export name */
  component: string;
  library?: string;
  /** prop values by design or code prop name; enum props pick the variant */
  props?: Record<string, PropValue>;
  /** overrides to restore (copy and paste of an instance) */
  overrides?: Record<string, NodeOverride>;
  /** slot contents by slot prop name */
  slots?: Record<string, import("./types").NodeTree[]>;
}
