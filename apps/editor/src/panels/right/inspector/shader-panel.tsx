// Shader picker and the param panel generated from each shader's schema. Shared by the Shader
// section (Shader nodes) and the shader fill editor.
import { useRef, useState, type ReactNode } from "react";
import type { FoldDocument, ShaderSpec } from "@opencrease/model";
import { resolveSrc } from "../../../state/api";
import { Icon, IconButton, SelectField, Toggle } from "../../../ui";
import { ColorDot, ColorField } from "../color/ColorField";
import { pickImage } from "./pick-image";
import { defaultParams, paramValue, shaderDef, shaderDefs, shaderLabel, type ParamDef } from "./shader-schema";

/** Tiles shown first in the picker; every other shader is in the "All shaders" list. */
const FEATURED = ["MeshGradient", "GrainGradient", "LiquidMetal", "HalftoneDots", "StaticMeshGradient", "Warp", "GodRays", "Dithering"];

export function shaderSwatch(spec: ShaderSpec | undefined): string {
  const params = { ...defaultParams(spec?.name ?? "MeshGradient"), ...(spec?.params ?? {}) };
  const colors = (params.colors as string[] | undefined) ?? [];
  if (colors.length >= 2) return `linear-gradient(135deg, ${colors.slice(0, 5).join(", ")})`;
  const back = (params.colorBack ?? params.colorTint) as string | undefined;
  const front = ((params.colorFront ?? params.colorHighlight ?? params.colorFill) as string | undefined) ?? colors[0];
  if (front && back) return `linear-gradient(135deg, ${back}, ${front})`;
  return "linear-gradient(135deg, #d8d6cf, #8b8a85)";
}

export function newShaderSpec(name: string): ShaderSpec {
  return { name, params: defaultParams(name) };
}

export function ShaderPicker({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const defs = shaderDefs();
  const featured = FEATURED.filter((n) => defs.some((d) => d.name === n));
  return (
    <>
      <div className="of-shader-grid">
        {featured.map((n) => (
          <button key={n} className={`of-shader-tile${n === value ? " on" : ""}`} title={shaderLabel(n)} onClick={() => n !== value && onPick(n)}>
            <span className="sw" style={{ background: shaderSwatch({ name: n, params: {} }) }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shaderLabel(n).replace(/ gradient$/, "")}</span>
          </button>
        ))}
      </div>
      <SelectField
        ariaLabel="All shaders"
        value={featured.includes(value) ? "" : value}
        placeholder={`All shaders (${defs.length})`}
        options={defs.map((d) => ({ value: d.name, label: d.takesImage ? `${d.label} (image)` : d.label }))}
        onChange={(n) => n !== value && onPick(n)}
      />
    </>
  );
}

export function ShaderPresets({ spec, onChange }: { spec: ShaderSpec; onChange: (s: ShaderSpec) => void }) {
  const def = shaderDef(spec.name);
  if (!def || def.presets.length < 2) return null;
  return (
    <SelectField
      ariaLabel="Preset"
      value=""
      placeholder="Apply a preset"
      options={def.presets.map((p) => ({ value: p.name, label: p.name }))}
      onChange={(p) => {
        const preset = def.presets.find((x) => x.name === p);
        if (!preset) return;
        // presets never carry the image; keep the current one
        const image = spec.params.image;
        onChange({ ...spec, params: { ...defaultParams(spec.name), ...preset.params, ...(image ? { image } : {}) } });
      }}
    />
  );
}

/** Param rows for a shader, generated from its schema. Unknown params set by agents are listed too. */
export function ShaderParams({ spec, onChange, doc, fileId }: { spec: ShaderSpec; onChange: (s: ShaderSpec, mergeKey?: string) => void; doc: FoldDocument; fileId: string }) {
  const [showPlacement, setShowPlacement] = useState(false);
  const def = shaderDef(spec.name);
  const set = (k: string, v: unknown, mk?: string) => onChange({ ...spec, params: { ...spec.params, [k]: v } }, mk);
  if (!def) {
    return <span className="of-hint">This shader is not in the installed shader library, so its parameters cannot be edited. It renders as a placeholder.</span>;
  }
  const main = def.params.filter((p) => p.group === "main");
  const placement = def.params.filter((p) => p.group === "placement");
  const known = new Set(def.params.map((p) => p.key));
  const extra = Object.keys(spec.params).filter((k) => !known.has(k) && !["frame", "originX", "originY", "worldWidth", "worldHeight", "margin"].includes(k));
  return (
    <>
      {main.map((p) => (
        <ParamRow key={p.key} def={p} value={paramValue(p, spec.params)} set={set} doc={doc} fileId={fileId} />
      ))}
      {extra.map((k) => (
        <div className="of-param-row" key={k}>
          <span className="plabel" title={k}>{k}</span>
          <span className="of-mono of-hint" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(spec.params[k])}</span>
        </div>
      ))}
      {placement.length ? (
        <button className="of-disclosure" onClick={() => setShowPlacement((s) => !s)} aria-expanded={showPlacement}>
          <Icon name={showPlacement ? "chevronDown" : "chevronRight"} size={10} />
          Placement
        </button>
      ) : null}
      {showPlacement
        ? placement.map((p) => <ParamRow key={p.key} def={p} value={paramValue(p, spec.params)} set={set} doc={doc} fileId={fileId} />)
        : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="of-param-row">
      <span className="plabel" title={label}>{label}</span>
      {children}
    </div>
  );
}

let sliderSession = 0;

function SliderParam({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number, mk?: string) => void }) {
  const mergeKey = useRef<string | undefined>(undefined);
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (
    <Row label={label}>
      <input
        type="range"
        className="of-slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${((value - min) / (max - min || 1)) * 100}%`, flex: 1 }}
        onPointerDown={() => { mergeKey.current = `shader-${++sliderSession}`; }}
        onPointerUp={() => { mergeKey.current = undefined; }}
        onKeyDown={(e) => { if (!e.repeat) mergeKey.current = `shader-${++sliderSession}`; }}
        onKeyUp={() => { mergeKey.current = undefined; }}
        onChange={(e) => onChange(Number(e.target.value), mergeKey.current)}
      />
      <input
        className="pval"
        aria-label={`${label} value`}
        defaultValue={`${Number(value.toFixed(digits))}${suffix}`}
        key={String(value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const n = Number(e.target.value.replace(suffix, "").trim());
          if (Number.isFinite(n) && n !== value) onChange(n);
        }}
      />
    </Row>
  );
}

