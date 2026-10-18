// Responsive preview (SPEC §4.3, P2): one artboard rendered again at several breakpoint widths, side by
// side to its right. The copies are read-only (no pointer events, not in the document) and follow edits
// live because they render the same nodes. Toggled from the artboard's context menu.
import { useCallback, useContext, useSyncExternalStore, type CSSProperties } from "react";
import type { FoldDocument, NodeId, OFNode } from "@opencrease/model";
import { lastKnownRect } from "../registry";
import { pxValue } from "../selection-logic";
import { baseStyle, FileContext, NodeView, ShaderFill } from "./NodeView";

export const DEFAULT_BREAKPOINTS = [390, 768, 1280];
const GAP = 80;

const KEY = (fileId: string) => `opencrease.responsive.${fileId}`;
let state: Record<string, Record<NodeId, number[]>> = {};
const listeners = new Set<() => void>();

function load(fileId: string): Record<NodeId, number[]> {
  if (!state[fileId]) {
    try {
      const raw = globalThis.localStorage?.getItem(KEY(fileId));
      state = { ...state, [fileId]: raw ? (JSON.parse(raw) as Record<NodeId, number[]>) : {} };
    } catch {
      state = { ...state, [fileId]: {} };
    }
  }
  return state[fileId];
}

/** Breakpoint widths for an artboard: the file's breakpoint tokens (px), else 390, 768 and 1280. */
export function breakpointsFor(doc: FoldDocument, artboardWidth: number | null): number[] {
  const fromTokens = doc.tokens
    .filter((t) => t.type === "breakpoint")
    .map((t) => pxValue(t.value) ?? (typeof t.value === "string" ? Number.parseFloat(t.value) : Number.NaN))
    .filter((n) => Number.isFinite(n) && n >= 120 && n <= 4000);
  const list = [...new Set(fromTokens.length ? fromTokens : DEFAULT_BREAKPOINTS)].sort((a, b) => a - b);
  return list.filter((w) => artboardWidth === null || Math.abs(w - artboardWidth) > 1);
}

export function responsiveWidths(fileId: string, id: NodeId): number[] | null {
  return load(fileId)[id] ?? null;
}

export function setResponsivePreview(fileId: string, id: NodeId, widths: number[] | null) {
  const forFile = { ...load(fileId) };
  if (widths && widths.length) forFile[id] = widths;
  else delete forFile[id];
  state = { ...state, [fileId]: forFile };
  try {
    globalThis.localStorage?.setItem(KEY(fileId), JSON.stringify(forFile));
  } catch {
    // storage unavailable: keep it for this session
  }
  for (const l of [...listeners]) l();
}

export function useResponsivePreview(id: NodeId): number[] | null {
  const ctx = useContext(FileContext);
  const fileId = ctx?.register === false ? null : ctx?.fileId;
  const sub = useCallback((l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return useSyncExternalStore(sub, () => (fileId ? responsiveWidths(fileId, id) : null));
}

export function ResponsivePreview({ node, widths }: { node: OFNode; widths: number[] }) {
  const ctx = useContext(FileContext);
  if (!ctx) return null;
  const left = pxValue(node.styles.left) ?? 0;
  const top = pxValue(node.styles.top) ?? 0;
  const ownWidth = pxValue(node.styles.width) ?? lastKnownRect(node.id)?.width ?? 0;
  const fixedHeight = pxValue(node.styles.height);
  let x = left + ownWidth + GAP;
  return (
    <FileContext.Provider value={{ ...ctx, register: false }}>
      {widths.map((w) => {
        const at = x;
        x += w + GAP;
        const style = baseStyle(node, false) as Record<string, string | number>;
        delete style.left;
        delete style.top;
        delete style.right;
        delete style.bottom;
        delete style.rotate;
        style.position = "relative";
        if (node.paint?.shader && !node.paint.shaderHidden) style.isolation = "isolate";
        style.width = w;
        style.height = "auto";
        if (fixedHeight !== undefined) style.minHeight = fixedHeight;
        return (
          <div
            key={w}
            data-of-responsive-preview={node.id}
            aria-hidden
            style={{ position: "absolute", left: at, top, pointerEvents: "none" }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: "100%",
                paddingBottom: "calc(6px / var(--of-zoom, 1))",
                whiteSpace: "nowrap",
                font: "500 calc(11px / var(--of-zoom, 1))/1.3 var(--of-font-sans)",
                color: "var(--of-muted)",
              }}
            >
              {node.name} at {w}
            </div>
            <div style={style as CSSProperties}>
              {node.paint?.shader && !node.paint.shaderHidden ? <ShaderFill spec={node.paint.shader} /> : null}
              {node.children.map((c) => (
                <NodeView key={c} id={c} />
              ))}
            </div>
          </div>
        );
      })}
    </FileContext.Provider>
  );
}
