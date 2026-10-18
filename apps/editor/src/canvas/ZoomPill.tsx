// Zoom level pill (bottom right) with a small zoom menu. The menu items are shared with the toolbar's
// overflow menu when the canvas is too narrow for a separate pill.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { getViewportLive, subscribeViewport } from "./registry";
import { PIXEL_GRID_MIN_ZOOM } from "./toolbar-layout";
import { canvasUi, togglePixelGrid } from "./ui-state";
import { useStore } from "./store";
import { zoomStep, zoomTo, zoomToFit, zoomToSelection } from "./view";

export const ZOOM_ITEMS: Array<{ label: string; hint: string; run: () => void }> = [
  { label: "Zoom in", hint: "⌘ +", run: () => zoomStep(1) },
  { label: "Zoom out", hint: "⌘ −", run: () => zoomStep(-1) },
  { label: "Zoom to 100%", hint: "⌘ 0", run: () => zoomTo(1) },
  { label: "Zoom to fit", hint: "⇧ 1", run: () => void zoomToFit() },
  { label: "Zoom to selection", hint: "⇧ 2", run: () => void zoomToSelection() },
];

export function formatZoom(zoom: number): string {
  return `${zoom >= 0.1 ? Math.round(zoom * 100) : Math.round(zoom * 1000) / 10}%`;
}

export function useZoom(): number {
  return useSyncExternalStore(subscribeViewport, () => getViewportLive().zoom);
}

function Check({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: "block", visibility: on ? "visible" : "hidden" }}>
      <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="var(--of-ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Zoom commands plus the pixel grid toggle, as menu buttons. */
export function ZoomMenuItems({ onDone }: { onDone: () => void }) {
  const grid = useStore(canvasUi, (s) => s.pixelGrid);
  return (
    <>
      {ZOOM_ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.run();
            onDone();
          }}
        >
          <span>{item.label}</span>
          <span className="of-menu-hint">{item.hint}</span>
        </button>
      ))}
      <div className="of-menu-sep" role="separator" />
      <button type="button" role="menuitemcheckbox" aria-checked={grid} onClick={() => togglePixelGrid()}>
        <span>Pixel grid</span>
        <span className="of-menu-hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {`${PIXEL_GRID_MIN_ZOOM * 100}%+`}
          <Check on={grid} />
        </span>
      </button>
    </>
  );
}

/** Close a popover on outside pointer down or Escape. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref, close]);
}

export function CanvasMenu({ children, align = "right" }: { children: ReactNode; align?: "right" | "centre" }) {
  return (
    <div className="of-canvas-menu" role="menu" data-align={align}>
      {children}
    </div>
  );
}

export function ZoomPill() {
  const zoom = useZoom();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} data-of-chrome="" onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", right: 16, bottom: 20, zIndex: 5 }}>
      {open && (
        <CanvasMenu>
          <ZoomMenuItems onDone={() => setOpen(false)} />
        </CanvasMenu>
      )}
      <button type="button" className="of-zoom-pill" aria-label="Zoom" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {formatZoom(zoom)}
      </button>
    </div>
  );
}
