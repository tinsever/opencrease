import type { NodeTree, StyleMap } from "@opencrease/model";
import { decodeFigmaHtml, type KiwiRecord } from "./figma-kiwi";

const obj = (v: unknown): KiwiRecord => v && typeof v === "object" ? v as KiwiRecord : {};
const list = (v: unknown): KiwiRecord[] => Array.isArray(v) ? v.map(obj) : [];
const num = (v: unknown, fallback = 0): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const guid = (v: unknown): string => { const g = obj(v); return `${g.sessionID}:${g.localID}`; };
const align = (v: unknown): string => ({ MIN: "flex-start", MAX: "flex-end", CENTER: "center", STRETCH: "stretch", BASELINE: "baseline", SPACE_BETWEEN: "space-between", SPACE_EVENLY: "space-evenly" })[String(v)] ?? "flex-start";

function color(v: unknown, opacity = 1): string {
  const c = obj(v);
  return `rgba(${Math.round(num(c.r) * 255)}, ${Math.round(num(c.g) * 255)}, ${Math.round(num(c.b) * 255)}, ${num(c.a, 1) * opacity})`;
}

/** Figma path blobs: a one-byte opcode followed by little-endian float32 coordinates. */
export function pathData(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commands: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const op = bytes[offset++];
    const count = [0, 2, 2, 4, 6][op];
    if (count === undefined || offset + count * 4 > bytes.length) throw new Error("Unsupported Figma vector path.");
    const coords = Array.from({ length: count }, () => {
      const n = view.getFloat32(offset, true);
      offset += 4;
      if (!Number.isFinite(n)) throw new Error("Invalid Figma path coordinate.");
      return Math.round(n * 1000) / 1000;
    });
    commands.push(["Z", "M", "L", "Q", "C"][op] + coords.join(" "));
  }
  return commands.join(" ");
}

