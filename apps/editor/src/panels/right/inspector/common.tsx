// Shared inspector plumbing: the current selection, mixed values and style writes.
import { Component, createContext, useContext, type Context, type ReactNode } from "react";
import { resolveToken, type FoldDocument, type OFNode, type StyleValue, type Token, type TokenType } from "@opencrease/model";
import { styleConstraintPatches } from "../../../canvas/measure-dom";
import { getWorldRect } from "../../../canvas/registry";
import { getOpenFile } from "../../../state/workspace";
import { MIXED, type Mixed, type TokenOption } from "../../../ui";

export interface InspectorCtx {
  fileId: string;
  doc: FoldDocument;
  nodes: OFNode[];
  ids: string[];
}

// Keep one context object across hot module reloads, so a re-evaluated module still matches the
// provider rendered by an older DesignTab.
const holder = globalThis as unknown as { __opencreaseInspectorCtx?: Context<InspectorCtx | null> };
export const Ctx: Context<InspectorCtx | null> = (holder.__opencreaseInspectorCtx ??= createContext<InspectorCtx | null>(null));

export function useCtx(): InspectorCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("Inspector context missing");
  return c;
}

/** Contains inspector render errors to the inspector; resets when `resetKey` changes (new selection). */
export class InspectorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch(error: Error) {
    console.warn("Inspector section failed", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="of-empty">
          This part of the inspector could not render. Select the layer again to retry.
        </div>
      );
    }
    return this.props.children;
  }
}

export function parentOf(doc: FoldDocument, node: OFNode): OFNode | undefined {
  return node.parentId ? doc.nodes[node.parentId] : undefined;
}

/** The common value of `get` across nodes, or MIXED. */
export function common<T>(nodes: OFNode[], get: (n: OFNode) => T): T | Mixed {
  if (nodes.length === 0) return MIXED;
  const first = get(nodes[0]);
  for (let i = 1; i < nodes.length; i++) {
    const v = get(nodes[i]);
    if (String(v) !== String(first)) return MIXED;
  }
  return first;
}

export function styleValue(nodes: OFNode[], key: string): StyleValue | undefined | Mixed {
  return common(nodes, (n) => n.styles[key] as StyleValue | undefined);
}

/** Write styles to nodes as one undo step. A function patch is evaluated per node. */
export function applyStyles(
  ctx: Pick<InspectorCtx, "fileId" | "ids">,
  patch: Record<string, StyleValue | null> | ((node: OFNode) => Record<string, StyleValue | null>),
  label = "Change style",
  mergeKey?: string,
) {
  const file = getOpenFile(ctx.fileId);
  if (!file) return;
  try {
    file.store.transact(
      label,
      (tx) => {
        for (const id of ctx.ids) {
          const node = tx.doc.nodes[id];
          if (!node || node.locked) continue;
          const styles = typeof patch === "function" ? patch(node) : patch;
          for (const c of styleConstraintPatches(tx.doc, id, styles, getWorldRect)) tx.setStyles(c.id, c.styles);
          tx.setStyles(id, styles);
        }
      },
      { mergeKey },
    );
  } catch (e) {
    console.warn(label, e);
  }
}

export function updateNodes(ctx: Pick<InspectorCtx, "fileId" | "ids">, label: string, fn: (node: OFNode) => Parameters<import("@opencrease/model").Tx["updateNode"]>[1] | null, mergeKey?: string) {
  const file = getOpenFile(ctx.fileId);
  if (!file) return;
  try {
    file.store.transact(
      label,
      (tx) => {
        for (const id of ctx.ids) {
          const node = tx.doc.nodes[id];
          if (!node) continue;
          const p = fn(node);
          if (p) tx.updateNode(id, p);
        }
      },
      { mergeKey },
    );
  } catch (e) {
    console.warn(label, e);
  }
}

export function tokenOptions(doc: FoldDocument, types: TokenType[]): TokenOption[] {
  return doc.tokens.filter((t: Token) => types.includes(t.type)).map((t) => ({ name: t.name, value: t.value }));
}

export function tokenResolver(doc: FoldDocument) {
  return (name: string) => resolveToken(doc, name);
}

export function measured(id: string, axis: "width" | "height"): number | null {
  const r = getWorldRect(id);
  return r ? Math.round(r[axis] * 100) / 100 : null;
}
