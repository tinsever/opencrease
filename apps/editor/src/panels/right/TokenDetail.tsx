// Right panel detail for the token selected in the Theme tab.
import { useMemo, useState } from "react";
import { normalizeTokenName, pageOfNode, resolveToken, TOKEN_TYPES, varReferences, type Token, type TokenType } from "@opencrease/model";
import { useDoc } from "../../state/hooks";
import { getOpenFile, setActivePage, setSelection } from "../../state/workspace";
import { Button, Icon, Section, SelectField } from "../../ui";
import { nodeIcon } from "../nodeIcon";
import { selectToken } from "../shared";
import { ColorField } from "./color/ColorField";
import { resolveColor } from "./color/ColorPicker";
import { TokenModesSection } from "./TokenModes";

export const TOKEN_TYPE_LABEL: Record<TokenType, string> = {
  color: "Colour", spacing: "Spacing", radius: "Radius", fontFamily: "Font family", fontWeight: "Font weight", fontSize: "Font size",
  lineHeight: "Line height", letterSpacing: "Letter spacing", opacity: "Opacity", container: "Container", breakpoint: "Breakpoint",
};

export function updateToken(fileId: string, id: string, patch: Partial<Omit<Token, "id">>, label = "Edit token", mergeKey?: string): string | null {
  const file = getOpenFile(fileId);
  if (!file) return "No file";
  try {
    file.store.transact(label, (tx) => tx.updateToken(id, patch), { mergeKey });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function TokenDetail({ fileId, tokenId }: { fileId: string; tokenId: string }) {
  const doc = useDoc(fileId);
  const token = doc?.tokens.find((t) => t.id === tokenId);
  const [error, setError] = useState<string | null>(null);
  const usedBy = useMemo(() => {
    if (!doc || !token) return [];
    const out: Array<{ id: string; prop: string }> = [];
    for (const n of Object.values(doc.nodes)) {
      for (const [prop, v] of Object.entries(n.styles)) {
        if (varReferences(v).includes(token.name)) {
          out.push({ id: n.id, prop });
          break;
        }
      }
    }
    return out;
  }, [doc, token]);
  const aliases = useMemo(() => (doc && token ? doc.tokens.filter((t) => varReferences(t.value).includes(token.name)) : []), [doc, token]);
  if (!doc || !token) return null;
  const resolved = resolveToken(doc, token.name);
  const isAlias = typeof token.value === "string" && /^var\(/.test(token.value.trim());

  const selectNodes = (ids: string[]) => {
    if (!ids.length) return;
    const page = pageOfNode(doc, ids[0]);
    const file = getOpenFile(fileId);
    if (page && file && file.activePageId !== page.id) setActivePage(fileId, page.id);
    setSelection(fileId, ids.filter((id) => pageOfNode(doc, id)?.id === (page?.id ?? "")));
  };

  return (
    <div className="of-inspector">
      <div className="of-sel-header" style={{ paddingBottom: 12, borderBottom: "1px solid var(--of-hairline)" }}>
        {token.type === "color" ? (
          <span style={{ width: 36, height: 36, borderRadius: 6, background: resolveColor(doc, `var(${token.name})`), boxShadow: "inset 0 0 0 1px #00000014", flexShrink: 0 }} />
        ) : null}
        <div className="titles">
          <input
            className="of-inline-input"
            style={{ boxShadow: "none", background: "transparent", padding: 0, font: "600 var(--of-text-md)/16px var(--of-font-mono)", height: 18 }}
            defaultValue={token.name}
            key={token.name}
            aria-label="Token name"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => {
              const name = normalizeTokenName(e.target.value);
              if (name !== token.name) setError(updateToken(fileId, token.id, { name }, "Rename token"));
            }}
          />
          <div className="t2">
            {TOKEN_TYPE_LABEL[token.type]}, used by {usedBy.length} {usedBy.length === 1 ? "layer" : "layers"}
          </div>
        </div>
      </div>
      {error ? <div className="of-hint" style={{ color: "var(--of-danger)", padding: "8px 12px 0" }}>{error}</div> : null}
      <Section title="Value">
        {token.type === "color" ? (
          <ColorField value={String(token.value)} doc={doc} fileId={fileId} onChange={(v, mk) => setError(updateToken(fileId, token.id, { value: v }, "Edit token", mk))} />
        ) : (
          <input
            className="of-textfield"
            style={{ fontFamily: "var(--of-font-mono)" }}
            defaultValue={String(token.value)}
            key={String(token.value)}
            aria-label="Token value"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === String(token.value)) return;
              const num = /^-?\d*\.?\d+$/.test(raw) ? Number(raw) : raw;
              setError(updateToken(fileId, token.id, { value: num }));
            }}
          />
        )}
        {isAlias ? (
          <span className="of-hint">
            Alias, resolves to <span className="of-mono">{String(resolved ?? "nothing")}</span>
          </span>
        ) : null}
        <SelectField ariaLabel="Token type" label="Type" value={token.type} options={TOKEN_TYPES.map((t) => ({ value: t, label: TOKEN_TYPE_LABEL[t] }))} onChange={(type) => setError(updateToken(fileId, token.id, { type }, "Token type"))} />
      </Section>
      <TokenModesSection fileId={fileId} doc={doc} token={token} onError={setError} />
      <Section title="Description">
        <textarea
          className="of-textfield"
          style={{ height: 72, padding: 8, resize: "vertical", lineHeight: "18px" }}
          placeholder="When to use this token"
          defaultValue={token.description ?? ""}
          key={token.description ?? ""}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const d = e.target.value.trim();
            if (d !== (token.description ?? "")) setError(updateToken(fileId, token.id, { description: d || undefined }, "Token description"));
          }}
        />
      </Section>
      <Section
        title="Used by"
        actions={usedBy.length ? <button className="of-btn ghost sm" style={{ color: "var(--of-accent-ink)", height: 20, padding: "0 4px" }} onClick={() => selectNodes(usedBy.map((u) => u.id))}>Select all {usedBy.length}</button> : undefined}
      >
        {usedBy.length === 0 && aliases.length === 0 ? <span className="of-hint">No layers use this token yet.</span> : null}
        {usedBy.slice(0, 40).map((u) => {
          const n = doc.nodes[u.id];
          return (
            <button key={u.id} className="of-menu-item" style={{ padding: "0 2px" }} onClick={() => selectNodes([u.id])}>
              <Icon name={nodeIcon(n, false)} size={14} style={{ color: "var(--of-muted)" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{n.name}</span>
              <span className="of-mono of-muted" style={{ fontSize: "var(--of-text-xs)" }}>{u.prop}</span>
            </button>
          );
        })}
        {aliases.map((t) => (
          <button key={t.id} className="of-menu-item" style={{ padding: "0 2px" }} onClick={() => selectToken(t.id)}>
            <Icon name="tokens" size={12} style={{ color: "var(--of-muted)" }} />
            <span className="of-mono" style={{ flex: 1, fontSize: "var(--of-text-xs)" }}>{t.name.slice(2)}</span>
            <span className="of-muted" style={{ fontSize: "var(--of-text-xs)" }}>alias</span>
          </button>
        ))}
      </Section>
      <div style={{ padding: 12 }}>
        <Button
          variant="danger"
          onClick={() => {
            const file = getOpenFile(fileId);
            if (!file) return;
            if (usedBy.length && !confirm(`${usedBy.length} layers use ${token.name}. Delete it anyway? They keep the var() reference.`)) return;
            file.store.transact("Delete token", (tx) => tx.deleteToken(token.id));
            selectToken(null);
          }}
        >
          Delete token
        </Button>
      </div>
    </div>
  );
}
