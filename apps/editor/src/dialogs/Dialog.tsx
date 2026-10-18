import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Modal shell: dimmed overlay, Esc and outside click close, focus moves inside. */
export function Dialog({ onClose, children, width, top = "10vh", style, label }: { onClose: () => void; children: ReactNode; width: number; top?: string; style?: CSSProperties; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      if (ref.current && !ref.current.contains(document.activeElement)) {
        const focusable = ref.current.querySelector<HTMLElement>("[autofocus], input, textarea, button");
        (focusable ?? ref.current).focus();
      }
    }, 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((el) => el.getClientRects().length > 0);
        const first = items[0], last = items.at(-1);
        if (!first) { e.preventDefault(); ref.current.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.key === "Escape" && !document.querySelector(".of-menu, .of-popover")) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", key, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div
      className="of-overlay"
      style={{ paddingTop: top }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="of-dialog"
        style={{ width, maxWidth: "calc(100vw - 32px)", outline: "none", ...style }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
