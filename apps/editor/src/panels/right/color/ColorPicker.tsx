// Colour picker popover: OKLCH lightness x chroma plane (drawn in Display P3 when the screen can show
// it), hue and alpha sliders, notation switch (OKLCH, Oklab, HEX, RGB, HSL, P3), value inputs, a
// per-value gamut (sRGB or P3), eyedropper, document colour tokens and "Save as token".
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { converter, type Color } from "culori";
import { normalizeTokenName, type FoldDocument } from "@opencrease/model";
import { getOpenFile } from "../../../state/workspace";
import { Button, clamp, formatNumber, Icon, Popover, Segmented, type Anchor } from "../../../ui";
import { colorAlpha, colorBase } from "../inspector/fills";
import { formatPicker, literalToOklch, modeOf, PICKER_MODES, SRGB_ONLY, type PickerMode } from "./color-format";
import { computeCssColor, isCssColor, resolveColor, toOklchValue } from "./color-value";
export { computeCssColor, isCssColor, resolveColor } from "./color-value";
import { nativeEyeDropper, pickColor } from "./eyedropper";
import { MAX_CHROMA, inP3, inSrgb, maxChroma, oklchCss, oklchToP3Bytes, oklchToSrgbBytes, type Oklch } from "./oklch";

type Gamut = "srgb" | "p3";
const W = 248;
const H = 168;
const toRgb = converter("rgb");
const toHsl = converter("hsl");
const toOklab = converter("oklab");
const toP3 = converter("p3");

let sessionCounter = 0;

/** Whether the screen can show Display P3 colours. */
function p3Display(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(color-gamut: p3)").matches;
}

