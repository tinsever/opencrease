// Typography section for Text nodes. While characters are selected in a text being edited, the
// fields read and write that range (rich text spans) instead of the whole node.
import { useState } from "react";
import { type FoldDocument, type OFNode, type StyleMap, type StyleValue, type TextStyle } from "@opencrease/model";
import { NamePopover, runTx } from "../../left/theme-modes";
import { textStyleSummary } from "../../left/TextStylesList";
import { Icon, IconButton, MIXED, NumberField, Section, Segmented, SelectField, formatNumber, useMenu, type FieldValue, type Mixed } from "../../../ui";
import { ColorField } from "../color/ColorField";
import { common, tokenOptions, tokenResolver, useCtx } from "./common";
import { computedColorToHex, primaryFamily, useComputedText } from "./computed";
import { firstFamily, FontPicker } from "./font-picker";
import { textWriter, useTextRange } from "./text-range";

export { COMMON_FONTS, firstFamily } from "./font-picker";

const WEIGHTS: Array<{ value: string; label: string }> = [
  { value: "100", label: "Thin" }, { value: "200", label: "Extra light" }, { value: "300", label: "Light" }, { value: "400", label: "Regular" },
  { value: "500", label: "Medium" }, { value: "600", label: "Semibold" }, { value: "700", label: "Bold" }, { value: "800", label: "Extra bold" },
  { value: "900", label: "Black" },
];

/** Properties a text style bundles. Colour, alignment and layout stay per layer. */
export const TEXT_STYLE_KEYS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textTransform", "textDecoration",
  "fontFeatureSettings", "fontVariationSettings", "fontOpticalSizing",
];

export function weightLabel(v: StyleValue | undefined): string {
  const w = String(v ?? "400").replace("normal", "400").replace("bold", "700");
  return WEIGHTS.find((x) => x.value === w)?.label ?? w;
}

function styleOf(node: OFNode): StyleMap {
  const out: StyleMap = {};
  for (const k of TEXT_STYLE_KEYS) if (node.styles[k] !== undefined) out[k] = node.styles[k];
  return out;
}

/** True when the node changed one of the style's values (or added a typography value of its own). */
export function overridesStyle(node: OFNode, style: TextStyle): boolean {
  return TEXT_STYLE_KEYS.some((k) => (node.styles[k] ?? null) !== (style.styles[k] ?? null));
}

function TextStyleRow({ doc, nodes, fileId, ids }: { doc: FoldDocument; nodes: OFNode[]; fileId: string; ids: string[] }) {
  const [menu, openMenu] = useMenu();
  const [create, setCreate] = useState<DOMRect | null>(null);
  const styles = doc.textStyles ?? [];
  const applied = common(nodes, (n) => n.textStyle ?? "");
  const style = applied !== MIXED && applied ? styles.find((s) => s.id === applied) : undefined;
  const overridden = !!style && nodes.some((n) => overridesStyle(n, style));
  const apply = (id: string | null) =>
    runTx(fileId, id ? "Apply text style" : "Detach text style", (tx) => {
      for (const nid of ids) tx.applyTextStyle(nid, id);
    });

  const open = (anchor: HTMLElement) => {
    openMenu(
      [
        ...(styles.length ? [{ type: "label" as const, label: "Text styles" }] : []),
        ...styles.map((s) => ({ label: s.name, checked: s.id === applied, shortcut: textStyleSummary(doc, s), onSelect: () => void apply(s.id) })),
        ...(styles.length ? [{ type: "separator" as const }] : []),
        { label: "Create style from this text…", disabled: nodes.length !== 1, onSelect: () => setCreate(anchor.getBoundingClientRect()) },
        ...(style
          ? [
              {
                label: `Update ${style.name} to match`,
                disabled: !overridden || nodes.length !== 1,
                onSelect: () => void runTx(fileId, "Update text style", (tx) => tx.updateTextStyle(style.id, { styles: styleOf(nodes[0]) })),
              },
              { label: "Reset to style", disabled: !overridden, onSelect: () => void apply(style.id) },
              { label: "Detach style", onSelect: () => void apply(null) },
            ]
          : []),
      ],
      anchor,
      { minWidth: 236 },
    );
  };

  return (
    <>
      <button className="of-field" style={{ flex: "0 0 28px", border: 0, textAlign: "left", cursor: "default" }} aria-label="Text style" onClick={(e) => open(e.currentTarget)}>
        <Icon name="text" size={12} style={{ color: "var(--of-muted)" }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: style ? undefined : "var(--of-muted)", fontSize: "var(--of-text-sm)" }}>
          {applied === MIXED ? "Mixed styles" : style ? style.name : "No text style"}
        </span>
        {overridden ? <span className="of-field-hint muted" title="Some values differ from the style">Changed</span> : null}
        <Icon name="chevronDown" size={12} style={{ color: "var(--of-muted)" }} />
      </button>
      {create ? (
        <NamePopover
          anchor={create}
          title="New text style"
          hint="Saves this layer's font, size, weight, line height, spacing and features."
          initial={nodes[0]?.name && nodes[0].name !== "Text" ? nodes[0].name : "Body"}
          onClose={() => setCreate(null)}
          onCommit={(name) =>
            runTx(fileId, "Create text style", (tx) => {
              const s = tx.createTextStyle({ name, styles: styleOf(nodes[0]) });
              tx.applyTextStyle(nodes[0].id, s.id);
            })
          }
        />
      ) : null}
      {menu}
    </>
  );
}

