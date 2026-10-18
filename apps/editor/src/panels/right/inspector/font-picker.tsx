// Font family picker: font tokens, fonts in the file, fonts installed on this computer (Local Font
// Access API) and the whole Google Fonts library from the server's cached metadata, each row
// previewed in its own typeface (a tiny subset is loaded as the row scrolls into view).
import { useEffect, useMemo, useRef, useState } from "react";
import type { FoldDocument, StyleValue } from "@opencrease/model";
import { loadPreview, previewFamily, useFontMeta } from "../../../canvas/font-meta";
import { localFamilies } from "../../../canvas/fonts";
import { useSystemFonts } from "../../../desktop/desktop";
import { fuzzyFilter, Icon, Popover } from "../../../ui";

export const COMMON_FONTS = [
  "Geist", "Inter", "Instrument Serif", "Instrument Sans", "DM Sans", "DM Serif Display", "Manrope", "Space Grotesk", "IBM Plex Sans",
  "IBM Plex Serif", "IBM Plex Mono", "JetBrains Mono", "Playfair Display", "Fraunces", "Newsreader", "Source Serif 4", "Lora",
  "Libre Baskerville", "EB Garamond", "Cormorant Garamond", "Work Sans", "Plus Jakarta Sans", "Outfit", "Sora", "Figtree", "Onest",
  "Bricolage Grotesque", "Familjen Grotesk", "Schibsted Grotesk", "Hanken Grotesk", "Public Sans", "Roboto", "Roboto Mono",
  "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Rubik", "Karla", "Archivo", "Syne", "Unbounded", "Bebas Neue", "Anton",
  "Oswald", "Caveat", "system-ui", "serif", "sans-serif", "monospace",
];

const SYSTEM = new Set(["geist", "geist mono", "system-ui", "serif", "sans-serif", "monospace"]);

export function firstFamily(v: StyleValue | undefined): string {
  if (v === undefined) return "";
  return String(v).split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function docFonts(doc: FoldDocument): string[] {
  const set = new Set<string>();
  for (const n of Object.values(doc.nodes)) {
    const f = n.styles.fontFamily;
    if (f && !String(f).startsWith("var(")) set.add(firstFamily(f));
    for (const s of n.spans ?? []) if (s.styles?.fontFamily && !String(s.styles.fontFamily).startsWith("var(")) set.add(firstFamily(s.styles.fontFamily));
  }
  for (const t of doc.tokens) if (t.type === "fontFamily") set.add(firstFamily(t.value));
  return [...set].filter(Boolean);
}

type LocalState = { status: "unsupported" | "idle" | "loading" | "ready" | "denied"; families: string[] };
let localCache: LocalState | null = null;

function localSupported(): boolean {
  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

/** A row whose label renders in the family itself; Google families load a preview subset when visible. */
function FontRow({ family, google, active, hint, onPick }: { family: string; google: boolean; active: boolean; hint?: string; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!google || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadPreview(family);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [family, google]);
  const face = google ? `"${previewFamily(family)}", "${family}", var(--of-font-sans)` : SYSTEM.has(family.toLowerCase()) ? family : `"${family}", var(--of-font-sans)`;
  return (
    <button ref={ref} className={`of-menu-item${active ? " active" : ""}`} onClick={onPick} data-font={family}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: face, fontSize: 14 }}>{family}</span>
      {hint ? <span className="of-muted" style={{ fontSize: 10, flexShrink: 0 }}>{hint}</span> : null}
    </button>
  );
}

