// Renders document nodes as real DOM. Each node component subscribes to its own node object, so a change
// re-renders only the nodes whose objects changed (immer keeps untouched nodes identical).
import { createContext, createElement, memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import type { DocStore, NodeId, OFNode } from "@opencrease/model";
import { safeSvgAttrs, SVG_TAGS, svgAttrToJsx, toReactStyle } from "@opencrease/css";
import { isGenUrl } from "@opencrease/protocol";
import { pendingImageStyle } from "../../ai/gen-logic";
import { resolveSrc } from "../../state/api";
import { useWorkspace } from "../../state/hooks";
import { ShaderView } from "./ShaderView";
import { buildEditableDom, insertAtSelection, restoreSelection, richText, selectionOffsets } from "../rich-edit";
import { commitTextEdit, lastSynced, richKey, syncTextEdit } from "../text-edit";
import { handleTextShortcut } from "../text-shortcuts";
import { canvasUi } from "../ui-state";
import { registerNodeElement, unregisterNodeElement } from "../registry";
import { subscribeNode } from "./node-subs";

interface FileCtx {
  fileId: string;
  store: DocStore;
  /** false for off-canvas renders (thumbnail capture): their elements must not shadow the canvas ones */
  register?: boolean;
}

export const FileContext = createContext<FileCtx | null>(null);

function useFileCtx(): FileCtx {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error("FileContext missing");
  return ctx;
}

export function useNodeObject(id: NodeId): OFNode | undefined {
  const { store } = useFileCtx();
  const subscribe = useCallback((l: () => void) => subscribeNode(store, id, l), [store, id]);
  return useSyncExternalStore(subscribe, () => store.doc.nodes[id]);
}

export type NodeRef = (el: HTMLElement | SVGElement | null) => void | (() => void);

/** Ref callback that registers the node's element with the canvas registry. */
export function useNodeRef(id: NodeId): NodeRef {
  const { register = true } = useFileCtx();
  return useCallback(
    (el: HTMLElement | SVGElement | null) => {
      if (!el || !register) return;
      registerNodeElement(id, el);
      return () => unregisterNodeElement(id, el);
    },
    [id, register],
  );
}

type Style = Record<string, string | number>;

export function baseStyle(node: OFNode, top: boolean): Style {
  const style: Style = toReactStyle(node.styles);
  for (const key of ["background", "backgroundImage"]) {
    if (typeof style[key] === "string") style[key] = pendingImageStyle(style[key]);
  }
  if (top) {
    if (style.position === undefined || style.position === "relative" || style.position === "static") style.position = "absolute";
    if (style.left === undefined && style.right === undefined) style.left = 0;
    if (style.top === undefined && style.bottom === undefined) style.top = 0;
  }
  if (!node.visible) style.display = "none";
  return style;
}

export const NodeView = memo(function NodeView({ id, top = false }: { id: NodeId; top?: boolean }) {
  const node = useNodeObject(id);
  const ref = useNodeRef(id);
  if (!node) return null;
  switch (node.type) {
    case "Root":
      return null;
    case "Text":
      return <TextView node={node} top={top} nodeRef={ref} />;
    case "Image":
      return <ImageView node={node} top={top} nodeRef={ref} />;
    case "SVG":
    case "SVGElement":
      return <SvgView node={node} top={top} nodeRef={ref} />;
    case "Shader":
      return <ShaderNodeView node={node} top={top} nodeRef={ref} />;
    default: {
      const style = baseStyle(node, top);
      const fill = node.paint?.shader && !node.paint.shaderHidden ? node.paint.shader : undefined;
      if (fill) {
        // the shader fill sits under the children inside this stacking context
        style.isolation = "isolate";
        if (style.position === undefined) style.position = "relative";
      }
      return (
        <div ref={ref} data-of-id={node.id} data-mode={node.mode} style={style as CSSProperties}>
          {fill && node.visible ? <ShaderFill spec={fill} /> : null}
          {node.children.map((c) => (
            <NodeView key={c} id={c} />
          ))}
        </div>
      );
    }
  }
});

function ShaderNodeView({ node, top, nodeRef }: { node: OFNode; top: boolean; nodeRef: NodeRef }) {
  const { fileId } = useFileCtx();
  const style = baseStyle(node, top);
  if (style.position === undefined) style.position = "relative";
  if (style.overflow === undefined) style.overflow = "hidden";
  return (
    <div ref={nodeRef} data-of-id={node.id} style={style as CSSProperties}>
      {node.visible && <ShaderView spec={node.shader} resolveImage={(src) => resolveSrc(fileId, src)} />}
    </div>
  );
}

export function ShaderFill({ spec }: { spec: NonNullable<OFNode["shader"]> }) {
  const { fileId } = useFileCtx();
  return <ShaderView spec={spec} fill resolveImage={(src) => resolveSrc(fileId, src)} />;
}

function ImageView({ node, top, nodeRef }: { node: OFNode; top: boolean; nodeRef: NodeRef }) {
  const { fileId } = useFileCtx();
  // gen:// images that are not generated yet render as the placeholder (status is drawn by GenStatusLayer)
  const src = isGenUrl(node.src ?? "") ? undefined : resolveSrc(fileId, node.src);
  const style = baseStyle(node, top);
  if (!src) {
    return (
      <div
        ref={nodeRef}
        data-of-id={node.id}
        style={{ backgroundImage: "repeating-linear-gradient(45deg, #EEE 0 8px, #F7F7F7 8px 16px)", ...style } as CSSProperties}
      />
    );
  }
  return <img ref={nodeRef} data-of-id={node.id} src={src} alt="" draggable={false} style={style as CSSProperties} />;
}

function svgProps(node: OFNode): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(safeSvgAttrs(node.attrs ?? {}, node.tag ?? "svg"))) {
    if (k === "style" || k.startsWith("on")) continue;
    props[svgAttrToJsx(k)] = v;
  }
  return props;
}