function imageUrl(bytes: Uint8Array): string | undefined {
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP" ? "image/webp" : undefined;
  if (!mime) return undefined;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

export function figmaMessageToTrees(message: KiwiRecord): { trees: NodeTree[]; warnings: string[] } {
  const warnings = new Set<string>();
  const warn = (s: string) => warnings.add(s);
  const records = list(message.nodeChanges).filter((n) => n.phase !== "REMOVED" && n.type !== "DOCUMENT" && n.type !== "CANVAS");
  if (records.length > 20_000) throw new Error("The Figma selection contains too many layers.");
  const byId = new Map(records.map((n) => [guid(n.guid), n]));
  if (byId.size !== records.length || records.some((n) => obj(n.guid).localID === undefined)) throw new Error("Invalid or repeated Figma layer IDs.");
  const children = new Map<string, KiwiRecord[]>();
  for (const n of records) {
    const parent = guid(obj(n.parentIndex).guid);
    const siblings = children.get(parent) ?? [];
    siblings.push(n);
    children.set(parent, siblings);
  }
  for (const nodes of children.values()) nodes.sort((a, b) => { const x = String(obj(a.parentIndex).position ?? ""); const y = String(obj(b.parentIndex).position ?? ""); return x < y ? -1 : x > y ? 1 : 0; });
  const blobs = list(message.blobs);
  const blob = (index: unknown): Uint8Array | undefined => typeof index === "number" && blobs[index]?.bytes instanceof Uint8Array ? blobs[index].bytes as Uint8Array : undefined;
  const active = new Set<KiwiRecord>();
  const converted = new Set<KiwiRecord>();

  const convert = (n: KiwiRecord, inFlex = false, depth = 0): NodeTree => {
    if (active.has(n) || depth > 100) throw new Error("Invalid Figma layer hierarchy.");
    active.add(n);
    const size = obj(n.size);
    const matrix = obj(n.transform);
    const styles: StyleMap = { width: num(size.x, 100), height: num(size.y, 100), flexShrink: 0 };
    if (!inFlex || n.stackPositioning === "ABSOLUTE") Object.assign(styles, { position: "absolute", left: num(matrix.m02), top: num(matrix.m12) });
    if (num(matrix.m00, 1) !== 1 || num(matrix.m11, 1) !== 1 || num(matrix.m01) !== 0 || num(matrix.m10) !== 0) {
      styles.transform = `matrix(${num(matrix.m00, 1)},${num(matrix.m10)},${num(matrix.m01)},${num(matrix.m11, 1)},0,0)`;
      styles.transformOrigin = "0 0";
    }
    if (typeof n.opacity === "number") styles.opacity = n.opacity;
    if (typeof n.cornerRadius === "number") styles.borderRadius = n.cornerRadius;
    if (n.frameMaskDisabled === false) styles.overflow = "hidden";
    if (n.visible === false) styles.display = "none";
    const paints = list(n.fillPaints).filter((p) => p.visible !== false);
    const paint = paints[paints.length - 1];
    if (paints.length > 1) warn("Multiple Figma fills use the topmost paint.");
    if (paint?.type === "SOLID") styles[n.type === "TEXT" ? "color" : "backgroundColor"] = color(paint.color, num(paint.opacity, 1));
    else if (paint && paint.type !== "IMAGE") warn("Figma gradient and pattern fills are not converted.");
    const stroke = list(n.strokePaints).find((p) => p.type === "SOLID" && p.visible !== false);
    if (stroke) styles.border = `${num(n.strokeWeight, 1)}px solid ${color(stroke.color, num(stroke.opacity, 1))}`;
    if (list(n.effects).length) warn("Figma effects are not converted.");
    let tree: NodeTree = { type: "Frame", name: typeof n.name === "string" ? n.name : String(n.type ?? "Layer"), styles };
    const flex = n.stackMode === "HORIZONTAL" || n.stackMode === "VERTICAL";
    if (flex) {
      Object.assign(styles, { display: "flex", flexDirection: n.stackMode === "HORIZONTAL" ? "row" : "column", gap: num(n.stackSpacing), alignItems: align(n.stackCounterAlignItems ?? n.stackAlign ?? n.stackCounterAlign), justifyContent: align(n.stackPrimaryAlignItems ?? n.stackJustify), paddingLeft: num(n.stackHorizontalPadding, num(n.stackPadding)), paddingTop: num(n.stackVerticalPadding, num(n.stackPadding)), paddingRight: num(n.stackPaddingRight, num(n.stackHorizontalPadding, num(n.stackPadding))), paddingBottom: num(n.stackPaddingBottom, num(n.stackVerticalPadding, num(n.stackPadding))) });
      if (n.stackWrap === "WRAP") styles.flexWrap = "wrap";
    }
    if (n.visible === false) styles.display = "none";
    if (inFlex && num(n.stackChildPrimaryGrow) > 0) styles.flexGrow = num(n.stackChildPrimaryGrow);
    if (n.type === "TEXT") {
      const font = obj(n.fontName);
      Object.assign(styles, { fontFamily: String(font.family ?? "Inter"), fontSize: num(n.fontSize, 16), whiteSpace: "pre-wrap" });
      const weight = /black|heavy/i.test(String(font.style)) ? 900 : /extra.?bold/i.test(String(font.style)) ? 800 : /semi.?bold/i.test(String(font.style)) ? 600 : /bold/i.test(String(font.style)) ? 700 : /medium/i.test(String(font.style)) ? 500 : /light/i.test(String(font.style)) ? 300 : 400;
      styles.fontWeight = weight;
      if (/italic|oblique/i.test(String(font.style))) styles.fontStyle = "italic";
      const lh = obj(n.lineHeight);
      if (lh.units === "PIXELS") styles.lineHeight = `${num(lh.value)}px`;
      else if (lh.units === "PERCENT") styles.lineHeight = num(lh.value) / 100;
      const spacing = obj(n.letterSpacing);
      if (spacing.units === "PIXELS") styles.letterSpacing = num(spacing.value);
      styles.textAlign = String(n.textAlignHorizontal ?? "LEFT").toLowerCase();
      tree.type = "Text";
      tree.text = String(obj(n.textData).characters ?? "");
      if (list(obj(n.textData).styleOverrideTable).length) warn("Mixed Figma text styles are flattened to the layer style.");
    } else if (["VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "LINE", "STAR", "REGULAR_POLYGON"].includes(String(n.type))) {
      const paths: NodeTree[] = [];
      for (const path of list(n.fillGeometry)) {
        const bytes = blob(path.commandsBlob);
        if (!bytes) continue;
        paths.push({ type: "SVGElement", tag: "path", attrs: { d: pathData(bytes), fill: paint?.type === "SOLID" ? color(paint.color, num(paint.opacity, 1)) : "none", "fill-rule": path.windingRule === "EVENODD" ? "evenodd" : "nonzero" } });
      }
      for (const path of list(n.strokeGeometry)) {
        const bytes = blob(path.commandsBlob);
        if (bytes && stroke) paths.push({ type: "SVGElement", tag: "path", attrs: { d: pathData(bytes), fill: color(stroke.color, num(stroke.opacity, 1)) } });
      }
      if (!paths.length && n.type === "ELLIPSE") paths.push({ type: "SVGElement", tag: "ellipse", attrs: { cx: String(num(size.x) / 2), cy: String(num(size.y) / 2), rx: String(num(size.x) / 2), ry: String(num(size.y) / 2), fill: paint?.type === "SOLID" ? color(paint.color) : "none", ...(stroke ? { stroke: color(stroke.color), "stroke-width": String(num(n.strokeWeight, 1)) } : {}) } });
      if (paths.length) {
        tree.type = "SVG";
        tree.attrs = { viewBox: `0 0 ${num(size.x, 100)} ${num(size.y, 100)}` };
        tree.children = paths;
        delete styles.backgroundColor;
        delete styles.border;
      } else warn("A Figma vector has no supported path geometry; its bounds are preserved.");
    } else if (paint?.type === "IMAGE") {
      const bytes = blob(obj(paint.image).dataBlob);
      const url = bytes && imageUrl(bytes);
      if (url) { tree.type = "Image"; tree.src = url; styles.objectFit = paint.imageScaleMode === "FIT" ? "contain" : "cover"; }
      else warn("A Figma image is not embedded in the clipboard; its bounds are preserved.");
    }
    if (tree.type === "Frame") {
      tree.children = (children.get(guid(n.guid)) ?? []).map((c) => convert(c, flex, depth + 1));
      if (tree.children.length && styles.position === undefined) styles.position = "relative";
    }
    active.delete(n);
    converted.add(n);
    return tree;
  };
  const roots = records.filter((n) => !byId.has(guid(obj(n.parentIndex).guid)));
  if (!roots.length && records.length) throw new Error("The Figma clipboard has no root layers.");
  const trees = roots.map((n) => convert(n));
  if (converted.size !== records.length) warn("Some Figma descendants could not be represented by their parent node.");
  if (!trees.length) throw new Error("The Figma clipboard contains no supported layers.");
  return { trees, warnings: [...warnings] };
}

export function importFigmaHtml(html: string): { trees: NodeTree[]; warnings: string[] } {
  return figmaMessageToTrees(decodeFigmaHtml(html).message);
}
