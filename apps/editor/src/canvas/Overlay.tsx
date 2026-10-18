// Screen-space overlay above the world: artboard labels, hover and selection outlines, resize handles,
// size badge, snapping guides, marquee, drop indicators and agent working outlines.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { FoldDocument, NodeId, OFNode } from "@opencrease/model";
import { useDoc, useWorkspace } from "../state/hooks";
import { renameNode } from "../state/actions";
import { setHover, type AgentWork } from "../state/workspace";
import { CORNER_HANDLES, EDGE_HANDLES, formatNumber, handleCursor, rectsEqual, unionRects, type Handle, type Rect } from "./geometry";
import { topRect } from "./virtual";
import { rectsIntersect } from "./geometry";
import { canvasSize, clientToLocal, getViewportLive, getWorldRect, subscribeViewport } from "./registry";
import { bandAt, GAP_ARM_DELAY_MS, gapGrabBand, gapHandlesApply, gapStrips } from "./gap";
import { beginGapDrag, beginResize, beginRotate, pressArtboardLabel } from "./interactions";
import { flexAxis, isAbsolutelyPositioned, isArtboardNode, isFlex, isLockedDeep, sizeIntent, topmostOnly } from "./selection-logic";
import { orientedBox } from "./measure-dom";
import { boxBounds, handlePoint, rotatedHandleCursor, type OrientedBox } from "./transform";
import { measureBetween, type Measure } from "./spacing";
import { GridLines } from "./GridLines";
import { useWorkspace as useWs } from "../state/hooks";
import { canvasUi } from "./ui-state";
import { useStore } from "./store";
import { rectToScreen, type ViewportValue } from "./viewport-math";
import { pixelGrid } from "./toolbar-layout";
import { clientDisplayName, clientMonogram, isClaudeClient } from "./agent-client";
import { ClaudeMark } from "./icons";
import { useEditingPath, VectorOverlay } from "../vector/VectorOverlay";
import { GradientHandles } from "./GradientHandles";
import { inComponent, ownTone, selectionInComponent, type ComponentTone } from "./component-tone";
import { Icon } from "../ui";

const EMPTY_WORK: Record<NodeId, AgentWork> = {};
const EMPTY: NodeId[] = [];

// ------------------------------------------------------------------ measurement

function measure(ids: NodeId[]): Record<NodeId, Rect> {
  const out: Record<NodeId, Rect> = {};
  for (const id of ids) {
    const r = getWorldRect(id);
    if (r) out[id] = r;
  }
  return out;
}

function sameRects(a: Record<NodeId, Rect>, b: Record<NodeId, Rect>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!rectsEqual(a[k], b[k])) return false;
  return true;
}

