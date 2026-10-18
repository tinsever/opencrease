// Selection colours, Clip and mask, and Other styles sections.
import { useRef, useState } from "react";
import { camelToKebab } from "@opencrease/css";
import type { StyleValue } from "@opencrease/model";
import { getOpenFile } from "../../../state/workspace";
import { IconButton, MIXED, Section, SelectField, useMenu } from "../../../ui";
import { ColorField } from "../color/ColorField";
import { applyStyles, common, styleValue, useCtx } from "./common";
import { addableProps, otherStyles, parseRawStyle } from "./other-styles";
import { pickImage } from "./pick-image";
import { collectColors, colorKey, replaceInParams, replaceInValue, type ColorGroup } from "./selection-colors";

// ---------------------------------------------------------------- Selection colours

const SHOWN = 6;

export function SelectionColorsSection() {
  const ctx = useCtx();
  const { doc, nodes, fileId, ids } = ctx;
  const editingKeys = useRef(new Map<string, string>());
  const [all, setAll] = useState(false);
  const groups = collectColors(doc, ids);
  if (groups.length === 0) return null;

  const replace = (g: ColorGroup, next: string, mk?: string) => {
    const file = getOpenFile(fileId);
    if (!file) return;
    const sourceKey = mk ? editingKeys.current.get(mk) ?? g.key : g.key;
    try {
      file.store.transact(
        "Selection colour",
        (tx) => {
          for (const use of g.uses) {
            const node = tx.doc.nodes[use.nodeId];
            if (!node || node.locked) continue;
            if (use.kind === "style") {
              const v = node.styles[use.prop];
              if (typeof v === "string") tx.setStyles(node.id, { [use.prop]: replaceInValue(v, sourceKey, next) });
            } else if (use.kind === "attr") {
              const v = node.attrs?.[use.prop];
              if (v) tx.updateNode(node.id, { attrs: { ...node.attrs, [use.prop]: replaceInValue(v, sourceKey, next) } });
            } else if (use.kind === "hidden" && node.paint?.hiddenFills) {
              const hiddenFills = node.paint.hiddenFills.map((h, i) => i === Number(use.prop) ? { ...h, css: replaceInValue(h.css, sourceKey, next) } : h);
              tx.updateNode(node.id, { paint: { ...node.paint, hiddenFills } });
            } else if (use.kind === "shader" && use.fill && node.paint?.shader) {
              const s = node.paint.shader;
              tx.updateNode(node.id, { paint: { ...node.paint, shader: { ...s, params: replaceInParams(s.params, use.prop, sourceKey, next) } } });
            } else if (use.kind === "shader" && !use.fill && node.shader) {
              tx.updateNode(node.id, { shader: { ...node.shader, params: replaceInParams(node.shader.params, use.prop, sourceKey, next) } });
            }
          }
        },
        { mergeKey: mk },
      );
      if (mk) {
        if (editingKeys.current.size > 64) editingKeys.current.clear();
        editingKeys.current.set(mk, colorKey(next));
      }
    } catch (e) {
      console.warn("Selection colour", e);
    }
  };

  const list = all ? groups : groups.slice(0, SHOWN);
  return (
    <Section title="Selection colours">
      {list.map((g, i) => (
        <div className="of-fill-row" key={i}>
          <ColorField value={g.color} doc={doc} fileId={fileId} onChange={(c, mk) => replace(g, c, mk)} />
          <span className="of-row-slot of-use-count" title={`Used ${g.uses.length} ${g.uses.length === 1 ? "time" : "times"}`}>
            {g.uses.length}
          </span>
        </div>
      ))}
      {groups.length > SHOWN ? (
        <button className="of-disclosure" onClick={() => setAll((s) => !s)}>
          {all ? "Show fewer" : `Show all ${groups.length} colours`}
        </button>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- Clip and mask

const CLIP_PRESETS = [
  { value: "inset(0 round 16px)", label: "Rounded inset" },
  { value: "circle(50%)", label: "Circle" },
  { value: "ellipse(50% 50%)", label: "Ellipse" },
  { value: "polygon(50% 0%, 100% 100%, 0% 100%)", label: "Triangle" },
  { value: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)", label: "Hexagon" },
  { value: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", label: "Diamond" },
];

const MASK_PRESETS = [
  { value: "linear-gradient(180deg, black 60%, transparent)", label: "Fade out bottom" },
  { value: "linear-gradient(0deg, black 60%, transparent)", label: "Fade out top" },
  { value: "linear-gradient(90deg, transparent, black 15%, black 85%, transparent)", label: "Fade out sides" },
  { value: "radial-gradient(closest-side, black 60%, transparent)", label: "Vignette" },
];

function RawInput({ value, onCommit, ariaLabel, placeholder }: { value: string; onCommit: (v: string) => void; ariaLabel: string; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      className="of-textfield of-mono-field"
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={false}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(value);
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => {
        if (!cancelled.current && draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function ClipMaskSection() {
  const ctx = useCtx();
  const { nodes, fileId } = ctx;
  const [menu, openMenu] = useMenu();
  if (nodes.some((n) => n.type === "SVGElement")) return null;
  const clip = styleValue(nodes, "clipPath");
  const mask = common(nodes, (n) => String(n.styles.maskImage ?? n.styles.WebkitMaskImage ?? ""));
  const hasClip = clip !== undefined;
  const hasMask = mask !== "";
  const setClip = (v: string | null) => applyStyles(ctx, { clipPath: v }, v ? "Clip path" : "Remove clip path");
  const setMask = (v: string | null, extra: Record<string, StyleValue | null> = {}) =>
    applyStyles(ctx, { maskImage: v, WebkitMaskImage: null, ...(v ? extra : { maskSize: null, maskRepeat: null, maskPosition: null }) }, v ? "Mask" : "Remove mask");
  const add = (anchor: HTMLElement) =>
    openMenu(
      [
        { label: "Clip path", disabled: hasClip, onSelect: () => setClip(CLIP_PRESETS[0].value) },
        { label: "Gradient mask", disabled: hasMask, onSelect: () => setMask(MASK_PRESETS[0].value) },
        {
          label: "Image mask",
          disabled: hasMask,
          onSelect: () => pickImage(fileId, (img) => setMask(`url("${img.url}")`, { maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" })),
        },
      ],
      anchor,
    );
  return (
    <Section title="Clip and mask" collapsed={!hasClip && !hasMask} actions={<IconButton icon="plus" iconSize={12} size="xs" label="Add clip path or mask" onClick={(e) => add(e.currentTarget)} />}>
      {hasClip ? (
        <>
          <div className="of-row">
            <SelectField
              label="Clip"
              ariaLabel="Clip path shape"
              value={clip === MIXED ? "" : (CLIP_PRESETS.find((p) => p.value === clip)?.value ?? "")}
              placeholder={clip === MIXED ? "Mixed" : "Custom"}
              options={CLIP_PRESETS}
              onChange={setClip}
            />
            <span className="of-row-slot">
              <IconButton icon="minus" iconSize={12} size="sm" label="Remove clip path" onClick={() => setClip(null)} />
            </span>
          </div>
          <RawInput ariaLabel="Clip path value" value={clip === MIXED ? "" : String(clip)} placeholder="inset(), circle(), polygon()" onCommit={(v) => setClip(v.trim() || null)} />
        </>
      ) : null}
      {hasMask ? (
        <>
          <div className="of-row">
            <SelectField
              label="Mask"
              ariaLabel="Mask preset"
              value={mask === MIXED ? "" : (MASK_PRESETS.find((p) => p.value === mask)?.value ?? "")}
              placeholder={mask === MIXED ? "Mixed" : /^url\(/.test(String(mask)) ? "Image" : "Custom"}
              options={MASK_PRESETS}
              onChange={(v) => setMask(v)}
            />
            <span className="of-row-slot">
              <IconButton icon="minus" iconSize={12} size="sm" label="Remove mask" onClick={() => setMask(null)} />
            </span>
          </div>
          <RawInput ariaLabel="Mask image value" value={mask === MIXED ? "" : mask} placeholder="linear-gradient(), url()" onCommit={(v) => setMask(v.trim() || null)} />
        </>
      ) : null}
      {menu}
    </Section>
  );
}

// ---------------------------------------------------------------- Other styles

export function OtherStylesSection() {
  const ctx = useCtx();
  const { nodes } = ctx;
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keys = [...new Set(nodes.flatMap((n) => otherStyles(n.styles).map(([k]) => k)))];
  const commitNew = () => {
    const r = parseRawStyle(newKey, newValue);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    applyStyles(ctx, { [r.key]: r.value }, `Set ${r.key}`);
    setNewKey("");
    setNewValue("");
    setError(null);
    setAdding(false);
  };
  return (
    <Section title="Other styles" collapsed={keys.length === 0 && !adding} onHeaderClick={keys.length === 0 && !adding ? () => setAdding(true) : undefined} actions={<IconButton icon="plus" iconSize={12} size="xs" label="Add style" onClick={() => setAdding(true)} />}>
      {keys.map((k) => {
        const v = styleValue(nodes, k);
        return (
          <div className="of-kv-row" key={k}>
            <span className="of-kv-key" title={camelToKebab(k)}>{camelToKebab(k)}</span>
            <RawInput
              ariaLabel={`${k} value`}
              value={v === MIXED ? "" : v === undefined ? "" : String(v)}
              placeholder={v === MIXED ? "Mixed" : ""}
              onCommit={(nv) => {
                if (!nv.trim()) return applyStyles(ctx, { [k]: null }, `Remove ${k}`);
                const r = parseRawStyle(k, nv);
                if (!("error" in r)) applyStyles(ctx, { [r.key]: r.value }, `Set ${k}`);
              }}
            />
            <IconButton icon="minus" iconSize={12} size="sm" label={`Remove ${k}`} onClick={() => applyStyles(ctx, { [k]: null }, `Remove ${k}`)} />
          </div>
        );
      })}
      {adding ? (
        <>
          <div className="of-kv-row">
            <input
              className="of-textfield of-mono-field of-kv-key-input"
              aria-label="Property"
              placeholder="property"
              list="of-other-style-props"
              autoFocus
              spellCheck={false}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <input
              className="of-textfield of-mono-field"
              aria-label="Value"
              placeholder="value"
              spellCheck={false}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitNew();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <IconButton icon="check" iconSize={12} size="sm" label="Apply style" onClick={commitNew} />
          </div>
          <datalist id="of-other-style-props">
            {addableProps(nodes[0].styles).map((p) => (
              <option key={p} value={camelToKebab(p)} />
            ))}
          </datalist>
          {error ? <span className="of-hint" style={{ color: "var(--of-danger)" }}>{error}</span> : <span className="of-hint">Any supported CSS property without its own panel, for example z-index or aspect-ratio.</span>}
        </>
      ) : null}
    </Section>
  );
}
