// A top-level layer on the page: rendered live, as a same-size placeholder when it is far outside the
// viewport, or as a raster thumbnail below 10% zoom (see virtual.ts and lod.ts).
import { safeCssValue } from "@opencrease/css";
import { memo, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { tokenCssVars, type DocStore, type NodeId, type OFNode } from "@opencrease/model";
import { lastKnownRect } from "../registry";
import { pxValue } from "../selection-logic";
import { useThumbnail } from "../lod";
import { useLayerMode } from "../virtual";
import { baseStyle, FileContext, NodeView, useNodeObject, useNodeRef } from "./NodeView";
import { ResponsivePreview, useResponsivePreview } from "./ResponsivePreview";

/** Paint-only styles a placeholder keeps so it reads like the artboard (layout styles are dropped). */
const LAYOUT_KEYS = ["display", "flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "alignItems", "justifyContent", "alignContent", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock", "gridTemplateColumns", "gridTemplateRows"];

function placeholderStyle(node: OFNode): CSSProperties {
  const style = baseStyle(node, true);
  for (const k of LAYOUT_KEYS) delete style[k];
  const known = lastKnownRect(node.id);
  if (pxValue(node.styles.width) === undefined && known) style.width = known.width;
  if (pxValue(node.styles.height) === undefined && known) style.height = known.height;
  style.boxSizing = "border-box";
  style.minWidth = 0;
  style.minHeight = 0;
  return style as CSSProperties;
}

function Placeholder({ node, thumb }: { node: OFNode; thumb: boolean }) {
  const ref = useNodeRef(node.id);
  const url = useThumbnail(node.id, thumb);
  return (
    <div ref={ref} data-of-id={node.id} data-of-virtual={thumb ? "thumb" : "placeholder"} style={placeholderStyle(node)}>
      {thumb && url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none", borderRadius: "inherit" }}
        />
      ) : null}
    </div>
  );
}

export const TopLayer = memo(function TopLayer({ id }: { id: NodeId }) {
  const mode = useLayerMode(id);
  const node = useNodeObject(id);
  const responsive = useResponsivePreview(id);
  if (!node) return null;
  if (mode === "live" || node.type === "Text") {
    return (
      <>
        <NodeView id={id} top />
        {responsive && node.visible ? <ResponsivePreview node={node} widths={responsive} /> : null}
      </>
    );
  }
  return <Placeholder node={node} thumb={mode === "thumb"} />;
});

/**
 * Render a top-level layer into a hidden host outside the canvas (for thumbnails). Its elements do not
 * register with the canvas registry, so canvas lookups keep finding the canvas element.
 */
export function offscreenTopLayer(fileId: string, store: DocStore) {
  return (id: NodeId): Promise<{ el: HTMLElement; dispose(): void } | null> =>
    new Promise((resolve) => {
      const host = document.createElement("div");
      host.className = "of-canvas-content";
      host.setAttribute("data-of-capture-host", "");
      Object.assign(host.style, { position: "fixed", left: "-200000px", top: "0px", width: "100000px", height: "100000px", inset: "auto", pointerEvents: "none", contain: "strict" });
      for (const [k, v] of Object.entries(tokenCssVars(store.doc))) if (safeCssValue(v)) host.style.setProperty(k, v);
      document.body.appendChild(host);
      const root = createRoot(host);
      const dispose = () => {
        root.unmount();
        host.remove();
      };
      root.render(
        <FileContext.Provider value={{ fileId, store, register: false }}>
          <NodeView id={id} top />
        </FileContext.Provider>,
      );
      // two frames for React to commit and the browser to lay out
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = host.querySelector<HTMLElement>(`[data-of-id="${CSS.escape(id)}"]`);
          if (!el) {
            dispose();
            resolve(null);
          } else resolve({ el, dispose });
        }),
      );
    });
}
