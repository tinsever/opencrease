// Floating bottom toolbar (Move, Frame, Rectangle, Text, Pen, Image, Shader, Ask agent). It adapts to
// the canvas width: tighter spacing, icon-only "Ask agent", and an overflow menu for the less used
// tools (and the zoom commands when there is no room for the zoom pill).
import { Icon } from "../ui";
import { useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "../state/hooks";
import { setRightTab, setTool, type Tool } from "../state/workspace";
import { FrameIcon, HandIcon, ImageIcon, MoveIcon, PenIcon, RectIcon, ShaderIcon, TextIcon } from "./icons";
import { pickAndInsertImages } from "./insert";
import { toolbarLayout } from "./toolbar-layout";
import { CanvasMenu, formatZoom, useDismiss, useZoom, ZoomMenuItems } from "./ZoomPill";
import { ShapeToolButton } from "../vector/ShapeToolButton";

interface ToolDef {
  tool: Tool;
  label: string;
  key?: string;
  icon: (color: string) => ReactNode;
  disabled?: string;
  onClick?: () => void;
}

const TOOLS: Record<string, ToolDef> = {
  scale: { tool: "scale", label: "Scale", key: "K", icon: (c) => <Icon name="corners" size={20} style={{ color: c }} /> },
  zoom: { tool: "zoom", label: "Zoom", key: "Z", icon: (c) => <Icon name="search" size={20} style={{ color: c }} /> },
  move: { tool: "move", label: "Move", key: "V", icon: (c) => <MoveIcon color={c} /> },
  frame: { tool: "frame", label: "Frame", key: "F", icon: (c) => <FrameIcon color={c} /> },
  rect: { tool: "rect", label: "Rectangle", key: "R", icon: (c) => <RectIcon color={c} /> },
  text: { tool: "text", label: "Text", key: "T", icon: (c) => <TextIcon color={c} /> },
  pen: { tool: "pen", label: "Pen", key: "P", icon: (c) => <PenIcon color={c} /> },
  image: { tool: "image", label: "Image", key: "I", icon: (c) => <ImageIcon color={c} />, onClick: pickAndInsertImages },
  shader: { tool: "shader", label: "Shader", icon: (c) => <ShaderIcon color={c} /> },
};

function runTool(def: ToolDef) {
  if (def.disabled) return;
  if (def.onClick) def.onClick();
  else setTool(def.tool);
}

function Tip({ label, hint, show }: { label: string; hint?: string; show: boolean }) {
  if (!show) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: "absolute",
        bottom: "calc(100% + 10px)",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        background: "var(--of-ink)",
        color: "var(--of-on-ink)",
        borderRadius: "var(--of-radius-sm)",
        fontSize: "var(--of-text-xs)",
        lineHeight: "14px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {label}
      {hint && <span style={{ color: "inherit", opacity: 0.6, fontFamily: "var(--of-font-mono)" }}>{hint}</span>}
    </div>
  );
}

function ToolButton({ def, active }: { def: ToolDef; active: boolean }) {
  const [hover, setHoverState] = useState(false);
  const color = active ? "#FFFFFF" : "var(--of-ink)";
  return (
    <div style={{ position: "relative" }} onPointerEnter={() => setHoverState(true)} onPointerLeave={() => setHoverState(false)}>
      <button
        type="button"
        aria-label={def.label}
        aria-pressed={active}
        aria-disabled={!!def.disabled}
        className="of-tool-button"
        data-active={active || undefined}
        onClick={() => runTool(def)}
        style={{ opacity: def.disabled ? 0.38 : 1, cursor: def.disabled ? "default" : "pointer" }}
      >
        {def.icon(color)}
      </button>
      <Tip label={def.disabled ?? def.label} hint={def.disabled ? undefined : def.key} show={hover} />
    </div>
  );
}

function MoreIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
      <circle cx="3.5" cy="8" r="1.3" fill={color} />
      <circle cx="8" cy="8" r="1.3" fill={color} />
      <circle cx="12.5" cy="8" r="1.3" fill={color} />
    </svg>
  );
}

