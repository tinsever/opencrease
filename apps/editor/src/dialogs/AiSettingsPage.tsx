// Settings, AI providers: configure image and chat providers. Keys go to the server and never come back
// in full; the page only shows the last four characters.
import { useState } from "react";
import { AI_PROVIDER_KINDS, providerKindInfo, type AiProviderKind, type AiProviderView } from "@opencrease/protocol";
import { aiApi, capable, defaultProvider, refreshAiSettings, useAiSettings } from "../ai/api";
import { tildePath } from "../panels/files";
import { Button, ClaudeMark, Icon, monogram, SelectField } from "../ui";

function ProviderTile({ kind, label }: { kind: AiProviderKind; label: string }) {
  if (kind === "anthropic") {
    return (
      <span className="of-prov-tile claude">
        <ClaudeMark size={16} />
      </span>
    );
  }
  return <span className="of-prov-tile">{monogram(label)}</span>;
}

function summary(p: AiProviderView): string {
  const info = providerKindInfo(p.kind)!;
  const parts: string[] = [];
  if (p.label !== info.label) parts.push(info.label);
  const models = [p.chatModel, p.imageModel].filter(Boolean);
  if (models.length) parts.push(models.join(", "));
  parts.push(info.key === "none" ? "no key needed" : p.hasKey ? `key ${p.keyHint}` : info.key === "optional" ? "no key" : "key missing");
  return parts.join(", ");
}