export function TypographySection() {
  const ctx = useCtx();
  const { doc, nodes } = ctx;
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const range = useTextRange(ctx);
  const w = textWriter(ctx, range);
  const resolve = tokenResolver(doc);
  const family = w.value("fontFamily");
  const familyToken = typeof family === "string" ? /^var\(\s*--([\w-]+)/.exec(family)?.[1] : undefined;
  const computed = useComputedText(ctx.ids, doc);
  const inheritedFamily = family === undefined;
  const computedFamily = common(nodes, (n) => primaryFamily(computed[n.id]?.fontFamily ?? ""));
  const familyName =
    family === MIXED
      ? "Mixed"
      : familyToken
        ? firstFamily(String(resolve(`--${familyToken}`) ?? familyToken))
        : inheritedFamily
          ? computedFamily === MIXED
            ? "Mixed"
            : computedFamily || "Default"
          : firstFamily(family);
  const authoredWeight = w.value("fontWeight");
  const weightToken = typeof authoredWeight === "string" ? /^var\(\s*(--[\w-]+)/.exec(authoredWeight)?.[1] : undefined;
  const weight = authoredWeight === undefined ? common(nodes, (n) => computed[n.id]?.fontWeight ?? "400") : weightToken ? (resolve(weightToken) ?? "400") : authoredWeight;
  const computedSize = common(nodes, (n) => (computed[n.id] ? String(Math.round(Number.parseFloat(computed[n.id].fontSize) * 100) / 100) : "16"));
  const align = common(nodes, (n) => String(n.styles.textAlign ?? "left"));
  const transform = common(nodes, (n) => String(n.styles.textTransform ?? "none"));
  const decorationRaw = range ? w.value("textDecoration") : common(nodes, (n) => String(n.styles.textDecoration ?? n.styles.textDecorationLine ?? "none"));
  const decoration = decorationRaw === MIXED ? MIXED : String(decorationRaw ?? "none");
  const italic = w.value("fontStyle");
  const weightTokens = doc.tokens.filter((t) => t.type === "fontWeight");
  const [menu, openMenu] = useMenu();

  const lh = w.value("lineHeight");
  const ls = w.value("letterSpacing");
  const lsDisplay: FieldValue | Mixed | undefined = ls === MIXED || ls === undefined ? ls : /em$/.test(String(ls)) ? `${formatNumber(Number.parseFloat(String(ls)) * 100, 1)}%` : ls;

  const setDecoration = (kind: "underline" | "line-through") => {
    const on = decoration !== MIXED && decoration.includes(kind);
    if (range) w.write({ textDecoration: on ? "none" : kind }, on ? "Remove decoration" : "Text decoration");
    else w.write({ textDecoration: on ? null : kind, textDecorationLine: null }, on ? "Remove decoration" : "Text decoration");
  };
  const color = w.value("color");
  const rangeColor = range ? (color === MIXED ? "" : color !== undefined ? String(color) : computed[range.node.id] ? computedColorToHex(computed[range.node.id].color) : "#000000") : "";

  return (
    <Section title={range ? "Typography (selected text)" : "Typography"}>
      {range ? (
        <div className="of-range-banner" role="status">
          <span>
            Styling {range.end - range.start} selected {range.end - range.start === 1 ? "character" : "characters"}
          </span>
        </div>
      ) : (
        <TextStyleRow doc={doc} nodes={nodes} fileId={ctx.fileId} ids={ctx.ids} />
      )}
      <button className="of-field" style={{ flex: "0 0 28px", cursor: "default", border: 0, textAlign: "left" }} onClick={(e) => setPicker(e.currentTarget)} aria-label="Font family">
        <span
          style={{
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: `"${familyName}", var(--of-font-sans)`, fontSize: 14, lineHeight: "16px",
            color: inheritedFamily ? "var(--of-muted)" : undefined,
          }}
          title={inheritedFamily ? "Inherited from a parent layer or the browser default. Pick a font to set it on this layer." : undefined}
        >
          {familyName}
        </span>
        {familyToken ? <span className="of-field-hint">{familyToken}</span> : inheritedFamily ? <span className="of-field-hint muted" style={{ fontFamily: "var(--of-font-sans)" }}>Inherited</span> : null}
        <Icon name="chevronDown" size={12} style={{ color: "var(--of-muted)" }} />
      </button>
      <div className="of-row">
        <div style={{ position: "relative", display: "flex", flex: 1, minWidth: 0 }}>
          <SelectField
            ariaLabel="Font weight"
            value={weight === MIXED ? "" : String(weight ?? "400").replace("normal", "400").replace("bold", "700")}
            options={WEIGHTS}
            onChange={(v) => w.write({ fontWeight: Number(v) }, "Font weight")}
            style={{ fontSize: "var(--of-text-sm)", color: authoredWeight === undefined ? "var(--of-muted)" : undefined, flex: 1, minWidth: 0 }}
          />
          {weightToken ? (
            <button type="button" className="of-field-hint of-weight-token" title={`Token ${weightToken}`} onClick={(e) => openMenu([...weightTokens.map((t) => ({ label: t.name.slice(2), checked: t.name === weightToken, onSelect: () => w.write({ fontWeight: `var(${t.name})` }, "Font weight") })), { type: "separator" }, { label: "Detach token", onSelect: () => w.write({ fontWeight: Number(resolve(weightToken)) || 400 }, "Detach token") }], e.currentTarget)}>
              {weightToken.slice(2)}
            </button>
          ) : weightTokens.length ? (
            <button type="button" className="of-field-hint muted of-token-pick of-weight-token" aria-label="Use a weight token" title="Use a token" onClick={(e) => openMenu(weightTokens.map((t) => ({ label: `${t.name.slice(2)}  ${t.value}`, onSelect: () => w.write({ fontWeight: `var(${t.name})` }, "Font weight") })), e.currentTarget)}>
              <Icon name="tokens" size={11} />
            </button>
          ) : null}
        </div>
        <NumberField
          ariaLabel="Font size"
          value={w.value("fontSize")}
          placeholder={computedSize === MIXED ? "Mixed" : computedSize}
          min={1}
          resolveToken={resolve}
          tokens={tokenOptions(doc, ["fontSize"])}
          onCommit={(s, key) => w.write({ fontSize: s }, "Font size", key)}
        />
      </div>
      <div className="of-row">
        <NumberField
          icon="lineHeight"
          ariaLabel="Line height"
          value={lh}
          placeholder="Auto"
          step={1}
          min={0}
          resolveToken={resolve}
          tokens={tokenOptions(doc, ["lineHeight"])}
          onCommit={(x, key) => {
            const n = typeof x === "number" ? x : null;
            w.write({ lineHeight: n === null ? x : n < 4 ? n : `${n}px` }, "Line height", key);
          }}
        />
        <NumberField
          icon="letterSpacing"
          ariaLabel="Letter spacing"
          value={lsDisplay}
          placeholder="0"
          step={0.5}
          resolveToken={resolve}
          tokens={tokenOptions(doc, ["letterSpacing"])}
          onCommit={(x, key) => {
            let out: StyleValue | null = x;
            if (typeof x === "string" && /%$/.test(x)) out = `${Number.parseFloat(x) / 100}em`;
            if (x === 0) out = null;
            w.write({ letterSpacing: out }, "Letter spacing", key);
          }}
        />
      </div>
      {range ? (
        <div className="of-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <ColorField value={rangeColor || "#000000"} doc={doc} fileId={ctx.fileId} onChange={(c, mk) => w.write({ color: c }, "Text colour", mk ? `range-color:${mk}` : undefined)} />
          </div>
        </div>
      ) : (
        <div className="of-row">
          <Segmented
            ariaLabel="Text align"
            value={align === MIXED ? null : align === "start" ? "left" : align === "end" ? "right" : align}
            onChange={(a) => w.write({ textAlign: a === "left" ? null : a }, "Text align")}
            options={[
              { value: "left", icon: "alignLeft", title: "Align left" },
              { value: "center", icon: "alignCenter", title: "Align center" },
              { value: "right", icon: "alignRight", title: "Align right" },
              { value: "justify", icon: "alignJustify", title: "Justify" },
            ]}
          />
          <Segmented
            className="auto"
            ariaLabel="Letter case"
            value={transform === MIXED ? null : transform}
            onChange={(t) => w.write({ textTransform: transform === t || t === "none" ? null : t }, "Letter case")}
            options={[
              { value: "capitalize", label: <span style={{ fontSize: 10, fontWeight: 600 }}>Aa</span>, title: "Capitalize" },
              { value: "uppercase", label: <span style={{ fontSize: 10, fontWeight: 600 }}>AA</span>, title: "Uppercase" },
              { value: "lowercase", label: <span style={{ fontSize: 10, fontWeight: 600 }}>aa</span>, title: "Lowercase" },
            ]}
          />
        </div>
      )}
      <div className="of-row tight">
        <button
          type="button"
          className={`of-icon-btn sm${italic === "italic" ? " active" : ""}`}
          aria-label="Italic"
          aria-pressed={italic === "italic"}
          title="Italic (⌘I)"
          onClick={() => w.write({ fontStyle: italic === "italic" ? (range ? "normal" : null) : "italic" }, "Italic")}
        >
          <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 13, lineHeight: 1 }}>I</span>
        </button>
        <IconButton icon="underline" iconSize={12} size="sm" label="Underline" active={decoration !== MIXED && decoration.includes("underline")} onClick={() => setDecoration("underline")} />
        <IconButton icon="strike" iconSize={12} size="sm" label="Strikethrough" active={decoration !== MIXED && decoration.includes("line-through")} onClick={() => setDecoration("line-through")} />
        <span style={{ flex: 1 }} />
        {!range ? (
          <SelectField
            ariaLabel="Wrapping"
            value={common(nodes, (n) => String(n.styles.whiteSpace ?? "pre-wrap")) === MIXED ? "" : (String(nodes[0].styles.whiteSpace ?? "pre-wrap") as "pre-wrap" | "nowrap" | "pre")}
            options={[
              { value: "pre-wrap", label: "Wrap" },
              { value: "nowrap", label: "No wrap" },
              { value: "pre", label: "Keep lines" },
            ]}
            onChange={(v) => w.write({ whiteSpace: v === "pre-wrap" ? null : v }, "Text wrapping")}
            style={{ flex: "0 0 104px" }}
          />
        ) : null}
      </div>
      {picker ? (
        <FontPicker
          anchor={picker}
          current={familyName}
          doc={doc}
          onClose={() => setPicker(null)}
          onPick={(f, isToken) => {
            w.write({ fontFamily: isToken ? f : /\s/.test(f) && !/^(system-ui|serif|sans-serif|monospace)$/.test(f) ? `"${f}"` : f }, "Font family");
            setPicker(null);
          }}
        />
      ) : null}
      {menu}
    </Section>
  );
}
