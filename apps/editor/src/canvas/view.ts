// Viewport commands (zoom in/out, fit, 100%, zoom to selection) used by shortcuts, the zoom menu and the canvas.
import { getActiveFile } from "../state/workspace";
import { unionRects, type Rect } from "./geometry";
import { canvasSize, getViewportLive, getWorldRect, setViewportLive } from "./registry";
import { fitRect, stepZoom, zoomAt } from "./viewport-math";

/** Space kept free at the bottom for the floating toolbar when fitting. */
const TOOLBAR_INSET = 56;

function centre(): { x: number; y: number } {
  const s = canvasSize();
  return { x: s.width / 2, y: s.height / 2 };
}

export function zoomStep(dir: 1 | -1) {
  const vp = getViewportLive();
  setViewportLive(zoomAt(vp, centre(), stepZoom(vp.zoom, dir)));
}

export function zoomTo(zoom: number) {
  setViewportLive(zoomAt(getViewportLive(), centre(), zoom));
}

export function fitWorldRect(rect: Rect, maxZoom = 1) {
  const size = canvasSize();
  if (size.width === 0) return;
  setViewportLive(fitRect(rect, size, { padding: 64, maxZoom, insetBottom: TOOLBAR_INSET }));
}

function pageRects(): Rect[] {
  const file = getActiveFile();
  if (!file) return [];
  const doc = file.store.doc;
  const root = doc.nodes[doc.pages[file.activePageId]?.rootId];
  if (!root) return [];
  return root.children.map((id) => (doc.nodes[id]?.visible ? getWorldRect(id) : null)).filter((r): r is Rect => !!r);
}

/** Zoom to fit everything on the page. Returns false when the page is empty. */
export function zoomToFit(): boolean {
  const all = unionRects(pageRects());
  if (!all) return false;
  fitWorldRect(all, 1);
  return true;
}

export function zoomToSelection(): boolean {
  const file = getActiveFile();
  if (!file || file.selection.length === 0) return zoomToFit();
  const rect = unionRects(file.selection.map((id) => getWorldRect(id)).filter((r): r is Rect => !!r));
  if (!rect) return false;
  fitWorldRect(rect, 8);
  return true;
}

export function panBy(dx: number, dy: number) {
  const vp = getViewportLive();
  setViewportLive({ ...vp, x: vp.x + dx, y: vp.y + dy });
}

/** Pan (keeping zoom) so `ids` are visible when they are outside the view. */
export function revealNodes(ids: string[]) {
  requestAnimationFrame(() => {
    const rect = unionRects(ids.map((id) => getWorldRect(id)).filter((r): r is Rect => !!r));
    if (!rect) return;
    const vp = getViewportLive();
    const size = canvasSize();
    const sx = rect.x * vp.zoom + vp.x;
    const sy = rect.y * vp.zoom + vp.y;
    const sw = rect.width * vp.zoom;
    const sh = rect.height * vp.zoom;
    const visible = sx >= 0 && sy >= 0 && sx + sw <= size.width && sy + sh <= size.height - TOOLBAR_INSET;
    if (visible) return;
    if (sw > size.width || sh > size.height - TOOLBAR_INSET) {
      fitWorldRect(rect, vp.zoom);
      return;
    }
    setViewportLive({
      zoom: vp.zoom,
      x: size.width / 2 - (rect.x + rect.width / 2) * vp.zoom,
      y: (size.height - TOOLBAR_INSET) / 2 - (rect.y + rect.height / 2) * vp.zoom,
    });
  });
}
