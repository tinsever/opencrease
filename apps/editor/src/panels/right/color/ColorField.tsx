// Colour swatch + value field used by Fill, Border, Shadow and Shader sections.
import { useEffect, useState, type ReactNode } from "react";
import type { FoldDocument } from "@opencrease/model";
import { formatNumber } from "../../../ui";
import { colorAlpha, colorBase, colorLabel, withAlpha } from "../inspector/fills";
import { ColorPicker, isCssColor, resolveColor } from "./ColorPicker";

export function Swatch({ color, doc, size = 20, round }: { color: string; doc: FoldDocument | undefined; size?: number; round?: boolean }) {
  const lit = resolveColor(doc, color);
  return (
    <span className="of-swatch" style={{ width: size, height: size, borderRadius: round ? 999 : 3, backgroundSize: "8px 8px" }}>
      <i style={{ background: lit }} />
    </span>
  );
}

/**
 * Chip with swatch (opens the picker), editable value text and alpha percentage.
 * `onChange(value, mergeKey)` receives CSS colour strings.
 */
export function ColorField({
  value, onChange, doc, fileId, showAlpha = true, nested, trailing, onAddStop,
}: {
  value: string;
  onChange: (value: string, mergeKey?: string) => void;
  doc: FoldDocument | undefined;
  fileId: string;
  showAlpha?: boolean;
  nested?: boolean;
  trailing?: ReactNode;
  /** Shift + eyedropper in the picker adds the colour as a gradient stop */
  onAddStop?: (color: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = colorLabel(value);
  const isToken = /^var\(/.test(colorBase(value).trim());
  const [draft, setDraft] = useState<string | null>(null);
  const [alphaDraft, setAlphaDraft] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setAlphaDraft(null);
  }, [value]);
  const alpha = formatNumber(colorAlpha(value) * 100, 0);
  const commit = (t: string) => {
    setDraft(null);
    const v = t.trim();
    if (!v || v === label) return;
    if (/^--[\w-]+$/.test(v)) onChange(`var(${v})`);
    else if (/^[0-9a-f]{3,8}$/i.test(v)) onChange(`#${v}`);
    else if (doc?.tokens.some((tk) => tk.type === "color" && tk.name === `--${v}`)) onChange(`var(--${v})`);
    // any CSS colour: hex, rgb, hsl, hwb, lab, lch, oklab, oklch, color(), named, color-mix(), var()
    else if (isCssColor(v) || /^var\(\s*--[\w-]+/.test(v)) onChange(v);
  };
  return (
    <div className={`of-fill-chip${anchor ? " active" : ""}`}>
      <button className="swatch-btn" aria-label="Edit colour" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <i style={{ background: resolveColor(doc, value) }} />
      </button>
      <input
        className={`ftext${isToken ? " token" : ""}`}
        value={draft ?? label}
        aria-label="Colour value"
        spellCheck={false}
        onFocus={(e) => {
          setDraft(label);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            e.currentTarget.value = label;
            setDraft(null);
            e.currentTarget.blur();
          }
          const input = e.target as HTMLInputElement;
          if ((e.key === "Backspace" || e.key === "Delete") && isToken && draft === label && input.selectionStart === 0 && input.selectionEnd === input.value.length) {
            // Backspace on a bound colour detaches the token and keeps the colour
            e.preventDefault();
            const alphaNow = colorAlpha(value);
            const literal = resolveColor(doc, value);
            onChange(alphaNow < 1 ? withAlpha(literal, alphaNow) : literal);
          }
        }}
      />
      {showAlpha ? (
        <input
          className="fmeta"
          aria-label="Opacity"
          value={alphaDraft ?? `${alpha}%`}
          onFocus={(e) => {
            setAlphaDraft(alpha);
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setAlphaDraft(e.target.value)}
          onBlur={() => {
            if (alphaDraft === null) return;
            const n = Number(alphaDraft.replace("%", ""));
            setAlphaDraft(null);
            if (Number.isFinite(n) && String(n) !== alpha) onChange(withAlpha(value, n / 100));
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const n = Number(alpha) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
              onChange(withAlpha(value, Math.max(0, Math.min(100, n)) / 100), "alpha-arrows");
            }
          }}
        />
      ) : null}
      {trailing}
      {anchor ? <ColorPicker anchor={anchor} value={value} doc={doc} fileId={fileId} nested={nested} onChange={onChange} onAddStop={onAddStop} onClose={() => setAnchor(null)} /> : null}
    </div>
  );
}

/** Round colour dot that opens the picker (shader colours). */
export function ColorDot({ value, onChange, doc, fileId, label }: { value: string; onChange: (v: string, key?: string) => void; doc: FoldDocument | undefined; fileId: string; label: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="of-color-dot" aria-label={label} title={label} style={{ background: resolveColor(doc, value) }} onClick={(e) => setAnchor(e.currentTarget)} />
      {anchor ? <ColorPicker anchor={anchor} value={value} doc={doc} fileId={fileId} nested onChange={onChange} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}
