// Drag to reorder stacked inspector rows (fills, shadows). A grip appears in the left gutter on hover;
// dragging it shows an insertion line and calls `onMove(from, to)` on drop.
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export interface Reorder {
  /** props for the row wrapper of item `i` */
  row(i: number): { ref: (el: HTMLElement | null) => void; className: string };
  /** the grip element for item `i` */
  grip(i: number, label?: string): ReactNode;
}

export function useReorder(count: number, onMove: (from: number, to: number) => void, canMove: (i: number) => boolean = () => true): Reorder {
  const rows = useRef<Array<HTMLElement | null>>([]);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const start = (e: ReactPointerEvent<HTMLElement>, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let to = from;
    setDrag({ from, to });
    const move = (ev: PointerEvent) => {
      // insertion index: number of rows whose midpoint is above the pointer, skipping fixed rows
      let idx = 0;
      for (let i = 0; i < count; i++) {
        const r = rows.current[i]?.getBoundingClientRect();
        if (r && ev.clientY > r.top + r.height / 2) idx = i + 1;
      }
      while (idx < count && !canMove(idx) && idx <= from) idx++;
      to = idx;
      setDrag({ from, to });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDrag(null);
      const target = to > from ? to - 1 : to;
      if (target !== from) onMove(from, target);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return {
    row(i) {
      let cls = "of-reorder-row";
      if (drag) {
        if (i === drag.from) cls += " dragging";
        if (drag.to === i && drag.to !== drag.from && drag.to !== drag.from + 1) cls += " drop-before";
        if (i === count - 1 && drag.to === count && drag.from !== count - 1) cls += " drop-after";
      }
      return { ref: (el) => (rows.current[i] = el), className: cls };
    },
    grip(i, label = "Drag to reorder") {
      if (count < 2 || !canMove(i)) return null;
      return (
        <span className="of-grip" role="button" aria-label={label} title={label} onPointerDown={(e) => start(e, i)}>
          <svg width="6" height="10" viewBox="0 0 6 10" aria-hidden>
            <circle cx="1.5" cy="1.5" r="1" /><circle cx="4.5" cy="1.5" r="1" />
            <circle cx="1.5" cy="5" r="1" /><circle cx="4.5" cy="5" r="1" />
            <circle cx="1.5" cy="8.5" r="1" /><circle cx="4.5" cy="8.5" r="1" />
          </svg>
        </span>
      );
    },
  };
}
