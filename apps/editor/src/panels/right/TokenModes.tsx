// Token detail: per-mode values. A token varies by at most one mode collection; its `value` is the
// collection's default mode and every other mode can override it.
import { modeLabel, tokenCollection, type FoldDocument, type Token } from "@opencrease/model";
import { getOpenFile } from "../../state/workspace";
import { IconButton, Section, SelectField } from "../../ui";
import { ColorField } from "./color/ColorField";

function run(fileId: string, label: string, fn: (tx: import("@opencrease/model").Tx) => void, mergeKey?: string): string | null {
  const file = getOpenFile(fileId);
  if (!file) return "No file";
  try {
    file.store.transact(label, fn, { mergeKey });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function parseValue(raw: string): string | number {
  const v = raw.trim();
  return /^-?\d*\.?\d+$/.test(v) ? Number(v) : v;
}

export function TokenModesSection({ fileId, doc, token, onError }: { fileId: string; doc: FoldDocument; token: Token; onError: (e: string | null) => void }) {
  const collections = doc.modeCollections ?? [];
  if (!collections.length) return null;
  const current = tokenCollection(doc, token);

  const varyBy = (id: string) => {
    if (id === (current?.id ?? "")) return;
    const c = collections.find((x) => x.id === id);
    onError(
      run(fileId, c ? "Vary token by mode" : "Stop varying by mode", (tx) => {
        tx.updateToken(token.id, { modes: undefined });
        if (c) for (const m of c.modes.slice(1)) tx.setTokenModeValue(token.id, m, token.value);
      }),
    );
  };

  return (
    <Section title="Modes">
      <SelectField
        ariaLabel="Varies by"
        label="Varies by"
        value={current?.id ?? ""}
        options={[{ value: "", label: "Nothing (one value)" }, ...collections.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={varyBy}
      />
      {current ? (
        <>
          <div className="of-mode-row">
            <span className="label">{modeLabel(current.modes[0])}</span>
            <span className="of-hint">Uses the value above (default mode)</span>
          </div>
          {current.modes.slice(1).map((m) => {
            const own = token.modes?.[m];
            const value = own ?? token.value;
            const set = (v: string | number, mergeKey?: string) => onError(run(fileId, "Edit mode value", (tx) => tx.setTokenModeValue(token.id, m, v), mergeKey));
            return (
              <div key={m} className="of-mode-row" data-mode-value={m}>
                <span className="label" title={m}>{modeLabel(m)}</span>
                <div className="of-row" style={{ gap: 4, minWidth: 0 }}>
                  {token.type === "color" ? (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ColorField value={String(value)} doc={doc} fileId={fileId} showAlpha={false} onChange={(v, mk) => set(v, mk ? `mode:${token.id}:${m}:${mk}` : undefined)} />
                    </div>
                  ) : (
                    <input
                      className="of-textfield"
                      style={{ fontFamily: "var(--of-font-mono)", flex: 1, minWidth: 0, color: own === undefined ? "var(--of-muted)" : undefined }}
                      defaultValue={String(value)}
                      key={`${m}:${String(value)}`}
                      aria-label={`${modeLabel(m)} value`}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={(e) => {
                        if (e.target.value.trim() === String(value)) return;
                        set(parseValue(e.target.value));
                      }}
                    />
                  )}
                  <IconButton
                    icon="refresh"
                    iconSize={12}
                    size="sm"
                    label="Use the default mode's value"
                    disabled={own === undefined || String(own) === String(token.value)}
                    onClick={() => onError(run(fileId, "Reset mode value", (tx) => tx.setTokenModeValue(token.id, m, token.value)))}
                  />
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <span className="of-hint">Give this token a different value per mode, for example a dark background. Frames pick a mode in the inspector.</span>
      )}
    </Section>
  );
}
