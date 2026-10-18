// On-canvas handles for the gradient fill open in the inspector: drag the endpoints to change the
// angle (linear, conic) or the centre (radial, conic), drag stops along the line, click the line to
// add a stop, Delete removes the selected stop. Screen space, above the selection outline.
import { useEffect, type PointerEvent as ReactPointerEvent } from "react";
import type { FoldDocument } from "@opencrease/model";
import { readNodeFills, writeNodeFills } from "../panels/right/inspector/fill-write";
import { isGradientLayer, type FillLayer, type GradientLayer } from "../panels/right/inspector/fills";
import { angleFromPoints, insertStop, linearLine, moveStop as reorderStop, projectOnLine, radialRadius, resolvedStops, type Line } from "../panels/right/inspector/gradient";
import { resolveColor } from "../panels/right/color/color-value";
import { gradientEdit } from "./gradient-edit";
import { getViewportLive } from "./registry";
import { useStore } from "./store";
import type { Rect } from "./geometry";

let session = 0;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function GradientHandles({ doc, nodeId, rect }: { doc: FoldDocument; nodeId: string; rect: Rect | undefined }) {
  const edit = useStore(gradientEdit, (s) => s);
  const target = edit.target && edit.target.nodeId === nodeId ? edit.target : null;
  const node = target ? doc.nodes[target.nodeId] : undefined;
  const layer = node ? readNodeFills(node)[target!.layer] : undefined;
  const g = layer && isGradientLayer(layer) ? layer : undefined;

  useEffect(() => {
    if (!g || !target) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if ((e.key === "Delete" || e.key === "Backspace") && g.stops.length > 2) {
        e.preventDefault();
        e.stopPropagation();
        const i = gradientEdit.get().stop;
        write(target.fileId, target.nodeId, target.layer, (l) => ({ ...l, stops: l.stops.filter((_, j) => j !== i) }), "Remove stop");
        gradientEdit.set({ stop: Math.max(0, i - 1) });
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [g, target]);

  if (!target || !node || !g || !rect) return null;
  const zoom = getViewportLive().zoom;
  const w = rect.width / zoom;
  const h = rect.height / zoom;
  // box-local (unzoomed) → screen
  const sx = (x: number) => rect.x + x * zoom;
  const sy = (y: number) => rect.y + y * zoom;
  const toLocal = (ev: { clientX: number; clientY: number }, host: Element) => {
    const r = host.getBoundingClientRect();
    return { x: (ev.clientX - r.left - rect.x) / zoom, y: (ev.clientY - r.top - rect.y) / zoom };
  };
  const stops = resolvedStops(g.stops);
  const center = g.kind === "linear" ? { x: w / 2, y: h / 2 } : { x: ((g.at?.x ?? 50) / 100) * w, y: ((g.at?.y ?? 50) / 100) * h };

  // the line stops sit on
  let line: Line;
  if (g.kind === "linear") line = linearLine(g.angle, w, h);
  else if (g.kind === "radial") {
    const { rx } = radialRadius(g, w, h);
    line = { x1: center.x, y1: center.y, x2: center.x + rx, y2: center.y };
  } else {
    const len = Math.max(24 / zoom, Math.min(w, h) * 0.35);
    const a = (g.angle * Math.PI) / 180;
    line = { x1: center.x, y1: center.y, x2: center.x + Math.sin(a) * len, y2: center.y - Math.cos(a) * len };
  }
  const at = (p: number) => ({ x: line.x1 + ((line.x2 - line.x1) * p) / 100, y: line.y1 + ((line.y2 - line.y1) * p) / 100 });
  const conicPoint = (p: number) => {
    const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const a = ((g.kind === "conic" ? g.angle : 0) + p * 3.6) * (Math.PI / 180);
    return { x: center.x + Math.sin(a) * len, y: center.y - Math.cos(a) * len };
  };
  const stopPoint = (p: number) => (g.kind === "conic" ? conicPoint(p) : at(p));

  const drag = (e: ReactPointerEvent<Element>, onMove: (p: { x: number; y: number }, ev: PointerEvent, mk: string) => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const host = (e.currentTarget as Element).closest("[data-of-gradient-handles]")!;
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const mk = `gradient-${++session}`;
    const move = (ev: PointerEvent) => onMove(toLocal(ev, host), ev, mk);
    const up = () => {
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const update = (fn: (l: GradientLayer) => GradientLayer, mk?: string, label = "Gradient") => write(target.fileId, target.nodeId, target.layer, fn, label, mk);

  const moveStop = (i: number) => (e: ReactPointerEvent<Element>) => {
    gradientEdit.set({ stop: i });
    const start = resolvedStops(g.stops);
    drag(e, (p, _ev, mk) => {
      let pos: number;
      if (g.kind === "conic") pos = (((angleFromPoints(center.x, center.y, p.x, p.y) - g.angle) % 360) + 360) % 360 / 3.6;
      else pos = projectOnLine(line, p.x, p.y);
      pos = Math.round(clamp(pos, 0, 100) * 10) / 10;
      const moved = reorderStop(start, i, pos);
      update((l) => ({ ...l, stops: moved.stops }), mk);
      gradientEdit.set({ stop: moved.index });
    });
  };

  const moveEnd = (which: "start" | "end") => (e: ReactPointerEvent<Element>) =>
    drag(e, (p, ev, mk) => {
      if (g.kind === "linear") {
        const pivot = { x: w / 2, y: h / 2 };
        let a = angleFromPoints(pivot.x, pivot.y, p.x, p.y);
        if (which === "start") a = (a + 180) % 360;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        update((l) => ({ ...l, angle: Math.round(a * 10) / 10 }) as GradientLayer, mk);
      } else if (which === "start") {
        const x = Math.round(clamp((p.x / w) * 100, -50, 150) * 10) / 10;
        const y = Math.round(clamp((p.y / h) * 100, -50, 150) * 10) / 10;
        update((l) => ({ ...l, at: { x, y } }) as GradientLayer, mk);
      } else if (g.kind === "conic") {
        let a = angleFromPoints(center.x, center.y, p.x, p.y);
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        update((l) => ({ ...l, angle: Math.round(a * 10) / 10 }) as GradientLayer, mk);
      } else {
        // radial: drag the radius handle to set an explicit circle size
        const r = Math.max(1, Math.round(Math.hypot(p.x - center.x, p.y - center.y)));
        update((l) => ({ ...l, shape: "circle", radialSize: `${r}px` }) as GradientLayer, mk);
      }
    });

  const addOnLine = (e: ReactPointerEvent<Element>) => {
    if (e.button !== 0 || g.kind === "conic") return;
    e.preventDefault();
    e.stopPropagation();
    const host = (e.currentTarget as Element).closest("[data-of-gradient-handles]")!;
    const p = toLocal(e, host);
    const pos = clamp(projectOnLine(line, p.x, p.y), 0, 100);
    const nearest = stops.reduce((best, s) => (Math.abs(s.position - pos) < Math.abs(best.position - pos) ? s : best), stops[0]);
    const r = insertStop(g.stops, nearest.color, pos);
    update((l) => ({ ...l, stops: r.stops }), undefined, "Add stop");
    gradientEdit.set({ stop: r.index });
  };

  const a = { x: sx(line.x1), y: sy(line.y1) };
  const b = { x: sx(line.x2), y: sy(line.y2) };
  const color = (c: string) => resolveColor(doc, c);
  return (
    <svg data-of-gradient-handles="" data-of-overlay-ui="" className="of-popover-child" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      {g.kind === "conic" ? (
        <circle cx={sx(center.x)} cy={sy(center.y)} r={Math.hypot(b.x - a.x, b.y - a.y)} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={1} style={{ filter: "drop-shadow(0 0 1px #0008)" }} />
      ) : null}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth={1.5} style={{ filter: "drop-shadow(0 0 1px #0009)" }} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10} style={{ pointerEvents: "stroke", cursor: "copy" }} onPointerDown={addOnLine} />
      <circle data-handle="start" cx={a.x} cy={a.y} r={5} fill="#fff" stroke="var(--of-accent)" strokeWidth={1.5} style={{ pointerEvents: "all", cursor: g.kind === "linear" ? "grab" : "move" }} onPointerDown={moveEnd("start")} />
      <circle data-handle="end" cx={b.x} cy={b.y} r={5} fill="#fff" stroke="var(--of-accent)" strokeWidth={1.5} style={{ pointerEvents: "all", cursor: "grab" }} onPointerDown={moveEnd("end")} />
      {stops.map((s, i) => {
        const onLine = stopPoint(s.position);
        // Keep stop markers away from the endpoints so both remain draggable.
        const dx = g.kind === "conic" ? onLine.x - center.x : -(line.y2 - line.y1);
        const dy = g.kind === "conic" ? onLine.y - center.y : line.x2 - line.x1;
        const length = Math.hypot(dx, dy) || 1;
        const p = { x: onLine.x + (dx / length) * 16 / zoom, y: onLine.y + (dy / length) * 16 / zoom };
        const on = i === Math.min(edit.stop, stops.length - 1);
        return (
          <g key={i} data-stop={i} style={{ pointerEvents: "all", cursor: "grab" }} onPointerDown={moveStop(i)}>
            <line x1={sx(onLine.x)} y1={sy(onLine.y)} x2={sx(p.x)} y2={sy(p.y)} stroke="#fff" strokeWidth={1} style={{ pointerEvents: "none" }} />
            <rect x={sx(p.x) - 7} y={sy(p.y) - 7} width={14} height={14} rx={4} fill="#fff" stroke={on ? "var(--of-accent)" : "#0000004d"} strokeWidth={on ? 2 : 1} />
            <rect x={sx(p.x) - 4.5} y={sy(p.y) - 4.5} width={9} height={9} rx={2.5} fill={color(s.color)} />
          </g>
        );
      })}
    </svg>
  );
}

function write(fileId: string, nodeId: string, index: number, fn: (l: GradientLayer) => GradientLayer, label: string, mk?: string) {
  writeNodeFills(fileId, [nodeId], (layers) => layers.map((l, i): FillLayer => (i === index && isGradientLayer(l) ? (fn(l) as FillLayer) : l)), label, mk);
}
