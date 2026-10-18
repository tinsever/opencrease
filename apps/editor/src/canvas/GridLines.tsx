import { trackEdges } from "./grid-geometry";
// On-canvas grid lines for a selected CSS grid frame: the edges of every column and row track, read from
// the browser's resolved track sizes, drawn dashed in screen space.
import { useLayoutEffect, useState } from "react";
import type { NodeId } from "@opencrease/model";
import { getActiveFile } from "../state/workspace";
import { orientedBox } from "./measure-dom";
import { getNodeElement, getWorldRect } from "./registry";
import type { ViewportValue } from "./viewport-math";

export interface GridGeometry {
  angle: number;
  cx: number;
  cy: number;
  /** content box, world units */
  x: number;
  y: number;
  width: number;
  height: number;
  /** track edges along x and y (start and end of each track), world units relative to the content box */
  cols: Array<[number, number]>;
  rows: Array<[number, number]>;
}

function measureGrid(id: NodeId): GridGeometry | null {
  const el = getNodeElement(id);
  const doc = getActiveFile()?.store.doc;
  const b = doc ? orientedBox(doc, id) : null;
  const r = b ? { x: b.cx - b.width / 2, y: b.cy - b.height / 2, width: b.width, height: b.height } : getWorldRect(id);
  if (!el || !r) return null;
  const cs = getComputedStyle(el);
  if (cs.display !== "grid" && cs.display !== "inline-grid") return null;
  const px = (v: string) => Number.parseFloat(v) || 0;
  const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
  const left = (px(cs.borderLeftWidth) + px(cs.paddingLeft)) * scale;
  const top = (px(cs.borderTopWidth) + px(cs.paddingTop)) * scale;
  const right = (px(cs.borderRightWidth) + px(cs.paddingRight)) * scale;
  const bottom = (px(cs.borderBottomWidth) + px(cs.paddingBottom)) * scale;
  const colGap = cs.columnGap === "normal" ? 0 : px(cs.columnGap);
  const rowGap = cs.rowGap === "normal" ? 0 : px(cs.rowGap);
  const cols = trackEdges(cs.gridTemplateColumns, colGap).map(([a, b]) => [a * scale, b * scale] as [number, number]);
  const rows = trackEdges(cs.gridTemplateRows, rowGap).map(([a, b]) => [a * scale, b * scale] as [number, number]);
  return { angle: b?.angle ?? 0, cx: b?.cx ?? r.x + r.width / 2, cy: b?.cy ?? r.y + r.height / 2, x: r.x + left, y: r.y + top, width: r.width - left - right, height: r.height - top - bottom, cols, rows };
}

export function GridLines({ id, vp }: { id: NodeId; vp: ViewportValue }) {
  const [g, setG] = useState<GridGeometry | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const next = measureGrid(id);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setG(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [id]);
  if (!g) return null;
  const z = vp.zoom;
  const sx = (x: number) => (g.x + x) * z + vp.x;
  const sy = (y: number) => (g.y + y) * z + vp.y;
  const line = "color-mix(in srgb, var(--of-accent) 70%, transparent)";
  const fill = "color-mix(in srgb, var(--of-accent) 6%, transparent)";
  return (
    <div data-of-grid-lines="" style={{ position: "absolute", inset: 0, pointerEvents: "none", transform: `rotate(${g.angle}deg)`, transformOrigin: `${g.cx * z + vp.x}px ${g.cy * z + vp.y}px` }}>
      {g.cols.map(([a, b], i) => (
        <div
          key={`c${i}`}
          style={{
            position: "absolute",
            left: sx(a),
            top: sy(0),
            width: Math.max(0, (b - a) * z),
            height: Math.max(0, g.height * z),
            background: fill,
            borderLeft: `1px dashed ${line}`,
            borderRight: `1px dashed ${line}`,
            boxSizing: "border-box",
          }}
        />
      ))}
      {g.rows.map(([a, b], i) => (
        <div
          key={`r${i}`}
          style={{
            position: "absolute",
            left: sx(0),
            top: sy(a),
            width: Math.max(0, g.width * z),
            height: Math.max(0, (b - a) * z),
            borderTop: `1px dashed ${line}`,
            borderBottom: `1px dashed ${line}`,
            boxSizing: "border-box",
          }}
        />
      ))}
    </div>
  );
}
