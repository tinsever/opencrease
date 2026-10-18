// Text details for Text nodes: variable font axes, OpenType features, stroke, gradient text,
// truncation, wrapping style and CJK line breaking. Collapsed until opened or until a value is set.
import { useState } from "react";
import { AXIS_NAMES, familyInfo, parseVariations, useFontMeta, variationsToCss, type FontAxis } from "../../../canvas/font-meta";
import { IconButton, MIXED, NumberField, Section, SelectField, ToggleRow } from "../../../ui";
import { ColorField } from "../color/ColorField";
import { applyStyles, common, styleValue, tokenOptions, tokenResolver, useCtx } from "./common";
import { primaryFamily, useComputedText } from "./computed";
import { DEFAULT_ON, FEATURES, featuresToCss, gradientTextStyles, lineClampStyles, parseFeatures, readGradient } from "./text-details-logic";
import { textWriter, useTextRange } from "./text-range";

function AxisRow({ axis, value, onChange }: { axis: FontAxis; value: number; onChange: (v: number, key: string) => void }) {
  const p = ((value - axis.min) / (axis.max - axis.min || 1)) * 100;
  const step = axis.max - axis.min > 20 ? 1 : 0.1;
  return (
    <div className="of-param-row" data-axis={axis.tag}>
      <span className="plabel" title={axis.tag}>{AXIS_NAMES[axis.tag] ?? axis.tag}</span>
      <input
        type="range"
        className="of-slider"
        aria-label={AXIS_NAMES[axis.tag] ?? axis.tag}
        min={axis.min}
        max={axis.max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${p}%`, flex: 1 }}
        onChange={(e) => onChange(Number(e.target.value), `axis-${axis.tag}`)}
      />
      <input
        className="pval"
        aria-label={`${AXIS_NAMES[axis.tag] ?? axis.tag} value`}
        defaultValue={String(Math.round(value * 10) / 10)}
        key={String(value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onChange(Math.min(axis.max, Math.max(axis.min, n)), `axis-${axis.tag}-typed`);
        }}
      />
    </div>
  );
}

export function TextDetailsSection() {
  const ctx = useCtx();
  const { doc, nodes } = ctx;
  const range = useTextRange(ctx);
  const w = textWriter(ctx, range);
  const meta = useFontMeta();
  const computed = useComputedText(ctx.ids, doc);
  const [open, setOpen] = useState(false);
  const resolve = tokenResolver(doc);

  const familyName = common(nodes, (n) => primaryFamily(computed[n.id]?.fontFamily ?? ""));
  const info = familyName !== MIXED && familyName ? familyInfo(familyName) : undefined;
  void meta;
  const order = (t: string) => {
    const i = ["wght", "wdth", "opsz", "slnt"].indexOf(t);
    return i >= 0 ? i : t === t.toLowerCase() ? 10 : 20;
  };
  const axes = (info?.axes ?? []).filter((a) => a.tag !== "ital").sort((a, b) => order(a.tag) - order(b.tag));
  const variationsRaw = w.value("fontVariationSettings");
  const variations = parseVariations(variationsRaw === MIXED ? undefined : variationsRaw);
  const featuresRaw = w.value("fontFeatureSettings");
  const featureMap = parseFeatures(featuresRaw === MIXED ? undefined : featuresRaw);
  const opticalAuto = common(nodes, (n) => String(n.styles.fontOpticalSizing ?? "auto")) !== "none";
  const strokeWidth = styleValue(nodes, "WebkitTextStrokeWidth");
  const strokeColor = common(nodes, (n) => String(n.styles.WebkitTextStrokeColor ?? ""));
  const gradient = common(nodes, (n) => (n.styles.backgroundClip === "text" || n.styles.WebkitBackgroundClip === "text" ? String(n.styles.backgroundImage ?? "") : ""));
  const g = gradient !== MIXED && gradient ? readGradient(gradient) : null;
  const clamp = common(nodes, (n) => Number(n.styles.WebkitLineClamp ?? n.styles.lineClamp ?? 0) || 0);
  const wrapStyle = common(nodes, (n) => String(n.styles.textWrap ?? n.styles.textWrapStyle ?? "auto"));
  const keepAll = common(nodes, (n) => n.styles.wordBreak === "keep-all");

  const hasValues =
    Object.keys(featureMap).length > 0 || Object.keys(variations).length > 0 || strokeWidth !== undefined || !!gradient || clamp !== 0 || (wrapStyle !== "auto" && wrapStyle !== MIXED) || keepAll === true || !opticalAuto;
  const expanded = open || hasValues;

  const setAxis = (tag: string, v: number, key: string) => {
    if (tag === "wght") return w.write({ fontWeight: Math.round(v) }, "Font weight", key);
    const next = { ...variations, [tag]: v };
    w.write({ fontVariationSettings: variationsToCss(next) }, "Font variation", key);
  };
  const axisValue = (a: FontAxis): number => {
    if (a.tag === "wght") {
      const fw = Number(w.value("fontWeight") === MIXED ? NaN : (resolve(String(w.value("fontWeight"))) ?? w.value("fontWeight")));
      const cw = Number(computed[nodes[0].id]?.fontWeight);
      return Number.isFinite(fw) && fw > 0 ? fw : Number.isFinite(cw) ? cw : a.defaultValue;
    }
    if (a.tag === "opsz" && variations.opsz === undefined && opticalAuto) {
      const size = Number.parseFloat(computed[nodes[0].id]?.fontSize ?? "");
      return Number.isFinite(size) ? Math.min(a.max, Math.max(a.min, size)) : a.defaultValue;
    }
    return variations[a.tag] ?? a.defaultValue;
  };

  return (
    <Section
      title="Text details"
      collapsed={!expanded}
      onHeaderClick={() => setOpen((o) => !o)}
      actions={
        expanded && hasValues ? (
          <IconButton
            icon="minus"
            iconSize={12}
            size="xs"
            label="Clear text details"
            onClick={() =>
              applyStyles(
                ctx,
                {
                  fontFeatureSettings: null, fontVariationSettings: null, fontOpticalSizing: null, WebkitTextStroke: null, WebkitTextStrokeWidth: null,
                  WebkitTextStrokeColor: null, ...gradientTextStyles(null), ...lineClampStyles(null), textWrap: null, textWrapStyle: null, wordBreak: null,
                },
                "Clear text details",
              )
            }
          />
        ) : (
          <IconButton icon={expanded ? "chevronDown" : "chevronRight"} iconSize={12} size="xs" label={expanded ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)} />
        )
      }
    >
      {expanded ? (
        <>
          {axes.length ? (
            <>
              <span className="of-hint" style={{ lineHeight: "14px" }}>Variable axes of {info!.family}</span>
              {axes.map((a) => (
                <AxisRow key={a.tag} axis={a} value={axisValue(a)} onChange={(v, key) => setAxis(a.tag, v, key)} />
              ))}
              {axes.some((a) => a.tag === "opsz") ? (
                <ToggleRow
                  label="Optical size follows font size"
                  on={opticalAuto && variations.opsz === undefined}
                  onChange={(on) => {
                      const next = { ...variations };
                      delete next.opsz;
                      applyStyles(ctx, on ? { fontOpticalSizing: null, fontVariationSettings: variationsToCss(next) } : { fontOpticalSizing: "none" }, "Optical size");
                  }}
                />
              ) : null}
            </>
          ) : (
            <span className="of-hint" style={{ lineHeight: "14px" }}>
              {meta.status === "ready" || meta.status === "error" ? `${familyName === MIXED ? "These fonts have" : `${familyName || "This font"} has`} no variable axes we know of.` : "Loading font details…"}
            </span>
          )}

          <span className="of-hint" style={{ lineHeight: "14px", paddingTop: 4 }}>OpenType features</span>
          <div className="of-row" style={{ gap: 4, flexWrap: "wrap" }}>
            {FEATURES.map((f) => {
              const on = featureMap[f.tag] ?? (DEFAULT_ON.has(f.tag) ? true : false);
              return (
                <button
                  key={f.tag}
                  className={`of-chip-toggle${on ? " on" : ""}`}
                  title={f.label}
                  aria-pressed={on}
                  onClick={() => {
                    const next = { ...featureMap };
                    if (DEFAULT_ON.has(f.tag)) {
                      if (on) next[f.tag] = false;
                      else delete next[f.tag];
                    } else if (next[f.tag]) delete next[f.tag];
                    else next[f.tag] = true;
                    w.write({ fontFeatureSettings: featuresToCss(next) }, "OpenType features");
                  }}
                >
                  {f.tag}
                </button>
              );
            })}
          </div>

          {!range ? (
            <>
              <span className="of-hint" style={{ lineHeight: "14px", paddingTop: 4 }}>Stroke</span>
              <div className="of-row">
                <NumberField
                  icon="border"
                  ariaLabel="Text stroke width"
                  value={strokeWidth}
                  placeholder="None"
                  min={0}
                  step={0.5}
                  resolveToken={resolve}
                  tokens={tokenOptions(doc, ["spacing"])}
                  onCommit={(v, key) =>
                    applyStyles(ctx, v === null || v === 0 ? { WebkitTextStroke: null, WebkitTextStrokeWidth: null, WebkitTextStrokeColor: null } : { WebkitTextStroke: null, WebkitTextStrokeWidth: typeof v === "number" ? `${v}px` : v, WebkitTextStrokeColor: strokeColor && strokeColor !== MIXED ? strokeColor : "#000000" }, "Text stroke", key)
                  }
                  style={{ flex: "0 0 80px" }}
                />
                {strokeWidth !== undefined ? (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ColorField value={strokeColor === MIXED ? "#000000" : strokeColor || "#000000"} doc={doc} fileId={ctx.fileId} onChange={(c, mk) => applyStyles(ctx, { WebkitTextStrokeColor: c }, "Stroke colour", mk)} />
                  </div>
                ) : <span style={{ flex: 1 }} />}
              </div>

              <ToggleRow
                  label="Gradient text"
                  on={!!gradient && gradient !== MIXED}
                  onChange={(on) => {
                    const base = computed[nodes[0].id]?.color ?? "#141414";
                    applyStyles(ctx, gradientTextStyles(on ? { angle: 90, from: String(nodes[0].styles.color ?? base), to: "#D97757" } : null), on ? "Gradient text" : "Remove gradient text");
                  }}
                />
              {g ? (
                <>
                  <ColorField value={g.from} doc={doc} fileId={ctx.fileId} onChange={(c, mk) => applyStyles(ctx, gradientTextStyles({ ...g, from: c }), "Gradient text", mk)} />
                  <div className="of-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ColorField value={g.to} doc={doc} fileId={ctx.fileId} onChange={(c, mk) => applyStyles(ctx, gradientTextStyles({ ...g, to: c }), "Gradient text", mk)} />
                    </div>
                    <NumberField icon="rotate" ariaLabel="Gradient angle" value={g.angle} suffix="°" onCommit={(a, mk) => typeof a === "number" && applyStyles(ctx, gradientTextStyles({ ...g, angle: ((a % 360) + 360) % 360 }), "Gradient text", mk)} style={{ flex: "0 0 72px" }} />
                  </div>
                </>
              ) : gradient && gradient !== MIXED ? (
                <span className="of-hint">Custom gradient, edit it in the code or the background value.</span>
              ) : null}

              <div className="of-row" style={{ paddingTop: 4 }}>
                <NumberField
                  label="Lines"
                  ariaLabel="Maximum lines"
                  value={clamp === MIXED ? MIXED : clamp || undefined}
                  placeholder="All"
                  min={0}
                  max={99}
                  allowUnits={false}
                  onCommit={(v, key) => applyStyles(ctx, lineClampStyles(typeof v === "number" ? v : null), "Truncate text", key)}
                />
                <SelectField
                  ariaLabel="Line breaking"
                  value={wrapStyle === MIXED ? "" : (wrapStyle as "auto")}
                  options={[
                    { value: "auto", label: "Normal breaks" },
                    { value: "balance", label: "Balance lines" },
                    { value: "pretty", label: "Avoid orphans" },
                  ]}
                  onChange={(v) => applyStyles(ctx, { textWrap: v === "auto" ? null : v, textWrapStyle: null }, "Line breaking")}
                />
              </div>
              <ToggleRow label="Keep CJK words together" on={keepAll === true} onChange={(on) => applyStyles(ctx, { wordBreak: on ? "keep-all" : null }, "CJK line breaks")} />
            </>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
