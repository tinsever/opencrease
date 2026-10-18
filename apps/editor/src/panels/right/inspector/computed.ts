// Computed styles of rendered canvas nodes, for values the node inherits instead of setting itself.
import { useEffect, useState } from "react";
import { formatColor } from "@opencrease/css";
import { getNodeElement } from "../../../canvas/registry";

export interface ComputedText {
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
  color: string;
}

function read(id: string): ComputedText | null {
  const el = getNodeElement(id);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontSize: cs.fontSize, color: cs.color };
}

/**
 * Computed text styles per node id, read after the canvas has rendered the current document.
 * `version` should change whenever the document changes (pass the doc object).
 */
export function useComputedText(ids: string[], version: unknown): Record<string, ComputedText> {
  const [values, setValues] = useState<Record<string, ComputedText>>({});
  const key = ids.join(",");
  useEffect(() => {
    let raf2 = 0;
    // two frames: the canvas commits its DOM in the same tick, fonts may swap in a frame later
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const next: Record<string, ComputedText> = {};
        for (const id of key ? key.split(",") : []) {
          const v = read(id);
          if (v) next[id] = v;
        }
        setValues((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [key, version]);
  return values;
}

/** "rgb(34, 37, 31)" → "#22251F"; keeps alpha as 8-digit hex. */
export function computedColorToHex(color: string): string {
  const hex = formatColor(color, "hex");
  return hex.startsWith("#") ? hex.toUpperCase() : color;
}

/** First family of a computed font-family list, unquoted ("\"Instrument Serif\", serif" → "Instrument Serif"). */
export function primaryFamily(list: string): string {
  return list.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
}