function SvgView({ node, top, nodeRef }: { node: OFNode; top: boolean; nodeRef: NodeRef }) {
  const requested = node.tag || (node.type === "SVG" ? "svg" : "g");
  const tag = SVG_TAGS.has(requested) ? requested : "g";
  const style = node.type === "SVG" ? baseStyle(node, top) : (toReactStyle(node.styles) as Style);
  if (!node.visible && node.type !== "SVG") style.display = "none";
  const children = node.children.length
    ? node.children.map((c) => <NodeView key={c} id={c} />)
    : node.text
      ? node.text
      : undefined;
  return createElement(tag, { ...svgProps(node), ref: nodeRef, "data-of-id": node.id, style }, children);
}

function TextView({ node, top, nodeRef }: { node: OFNode; top: boolean; nodeRef: NodeRef }) {
  const { register = true } = useFileCtx();
  const editing = useWorkspace((s) => s.editingTextId === node.id) && register;
  const style = baseStyle(node, top);
  if (style.whiteSpace === undefined) style.whiteSpace = "pre-wrap";
  const empty = !node.text;
  if (empty || editing) {
    style.minHeight = "1lh";
    if (empty) style.minWidth = 2;
  }
  if (editing) return <EditableText key="edit" node={node} style={style} nodeRef={nodeRef} />;
  return (
    <div key="view" ref={nodeRef} data-of-id={node.id} style={style as CSSProperties}>
      {node.spans ? <SpanRuns node={node} /> : node.text}
    </div>
  );
}

/** Rich text runs as nested spans (the node's own styles live on the Text element). */
function SpanRuns({ node }: { node: OFNode }) {
  return (
    <>
      {(node.spans ?? []).map((s, i) =>
        s.styles ? (
          <span key={i} style={toReactStyle(s.styles) as CSSProperties}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}


/** Elements that may take focus during a text edit without ending it (the inspector and its popovers). */
const KEEP_EDITING = ".of-panel.right, .of-popover, .of-menu";

function EditableText({ node, style, nodeRef }: { node: OFNode; style: Style; nodeRef: NodeRef }) {
  const ref = useRef<HTMLDivElement>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      const cleanup = nodeRef(el);
      return () => {
        ref.current = null;
        cleanup?.();
      };
    },
    [nodeRef],
  );
  // read once per mount (not cleared here: StrictMode runs effects twice)
  const caretRef = useRef(canvasUi.get().caret);
  const lastPointer = useRef<EventTarget | null>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    buildEditableDom(el, { text: node.text ?? "", spans: node.spans });
    lastSynced.set(node.id, richKey(node));
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return;
    const caret = caretRef.current;
    let range: Range | null = null;
    if (caret && node.text) {
      const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const pos = doc.caretPositionFromPoint?.(caret.x, caret.y);
      if (pos && el.contains(pos.offsetNode)) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      } else {
        const r = doc.caretRangeFromPoint?.(caret.x, caret.y);
        if (r && el.contains(r.startContainer)) range = r;
      }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // outside changes (inspector, agent, undo) rebuild the content; our own syncs are recognised and skipped
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = richKey(node);
    if (key === lastSynced.get(node.id)) return;
    const focused = document.activeElement === el;
    const sel = focused ? selectionOffsets(el) : null;
    buildEditableDom(el, { text: node.text ?? "", spans: node.spans });
    lastSynced.set(node.id, key);
    if (sel) restoreSelection(el, Math.min(sel.start, (node.text ?? "").length), Math.min(sel.end, (node.text ?? "").length));
  }, [node]);

  // track the selected range for the inspector, and where the pointer went for blur decisions
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onSelection = () => {
      if (document.activeElement !== el) return;
      const sel = selectionOffsets(el);
      richText.set({ range: sel ? { nodeId: node.id, start: sel.start, end: sel.end } : null });
    };
    const onPointer = (e: PointerEvent) => {
      lastPointer.current = e.target;
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [node.id]);

  const keepsEditing = (target: EventTarget | null) => target instanceof Element && !!target.closest(KEEP_EDITING);

  return (
    <div
      ref={setRef}
      data-of-id={node.id}
      data-of-editing=""
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...style, outline: "none", userSelect: "text", cursor: "text", caretColor: "var(--of-accent)" } as CSSProperties}
      onBlur={(e) => {
        // moving into the inspector keeps the edit (and the selected range) alive
        if (keepsEditing(e.relatedTarget) || keepsEditing(lastPointer.current)) return;
        commitTextEdit(node.id, e.currentTarget);
      }}
      onInput={(e) => {
        if (composing.current || (e.nativeEvent as InputEvent).isComposing) return;
        syncTextEdit(node.id);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        syncTextEdit(node.id);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commitTextEdit(node.id, e.currentTarget);
          return;
        }
        if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) {
          e.preventDefault();
          const next = insertAtSelection(e.currentTarget, "\n");
          if (next) syncTextEdit(node.id, next);
          return;
        }
        if (handleTextShortcut(e.nativeEvent)) e.preventDefault();
      }}
      onPaste={(e) => {
        // plain text only; it takes the style of the text around the caret
        e.preventDefault();
        e.stopPropagation();
        const next = insertAtSelection(e.currentTarget, e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"));
        if (next) syncTextEdit(node.id, next);
      }}
      onDrop={(e) => e.preventDefault()}
      onCopy={(e) => e.stopPropagation()}
      onCut={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
