// Floating layers: anchored popovers, menus and tooltips (portals into document.body).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

export type Anchor = { x: number; y: number } | DOMRect | HTMLElement;

function rectOf(anchor: Anchor): { left: number; top: number; right: number; bottom: number } {
  if (anchor instanceof HTMLElement) return anchor.getBoundingClientRect();
  if ("width" in anchor) return anchor;
  return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
}

/** Position a floating box next to an anchor, flipped/clamped into the viewport. */
function place(anchor: Anchor, size: { w: number; h: number }, placement: "bottom" | "left" | "right" | "top", gap: number) {
  const r = rectOf(anchor);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x: number;
  let y: number;
  if (placement === "left" || placement === "right") {
    x = placement === "left" ? r.left - size.w - gap : r.right + gap;
    if (placement === "left" && x < 8) x = r.right + gap;
    if (placement === "right" && x + size.w > vw - 8) x = r.left - size.w - gap;
    y = r.top;
  } else {
    x = r.left;
    y = placement === "bottom" ? r.bottom + gap : r.top - size.h - gap;
    if (placement === "bottom" && y + size.h > vh - 8 && r.top - size.h - gap > 8) y = r.top - size.h - gap;
    if (placement === "top" && y < 8) y = r.bottom + gap;
  }
  x = Math.max(8, Math.min(x, vw - size.w - 8));
  y = Math.max(8, Math.min(y, vh - size.h - 8));
  return { x, y };
}

function useOutsideClose(ref: RefObject<HTMLElement | null>, onClose: () => void, ignore?: HTMLElement | null) {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (ignore?.contains(t)) return;
      // clicks inside another floating layer (menu opened from this popover) do not close it
      if ((t as HTMLElement).closest?.(".of-menu, .of-popover-child")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [ref, onClose, ignore]);
}

export function Popover({
  anchor, onClose, children, placement = "bottom", gap = 6, width, style, className,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  placement?: "bottom" | "left" | "right" | "top";
  gap?: number;
  width?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setPos(place(anchor, { w: el.offsetWidth, h: el.offsetHeight }, placement, gap));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, placement, gap]);
  useOutsideClose(ref, onClose, anchor instanceof HTMLElement ? anchor : null);
  return createPortal(
    <div
      ref={ref}
      className={`of-popover ${className ?? ""}`}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width, ...style }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- menus

export type MenuItem =
  | { type?: "item"; label: string; onSelect?: () => void; shortcut?: string; danger?: boolean; disabled?: boolean; checked?: boolean; icon?: ReactNode }
  | { type: "separator" }
  | { type: "label"; label: string };

export function Menu({ items, anchor, onClose, placement = "bottom", minWidth }: { items: MenuItem[]; anchor: Anchor; onClose: () => void; placement?: "bottom" | "right" | "left" | "top"; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(-1);
  const selectable = items.map((it, i) => ((it.type ?? "item") === "item" && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPos(place(anchor, { w: el.offsetWidth, h: el.offsetHeight }, placement, 4));
  }, [anchor, placement]);
  useOutsideClose(ref, onClose, anchor instanceof HTMLElement ? anchor : null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const idx = selectable.indexOf(active);
        const next = e.key === "ArrowDown" ? selectable[(idx + 1) % selectable.length] : selectable[(idx - 1 + selectable.length) % selectable.length];
        setActive(next ?? -1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const it = items[active] as { onSelect?: () => void };
        onClose();
        it.onSelect?.();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  const hasChecks = items.some((it) => (it.type ?? "item") === "item" && (it as { checked?: boolean }).checked !== undefined);
  return createPortal(
    <div ref={ref} className="of-menu" role="menu" style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, minWidth }}>
      {items.map((it, i) => {
        if (it.type === "separator") return <div key={i} className="of-menu-sep" />;
        if (it.type === "label") return <div key={i} className="of-menu-label of-caps">{it.label}</div>;
        return (
          <button
            key={i}
            role="menuitem"
            className={`of-menu-item${it.danger ? " danger" : ""}${active === i ? " active" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
          >
            {hasChecks ? <span className="check">{it.checked ? <Icon name="check" size={12} /> : null}</span> : null}
            {it.icon}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
            {it.shortcut ? <span className="shortcut">{it.shortcut}</span> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Local menu state: `const [menu, openMenu] = useMenu(); ... {menu}` */
export function useMenu(): [ReactElement | null, (items: MenuItem[], anchor: Anchor, opts?: { placement?: "bottom" | "right" | "left" | "top"; minWidth?: number }) => void] {
  const [state, setState] = useState<{ items: MenuItem[]; anchor: Anchor; placement?: "bottom" | "right" | "left" | "top"; minWidth?: number } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((items: MenuItem[], anchor: Anchor, opts?: { placement?: "bottom" | "right" | "left" | "top"; minWidth?: number }) => {
    // freeze element anchors to a rect so re-renders do not move the menu
    const a = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    setState({ items, anchor: a, ...opts });
  }, []);
  const el = state ? <Menu items={state.items} anchor={state.anchor} placement={state.placement} minWidth={state.minWidth} onClose={close} /> : null;
  return [el, open];
}

// ---------------------------------------------------------------- tooltip

export function Tooltip({ label, children, placement = "bottom", style }: { label: ReactNode; children: ReactNode; placement?: "bottom" | "top" | "left" | "right"; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current || !tipRef.current) return;
    const r = ref.current.getBoundingClientRect();
    const t = tipRef.current;
    let { x, y } = place(r, { w: t.offsetWidth, h: t.offsetHeight }, placement, 6);
    if (placement === "bottom" || placement === "top") x = Math.max(8, Math.min(r.left + r.width / 2 - t.offsetWidth / 2, window.innerWidth - t.offsetWidth - 8));
    setPos({ x, y });
  }, [open, placement]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span
      ref={ref}
      style={{ display: "inline-flex", ...style }}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), 450);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setOpen(false);
        setPos(null);
      }}
      onPointerDown={() => {
        clearTimeout(timer.current);
        setOpen(false);
      }}
    >
      {children}
      {open
        ? createPortal(
            <div ref={tipRef} className="of-tooltip" role="tooltip" style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}>
              {label}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