/** World rects of `ids`, re-measured every frame (cheap: only tracked nodes) and right after changes. */
function useWorldRects(ids: NodeId[], deps: unknown[]): Record<NodeId, Rect> {
  const [rects, setRects] = useState<Record<NodeId, Rect>>({});
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const rectsRef = useRef(rects);
  rectsRef.current = rects;

  useLayoutEffect(() => {
    const next = measure(idsRef.current);
    if (!sameRects(next, rectsRef.current)) setRects(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join("|"), ...deps]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = measure(idsRef.current);
      if (!sameRects(next, rectsRef.current)) {
        rectsRef.current = next;
        setRects(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return rects;
}

// ------------------------------------------------------------------ pieces

const box = (r: Rect, extra: CSSProperties = {}): CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: Math.max(0, r.width),
  height: Math.max(0, r.height),
  boxSizing: "border-box",
  pointerEvents: "none",
  ...extra,
});

const COMPONENT_ACCENT = { "--of-accent": "var(--of-component)", "--of-accent-ink": "var(--of-component)", "--of-selection-badge-ink": "var(--of-component-badge-ink)" } as CSSProperties;

function Outline({ r, width = 1, color = "var(--of-accent)" }: { r: Rect; width?: number; color?: string }) {
  return <div style={box(r, { border: `${width}px solid ${color}` })} />;
}

// Keep the first row below a frame free for the selection size badge.
function Badge({ x, y, children, tone = "accent" }: { x: number; y: number; children: ReactNode; tone?: "accent" | "ink" }) {
  return (
    <div
      data-of-size-badge
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translateX(-50%)",
        background: tone === "accent" ? "var(--of-accent)" : "var(--of-ink)",
        color: tone === "accent" ? "var(--of-selection-badge-ink)" : "var(--of-on-ink)",
        borderRadius: "var(--of-radius-sm)",
        padding: "3px 7px",
        fontFamily: "var(--of-font-mono)",
        fontSize: "var(--of-text-xs)",
        fontWeight: 500,
        lineHeight: "14px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
}

/** Screen-space box of a world box. */
function screenBox(vp: ViewportValue, b: OrientedBox): OrientedBox {
  return { cx: b.cx * vp.zoom + vp.x, cy: b.cy * vp.zoom + vp.y, width: b.width * vp.zoom, height: b.height * vp.zoom, angle: b.angle };
}

function RotOutline({ b, width = 1, color = "var(--of-accent)" }: { b: OrientedBox; width?: number; color?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: b.cx - b.width / 2,
        top: b.cy - b.height / 2,
        width: Math.max(0, b.width),
        height: Math.max(0, b.height),
        transform: b.angle ? `rotate(${b.angle}deg)` : undefined,
        boxSizing: "border-box",
        border: `${width}px solid ${color}`,
        pointerEvents: "none",
      }}
    />
  );
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7 15a6.5 6.5 0 1 1 10 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M7 15a6.5 6.5 0 1 1 10 0" fill="none" stroke="#141414" stroke-width="1.6" stroke-linecap="round"/><path d="M14.5 13.5l2.8 2 .6-3.4" fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round"/><path d="M14.5 13.5l2.8 2 .6-3.4" fill="none" stroke="#141414" stroke-width="1.5" stroke-linejoin="round"/></svg>',
)}") 12 12, crosshair`;

/** Invisible zones just outside the corners that start a rotation. */
function RotateZones({ b }: { b: OrientedBox }) {
  const outer: OrientedBox = { ...b, width: b.width + 22, height: b.height + 22 };
  return (
    <>
      {(["nw", "ne", "se", "sw"] as Handle[]).map((h) => {
        const p = handlePoint(outer, h);
        return (
          <div
            key={h}
            data-of-overlay-ui=""
            data-of-rotate-zone={h}
            onPointerDown={(e) => beginRotate(e.nativeEvent)}
            style={{ position: "absolute", left: p.x - 10, top: p.y - 10, width: 20, height: 20, borderRadius: 10, cursor: ROTATE_CURSOR, pointerEvents: "auto" }}
          />
        );
      })}
    </>
  );
}

function Handles({ b }: { b: OrientedBox }) {
  const small = b.width < 24 || b.height < 24;
  return (
    <>
      {EDGE_HANDLES.map((h) => {
        const vertical = h === "e" || h === "w";
        const p = handlePoint(b, h);
        const inset = small ? 0 : 6;
        const length = Math.max(0, (vertical ? b.height : b.width) - inset * 2);
        const w = vertical ? 8 : length;
        const hh = vertical ? length : 8;
        return (
          <div
            key={h}
            data-of-overlay-ui=""
            onPointerDown={(e) => beginResize(e.nativeEvent, h)}
            style={{
              position: "absolute",
              left: p.x - w / 2,
              top: p.y - hh / 2,
              width: w,
              height: hh,
              transform: b.angle ? `rotate(${b.angle}deg)` : undefined,
              cursor: rotatedHandleCursor(h, b.angle),
              pointerEvents: "auto",
            }}
          />
        );
      })}
      {CORNER_HANDLES.map((h) => {
        const p = handlePoint(b, h);
        return (
          <div
            key={h}
            data-of-overlay-ui=""
            onPointerDown={(e) => beginResize(e.nativeEvent, h)}
            style={{
              position: "absolute",
              left: p.x - 7,
              top: p.y - 7,
              width: 14,
              height: 14,
              cursor: rotatedHandleCursor(h, b.angle),
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: b.angle ? `rotate(${b.angle}deg)` : undefined,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                background: "#FFFFFF",
                border: "1.5px solid var(--of-accent)",
                boxSizing: "border-box",
              }}
            />
          </div>
        );
      })}
    </>
  );
}

