// The canvas: renders the active page as real DOM inside a transformed world layer, with the
// screen-space overlay, floating toolbar and zoom pill on top.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { safeCssValue } from "@opencrease/css";
import { modeScopeCss, tokenCssVars, type NodeId } from "@opencrease/model";
import { useWorkspace } from "../state/hooks";
import { getOpenFile, setViewport } from "../state/workspace";
import { FileContext, useNodeObject } from "./render/NodeView";
import { offscreenTopLayer, TopLayer } from "./render/TopLayer";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { attachLod } from "./lod";
import { clearVirtualPage, setVirtualPage, topRect } from "./virtual";
import { unionRects, type Rect } from "./geometry";
import { fitRect } from "./viewport-math";
import { Overlay } from "./Overlay";
import { GenStatusLayer } from "./GenStatusLayer";
import { Toolbar } from "./Toolbar";
import { ZoomPill } from "./ZoomPill";
import { invalidateMeasurements, registerCanvas, setRegisteredPage, unregisterCanvas } from "./registry";
import { attachInteractions } from "./interactions";
import { ensureDocumentFonts } from "./fonts";
import { canvasUi } from "./ui-state";
import { useStore } from "./store";
import { zoomToFit } from "./view";
import { toolbarLayout } from "./toolbar-layout";
import type { ViewportValue } from "./viewport-math";
import "./canvas.css";

const DEFAULT_VIEWPORT: ViewportValue = { x: 80, y: 80, zoom: 1 };
/** Large enough that auto-width page-level text never wraps against the world's edge. */
const WORLD_SIZE = 100_000;

const PageLayers = memo(function PageLayers({ rootId }: { rootId: NodeId }) {
  const root = useNodeObject(rootId);
  if (!root) return null;
  return (
    <>
      {root.children.map((id) => (
        <TopLayer key={id} id={id} />
      ))}
    </>
  );
});

/** Fit the page from the layers' own left/top/width/height before anything is measured (fast first paint). */
function styleFit(fileId: string, size: { width: number; height: number }): ViewportValue | null {
  const f = getOpenFile(fileId);
  if (!f || size.width === 0) return null;
  const doc = f.store.doc;
  const root = doc.nodes[doc.pages[f.activePageId]?.rootId];
  if (!root || root.children.length === 0) return null;
  const rects: Rect[] = [];
  for (const id of root.children) {
    const r = doc.nodes[id]?.visible ? topRect(doc, id) : null;
    if (!r) return null;
    rects.push(r);
  }
  const all = unionRects(rects);
  return all ? fitRect(all, size, { padding: 64, maxZoom: 1, insetBottom: 56 }) : null;
}

