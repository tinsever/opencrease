// The toolbar's shape slot: shows the last used shape tool, with a menu of all shapes
// (the corner notch, a second click on the active tool, or a right-click opens it).
import { useRef, useState } from "react";
import { useWorkspace } from "../state/hooks";
import { setTool, type Tool } from "../state/workspace";
import { useStore } from "../canvas/store";
import { CanvasMenu, useDismiss } from "../canvas/ZoomPill";
import { ShapeIcon } from "./icons";
import type { ShapeKind } from "./shapes";
import { vectorUi } from "./state";
import "./vector.css";

const SHAPES: Array<{ kind: ShapeKind; tool: Tool; label: string; key?: string }> = [
  { kind: "rect", tool: "rect", label: "Rectangle", key: "R" },
  { kind: "line", tool: "line", label: "Line", key: "L" },
  { kind: "ellipse", tool: "ellipse", label: "Ellipse", key: "O" },
  { kind: "polygon", tool: "polygon", label: "Polygon" },
  { kind: "star", tool: "star", label: "Star" },
];

const SHAPE_TOOL_SET = new Set<Tool>(SHAPES.map((s) => s.tool));

export function isShapeToolbarTool(tool: Tool): boolean {
  return SHAPE_TOOL_SET.has(tool);
}

function Tip({ label, hint }: { label: string; hint?: string }) {
  return (
    <div role="tooltip" className="of-shape-tip">
      {label}
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function ShapeToolButton() {
  const tool = useWorkspace((s) => s.tool);
  const last = useStore(vectorUi, (s) => s.lastShape);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const activeShape = SHAPES.find((s) => s.tool === tool);
  const current = activeShape ?? SHAPES.find((s) => s.kind === last) ?? SHAPES[0];
  const active = !!activeShape;
  const color = active ? "#FFFFFF" : "var(--of-ink)";
  const pick = (s: (typeof SHAPES)[number]) => {
    vectorUi.set({ lastShape: s.kind });
    setTool(s.tool);
    setOpen(false);
  };
  return (
    <div ref={ref} style={{ position: "relative" }} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {open && (
        <CanvasMenu align="centre">
          <div className="of-menu-label">Shapes</div>
          {SHAPES.map((s) => (
            <button key={s.kind} type="button" role="menuitem" data-active={tool === s.tool || undefined} onClick={() => pick(s)}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShapeIcon kind={s.kind} color="var(--of-ink)" />
                {s.label}
              </span>
              <span className="of-menu-hint">{s.key ?? ""}</span>
            </button>
          ))}
        </CanvasMenu>
      )}
      <button
        type="button"
        aria-label={`${current.label}, shapes menu`}
        aria-pressed={active}
        aria-haspopup="menu"
        aria-expanded={open}
        className="of-tool-button"
        data-active={active || undefined}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const onNotch = e.clientX > r.right - 11 && e.clientY > r.bottom - 11;
          if (onNotch || active) setOpen((o) => !o);
          else pick(current);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        style={{ position: "relative" }}
      >
        <ShapeIcon kind={current.kind} color={color} />
        <svg width="5" height="5" viewBox="0 0 5 5" aria-hidden style={{ position: "absolute", right: 4, bottom: 4 }}>
          <path d="M5 0v5H0z" fill={color} opacity={active ? 0.9 : 0.55} />
        </svg>
      </button>
      {hover && !open && <Tip label={current.label} hint={current.key} />}
    </div>
  );
}