/** Distance lines with a value label (equal spacing while moving, Alt-hover measurements). */
function Measures({ list, toScreen }: { list: Measure[]; toScreen: (x: number, y: number) => { x: number; y: number } }) {
  return (
    <>
      {list.map((m, i) => {
        const a = toScreen(m.x1, m.y1);
        const b = toScreen(m.x2, m.y2);
        const horizontal = Math.abs(a.y - b.y) < 0.5;
        const len = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
        if (len < 1) return null;
        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        return (
          <div key={i} data-of-measure="">
            <div
              style={{
                position: "absolute",
                left: horizontal ? left : Math.round(a.x) - 0.5,
                top: horizontal ? Math.round(a.y) - 0.5 : top,
                width: horizontal ? len : 1,
                height: horizontal ? 1 : len,
                background: "var(--of-measure)",
                pointerEvents: "none",
              }}
            />
            {[0, 1].map((k) => (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: horizontal ? (k ? left + len : left) - 0.5 : Math.round(a.x) - 3.5,
                  top: horizontal ? Math.round(a.y) - 3.5 : (k ? top + len : top) - 0.5,
                  width: horizontal ? 1 : 7,
                  height: horizontal ? 7 : 1,
                  background: "var(--of-measure)",
                  pointerEvents: "none",
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: horizontal ? left + len / 2 : a.x + 6,
                top: horizontal ? a.y + 5 : top + len / 2 - 9,
                transform: horizontal ? "translateX(-50%)" : undefined,
                padding: "2px 5px",
                borderRadius: "var(--of-radius-sm)",
                background: "var(--of-measure)",
                color: "#FFFFFF",
                font: "500 10px/14px var(--of-font-mono)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {formatNumber(m.value)}
            </div>
          </div>
        );
      })}
    </>
  );
}

function sizeLabel(doc: FoldDocument, id: NodeId, r: Rect): string {
  const node = doc.nodes[id];
  const wi = node ? sizeIntent(doc, node, "width") : null;
  const hi = node ? sizeIntent(doc, node, "height") : null;
  return `${formatNumber(r.width)}${wi ? ` ${wi}` : ""} × ${formatNumber(r.height)}${hi ? ` ${hi}` : ""}`;
}

function ArtboardLabel({
  id, name, r, worldSize, selected, hovered, tone,
}: { id: NodeId; name: string; r: Rect; worldSize: Rect; selected: boolean; hovered: boolean; tone?: ComponentTone }) {
  const renaming = useStore(canvasUi, (s) => s.renaming === id);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      setDraft(name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [renaming, name]);
  if (r.width < 24) return null;
  const showSize = r.width >= 140;
  const commit = () => {
    const v = draft.trim();
    canvasUi.set({ renaming: null });
    if (v && v !== name) renameNode(id, v);
  };
  return (
    <div
      data-of-overlay-ui=""
      style={{
        position: "absolute",
        left: r.x,
        top: r.y - 20,
        width: r.width,
        height: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") canvasUi.set({ renaming: null });
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            pointerEvents: "auto",
            flex: 1,
            minWidth: 0,
            height: 18,
            margin: "-2px 0 -2px -4px",
            padding: "0 3px",
            border: "1px solid var(--of-accent)",
            borderRadius: "var(--of-radius-sm)",
            outline: "none",
            background: "var(--of-panel)",
            font: "500 11px/14px var(--of-font-sans)",
            color: "var(--of-ink)",
          }}
        />
      ) : (
        <div
          title={name}
          data-of-artboard-label={id}
          onPointerDown={(e) => pressArtboardLabel(e.nativeEvent, id)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            canvasUi.set({ renaming: id });
          }}
          onPointerEnter={() => setHover(id)}
          onPointerLeave={() => setHover(null)}
          style={{
            pointerEvents: "auto",
            minWidth: 0,
            flex: "0 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--of-font-sans)",
            fontSize: "var(--of-text-xs)",
            fontWeight: 500,
            lineHeight: "14px",
            color: tone ? "var(--of-component)" : selected ? "var(--of-accent-ink)" : hovered ? "var(--of-ink)" : "var(--of-ink-2)",
            cursor: "default",
            userSelect: "none",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {tone ? <Icon name={tone === "set" ? "componentSet" : tone === "main" ? "mainComponent" : "component"} size={11} style={{ flexShrink: 0 }} /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
        </div>
      )}
      <div style={{ flex: 1 }} />
      {showSize && !renaming && (
        <div
          style={{
            flexShrink: 0,
            fontFamily: "var(--of-font-mono)",
            fontSize: "var(--of-text-xs)",
            lineHeight: "14px",
            color: "var(--of-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {formatNumber(worldSize.width)} × {formatNumber(worldSize.height)}
        </div>
      )}
    </div>
  );
}

function AgentBadge({ r, work }: { r: Rect; work: AgentWork }) {
  const claude = isClaudeClient(work.client);
  return (
    <>
      <div
        className="of-agent-outline"
        style={box(
          { x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 },
          { border: "2px solid var(--of-agent)", borderRadius: 2 },
        )}
      />
      <div
        data-of-agent-badge
        style={{
          position: "absolute",
          left: r.x,
          top: r.y + r.height + 36,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px 6px 8px",
          background: "var(--of-agent-badge)",
          borderRadius: "var(--of-radius-md)",
          boxShadow: "0 4px 14px rgb(47 100 214 / 0.28)",
          pointerEvents: "none",
          maxWidth: Math.max(160, r.width),
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            borderRadius: 4,
            background: claude ? "var(--of-claude)" : "rgb(255 255 255 / 0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
            fontFamily: "var(--of-font-sans)",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {claude ? <ClaudeMark size={12} /> : clientMonogram(work.client)}
        </div>
        <span className="of-agent-live" aria-hidden />
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <div
            style={{
              color: "#FFFFFF",
              fontFamily: "var(--of-font-sans)",
              fontSize: "var(--of-text-xs)",
              fontWeight: 600,
              lineHeight: "14px",
              whiteSpace: "nowrap",
            }}
          >
            {clientDisplayName(work.client)} is working
          </div>
          {work.label && (
            <div
              style={{
                color: "rgb(255 255 255 / 0.82)",
                fontFamily: "var(--of-font-mono)",
                fontSize: 10,
                lineHeight: "12px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {work.label}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const HATCH = "repeating-linear-gradient(135deg, color-mix(in srgb, var(--of-accent) 22%, transparent) 0 1px, transparent 1px 5px)";

/** Flow children of a flex frame that sit in the layout (for gap handles). */
function flowChildren(doc: FoldDocument, frame: OFNode): NodeId[] {
  return frame.children.filter((id) => {
    const n = doc.nodes[id];
    return n && n.visible && n.styles.position !== "absolute" && n.styles.position !== "fixed";
  });
}

function GapHandles({ doc, frame, rects, toScreen }: { doc: FoldDocument; frame: OFNode; rects: Record<NodeId, Rect>; toScreen: (r: Rect) => Rect }) {
  // A gap band only turns into a handle after the pointer rests on it, so drags through a selected
  // frame keep moving the frame (C1 in the UI review).
  const [armed, setArmed] = useState<number | null>(null);
  const dragging = useStore(canvasUi, (s) => s.gapDrag?.frameId === frame.id);
  const axis = flexAxis(frame);
  const kids = flowChildren(doc, frame).map((id) => rects[id]).filter((r): r is Rect => !!r);
  const strips = gapStrips(kids, axis);
  const screens = strips.map(toScreen);
  const bands = screens.map((r) => gapGrabBand(r, axis));
  const bandsRef = useRef(bands);
  bandsRef.current = bands;

  useEffect(() => {
    let pending: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: PointerEvent) => {
      if (canvasUi.get().gesture !== "idle" || e.buttons !== 0) return;
      const local = clientToLocal({ x: e.clientX, y: e.clientY });
      const size = canvasSize();
      const inside = local.x >= 0 && local.y >= 0 && local.x <= size.width && local.y <= size.height;
      const hit = inside ? bandAt(bandsRef.current, local) : null;
      if (hit === pending) return;
      pending = hit;
      clearTimeout(timer);
      if (hit === null) setArmed(null);
      else timer = setTimeout(() => setArmed(hit), GAP_ARM_DELAY_MS);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {screens.map((r, i) => {
        const band = bands[i];
        const main = axis === "row" ? r.width : r.height;
        if ((axis === "row" ? r.height : r.width) < 12) return null;
        const active = armed === i || dragging;
        if (!active) return null;
        return (
          <div key={i}>
            {main >= 1 && <div style={box(r, { backgroundImage: HATCH })} />}
            <div
              data-of-overlay-ui=""
              onPointerLeave={() => !dragging && setArmed(null)}
              onPointerDown={(e) => beginGapDrag(e.nativeEvent, frame.id, axis, axis === "row" ? strips[i].width : strips[i].height)}
              style={{
                position: "absolute",
                left: band.x,
                top: band.y,
                width: band.width,
                height: band.height,
                pointerEvents: "auto",
                cursor: axis === "row" ? "ew-resize" : "ns-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: axis === "row" ? 2 : 16,
                  height: axis === "row" ? 16 : 2,
                  borderRadius: 2,
                  background: "var(--of-accent)",
                  flexShrink: 0,
                }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ overlay

export function Overlay({ fileId }: { fileId: string }) {
  const vp = useSyncExternalStore(subscribeViewport, getViewportLive) as ViewportValue;
  const doc = useDoc(fileId);
  const pageId = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId)?.activePageId);
  const selection = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId)?.selection ?? EMPTY);
  const hoverId = useWorkspace((s) => s.hoverId);
  const editingId = useWorkspace((s) => s.editingTextId);
  const agentWork = useWorkspace((s) => s.agentWork[fileId] ?? EMPTY_WORK);
  const ui = useStore(canvasUi, (s) => s);
  const editingPath = useEditingPath(fileId);
  const tool = useWs((s) => s.tool);

  const root = doc && pageId ? doc.nodes[doc.pages[pageId]?.rootId] : undefined;
  const size = canvasSize();
  const viewport = { x: (-vp.x - 120) / vp.zoom, y: (-vp.y - 120) / vp.zoom, width: (size.width + 240) / vp.zoom, height: (size.height + 240) / vp.zoom };
  const topIds = (root?.children ?? EMPTY).filter((id) => {
    const r = doc ? topRect(doc, id) : null;
    return !r || rectsIntersect(r, viewport);
  });
  const singleSel = selection.length === 1 && doc ? doc.nodes[selection[0]] : undefined;
  const gapFrame =
    singleSel && singleSel.type === "Frame" && isFlex(singleSel) && gapHandlesApply(singleSel.styles) && !isLockedDeep(doc!, singleSel.id)
      ? singleSel
      : undefined;
  const gapKids = gapFrame && doc ? flowChildren(doc, gapFrame) : EMPTY;
  const selParent = singleSel?.parentId && doc?.nodes[singleSel.parentId]?.type !== "Root" ? singleSel.parentId : null;
  const tracked = [
    ...new Set([
      ...topIds,
      ...selection,
      ...Object.keys(agentWork),
      ...gapKids,
      ...(hoverId ? [hoverId] : []),
      ...(ui.dropTarget ? [ui.dropTarget] : []),
      ...(selParent ? [selParent] : []),
      ...ui.highlight,
    ]),
  ];
  const rects = useWorldRects(tracked, [doc, pageId]);
  if (!doc || !root) return null;

  const s = (r: Rect) => rectToScreen(vp, r);
  const grid = ui.pixelGrid ? pixelGrid(vp) : null;
  const busy = ui.gesture === "move" || ui.gesture === "pan" || ui.gesture === "draw";
  const selRects = selection.map((id) => rects[id]).filter((r): r is Rect => !!r);
  const union = unionRects(selRects);
  const single = selection.length === 1 ? doc.nodes[selection[0]] : undefined;
  // rotated layers get a rotated outline and handles
  const singleBox = single && rects[single.id] ? orientedBox(doc, single.id) : null;
  const sb = (b: OrientedBox) => screenBox(vp, b);
  const unionBox: OrientedBox | null = union ? { cx: union.x + union.width / 2, cy: union.y + union.height / 2, width: union.width, height: union.height, angle: 0 } : null;
  const handleBox = single ? singleBox : unionBox;
  const tops = topmostOnly(doc, selection).filter((id) => doc.nodes[id]);
  const transformable =
    tops.length > 0 && tops.every((id) => doc.nodes[id].type !== "SVGElement" && !isLockedDeep(doc, id)) && !(single && editingId === single.id);
  const resizable =
    transformable && !editingPath &&
    ui.gesture !== "move" &&
    ui.gesture !== "rotate" &&
    (!!single || tool === "scale" || tops.every((id) => isAbsolutelyPositioned(doc, doc.nodes[id])));
  const hoverBox = hoverId && rects[hoverId] ? orientedBox(doc, hoverId) : null;
  const showHover = hoverId && !selection.includes(hoverId) && rects[hoverId] && !busy && ui.gesture !== "resize" && ui.gesture !== "marquee" && ui.gesture !== "rotate";
  const toScreenPt = (x: number, y: number) => ({ x: x * vp.zoom + vp.x, y: y * vp.zoom + vp.y });
  let altMeasures: Measure[] = [];
  if (ui.altHeld && union && ui.gesture === "idle") {
    const other = hoverId && !selection.includes(hoverId) ? rects[hoverId] : selParent ? rects[selParent] : undefined;
    if (other) altMeasures = measureBetween(union, other);
  }
  const gridFrame = single && single.type === "Frame" && single.styles.display === "grid" && !busy ? single : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {grid && (
        <div
          aria-hidden
          data-of-pixel-grid=""
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(to right, rgb(128 128 128 / 0.22) 1px, transparent 1px), linear-gradient(to bottom, rgb(128 128 128 / 0.22) 1px, transparent 1px)",
            backgroundSize: `${grid.size}px ${grid.size}px`,
            backgroundPosition: `${grid.offsetX}px ${grid.offsetY}px`,
          }}
        />
      )}
      {/* artboard labels */}
      {topIds.map((id) => {
        const n = doc.nodes[id];
        const r = rects[id];
        if (!n || !r || !n.visible || !isArtboardNode(doc, n)) return null;
        return (
          <ArtboardLabel
            key={id}
            id={id}
            name={n.name}
            r={s(r)}
            worldSize={r}
            selected={selection.includes(id)}
            hovered={hoverId === id}
            tone={ownTone(n)}
          />
        );
      })}

      {/* agent working outlines */}
      {Object.entries(agentWork).map(([id, work]) => {
        const r = rects[id];
        return r ? <AgentBadge key={id} r={s(r)} work={work} /> : null;
      })}

      <div style={{ display: "contents", ...(showHover && inComponent(doc, hoverId!) ? COMPONENT_ACCENT : null) }}>
        {showHover && (hoverBox && hoverBox.angle ? <RotOutline b={sb(hoverBox)} /> : <Outline r={s(rects[hoverId!])} width={1} />)}
      </div>
      {gridFrame && rects[gridFrame.id] && <GridLines id={gridFrame.id} vp={vp} />}

      {/* token usages pointed at from the Theme tab */}
      {ui.highlight.map((id) => (rects[id] ? <div key={`hl-${id}`} data-of-highlight="" style={box(s(rects[id]), { outline: "1.5px dashed var(--of-accent)", outlineOffset: 1, background: "color-mix(in srgb, var(--of-accent) 8%, transparent)" })} /> : null))}

      {ui.dropTarget && rects[ui.dropTarget] && <Outline r={s(rects[ui.dropTarget])} width={1.5} />}

      {/* selection: purple for components, instances and their layers */}
      <div style={{ display: "contents", ...(selectionInComponent(doc, selection) ? COMPONENT_ACCENT : null) }}>
      {selection.length > 1 &&
        selection.map((id) => {
          const b = rects[id] ? orientedBox(doc, id) : null;
          return b ? <RotOutline key={id} b={sb(b)} /> : null;
        })}
      {union && !editingPath &&
        (single && singleBox && singleBox.angle ? (
          <RotOutline b={sb(singleBox)} width={1.5} />
        ) : (
          <Outline r={s(union)} width={editingId && single?.id === editingId ? 1 : 1.5} />
        ))}
      {gapFrame && !busy && editingId === null && (ui.gesture === "idle" || ui.gapDrag) && (
        <GapHandles doc={doc} frame={gapFrame} rects={rects} toScreen={s} />
      )}
      {handleBox && resizable && !busy && !ui.gapDrag && ui.gesture !== "resize" && <RotateZones b={sb(handleBox)} />}
      {handleBox && resizable && !busy && !ui.gapDrag && <Handles b={sb(handleBox)} />}
      {union && !busy && !editingPath && editingId !== single?.id && (() => {
        const bounds = single && singleBox && singleBox.angle ? boxBounds(sb(singleBox)) : s(union);
        const badgeX = bounds.x + bounds.width / 2;
        const below = { x: badgeX - 80, y: bounds.y + bounds.height + 6, width: 160, height: 22 };
        const labels = topIds.flatMap((id) => {
          const node = doc.nodes[id], rect = rects[id];
          if (!node?.visible || !rect || !isArtboardNode(doc, node)) return [];
          const screen = s(rect);
          return [{ x: screen.x, y: screen.y - 20, width: screen.width, height: 16 }];
        });
        // A nearby frame can have its name in the row below this selection.
        const badgeY = labels.some((label) => rectsIntersect(below, label)) || below.y + below.height > size.height - 52
          ? Math.max(4, bounds.y - 48)
          : below.y;
        return (
          <Badge x={badgeX} y={badgeY}>
            {ui.rotating !== null
              ? `${formatNumber(ui.rotating)}°`
              : ui.scaling !== null
                ? `Scale ${formatNumber(ui.scaling * 100)}%`
                : ui.gapDrag
                  ? `Gap ${formatNumber(ui.gapDrag.value)}`
                  : single
                    ? sizeLabel(doc, single.id, singleBox && singleBox.angle ? { ...union, width: singleBox.width, height: singleBox.height } : union)
                    : `${formatNumber(union.width)} × ${formatNumber(union.height)}`}
          </Badge>
        );
      })()}
      {single && !busy && !editingPath && !singleBox?.angle && ui.gesture !== "resize" && <GradientHandles doc={doc} nodeId={single.id} rect={rects[single.id] ? s(rects[single.id]) : undefined} />}

      </div>

      {/* drawing draft */}
      {ui.draft && (
        <>
          <Outline r={s(ui.draft)} width={1.5} />
          <Badge x={s(ui.draft).x + s(ui.draft).width / 2} y={s(ui.draft).y + s(ui.draft).height + 6}>
            {formatNumber(ui.draft.width)} × {formatNumber(ui.draft.height)}
          </Badge>
        </>
      )}

      {/* marquee */}
      {ui.marquee && (
        <div
          style={box(s(ui.marquee), {
            border: "1px solid var(--of-accent)",
            background: "color-mix(in srgb, var(--of-accent) 8%, transparent)",
          })}
        />
      )}

      {/* reorder insertion line */}
      {ui.insertLine &&
        (() => {
          const a = s({ x: ui.insertLine.x1, y: ui.insertLine.y1, width: 0, height: 0 });
          const b = s({ x: ui.insertLine.x2, y: ui.insertLine.y2, width: 0, height: 0 });
          const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
          return (
            <div
              style={{
                position: "absolute",
                left: vertical ? a.x - 1 : Math.min(a.x, b.x),
                top: vertical ? Math.min(a.y, b.y) : a.y - 1,
                width: vertical ? 2 : Math.max(2, Math.abs(b.x - a.x)),
                height: vertical ? Math.max(2, Math.abs(b.y - a.y)) : 2,
                background: "var(--of-accent)",
                borderRadius: 1,
              }}
            />
          );
        })()}

      {/* spacing and distance measurements */}
      <Measures list={ui.gesture === "move" ? ui.measures : altMeasures} toScreen={toScreenPt} />

      {/* snapping guides */}
      {ui.guides.map((g, i) => {
        if (g.orientation === "vertical") {
          const a = s({ x: g.at, y: g.from, width: 0, height: g.to - g.from });
          return <div key={i} style={{ position: "absolute", left: Math.round(a.x) - 0.5, top: a.y, width: 1, height: a.height, background: "var(--of-accent)" }} />;
        }
        const a = s({ x: g.from, y: g.at, width: g.to - g.from, height: 0 });
        return <div key={i} style={{ position: "absolute", left: a.x, top: Math.round(a.y) - 0.5, width: a.width, height: 1, background: "var(--of-accent)" }} />;
      })}

      <VectorOverlay fileId={fileId} vp={vp} />
    </div>
  );
}