function ModelField({ id, label, value, suggestions, onChange, placeholder }: { id: string; label: string; value: string; suggestions: string[]; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="of-ai-row">
      <span className="lbl">{label}</span>
      <div className="of-field">
        <input className="sans" list={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label} spellCheck={false} />
        <datalist id={id}>
          {suggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

function ProviderEditor({ p, onDone }: { p: AiProviderView; onDone: () => void }) {
  const info = providerKindInfo(p.kind)!;
  const [label, setLabel] = useState(p.label);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [key, setKey] = useState("");
  const [imageModel, setImageModel] = useState(p.imageModel);
  const [chatModel, setChatModel] = useState(p.chatModel);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const dirty = label !== p.label || baseUrl !== p.baseUrl || key !== "" || imageModel !== p.imageModel || chatModel !== p.chatModel;

  const save = async () => {
    setBusy("save");
    setStatus(null);
    try {
      await aiApi.updateProvider(p.id, { label, baseUrl, imageModel, chatModel, ...(key ? { apiKey: key } : {}) });
      setKey("");
      await refreshAiSettings();
      setStatus({ ok: true, message: "Saved." });
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    setStatus(null);
    try {
      if (dirty) {
        await aiApi.updateProvider(p.id, { label, baseUrl, imageModel, chatModel, ...(key ? { apiKey: key } : {}) });
        setKey("");
        await refreshAiSettings();
      }
      const r = await aiApi.testProvider(p.id);
      setStatus({ ok: r.ok, message: r.message });
      if (r.models?.length) setModels(r.models);
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("remove");
    try {
      await aiApi.deleteProvider(p.id);
      await refreshAiSettings();
      onDone();
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
      setBusy(null);
    }
  };

  return (
    <div className="of-prov-body">
      <span className="of-hint">{info.hint}</span>
      <div className="of-ai-row">
        <span className="lbl">Name</span>
        <div className="of-field">
          <input className="sans" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Name" />
        </div>
      </div>
      <div className="of-ai-row">
        <span className="lbl">Base URL</span>
        <div className="of-field">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Base URL" spellCheck={false} placeholder="https://…/v1" />
        </div>
      </div>
      {info.key !== "none" ? (
        <div className="of-ai-row">
          <span className="lbl">API key</span>
          <div className="of-field">
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label="API key"
              placeholder={p.hasKey ? `Saved, ends in ${p.keyHint.replace("…", "")}. Paste to replace.` : info.key === "optional" ? "Optional" : "Paste your key"}
            />
          </div>
          {p.hasKey ? (
            <button
              className="of-btn sm ghost"
              onClick={async () => {
                setBusy("save");
                try {
                  await aiApi.updateProvider(p.id, { apiKey: null });
                  await refreshAiSettings();
                } catch (e) { setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) }); }
                finally { setBusy(null); }
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      {info.capabilities.includes("chat") ? (
        <ModelField id={`chat-${p.id}`} label="Chat model" value={chatModel} onChange={setChatModel} suggestions={[...new Set([...info.chatModels, ...models])]} placeholder={info.chatModels[0] ?? "Model id"} />
      ) : null}
      {info.capabilities.includes("image") ? (
        <ModelField
          id={`img-${p.id}`}
          label="Image model"
          value={imageModel}
          onChange={setImageModel}
          suggestions={[...new Set([...info.imageModels, ...models])]}
          placeholder={info.imageModels[0] ?? (p.kind === "comfyui" ? "Checkpoint file name" : p.kind === "automatic1111" ? "Current checkpoint" : "Model id")}
        />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <Button size="sm" variant="primary" disabled={!dirty || busy !== null} onClick={() => void save()}>
          Save
        </Button>
        <Button size="sm" disabled={busy !== null} onClick={() => void test()}>
          {busy === "test" ? "Testing" : "Test connection"}
        </Button>
        <span className="of-prov-test" style={{ flex: 1, minWidth: 0, color: status ? (status.ok ? "var(--of-success)" : "var(--of-danger)") : undefined }}>
          {status?.message}
        </span>
        <Button size="sm" variant="ghost" className="danger" disabled={busy !== null} onClick={() => void remove()}>
          Remove
        </Button>
      </div>
    </div>
  );
}

export function AiSettingsPage() {
  const { settings, error } = useAiSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<AiProviderKind | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  if (error && !settings) return <div className="of-settings-body of-hint" style={{ color: "var(--of-danger)" }}>Could not load AI settings: {error}</div>;
  if (!settings) return <div className="of-settings-body of-hint">Loading AI settings</div>;

  const add = async (kind: AiProviderKind) => {
    setAdding(kind);
    setAddError(null);
    try {
      const info = providerKindInfo(kind)!;
      const p = await aiApi.createProvider({ kind, ...(info.baseUrl ? {} : { baseUrl: "http://localhost:11434/v1" }) });
      await refreshAiSettings();
      setOpen(p.id);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(null);
    }
  };

  const imageProviders = settings.providers.filter((p) => capable(p, "image"));
  const chatProviders = settings.providers.filter((p) => capable(p, "chat"));
  const setDefault = async (cap: "image" | "chat", id: string) => {
    try {
      await aiApi.setDefaults({ [cap]: id });
      await refreshAiSettings();
    } catch (e) { setAddError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="of-settings-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="of-ai-defaults">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>Images</span>
          {imageProviders.length ? (
            <SelectField value={defaultProvider(settings, "image")?.id ?? ""} options={imageProviders.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => void setDefault("image", v)} ariaLabel="Image provider" />
          ) : (
            <span className="of-hint">Add an image provider to generate with ⇧⌘I.</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>In-app agent and SVG</span>
          {chatProviders.length ? (
            <SelectField value={defaultProvider(settings, "chat")?.id ?? ""} options={chatProviders.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => void setDefault("chat", v)} ariaLabel="Chat provider" />
          ) : (
            <span className="of-hint">No chat provider yet. Add Anthropic or an OpenAI-compatible endpoint.</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>Providers</span>
        {settings.providers.length ? (
          <div className="of-prov-list">
            {settings.providers.map((p) => {
              const info = providerKindInfo(p.kind)!;
              const isOpen = open === p.id;
              return (
                <div key={p.id} className={`of-prov${isOpen ? " open" : ""}`}>
                  <button className="of-prov-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                    <ProviderTile kind={p.kind} label={p.label} />
                    <span className="names">
                      <span className="n1">{p.label}</span>
                      <span className="n2">{summary(p)}</span>
                    </span>
                    {info.capabilities.includes("chat") ? <span className="of-prov-tag">Agent</span> : null}
                    {info.capabilities.includes("image") ? <span className="of-prov-tag">Images</span> : null}
                    {info.key === "required" && !p.hasKey ? <Icon name="warning" size={12} style={{ color: "var(--of-danger)" }} /> : null}
                    <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={12} style={{ color: "var(--of-muted)" }} />
                  </button>
                  {isOpen ? <ProviderEditor key={`${p.id}-${p.keyHint}`} p={p} onDone={() => setOpen(null)} /> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="of-hint">AI features are off until you add a provider. Everything else in OpenCrease works without one.</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>Add a provider</span>
        <div className="of-prov-add">
          {AI_PROVIDER_KINDS.map((k) => (
            <Button key={k.kind} size="sm" disabled={adding !== null} onClick={() => void add(k.kind)} title={k.hint}>
              <Icon name="plus" size={10} />
              {k.label}
            </Button>
          ))}
        </div>
        {addError ? <span className="of-ai-error">{addError}</span> : null}
      </div>

      <p className="of-hint" style={{ margin: 0 }}>
        Keys are stored in <span className="of-mono">{tildePath(settings.secretsPath)}</span>, readable only by your user. Saved keys are returned only as their last four characters. Every provider call runs on the local server.
      </p>
    </div>
  );
}