export function FontPicker({ anchor, current, doc, onClose, onPick }: { anchor: HTMLElement; current: string; doc: FoldDocument; onClose: () => void; onPick: (family: string, isToken?: boolean) => void }) {
  const [q, setQ] = useState("");
  const [queried, setLocal] = useState<LocalState>(() => localCache ?? { status: localSupported() ? "idle" : "unsupported", families: [] });
  // the desktop app lists installed fonts natively; the browser asks through the Local Font Access API
  const system = useSystemFonts();
  const local: LocalState = system.length ? { status: "ready", families: system } : queried;
  const meta = useFontMeta();
  const inDoc = useMemo(() => docFonts(doc), [doc]);
  const tokens = doc.tokens.filter((t) => t.type === "fontFamily");
  const google = useMemo(() => (meta.status === "ready" ? meta.list.map((f) => f.family) : COMMON_FONTS.filter((f) => !SYSTEM.has(f.toLowerCase()))), [meta]);
  const googleSet = useMemo(() => new Set(google.map((f) => f.toLowerCase())), [google]);
  const variable = (f: string) => (meta.byName.get(f.toLowerCase())?.axes.length ? "Variable" : undefined);
  const query = q.trim();
  const match = (list: string[]) => (query ? fuzzyFilter(list, query, (f) => f) : list);
  const googleMatches = match(google).slice(0, query ? 120 : 200);
  const localMatches = match(local.families).slice(0, 200);
  const all = [...inDoc, ...local.families, ...google];
  const custom = query && !all.some((f) => f.toLowerCase() === query.toLowerCase()) ? query : null;
  const first = match(inDoc)[0] ?? localMatches[0] ?? googleMatches[0];

  const pick = (f: string) => {
    if (local.families.includes(f) && !googleSet.has(f.toLowerCase())) localFamilies.add(f.toLowerCase());
    onPick(f);
  };

  const loadLocal = async () => {
    setLocal({ status: "loading", families: [] });
    try {
      const fonts = await (window as unknown as { queryLocalFonts: () => Promise<Array<{ family: string }>> }).queryLocalFonts();
      const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
      localCache = { status: "ready", families };
      setLocal(localCache);
    } catch {
      localCache = { status: "denied", families: [] };
      setLocal(localCache);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} placement="left" gap={12} width={264}>
      <div className="of-search-row" style={{ margin: 8 }}>
        <Icon name="search" size={13} />
        <input
          autoFocus
          placeholder={meta.status === "ready" ? `Search ${meta.list.length} fonts` : "Search fonts"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") pick(first ?? custom ?? query);
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div className="of-scroll" style={{ maxHeight: 360, padding: "0 4px 4px" }} data-of-font-list="">
        {tokens.length && !query ? <div className="of-menu-label of-caps">Tokens</div> : null}
        {!query
          ? tokens.map((t) => (
              <button key={t.id} className="of-menu-item" onClick={() => onPick(`var(${t.name})`, true)}>
                <span style={{ flex: 1, fontFamily: `"${firstFamily(t.value)}"` }}>{firstFamily(t.value)}</span>
                <span className="of-mono" style={{ fontSize: 10, color: "var(--of-accent-ink)" }}>{t.name.slice(2)}</span>
              </button>
            ))
          : null}
        {match(inDoc).length ? <div className="of-menu-label of-caps">In this file</div> : null}
        {match(inDoc).map((f) => (
          <FontRow key={`d-${f}`} family={f} google={googleSet.has(f.toLowerCase())} active={f === current} onPick={() => pick(f)} />
        ))}
        {custom ? (
          <button className="of-menu-item" onClick={() => pick(custom)}>
            Use “{custom}”
          </button>
        ) : null}
        <div className="of-menu-label of-caps">On this computer</div>
        {local.status === "ready" ? (
          localMatches.length ? (
            localMatches.map((f) => <FontRow key={`l-${f}`} family={f} google={false} active={f === current} onPick={() => pick(f)} />)
          ) : (
            <div className="of-hint" style={{ padding: "2px 8px 6px" }}>{query ? "No installed fonts match." : "No installed fonts were reported."}</div>
          )
        ) : local.status === "unsupported" ? (
          <div className="of-hint" style={{ padding: "2px 8px 6px" }}>This browser cannot list installed fonts. Type a font's name above to use it anyway.</div>
        ) : local.status === "denied" ? (
          <div className="of-hint" style={{ padding: "2px 8px 6px" }}>Access to installed fonts was not granted. Allow it in the site settings, or type a font's name above.</div>
        ) : (
          <button className="of-menu-item" onClick={() => void loadLocal()} disabled={local.status === "loading"}>
            <Icon name="download" size={12} style={{ color: "var(--of-muted)" }} />
            <span style={{ flex: 1 }}>{local.status === "loading" ? "Asking for access…" : "Show installed fonts"}</span>
          </button>
        )}
        <div className="of-menu-label of-caps">{meta.status === "ready" ? "Google Fonts" : "Google Fonts and system"}</div>
        {googleMatches.map((f) => (
          <FontRow key={`g-${f}`} family={f} google active={f === current} hint={variable(f)} onPick={() => pick(f)} />
        ))}
        {meta.status === "error" ? <div className="of-hint" style={{ padding: "2px 8px 6px" }}>The full Google Fonts list is not available offline yet. Fonts used before still load from the cache.</div> : null}
        {!query
          ? ["Geist", "Geist Mono", "system-ui", "serif", "sans-serif", "monospace"].map((f) => <FontRow key={`s-${f}`} family={f} google={false} active={f === current} onPick={() => pick(f)} />)
          : null}
      </div>
    </Popover>
  );
}