function ParamRow({ def, value, set, doc, fileId }: { def: ParamDef; value: unknown; set: (k: string, v: unknown, mk?: string) => void; doc: FoldDocument; fileId: string }) {
  switch (def.kind) {
    case "number":
      return <SliderParam label={def.label} value={Number(value) || 0} min={def.min} max={def.max} step={def.step} onChange={(v, mk) => set(def.key, v, mk)} />;
    case "angle":
      return <SliderParam label={def.label} value={Number(value) || 0} min={0} max={360} step={1} suffix="°" onChange={(v, mk) => set(def.key, v, mk)} />;
    case "boolean":
      return (
        <Row label={def.label}>
          <span style={{ flex: 1 }} />
          <Toggle on={Boolean(value)} label={def.label} onChange={(v) => set(def.key, v)} />
        </Row>
      );
    case "enum":
      return (
        <Row label={def.label}>
          <SelectField ariaLabel={def.label} value={String(value)} options={def.options.map((o) => ({ value: o, label: o }))} onChange={(o) => set(def.key, o)} style={{ flex: 1 }} />
        </Row>
      );
    case "color":
      return (
        <Row label={def.label}>
          <ColorField value={String(value)} doc={doc} fileId={fileId} nested onChange={(c, mk) => set(def.key, c, mk)} />
        </Row>
      );
    case "colors": {
      const colors = Array.isArray(value) ? (value as string[]) : def.default;
      return (
        <Row label={def.label}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, alignItems: "center" }}>
            {colors.map((c, i) => (
              <span
                key={i}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (colors.length > 1) set(def.key, colors.filter((_, j) => j !== i));
                }}
              >
                <ColorDot label={`${def.label} ${i + 1}. Right-click to remove`} value={c} doc={doc} fileId={fileId} onChange={(nc, mk) => set(def.key, colors.map((x, j) => (j === i ? nc : x)), mk)} />
              </span>
            ))}
            {colors.length < def.max ? (
              <button className="of-color-dot add" aria-label="Add colour" title={`Add colour (up to ${def.max})`} onClick={() => set(def.key, [...colors, colors[colors.length - 1] ?? "#ffffff"])}>
                <Icon name="plus" size={10} />
              </button>
            ) : null}
          </div>
        </Row>
      );
    }
    case "image": {
      const src = typeof value === "string" ? value : "";
      const url = src ? resolveSrc(fileId, src) : undefined;
      return (
        <Row label={def.label}>
          <div className="of-fill-chip" style={{ flex: 1 }}>
            <button className="swatch-btn" aria-label={src ? "Replace image" : "Choose image"} title={src ? "Replace image" : "Choose image"} onClick={() => pickImage(fileId, (img) => set(def.key, img.ref))}>
              {url ? <i style={{ background: `center / cover no-repeat url("${url}")` }} /> : null}
            </button>
            <button className="ftext sans" onClick={() => pickImage(fileId, (img) => set(def.key, img.ref))} style={{ color: src ? undefined : "var(--of-muted)" }}>
              {src ? (doc.assets[src.replace("asset://", "")]?.name ?? "Image") : def.required ? "Choose an image" : "No image"}
            </button>
            {src ? <IconButton icon="close" iconSize={10} size="xs" label="Remove image" onClick={() => set(def.key, "")} /> : null}
          </div>
        </Row>
      );
    }
  }
}

/** Code for a shader, with the import line. */
export function shaderSnippet(spec: ShaderSpec, opts: { fill?: boolean } = {}): string {
  const hidden = new Set(["frame", "originX", "originY", "worldWidth", "worldHeight"]);
  const props = Object.entries(spec.params)
    .filter(([k, v]) => !hidden.has(k) && v !== undefined && v !== "")
    .map(([k, v]) => (typeof v === "string" ? `  ${k}={${JSON.stringify(v)}}` : `  ${k}={${JSON.stringify(v)}}`));
  const style = opts.fill ? `  style={{ position: "absolute", inset: 0, zIndex: -1, borderRadius: "inherit", overflow: "hidden", pointerEvents: "none" }}` : `  style={{ width: "100%", height: "100%" }}`;
  return `import { ${spec.name} } from "@paper-design/shaders-react";\n\n<${spec.name}\n${[...props, style].join("\n")}\n/>`;
}