export function Canvas({ fileId }: { fileId: string }) {
  const file = getOpenFile(fileId);
  const store = file?.store;
  const pageId = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId)?.activePageId);
  const tool = useWorkspace((s) => s.tool);
  const uiHidden = useWorkspace((s) => s.uiHidden);
  const gesture = useStore(canvasUi, (s) => s.gesture);
  const spaceHeld = useStore(canvasUi, (s) => s.spaceHeld);
  const altHeld = useStore(canvasUi, (s) => s.altHeld);
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(1000);
  // layers render once the canvas knows its size and viewport, so virtualisation can skip far layers
  const [ready, setReady] = useState(false);

  // the toolbar adapts to the canvas width
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    setCanvasWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setCanvasWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = useSyncExternalStore(
    (l) => (store ? store.subscribe(l) : () => {}),
    () => store?.doc,
  );
  const tokens = doc?.tokens;
  const tokenVars = useMemo(() => (tokens ? Object.fromEntries(Object.entries(tokenCssVars({ tokens })).filter(([, v]) => safeCssValue(v))) : {}), [tokens]);

  const collections = doc?.modeCollections;
  // frames that pin a mode (data-mode) get that mode's values as scoped custom properties
  const modeCss = useMemo(() => (tokens && collections ? modeScopeCss({ tokens: tokens.filter((t) => /^--[\w-]+$/.test(t.name)).map((t) => ({ ...t, value: safeCssValue(t.value) ? t.value : "initial", modes: Object.fromEntries(Object.entries(t.modes ?? {}).filter(([, value]) => safeCssValue(value))) })), modeCollections: collections }, ".of-canvas-content") : ""), [tokens, collections]);
  const rootId = doc && pageId ? doc.pages[pageId]?.rootId : undefined;
  if (doc && rootId) setVirtualPage(doc, doc.nodes[rootId]?.children ?? []);
  const rootBg = rootId ? doc?.nodes[rootId]?.styles.backgroundColor : undefined;

  // mount: register with the registry, attach pointer handling
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    const f = getOpenFile(fileId);
    if (!canvas || !world || !f) return;
    const saved = f.viewports[f.activePageId];
    const quickFit = saved ? null : styleFit(fileId, { width: canvas.clientWidth, height: canvas.clientHeight });
    registerCanvas(
      { canvas, world, fileId, pageId: f.activePageId, persist: (vp, pid) => setViewport(fileId, vp, pid) },
      saved ?? quickFit ?? DEFAULT_VIEWPORT,
    );
    const detach = attachInteractions(canvas, fileId);
    const unsubMeasure = f.store.subscribe(() => invalidateMeasurements());
    const resize = new ResizeObserver(() => invalidateMeasurements());
    resize.observe(canvas);
    const fontsChanged = () => invalidateMeasurements();
    document.fonts.addEventListener("loadingdone", fontsChanged);
    const detachLod = attachLod(f.store, offscreenTopLayer(fileId, f.store));
    setReady(true);
    let raf = 0;
    if (!saved) raf = requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
    return () => {
      cancelAnimationFrame(raf);
      detach();
      unsubMeasure();
      resize.disconnect();
      document.fonts.removeEventListener("loadingdone", fontsChanged);
      detachLod();
      clearVirtualPage(fileId);
      unregisterCanvas(canvas);
    };
  }, [fileId]);

  // page switch: restore that page's viewport or fit it
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    const f = getOpenFile(fileId);
    if (!f || !pageId) return;
    const saved = f.viewports[pageId];
    const el = canvasRef.current;
    setRegisteredPage(pageId, saved ?? (el ? styleFit(fileId, { width: el.clientWidth, height: el.clientHeight }) : null) ?? DEFAULT_VIEWPORT);
    if (!saved) requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
  }, [fileId, pageId]);

  // fonts used by the document
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => ensureDocumentFonts(doc), 50);
    return () => clearTimeout(t);
  }, [doc]);

  if (!file || !store) return <div className="of-canvas" style={{ background: "var(--of-canvas)" }} />;

  const panning = gesture === "pan";
  const cursor =
    tool === "hand" || spaceHeld
      ? panning
        ? "grabbing"
        : "grab"
      : tool === "frame" || tool === "rect" || tool === "shader" || tool === "pen" || tool === "line" || tool === "ellipse" || tool === "polygon" || tool === "star"
        ? "crosshair"
        : tool === "zoom"
          ? altHeld ? "zoom-out" : "zoom-in"
          : tool === "text"
            ? "text"
            : "default";

  return (
    <FileContext.Provider value={{ fileId, store }}>
      <div
        ref={canvasRef}
        className="of-canvas"
        data-of-canvas=""
        style={{ background: typeof rootBg === "string" && safeCssValue(rootBg) ? rootBg : "var(--of-canvas)", cursor }}
      >
        <div className="of-canvas-content" data-of-content="" style={tokenVars as CSSProperties}>
          {modeCss ? <style data-of-modes="">{modeCss}</style> : null}
          <div
            ref={worldRef}
            data-of-world=""
            style={{ position: "absolute", left: 0, top: 0, width: WORLD_SIZE, height: WORLD_SIZE, transformOrigin: "0 0" }}
          >
            {rootId && ready && <PageLayers key={rootId} rootId={rootId} />}
          </div>
        </div>
        <Overlay fileId={fileId} />
        <CanvasContextMenu />
        <GenStatusLayer fileId={fileId} />
        {!uiHidden && <Toolbar canvasWidth={canvasWidth} />}
        {!uiHidden && toolbarLayout(canvasWidth).zoomPill && <ZoomPill />}
      </div>
    </FileContext.Provider>
  );
}
