// Number field with label scrubbing, arrow-key stepping, expressions and var() tokens.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatNumber, parseFieldInput, pxValue, type FieldValue } from "./expr";
import { Icon, type IconName } from "./icons";
import { useMenu, type MenuItem } from "./Popover";

export const MIXED = Symbol("mixed");
export type Mixed = typeof MIXED;

export interface TokenOption {
  name: string; // "--spacing-12"
  value: string | number;
}

let scrubSession = 0;

export interface NumberFieldProps {
  /** raw style value, MIXED, or undefined (empty) */
  value: FieldValue | Mixed | undefined;
  onCommit: (value: FieldValue | null, mergeKey?: string) => void;
  label?: string;
  icon?: IconName;
  /** text shown when the value is empty */
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
  /** display multiplier: e.g. 100 for opacity (stored 0..1, shown 0..100) */
  scale?: number;
  /** text appended to numbers in display (e.g. "%" or "°") */
  suffix?: string;
  /** value used when scrubbing starts from an empty/non-numeric value (e.g. the measured size) */
  fallback?: number;
  /** resolve a token name to its value, for display of var() values */
  resolveToken?: (name: string) => string | number | undefined;
  /** tokens offered in the picker (shown when the field has a token hint slot) */
  tokens?: TokenOption[];
  /** extra trailing content (Fill/Hug tag, etc.) */
  trailing?: ReactNode;
  allowUnits?: boolean;
  allowKeywords?: boolean;
  style?: CSSProperties;
  ariaLabel?: string;
  disabled?: boolean;
  /** precision for display */
  digits?: number;
}

function displayValue(v: FieldValue | Mixed | undefined, p: NumberFieldProps): { text: string; token?: string } {
  if (v === MIXED) return { text: "" };
  if (v === undefined || v === "") return { text: "" };
  const scale = p.scale ?? 1;
  if (typeof v === "string") {
    const m = /^var\(\s*(--[\w-]+)/.exec(v);
    if (m) {
      const resolved = p.resolveToken?.(m[1]);
      const n = resolved !== undefined ? pxValue(resolved) : null;
      return { text: n !== null ? formatNumber(n * scale, p.digits) + (p.suffix ?? "") : String(resolved ?? ""), token: m[1].slice(2) };
    }
    const n = pxValue(v);
    if (n !== null) return { text: formatNumber(n * scale, p.digits) + (p.suffix ?? "") };
    return { text: v };
  }
  return { text: formatNumber(v * scale, p.digits) + (p.suffix ?? "") };
}

export function NumberField(p: NumberFieldProps) {
  const { value, onCommit, label, icon, placeholder, step = 1, min, max, scale = 1, suffix, trailing, style, ariaLabel, disabled } = p;
  const shown = displayValue(value, p);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, openMenu] = useMenu();
  const arrowKey = useRef<string | undefined>(undefined);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (draft === null) arrowKey.current = undefined;
  }, [draft]);

  const clampN = (n: number) => {
    let r = n;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  };

  const numericNow = (): number => {
    if (value === MIXED || value === undefined) return p.fallback ?? 0;
    if (typeof value === "string") {
      const m = /^var\(\s*(--[\w-]+)/.exec(value);
      const n = pxValue(m ? (p.resolveToken?.(m[1]) ?? "") : value);
      return n ?? p.fallback ?? 0;
    }
    return value;
  };

  const commitText = (text: string) => {
    setDraft(null);
    const t = text.trim();
    if (t === shown.text.trim() && !(value === MIXED)) return;
    if (t === "") {
      if (value !== undefined && value !== MIXED) onCommit(null);
      return;
    }
    const stripped = suffix ? t.replace(new RegExp(`\\s*${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "") : t;
    const parsed = parseFieldInput(stripped, { allowUnits: p.allowUnits ?? !suffix, allowKeywords: p.allowKeywords });
    if (parsed === null) return;
    if (typeof parsed === "number") onCommit(clampN(parsed / scale));
    else onCommit(parsed);
  };

  const stepBy = (delta: number) => {
    const next = clampN(Math.round((numericNow() * scale + delta) * 1000) / 1000 / scale);
    arrowKey.current ??= `arrow-${++scrubSession}`;
    onCommit(next, arrowKey.current);
    setDraft(null);
  };

  const onLabelPointerDown = (e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = numericNow() * scale;
    const key = `scrub-${++scrubSession}`;
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const raw = start + Math.round(dx / 2) * step * mult;
      onCommit(clampN(Math.round(raw * 100) / 100 / scale), key);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (!moved) inputRef.current?.focus();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const tokenMenu = (anchor: HTMLElement) => {
    const items: MenuItem[] = (p.tokens ?? []).map((t) => ({
      label: `${t.name.slice(2)}  ${typeof t.value === "number" ? t.value : t.value}`,
      checked: typeof value === "string" && value.includes(t.name),
      onSelect: () => onCommit(`var(${t.name})`),
    }));
    if (typeof value === "string" && value.startsWith("var(")) {
      items.push({ type: "separator" }, { label: "Detach token", onSelect: () => onCommit(numericNow()) });
    }
    if (items.length === 0) items.push({ label: "No matching tokens", disabled: true });
    openMenu(items, anchor);
  };

  return (
    <div className={`of-field${value === MIXED ? " mixed" : ""}`} style={style} aria-disabled={disabled}>
      {icon || label ? (
        <span className="of-field-label scrub" onPointerDown={onLabelPointerDown} title={label ? `${label}: drag to change` : undefined}>
          {icon ? <Icon name={icon} size={12} /> : label}
        </span>
      ) : null}
      <input
        ref={inputRef}
        aria-label={ariaLabel ?? label}
        value={draft ?? shown.text}
        placeholder={value === MIXED ? "Mixed" : placeholder}
        disabled={disabled}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(shown.text);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (skipBlur.current) skipBlur.current = false;
          else if (draft !== null) commitText(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            commitText((e.target as HTMLInputElement).value);
            skipBlur.current = true;
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            skipBlur.current = true;
            (e.target as HTMLInputElement).blur();
          } else if (
            (e.key === "Backspace" || e.key === "Delete") &&
            shown.token &&
            draft === shown.text &&
            (e.target as HTMLInputElement).selectionStart === 0 &&
            (e.target as HTMLInputElement).selectionEnd === (e.target as HTMLInputElement).value.length
          ) {
            // Backspace on a bound field detaches the token and keeps its current value
            e.preventDefault();
            onCommit(numericNow());
            setDraft(null);
            requestAnimationFrame(() => inputRef.current?.select());
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            stepBy((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1) * step);
            requestAnimationFrame(() => inputRef.current?.select());
          }
        }}
      />
      {shown.token ? (
        <button type="button" className="of-field-hint" title={`Token --${shown.token}`} onClick={(e) => tokenMenu(e.currentTarget)}>
          {shown.token}
        </button>
      ) : p.tokens && p.tokens.length > 0 && !trailing ? (
        <button type="button" className="of-field-hint muted of-token-pick" title="Use a token" aria-label="Use a token" onClick={(e) => tokenMenu(e.currentTarget)}>
          <Icon name="tokens" size={11} />
        </button>
      ) : null}
      {trailing}
      {menu}
    </div>
  );
}
