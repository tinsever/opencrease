// Screen-space drawing for vector editing: the pen's draft path, shape previews, and path edit mode
// (outline, anchors, bézier handles, point marquee, live readout and the mode bar).
import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { FoldDocument } from "@opencrease/model";
import { useDoc } from "../state/hooks";
import { getCanvasElement } from "../canvas/registry";
import { useStore } from "../canvas/store";
import { toScreen, type ViewportValue } from "../canvas/viewport-math";
import { formatNumber } from "../canvas/geometry";
import { installVectorController } from "./controller";
import { editModel, exitPathEdit, pathToScreen, pressAnchor, pressHandle, setEditTool, typeOf, validRefs } from "./edit";
import { applyMatrix, refKey, serializePath, transformPath, type Matrix, type PathModel, type Pt } from "./path";
import { finishPen } from "./pen";
import { polygonPoints, starPoints } from "./shapes";
import { toggleSnapHalf, vectorUi, type PathEdit, type PenDraft, type ShapeDraft } from "./state";
import "./vector.css";

const ACCENT = "var(--of-accent)";

function useLiveMatrix(doc: FoldDocument | undefined, edit: PathEdit | null, vp: ViewportValue): Matrix | null {
  const [m, setM] = useState<Matrix | null>(null);
  // measure after every commit (the edited SVG may have been refitted) and keep tracking layout changes
  useLayoutEffect(() => {
    const next = doc && edit ? pathToScreen(doc, edit.pathId) : null;
    setM((prev) => (sameMatrix(prev, next) ? prev : next));
  });
  useEffect(() => {
    if (!edit) return;
    let raf = 0;
    const tick = () => {
      const f = vectorUi.get().edit;
      const d = doc;
      if (f && d) {
        const next = pathToScreen(d, f.pathId);
        setM((prev) => (sameMatrix(prev, next) ? prev : next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [edit, doc]);
  void vp;
  return m;
}

function sameMatrix(a: Matrix | null, b: Matrix | null): boolean {
  if (!a || !b) return a === b;
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

// ------------------------------------------------------------------ pieces

function AnchorBox({ p, selected, onPointerDown, title }: { p: Pt; selected: boolean; onPointerDown?: (e: PointerEvent) => void; title?: string }) {
  const size = selected ? 10 : 8;
  return (
    <div
      data-of-overlay-ui=""
      title={title}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e.nativeEvent) : undefined}
      style={{
        position: "absolute",
        left: p.x - 8,
        top: p.y - 8,
        width: 16,
        height: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: onPointerDown ? "auto" : "none",
        cursor: "default",
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          boxSizing: "border-box",
          background: selected ? ACCENT : "#FFFFFF",
          border: selected ? "none" : `1.5px solid ${ACCENT}`,
        }}
      />
    </div>
  );
}

function HandleDot({ p, onPointerDown }: { p: Pt; onPointerDown: (e: PointerEvent) => void }) {
  return (
    <div
      data-of-overlay-ui=""
      onPointerDown={(e) => onPointerDown(e.nativeEvent)}
      style={{
        position: "absolute",
        left: p.x - 7,
        top: p.y - 7,
        width: 14,
        height: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
    >
      <div style={{ width: 8, height: 8, boxSizing: "border-box", borderRadius: 999, background: "#FFFFFF", border: `1.5px solid ${ACCENT}` }} />
    </div>
  );
}

function Readout({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        padding: "3px 7px",
        background: "var(--of-ink)",
        color: "#FFFFFF",
        borderRadius: "var(--of-radius-sm)",
        fontFamily: "var(--of-font-mono)",
        fontSize: "var(--of-text-xs)",
        lineHeight: "14px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

function BarButton({ label, active, onClick, title, primary }: { label: string; active?: boolean; onClick: () => void; title?: string; primary?: boolean }) {
  return (
    <button
      type="button"
      className="of-mode-bar-btn"
      data-active={active || undefined}
      data-primary={primary || undefined}
      aria-pressed={primary ? undefined : !!active}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ModeBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-of-chrome=""
      className="of-mode-bar"
      role="toolbar"
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="of-mode-bar-label">{label}</div>
      <div className="of-mode-bar-sep" />
      {children}
    </div>
  );
}

const svgLayer: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" };

// ------------------------------------------------------------------ pen draft

function PenLayer({ pen, vp, snap }: { pen: PenDraft; vp: ViewportValue; snap: boolean }) {
  const s = (p: Pt) => toScreen(vp, p);
  const screen: PathModel = transformPath([{ anchors: pen.anchors, closed: false }], [vp.zoom, 0, 0, vp.zoom, vp.x, vp.y]);
  const last = pen.anchors[pen.anchors.length - 1];
  let band = "";
  if (last && pen.cursor) {
    const target = pen.closing ? pen.anchors[0] : pen.cursor;
    const a = s(last);
    const c1 = s(last.out ?? last);
    const c2 = pen.closing && pen.anchors[0].in ? s(pen.anchors[0].in) : s(target);
    const b = s(target);
    band = `M${a.x} ${a.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  }
  return (
    <>
      <svg style={svgLayer}>
        {band && <path d={band} fill="none" stroke={ACCENT} strokeWidth={1} strokeOpacity={0.55} />}
        <path d={serializePath(screen, 2)} fill="none" stroke={ACCENT} strokeWidth={1.5} />
        {last && last.in && <line x1={s(last).x} y1={s(last).y} x2={s(last.in).x} y2={s(last.in).y} stroke={ACCENT} strokeWidth={1} />}
        {last && last.out && <line x1={s(last).x} y1={s(last).y} x2={s(last.out).x} y2={s(last.out).y} stroke={ACCENT} strokeWidth={1} />}
        {last && [last.in, last.out].map((h, i) => (h ? <circle key={i} cx={s(h).x} cy={s(h).y} r={3.5} fill="#FFFFFF" stroke={ACCENT} strokeWidth={1.5} /> : null))}
      </svg>
      {pen.anchors.map((a, i) => (
        <AnchorBox key={i} p={s(a)} selected={i === pen.anchors.length - 1 || (i === 0 && pen.closing)} />
      ))}
      <ModeBar label="Drawing path">
        <BarButton label="Snap ½ px" active={snap} onClick={toggleSnapHalf} title="Snap points to half pixels (⇧⌘')" />
        <div className="of-mode-bar-sep" />
        <BarButton label="Done" primary onClick={() => finishPen(false)} title="Finish the path (Enter)" />
      </ModeBar>
    </>
  );
}

// ------------------------------------------------------------------ shape draft

function ShapeLayer({ shape, vp }: { shape: ShapeDraft; vp: ViewportValue }) {
  const a = toScreen(vp, shape.a);
  const b = toScreen(vp, shape.b);
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  let el: ReactNode = null;
  if (shape.kind === "line") el = <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={1.5} />;
  else if (shape.kind === "ellipse") el = <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={ACCENT} strokeWidth={1.5} />;
  else if (shape.kind === "polygon" || shape.kind === "star") {
    const pts = shape.kind === "polygon" ? polygonPoints(3, box) : starPoints(5, 0.382, box);
    el = <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={1.5} />;
  } else el = <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="none" stroke={ACCENT} strokeWidth={1.5} />;
  const w = Math.abs(shape.b.x - shape.a.x);
  const h = Math.abs(shape.b.y - shape.a.y);
  const label = shape.kind === "line" ? `${formatNumber(Math.hypot(w, h))}` : `${formatNumber(w)} × ${formatNumber(h)}`;
  return (
    <>
      <svg style={svgLayer}>{el}</svg>
      <div className="of-vector-badge" style={{ left: box.x + box.width / 2, top: box.y + box.height + 6 }}>
        {label}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ path edit

function EditLayer({ doc, edit, m, snap }: { doc: FoldDocument; edit: PathEdit; m: Matrix | null; snap: boolean }) {
  const readout = useStore(vectorUi, (s) => s.readout);
  const marquee = useStore(vectorUi, (s) => s.marquee);
  const model = editModel(doc, edit.pathId);
  const bar = (
    <ModeBar label="Editing path">
      <BarButton label="Bend" active={edit.tool === "bend"} onClick={() => setEditTool("bend")} title="Drag points, handles and segments. Double-click a segment to add a point" />
      <BarButton label="Add point" active={edit.tool === "add"} onClick={() => setEditTool("add")} title="Click a segment to add a point" />
      <BarButton label="Snap ½ px" active={snap} onClick={toggleSnapHalf} title="Snap points to half pixels (⇧⌘')" />
      <div className="of-mode-bar-sep" />
      <BarButton label="Done" primary onClick={exitPathEdit} title="Leave path editing (Esc)" />
    </ModeBar>
  );
  if (!m) return bar;
  const p = (pt: Pt) => applyMatrix(m, pt);
  const screen = transformPath(model, m);
  const selected = new Set(validRefs(model, edit.selected).map(refKey));
  // handles: those of selected anchors, plus the neighbours' handles that face them
  const handles: Array<{ key: string; a: Pt; h: Pt; ref: { sub: number; index: number }; side: "in" | "out" }> = [];
  model.forEach((sp, si) => {
    const n = sp.anchors.length;
    sp.anchors.forEach((a, i) => {
      const key = refKey({ sub: si, index: i });
      const prevSel = selected.has(refKey({ sub: si, index: i > 0 ? i - 1 : sp.closed ? n - 1 : -1 }));
      const nextSel = selected.has(refKey({ sub: si, index: i < n - 1 ? i + 1 : sp.closed ? 0 : -1 }));
      const self = selected.has(key);
      if (a.in && (self || prevSel)) handles.push({ key: `${key}:in`, a: p(a), h: p(a.in), ref: { sub: si, index: i }, side: "in" });
      if (a.out && (self || nextSel)) handles.push({ key: `${key}:out`, a: p(a), h: p(a.out), ref: { sub: si, index: i }, side: "out" });
    });
  });
  return (
    <>
      <svg style={svgLayer}>
        <path d={serializePath(screen, 2)} fill="none" stroke={ACCENT} strokeWidth={1.5} />
        {handles.map((h) => (
          <line key={h.key} x1={h.a.x} y1={h.a.y} x2={h.h.x} y2={h.h.y} stroke={ACCENT} strokeWidth={1} />
        ))}
      </svg>
      {handles.map((h) => (
        <HandleDot key={h.key} p={h.h} onPointerDown={(e) => pressHandle(e, h.ref, h.side)} />
      ))}
      {screen.map((sp, si) =>
        sp.anchors.map((a, i) => {
          const ref = { sub: si, index: i };
          return (
            <AnchorBox
              key={refKey(ref)}
              p={a}
              selected={selected.has(refKey(ref))}
              title={typeOf(edit, model, ref)}
              onPointerDown={(e) => pressAnchor(e, ref)}
            />
          );
        }),
      )}
      {marquee && (
        <div
          style={{
            position: "absolute",
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
            border: `1px solid ${ACCENT}`,
            background: "color-mix(in srgb, var(--of-accent) 8%, transparent)",
            pointerEvents: "none",
          }}
        />
      )}
      {readout && <Readout {...readout} />}
      {bar}
    </>
  );
}

// ------------------------------------------------------------------ root

export function VectorOverlay({ fileId, vp }: { fileId: string; vp: ViewportValue }) {
  const doc = useDoc(fileId);
  const pen = useStore(vectorUi, (s) => (s.pen && s.pen.fileId === fileId ? s.pen : null));
  const edit = useStore(vectorUi, (s) => (s.edit && s.edit.fileId === fileId ? s.edit : null));
  const shape = useStore(vectorUi, (s) => s.shape);
  const snap = useStore(vectorUi, (s) => s.snapHalf);
  const m = useLiveMatrix(doc, edit, vp);

  useEffect(() => {
    const canvas = getCanvasElement();
    if (!canvas) return;
    return installVectorController(canvas, fileId);
  }, [fileId]);

  if (!doc) return null;
  return (
    <>
      {pen && <PenLayer pen={pen} vp={vp} snap={snap} />}
      {shape && <ShapeLayer shape={shape} vp={vp} />}
      {edit && doc.nodes[edit.pathId] && <EditLayer doc={doc} edit={edit} m={m} snap={snap} />}
    </>
  );
}

/** True while this file is in path edit mode (the regular selection chrome hides). */
export function useEditingPath(fileId: string): boolean {
  return useStore(vectorUi, (s) => !!s.edit && s.edit.fileId === fileId);
}

