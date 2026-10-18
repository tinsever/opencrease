// Border, Outline, Shadow, Filters and Backdrop filters sections.
import { useState } from "react";
import type { StyleValue } from "@opencrease/model";
import { IconButton, MIXED, NumberField, Section, SelectField, useMenu, type FieldValue } from "../../../ui";
import { ColorField } from "../color/ColorField";
import { bordersDiffer, hasBorder, hasOutline, readBorder, readOutline, writeBorder, writeOutline, type BorderValue, type Sides } from "./box";
import { applyStyles, common, styleValue, tokenOptions, tokenResolver, useCtx } from "./common";
import { DEFAULT_SHADOW, FILTER_DEFS, filtersToCss, moveItem, parseFilters, parseShadows, shadowsToCss, type FilterEntry, type FilterName, type Shadow } from "./effects";
import { useReorder } from "./reorder";

const LINE_STYLES = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "double", label: "Double" },
] as const;

const num = (v: FieldValue | null): StyleValue => (v === null ? 0 : v);

// ---------------------------------------------------------------- Border

export function BorderSection() {
  const ctx = useCtx();
  const { doc, nodes, fileId } = ctx;
  const [perSide, setPerSide] = useState(false);
  if (nodes.some((n) => n.type === "SVGElement" || n.type === "SVG")) return null;
  const has = common(nodes, (n) => hasBorder(n.styles));
  const key = common(nodes, (n) => JSON.stringify(readBorder(n.styles)));
  const addBorder = () => applyStyles(ctx, writeBorder({ width: 1, style: "solid", color: "#000000" }), "Add border");
  if (has === false) {
    return <Section title="Border" collapsed onHeaderClick={addBorder} actions={<IconButton icon="plus" iconSize={12} size="xs" label="Add border" onClick={addBorder} />} />;
  }
  const b = readBorder(nodes[0].styles);
  const differ = bordersDiffer(b);
  const expanded = perSide || differ;
  const set = (patch: Partial<BorderValue>, mk?: string) => applyStyles(ctx, (n) => writeBorder({ ...readBorder(n.styles), ...patch }), "Border", mk);
  const setSide = (i: number, w: FieldValue | null, mk?: string) =>
    applyStyles(ctx, (n) => {
      const cur = readBorder(n.styles);
      const widths = [...(cur.widths ?? [cur.width ?? 1, cur.width ?? 1, cur.width ?? 1, cur.width ?? 1])] as Sides<StyleValue | undefined>;
      widths[i] = num(w);
      return writeBorder({ ...cur, widths });
    }, "Border width", mk);
  const sides = ["Top", "Right", "Bottom", "Left"] as const;
  return (
    <Section title="Border" actions={<IconButton icon="minus" iconSize={12} size="xs" label="Remove border" onClick={() => applyStyles(ctx, writeBorder(null), "Remove border")} />}>
      {key === MIXED ? <span className="of-hint">Mixed borders, edits apply to all</span> : null}
      <div className="of-fill-row">
        <ColorField value={b.color ?? "#000000"} doc={doc} fileId={fileId} onChange={(c, mk) => set({ color: c }, mk)} />
        <span className="of-row-slot" style={{ width: 28 }} />
      </div>
      <div className="of-row">
        <NumberField
          icon="border"
          ariaLabel="Border width"
          value={differ ? MIXED : (b.widths?.[0] ?? b.width ?? 1)}
          placeholder="Mixed"
          min={0}
          resolveToken={tokenResolver(doc)}
          tokens={tokenOptions(doc, ["spacing"])}
          onCommit={(w, mk) => set({ width: num(w), widths: undefined }, mk)}
        />
        <SelectField ariaLabel="Border style" value={(b.style ?? "solid") as "solid"} options={[...LINE_STYLES]} onChange={(s) => set({ style: s })} />
        <span className="of-row-slot">
          <IconButton icon="sides" iconSize={14} label="Width per side" active={expanded} onClick={() => setPerSide((s) => !s)} />
        </span>
      </div>
      {expanded ? (
        <div className="of-row tight">
          {sides.map((s, i) => (
            <NumberField key={s} label={s[0]} ariaLabel={`${s} border width`} value={b.widths?.[i] ?? 0} min={0} onCommit={(w, mk) => setSide(i, w, mk)} />
          ))}
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- Outline

export function OutlineSection() {
  const ctx = useCtx();
  const { doc, nodes, fileId } = ctx;
  if (nodes.some((n) => n.type === "SVGElement")) return null;
  const has = common(nodes, (n) => hasOutline(n.styles));
  const add = () => applyStyles(ctx, writeOutline({ width: 2, style: "solid", color: "#2F6FEB" }), "Add outline");
  if (has === false) {
    return <Section title="Outline" collapsed onHeaderClick={add} actions={<IconButton icon="plus" iconSize={12} size="xs" label="Add outline" onClick={add} />} />;
  }
  const o = readOutline(nodes[0].styles);
  const mixed = common(nodes, (n) => JSON.stringify(readOutline(n.styles))) === MIXED;
  const set = (patch: Partial<typeof o>, mk?: string) => applyStyles(ctx, (n) => writeOutline({ ...readOutline(n.styles), ...patch }), "Outline", mk);
  return (
    <Section title="Outline" actions={<IconButton icon="minus" iconSize={12} size="xs" label="Remove outline" onClick={() => applyStyles(ctx, writeOutline(null), "Remove outline")} />}>
      {mixed ? <span className="of-hint">Mixed outlines, edits apply to all</span> : null}
      <div className="of-fill-row">
        <ColorField value={o.color ?? "#000000"} doc={doc} fileId={fileId} onChange={(c, mk) => set({ color: c }, mk)} />
        <span className="of-row-slot" style={{ width: 28 }} />
      </div>
      <div className="of-row">
        <NumberField icon="border" ariaLabel="Outline width" value={o.width ?? 1} min={0} onCommit={(w, mk) => set({ width: num(w) }, mk)} />
        <SelectField ariaLabel="Outline style" value={(o.style ?? "solid") as "solid"} options={[...LINE_STYLES]} onChange={(s) => set({ style: s })} />
        <span className="of-row-slot" />
      </div>
      <div className="of-row">
        <NumberField label="Offset" ariaLabel="Outline offset" value={o.offset ?? 0} onCommit={(v, mk) => set({ offset: num(v) }, mk)} />
        <span style={{ flex: 1 }} />
        <span className="of-row-slot" />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Shadow

export function ShadowSection() {
  const ctx = useCtx();
  const { doc, nodes, fileId } = ctx;
  const text = nodes.every((n) => n.type === "Text");
  const prop = text ? "textShadow" : "boxShadow";
  const raw = styleValue(nodes, prop);
  const mixed = raw === MIXED;
  const list = mixed ? [] : parseShadows(raw);
  const write = (next: Shadow[], label = "Shadow", mk?: string) => applyStyles(ctx, { [prop]: shadowsToCss(next, { text }) }, label, mk);
  const reorder = useReorder(list.length, (from, to) => write(moveItem(list, from, to), "Reorder shadows"));
  if (nodes.some((n) => n.type === "SVGElement")) return null;
  const add = () => write([{ ...DEFAULT_SHADOW }, ...list], "Add shadow");
  return (
    <Section
      title={text ? "Text shadow" : "Shadow"}
      collapsed={!mixed && list.length === 0}
      onHeaderClick={!mixed && list.length === 0 ? add : undefined}
      actions={<IconButton icon="plus" iconSize={12} size="xs" label="Add shadow" onClick={add} />}
    >
      {mixed ? (
        <div className="of-row">
          <span className="of-hint" style={{ flex: 1 }}>Mixed shadows</span>
          <button className="of-btn sm" onClick={() => write([{ ...DEFAULT_SHADOW }])}>Replace all</button>
        </div>
      ) : null}
      {list.map((s, i) => {
        if (s.raw) return (
          <div className="of-row" key={i}>
            <span className="of-mono of-hint" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }} title={s.raw}>{s.raw}</span>
            <IconButton icon="minus" iconSize={12} size="sm" label="Remove shadow" onClick={() => write(list.filter((_, j) => j !== i), "Remove shadow")} />
          </div>
        );
        const upd = (patch: Partial<Shadow>, mk?: string) => write(list.map((x, j) => (j === i ? { ...x, ...patch } : x)), "Shadow", mk);
        const row = reorder.row(i);
        return (
          <div key={i} ref={row.ref} className={row.className} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reorder.grip(i, "Drag to reorder shadows")}
            <div className="of-fill-row">
              <ColorField value={s.color} doc={doc} fileId={fileId} onChange={(c, mk) => upd({ color: c }, mk)} />
              {!text ? (
                <SelectField
                  ariaLabel="Shadow type"
                  value={s.inset ? "inner" : "drop"}
                  options={[
                    { value: "drop", label: "Drop" },
                    { value: "inner", label: "Inner" },
                  ]}
                  onChange={(t) => upd({ inset: t === "inner" })}
                  style={{ flex: "0 0 72px" }}
                />
              ) : null}
              <IconButton icon="minus" iconSize={12} size="sm" label="Remove shadow" onClick={() => write(list.filter((_, j) => j !== i), "Remove shadow")} />
            </div>
            <div className="of-row tight">
              <NumberField label="X" value={s.x} onCommit={(x, mk) => upd({ x: Number(x ?? 0) || 0 }, mk)} />
              <NumberField label="Y" value={s.y} onCommit={(y, mk) => upd({ y: Number(y ?? 0) || 0 }, mk)} />
              <NumberField label="B" ariaLabel="Blur" value={s.blur} min={0} onCommit={(b, mk) => upd({ blur: Number(b ?? 0) || 0 }, mk)} />
              {!text ? <NumberField label="S" ariaLabel="Spread" value={s.spread} onCommit={(sp, mk) => upd({ spread: Number(sp ?? 0) || 0 }, mk)} /> : null}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// ---------------------------------------------------------------- Filters / Backdrop filters

function FilterList({ prop, title }: { prop: "filter" | "backdropFilter"; title: string }) {
  const ctx = useCtx();
  const { nodes } = ctx;
  const [menu, openMenu] = useMenu();
  const raw = common(nodes, (n) => n.styles[prop] ?? (prop === "backdropFilter" ? n.styles.WebkitBackdropFilter : undefined));
  const mixed = raw === MIXED;
  const entries = mixed ? [] : parseFilters(raw);
  const noun = prop === "filter" ? "filter" : "backdrop filter";
  const write = (next: FilterEntry[], mk?: string) =>
    applyStyles(ctx, prop === "filter" ? { filter: filtersToCss(next) } : { backdropFilter: filtersToCss(next), WebkitBackdropFilter: null }, title, mk);
  const addMenu = (anchor: HTMLElement) =>
    openMenu(
      FILTER_DEFS.map((d) => ({
        label: d.label,
        disabled: entries.some((e) => e.name === d.name),
        onSelect: () => write([...entries, { name: d.name, value: prop === "backdropFilter" && d.name === "blur" ? 12 : d.default }]),
      })),
      anchor,
    );
  return (
    <Section title={title} collapsed={!mixed && entries.length === 0} actions={<IconButton icon="plus" iconSize={12} size="xs" label={`Add ${noun}`} onClick={(e) => addMenu(e.currentTarget)} />}>
      {mixed ? (
        <div className="of-row">
          <span className="of-hint" style={{ flex: 1 }}>Mixed {noun}s</span>
          <button className="of-btn sm" onClick={() => write([])}>Clear all</button>
        </div>
      ) : null}
      {entries.map((e, i) => {
        if (e.name === "raw") {
          return (
            <div className="of-row" key={i}>
              <span className="of-mono of-hint" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }} title={e.raw}>{e.raw}</span>
              <IconButton icon="minus" iconSize={12} size="sm" label={`Remove ${noun}`} onClick={() => write(entries.filter((_, j) => j !== i))} />
            </div>
          );
        }
        const def = FILTER_DEFS.find((d) => d.name === e.name)!;
        return (
          <div className="of-row" key={i}>
            <span style={{ width: 76, flexShrink: 0, color: "var(--of-ink-2)", fontSize: "var(--of-text-xs)" }}>{def.label}</span>
            <NumberField
              ariaLabel={`${title}: ${def.label}`}
              value={e.value}
              suffix={def.unit === "px" ? undefined : def.unit === "deg" ? "°" : "%"}
              min={def.min}
              max={def.max}
              allowUnits={false}
              onCommit={(v, mk) => write(entries.map((x, j) => (j === i ? { name: e.name as FilterName, value: Number(v ?? 0) || 0 } : x)), mk)}
            />
            <IconButton icon="minus" iconSize={12} size="sm" label={`Remove ${noun}`} onClick={() => write(entries.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      {menu}
    </Section>
  );
}

export function FiltersSection() {
  return <FilterList prop="filter" title="Filters" />;
}

export function BackdropFiltersSection() {
  const { nodes } = useCtx();
  if (nodes.some((n) => n.type === "SVGElement")) return null;
  return <FilterList prop="backdropFilter" title="Backdrop filters" />;
}