export function ColorPicker({
  anchor, value, onChange, onClose, doc, fileId, placement = "left", nested, onAddStop,
}: {
  /** set when opened from inside another popover so outside clicks do not close the parent */
  nested?: boolean;
  anchor: Anchor;
  value: string;
  onChange: (value: string, mergeKey?: string) => void;
  onClose: () => void;
  doc: FoldDocument | undefined;
  fileId: string;
  placement?: "left" | "bottom" | "right";
  /** Shift + eyedropper adds the picked colour as a gradient stop through this */
  onAddStop?: (color: string) => void;
}) {
  const isToken = /^var\(/.test(colorBase(value).trim());
  const [tab, setTab] = useState<"custom" | "tokens">(isToken ? "tokens" : "custom");
  const initial = toOklchValue(doc, value) ?? { l: 0.7, c: 0.1, h: 50, a: 1 };
  const [o, setO] = useState<Oklch>(initial);
  const [mode, setMode] = useState<PickerMode>("oklch");
  const [gamut, setGamut] = useState<Gamut>(modeOf(value) === "p3" || !inSrgb(initial.l, initial.c, initial.h) ? "p3" : "srgb");
  const lastEmitted = useRef<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const wide = useMemo(p3Display, []);

  // follow external changes (undo, agent edits) unless they are our own echo
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const next = toOklchValue(doc, value);
    if (next) setO((prev) => ({ ...next, h: next.c < 0.0005 ? prev.h : next.h }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (next: Oklch, key?: string) => {
    setO(next);
    // a wide-gamut colour in an sRGB-only notation is written in Display P3 (see formatPicker)
    if (SRGB_ONLY.has(mode) && !inSrgb(next.l, next.c, next.h)) setMode("p3");
    const out = formatPicker(next, mode);
    lastEmitted.current = out;
    onChange(out, key);
  };

  /** Chroma limited to the value's gamut. */
  const fitGamut = (next: Oklch, g: Gamut = gamut): Oklch => ({ ...next, c: Math.min(next.c, maxChroma(next.l, next.h, g)) });

  // ------------------------------------------------------------ plane
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const space: PredefinedColorSpace = wide ? "display-p3" : "srgb";
    const ctx = cv.getContext("2d", { colorSpace: space });
    if (!ctx) return;
    const img = ctx.createImageData(W, H, { colorSpace: space });
    const d = img.data;
    const toBytes = wide ? oklchToP3Bytes : oklchToSrgbBytes;
    for (let y = 0; y < H; y++) {
      const l = 1 - y / (H - 1);
      for (let x = 0; x < W; x++) {
        const c = (x / (W - 1)) * MAX_CHROMA;
        const [r, g, b] = toBytes(l, c, o.h);
        const i = (y * W + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [o.h, tab, wide]);

  const gamutPaths = useMemo(() => {
    const line = (g: Gamut) => {
      const pts: string[] = [];
      for (let y = 0; y <= H; y += 3) {
        const l = 1 - y / H;
        const x = (maxChroma(l, o.h, g) / MAX_CHROMA) * W;
        pts.push(`${pts.length ? "L" : "M"}${Math.min(W, x).toFixed(1)} ${y}`);
      }
      return pts.join(" ");
    };
    const srgb = line("srgb");
    const p3 = line("p3");
    // area outside the chosen gamut, shaded so it reads as not selectable
    const outside = `${gamut === "srgb" ? srgb : p3} L${W} ${H} L${W} 0 Z`;
    return { srgb, p3, outside };
  }, [o.h, gamut]);

  const dragOn = (e: ReactPointerEvent<HTMLElement>, apply: (fx: number, fy: number, key: string) => void) => {
    const el = e.currentTarget;
    const key = `color-${++sessionCounter}`;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      apply(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1), key);
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const swatch = oklchCss({ ...o, a: 1 });
  const status = inSrgb(o.l, o.c, o.h) ? "In sRGB" : inP3(o.l, o.c, o.h) ? "Display P3" : "Outside P3, clipped";
  const statusColor = inSrgb(o.l, o.c, o.h) ? "var(--of-success)" : inP3(o.l, o.c, o.h) ? "var(--of-accent)" : "var(--of-danger)";

  // ------------------------------------------------------------ value inputs
  const channels = useMemo((): Array<{ key: string; value: string; set: (n: number) => Oklch | null }> => {
    const a100 = formatNumber(o.a * 100, 0);
    const setA = (n: number): Oklch => ({ ...o, a: clamp(n / 100, 0, 1) });
    const from = (c: Color): Oklch | null => {
      const r = literalToOklch(formatRgbLike(c), o.a);
      return r ? { ...r, h: r.c < 0.0005 ? o.h : r.h } : null;
    };
    const color = { mode: "oklch" as const, l: o.l, c: o.c, h: o.h };
    switch (mode) {
      case "oklch":
        return [
          { key: "L", value: formatNumber(o.l, 3), set: (n) => ({ ...o, l: clamp(n > 1 ? n / 100 : n, 0, 1) }) },
          { key: "C", value: formatNumber(o.c, 3), set: (n) => ({ ...o, c: clamp(n, 0, 0.5) }) },
          { key: "H", value: formatNumber(o.h, 1), set: (n) => ({ ...o, h: ((n % 360) + 360) % 360 }) },
          { key: "A", value: a100, set: setA },
        ];
      case "oklab": {
        const lab = toOklab(color);
        const setL = (k: "l" | "a" | "b") => (n: number) => from({ ...lab, [k]: k === "l" ? clamp(n > 1 ? n / 100 : n, 0, 1) : clamp(n, -0.5, 0.5) } as Color);
        return [
          { key: "L", value: formatNumber(lab.l ?? 0, 3), set: setL("l") },
          { key: "a", value: formatNumber(lab.a ?? 0, 3), set: setL("a") },
          { key: "b", value: formatNumber(lab.b ?? 0, 3), set: setL("b") },
          { key: "A", value: a100, set: setA },
        ];
      }
      case "p3": {
        const p = toP3(color);
        const setC = (k: "r" | "g" | "b") => (n: number) => from({ ...p, [k]: clamp(n > 1 ? n / 255 : n, 0, 1) } as Color);
        return [
          { key: "R", value: formatNumber(clamp(p.r ?? 0, 0, 1), 3), set: setC("r") },
          { key: "G", value: formatNumber(clamp(p.g ?? 0, 0, 1), 3), set: setC("g") },
          { key: "B", value: formatNumber(clamp(p.b ?? 0, 0, 1), 3), set: setC("b") },
          { key: "A", value: a100, set: setA },
        ];
      }
      case "rgb": {
        const rgb = toRgb(color);
        const ch = (k: "r" | "g" | "b") => formatNumber(clamp((rgb[k] ?? 0) * 255, 0, 255), 0);
        const setC = (k: "r" | "g" | "b") => (n: number) => from({ ...rgb, [k]: clamp(n, 0, 255) / 255 } as Color);
        return [
          { key: "R", value: ch("r"), set: setC("r") },
          { key: "G", value: ch("g"), set: setC("g") },
          { key: "B", value: ch("b"), set: setC("b") },
          { key: "A", value: a100, set: setA },
        ];
      }
      case "hsl": {
        const hsl = toHsl(color);
        return [
          { key: "H", value: formatNumber(hsl.h ?? 0, 0), set: (n) => from({ ...hsl, h: n } as Color) },
          { key: "S", value: formatNumber((hsl.s ?? 0) * 100, 0), set: (n) => from({ ...hsl, s: clamp(n, 0, 100) / 100 } as Color) },
          { key: "L", value: formatNumber((hsl.l ?? 0) * 100, 0), set: (n) => from({ ...hsl, l: clamp(n, 0, 100) / 100 } as Color) },
          { key: "A", value: a100, set: setA },
        ];
      }
      default:
        return [{ key: "A", value: a100, set: setA }];
    }
  }, [o, mode]);

  const colorTokens = (doc?.tokens ?? []).filter((t) => t.type === "color");
  const native = !!nativeEyeDropper();

  const eyedrop = async (shiftClick: boolean) => {
    const picked = await pickColor({ shift: shiftClick });
    if (!picked) return;
    if (picked.shift && onAddStop) {
      onAddStop(picked.color);
      return;
    }
    const next = literalToOklch(picked.color, o.a);
    if (next) {
      if (!inSrgb(next.l, next.c, next.h)) setGamut("p3");
      emit(next);
    }
  };

  const saveToken = (rawName: string) => {
    const file = getOpenFile(fileId);
    const name = normalizeTokenName(rawName.replace(/\s+/g, "-").toLowerCase());
    if (!file || name.length < 3) return;
    try {
      file.store.transact("Create colour token", (tx) => tx.createToken({ type: "color", name, value: formatPicker({ ...o }, mode) }));
      lastEmitted.current = `var(${name})`;
      onChange(`var(${name})`);
      setSavingName(null);
      setTab("tokens");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const hex = formatPicker({ ...o, a: 1 }, "hex");

  return (
    <Popover anchor={anchor} onClose={onClose} placement={placement} gap={12} width={W} className={nested ? "of-popover-child" : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 40, padding: "0 12px", borderBottom: "1px solid var(--of-hairline)" }}>
        {(["custom", "tokens"] as const).map((t) => (
          <button
            key={t}
            className="of-tab"
            style={{ height: 40, borderBottom: 0, fontWeight: tab === t ? 600 : 400, color: tab === t ? "var(--of-ink)" : "var(--of-muted)" }}
            onClick={() => setTab(t)}
          >
            {t === "custom" ? "Custom" : "Tokens"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="of-icon-btn xs"
          aria-label={native ? "Pick a colour from the screen" : "Pick a colour from the canvas"}
          title={`${native ? "Pick a colour from anywhere on the screen" : "Pick a colour from the canvas"}${onAddStop ? ". Shift adds it as a gradient stop" : ""}`}
          onClick={(e) => void eyedrop(e.shiftKey)}
        >
          <Icon name="eyedropper" size={14} />
        </button>
        <button className="of-icon-btn xs" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={12} />
        </button>
      </div>

      {tab === "custom" ? (
        <>
          <div
            style={{ position: "relative", height: H, touchAction: "none" }}
            onPointerDown={(e) => dragOn(e, (fx, fy, key) => emit(fitGamut({ ...o, c: fx * MAX_CHROMA, l: 1 - fy }), key))}
          >
            <canvas ref={canvasRef} width={W} height={H} style={{ display: "block", width: W, height: H }} />
            <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <path d={gamutPaths.outside} fill="rgb(0 0 0 / 0.28)" />
              <path d={gamutPaths.p3} fill="none" stroke="rgb(255 255 255 / 75%)" strokeDasharray="3 3" />
              <path d={gamutPaths.srgb} fill="none" stroke="rgb(255 255 255 / 95%)" />
            </svg>
            <span style={gamutLabel(W - 30, 8)}>P3</span>
            <span style={gamutLabel(Math.min(W - 70, (maxChroma(0.85, o.h) / MAX_CHROMA) * W + 6), 22)}>sRGB</span>
            <div
              style={{
                position: "absolute", width: 14, height: 14, borderRadius: 999, border: "2px solid #fff", boxShadow: "0 0 0 1px #00000040",
                left: (o.c / MAX_CHROMA) * W - 7, top: (1 - o.l) * H - 7, background: swatch, pointerEvents: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 12px 4px" }}>
            <Slider
              background={`linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => `oklch(0.7 0.15 ${i * 30})`).join(", ")})`}
              fraction={o.h / 360}
              label="Hue"
              onDrag={(e) => dragOn(e, (fx, _fy, key) => emit(fitGamut({ ...o, h: fx * 360 }), key))}
            />
            <Slider
              background={`linear-gradient(90deg, transparent, ${swatch}), repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px`}
              fraction={o.a}
              label="Opacity"
              onDrag={(e) => dragOn(e, (fx, _fy, key) => emit({ ...o, a: Math.round(fx * 100) / 100 }, key))}
            />
          </div>
          <div style={{ display: "flex", gap: 4, padding: "8px 12px" }}>
            <div className="of-field select" style={{ flex: "0 0 auto", padding: "0 6px", width: 66 }}>
              <select
                aria-label="Colour format"
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as PickerMode;
                  setMode(SRGB_ONLY.has(m) && !inSrgb(o.l, o.c, o.h) ? "p3" : m);
                  const out = formatPicker(o, m);
                  lastEmitted.current = out;
                  if (!isToken) onChange(out);
                }}
                style={{ fontSize: "var(--of-text-xs)", fontWeight: 500 }}
              >
                {PICKER_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Icon name="chevronDown" size={10} style={{ color: "var(--of-muted)" }} />
            </div>
            {mode === "hex" ? (
              <ChannelInput
                key={`hex-${hex}`}
                value={hex.replace("#", "").toUpperCase()}
                grow={3}
                title="Hex, or paste any CSS colour"
                onCommit={(t) => {
                  const v = t.trim();
                  const css = /^[0-9a-f]{3,8}$/i.test(v) ? `#${v}` : v;
                  const lit = computeCssColor(css);
                  const next = lit ? literalToOklch(lit, colorAlpha(lit) < 1 ? colorAlpha(lit) : o.a) : null;
                  if (next) emit(next);
                }}
              />
            ) : null}
            {channels.map((c) => (
              <ChannelInput
                key={`${mode}-${c.key}-${c.value}`}
                value={c.value}
                title={c.key}
                onCommit={(t) => {
                  // a pasted colour in any channel replaces the whole colour
                  if (isCssColor(t) && !/^-?\d*[.,]?\d+%?$/.test(t.trim())) {
                    const lit = computeCssColor(t.trim());
                    const next = lit ? literalToOklch(lit) : null;
                    if (next) {
                      setGamut(inSrgb(next.l, next.c, next.h) ? "srgb" : "p3");
                      emit(next);
                    }
                    return;
                  }
                  const n = Number(t.replace(",", ".").replace("%", ""));
                  if (!Number.isFinite(n)) return;
                  const next = c.set(n);
                  if (next) emit(next);
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px 12px" }}>
            <Segmented
              ariaLabel="Gamut of this colour"
              value={gamut}
              className="of-seg-mini"
              onChange={(g) => {
                setGamut(g);
                if (g === "srgb" && !inSrgb(o.l, o.c, o.h)) emit(fitGamut(o, "srgb"));
              }}
              options={[
                { value: "srgb", label: "sRGB", title: "sRGB gamut: colours every screen shows" },
                { value: "p3", label: "P3", title: "Display P3 gamut: wider colours on capable screens" },
              ]}
            />
            <span title={status} style={{ width: 6, height: 6, borderRadius: 999, background: statusColor, flexShrink: 0 }} />
            <div style={{ flex: 1 }} />
            {savingName === null ? (
              <Button size="sm" onClick={() => setSavingName("")}>
                <Icon name="plus" size={11} /> Save as token
              </Button>
            ) : (
              <input
                className="of-textfield"
                autoFocus
                placeholder="--color-name"
                style={{ width: 120, height: 26, fontFamily: "var(--of-font-mono)", fontSize: "var(--of-text-xs)" }}
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onBlur={() => setSavingName(null)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") saveToken(savingName);
                  if (e.key === "Escape") setSavingName(null);
                }}
              />
            )}
          </div>
          {!wide && gamut === "p3" ? <div className="of-hint" style={{ padding: "0 12px 10px" }}>This screen shows sRGB only, so P3 colours are previewed clipped.</div> : null}
        </>
      ) : (
        <div className="of-scroll" style={{ maxHeight: 300, padding: 4 }}>
          {colorTokens.length === 0 ? <div className="of-empty">No colour tokens in this file yet. Pick a colour and use Save as token.</div> : null}
          {colorTokens.map((t) => {
            const selected = colorBase(value).trim() === `var(${t.name})`;
            const lit = resolveColor(doc, `var(${t.name})`);
            return (
              <button
                key={t.id}
                className={`of-menu-item${selected ? " active" : ""}`}
                onClick={() => {
                  lastEmitted.current = `var(${t.name})`;
                  onChange(`var(${t.name})`);
                }}
              >
                <span className="of-swatch"><i style={{ background: lit }} /></span>
                <span className="of-mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: "var(--of-text-xs)" }}>{t.name.slice(2)}</span>
                <span className="of-mono of-muted" style={{ fontSize: 10, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis" }}>{String(t.value)}</span>
                {selected ? <Icon name="check" size={12} style={{ color: "var(--of-accent-ink)" }} /> : null}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function formatRgbLike(c: Color): string {
  const rgb = toRgb(c);
  // unclamped linear values keep wide-gamut colours intact through the conversion
  return `color(srgb ${rgb.r ?? 0} ${rgb.g ?? 0} ${rgb.b ?? 0})`;
}

function gamutLabel(left: number, top: number) {
  return {
    position: "absolute" as const, left, top, padding: "1px 5px", borderRadius: 3, background: "#00000066", color: "#fff",
    font: "9px/12px var(--of-font-mono)", pointerEvents: "none" as const,
  };
}

function Slider({ background, fraction, onDrag, label }: { background: string; fraction: number; onDrag: (e: ReactPointerEvent<HTMLElement>) => void; label: string }) {
  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(fraction * 100)}
      style={{ position: "relative", height: 10, borderRadius: 999, background, touchAction: "none", margin: "0 8px 0 0" }}
      onPointerDown={onDrag}
    >
      <div
        style={{
          position: "absolute", top: -3, left: `calc(${fraction * 100}% - 8px)`, width: 16, height: 16, borderRadius: 999,
          background: "#fff", boxShadow: "0 0 0 1px #00000033, 0 1px 3px #00000033", pointerEvents: "none",
        }}
      />
    </div>
  );
}

function ChannelInput({ value, onCommit, title, grow = 1 }: { value: string; onCommit: (t: string) => void; title?: string; grow?: number }) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="of-field" style={{ flex: `${grow} 1 0`, padding: "0 4px", justifyContent: "center", minWidth: 0 }} title={title}>
      <input
        aria-label={title}
        value={draft}
        style={{ textAlign: "center", fontSize: "var(--of-text-xs)" }}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
          }
        }}
      />
    </div>
  );
}