function OverflowMenu({ tools, activeTool, withZoom, onDone }: { tools: Tool[]; activeTool: Tool; withZoom: boolean; onDone: () => void }) {
  const zoom = useZoom();
  return (
    <CanvasMenu align="centre">
      {tools.map((t) => {
        const def = TOOLS[t];
        return (
          <button
            key={t}
            type="button"
            role="menuitem"
            aria-disabled={!!def.disabled}
            title={def.disabled}
            data-active={activeTool === t || undefined}
            onClick={() => {
              if (def.disabled) return;
              runTool(def);
              onDone();
            }}
            style={{ opacity: def.disabled ? 0.45 : 1 }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {def.icon("var(--of-ink)")}
              {def.label}
            </span>
            <span className="of-menu-hint">{def.disabled ? "Later release" : (def.key ?? "")}</span>
          </button>
        );
      })}
      {withZoom && (
        <>
          <div className="of-menu-sep" role="separator" />
          <div className="of-menu-label">Zoom {formatZoom(zoom)}</div>
          <ZoomMenuItems onDone={onDone} />
        </>
      )}
    </CanvasMenu>
  );
}

function OverflowButton({ tools, activeTool, open, onToggle }: { tools: Tool[]; activeTool: Tool; open: boolean; onToggle: () => void }) {
  const [hover, setHoverState] = useState(false);
  const activeHidden = tools.includes(activeTool) ? TOOLS[activeTool] : undefined;
  const color = activeHidden ? "#FFFFFF" : "var(--of-ink)";
  return (
    <div style={{ position: "relative" }} onPointerEnter={() => setHoverState(true)} onPointerLeave={() => setHoverState(false)}>
      <button
        type="button"
        aria-label="More tools"
        aria-expanded={open}
        aria-haspopup="menu"
        className="of-tool-button"
        data-active={activeHidden ? true : undefined}
        onClick={onToggle}
      >
        {activeHidden ? activeHidden.icon(color) : <MoreIcon color={color} />}
      </button>
      <Tip label={activeHidden ? `${activeHidden.label}, more tools` : "More tools"} show={hover && !open} />
    </div>
  );
}

export function Toolbar({ canvasWidth }: { canvasWidth: number }) {
  const tool = useWorkspace((s) => s.tool);
  const [askHover, setAskHover] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(moreOpen, ref, () => setMoreOpen(false));
  const base = toolbarLayout(canvasWidth);
  const layout = { ...base, overflow: [...base.overflow, "scale", "zoom"] as Tool[] };
  const showMenu = moreOpen && layout.overflow.length > 0;
  return (
    <div
      ref={ref}
      data-of-chrome=""
      data-mode={layout.mode}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: layout.gap,
        padding: 4,
        background: "var(--of-panel)",
        borderRadius: "var(--of-radius-lg)",
        boxShadow: "0 0 0 1px rgb(0 0 0 / 0.06), 0 6px 20px rgb(0 0 0 / 0.10)",
        userSelect: "none",
        whiteSpace: "nowrap",
        zIndex: 5,
      }}
    >
      {layout.inline.map((t) => (t === "rect" ? <ShapeToolButton key={t} /> : <ToolButton key={t} def={TOOLS[t]} active={tool === t} />))}
      {tool === "hand" && <ToolButton def={{ tool: "hand", label: "Hand", key: "H", icon: (c) => <HandIcon color={c} /> }} active />}
      {showMenu && <OverflowMenu tools={layout.overflow} activeTool={tool} withZoom={!layout.zoomPill} onDone={() => setMoreOpen(false)} />}
      {layout.overflow.length > 0 && (
        <OverflowButton tools={layout.overflow} activeTool={tool} open={showMenu} onToggle={() => setMoreOpen((o) => !o)} />
      )}
      {layout.separator && <div style={{ width: 1, height: 20, background: "var(--of-hairline)", flexShrink: 0, margin: "0 2px" }} />}
      <div style={{ position: "relative" }} onPointerEnter={() => setAskHover(true)} onPointerLeave={() => setAskHover(false)}>
        <button
          type="button"
          className="of-tool-button of-ask-agent"
          data-icon-only={layout.askLabel ? undefined : true}
          aria-label="Ask agent"
          onClick={() => setRightTab("agent")}
        >
          <Icon name="plug" size={18} style={{ color: "var(--of-agent)" }} />
          {layout.askLabel && <span>Ask agent</span>}
        </button>
        <Tip label={layout.askLabel ? "Open the Agent tab" : "Ask agent"} show={askHover} />
      </div>
    </div>
  );
}
