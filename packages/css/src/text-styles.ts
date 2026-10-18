// Text styles as code: CSS classes (`.type-heading { ... }`) or Tailwind v4 utilities (`@utility type-heading`).
import { normalizeTokenName, tailwindTokenName, textStyleSlug, type FoldDocument, type TextStyle } from "@opencrease/model";
import { camelToKebab } from "./case";
import { styleValueToCss } from "./styles";

function declarations(style: TextStyle, rename: (value: string) => string, pad: string): string {
  return Object.entries(style.styles)
    .map(([k, v]) => `${pad}${camelToKebab(k)}: ${rename(styleValueToCss(k, v))};`)
    .join("\n");
}

function blocks(styles: readonly TextStyle[], head: (cls: string) => string, rename: (value: string) => string): string {
  return styles
    .filter((s) => textStyleSlug(s.name))
    .map((s) => {
      const body = declarations(s, rename, "  ");
      const comment = s.description ? `/* ${s.name}: ${s.description.replace(/\*\//g, "* /")} */\n` : `/* ${s.name} */\n`;
      return `${comment}${head(textStyleSlug(s.name))} {${body ? `\n${body}\n` : ""}}\n`;
    })
    .join("\n");
}

/** One CSS class per text style. Token references stay as written. */
export function textStylesToCss(doc: Pick<FoldDocument, "textStyles">): string {
  return blocks(doc.textStyles ?? [], (cls) => `.${cls}`, (v) => v);
}

/** One Tailwind `@utility` per text style, with token references renamed to their theme variables. */
export function textStylesToTailwind(doc: Pick<FoldDocument, "textStyles" | "tokens">): string {
  const renamed = new Map(doc.tokens.map((t) => [normalizeTokenName(t.name), tailwindTokenName(t)]));
  const rename = (value: string) => value.replace(/var\(\s*(--[^\s,()]+)/g, (m, ref: string) => (renamed.has(ref) ? `var(${renamed.get(ref)}` : m));
  return blocks(doc.textStyles ?? [], (cls) => `@utility ${cls}`, rename);
}
