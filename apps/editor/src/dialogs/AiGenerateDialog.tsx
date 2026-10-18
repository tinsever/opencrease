// ⇧⌘I image generation (into a fill, an image layer or a new layer), image edits, and ⇧⌘J SVG generation
// with the selected frame as context. Provider calls run on the server.
import { useEffect, useMemo, useRef, useState } from "react";
import { htmlToTrees, nodeToHtml } from "@opencrease/css";
import type { NodeId, NodeTree, OFNode } from "@opencrease/model";
import { buildGenUrl, providerKindInfo } from "@opencrease/protocol";
import { aiApi, capable, defaultProvider, openAiSettings, useAiSettings } from "../ai/api";
import { generateForNode } from "../ai/gen-jobs";
import { currentImage, defaultTarget, pendingGen, type GenTarget } from "../ai/gen-logic";
import { screenshotNode } from "../agent/exporter";
import { canvasSize, getViewportLive, getWorldRect } from "../canvas/registry";
import { toWorld } from "../canvas/viewport-math";
import { insertTrees } from "../state/actions";
import { getActiveFile } from "../state/workspace";
import { Button, Icon, Segmented, SelectField } from "../ui";
import { Dialog } from "./Dialog";

export type AiGenerateMode = "image" | "edit" | "svg";

const SHAPES = {
  square: { label: "Square", width: 512, height: 512 },
  landscape: { label: "3:2", width: 600, height: 400 },
  portrait: { label: "2:3", width: 400, height: 600 },
  wide: { label: "16:9", width: 640, height: 360 },
} as const;
type Shape = keyof typeof SHAPES;

function viewportCentre(): { x: number; y: number } {
  const { width, height } = canvasSize();
  return toWorld(getViewportLive(), { x: width / 2, y: height / 2 });
}

/** Insert trees into the selected frame, or as top-level layers centred in the view. */
function placeTrees(trees: NodeTree[], frame: OFNode | undefined, size: { width: number; height: number }, label: string): NodeId[] {
  const file = getActiveFile();
  if (!file) return [];
  const doc = file.store.doc;
  if (frame) return insertTrees(frame.id, trees, label);
  const rootId = doc.pages[file.activePageId]!.rootId;
  const c = viewportCentre();
  const placed = trees.map((t) => ({ ...t, styles: { ...(t.styles ?? {}), position: "absolute", left: Math.round(c.x - size.width / 2), top: Math.round(c.y - size.height / 2) } }));
  return insertTrees(rootId, placed, label);
}

export function AiGenerateDialog({ mode: initialMode, onClose }: { mode: AiGenerateMode; onClose: () => void }) {
  const { settings, error: settingsError } = useAiSettings();
  const file = getActiveFile();
  const doc = file?.store.doc;
  const sel = file && doc ? file.selection.map((id) => doc.nodes[id]).filter((n): n is OFNode => !!n && n.type !== "Root") : [];
  const node = sel.length === 1 ? sel[0] : undefined;
  const mode = initialMode;
  const image = mode !== "svg";
  const cap = image ? "image" : "chat";

  const providers = useMemo(() => (settings?.providers ?? []).filter((p) => capable(p, cap)), [settings, cap]);
  const [providerId, setProviderId] = useState<string>("");
  const provider = providers.find((p) => p.id === providerId) ?? defaultProvider(settings, cap);
  const info = provider ? providerKindInfo(provider.kind) : undefined;

  const existingTarget = defaultTarget(node);
  const [target, setTarget] = useState<GenTarget | "new">(existingTarget);
  const [shape, setShape] = useState<Shape>("square");
  const [prompt, setPrompt] = useState(() => (mode === "image" && node ? (node.gen?.prompt ?? (node ? pendingGen(node)?.spec.prompt : undefined) ?? "") : ""));
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const frame = node && node.type === "Frame" ? node : undefined;
  const rect = node ? getWorldRect(node.id) : null;
  const hasImage = node ? !!currentImage(node) : false;
  const editBlocked = mode === "edit" && (!node || !hasImage);
  const editUnsupported = mode === "edit" && info && !info.imageEdits;

  const title = mode === "svg" ? "Generate SVG" : mode === "edit" ? "Edit image" : "Generate image";
  const where =
    mode === "svg"
      ? frame
        ? `Draws a vector graphic into “${frame.name}”, using the frame as context.`
        : "Draws a vector graphic as a new layer. Select a frame first to use it as context."
      : mode === "edit"
        ? node && hasImage
          ? `Changes the image in “${node.name}” and keeps its size. Describe what to change or the new style.`
          : "Select an image layer or a layer with an image fill to edit it."
        : target === "new"
          ? frame
            ? `Adds a new image layer inside “${frame.name}”.`
            : "Adds a new image layer in the middle of the view."
          : target === "src"
            ? `Replaces the image in “${node!.name}”.`
            : `Fills “${node!.name}” with the image.`;

  const canSubmit = !!provider && !!prompt.trim() && !busy && !editBlocked && !editUnsupported;

  const submit = async () => {
    if (!canSubmit || !file || !doc) return;
    setError(null);
    const opts = { prompt: prompt.trim(), model: model.trim() || modelPlaceholder, provider: provider!.id };
    if (mode === "edit" && node) {
      void generateForNode(file.id, node.id, { ...opts, edit: true });
      onClose();
      return;
    }
    if (mode === "image") {
      if (target !== "new" && node) {
        void generateForNode(file.id, node.id, { ...opts, target });
        onClose();
        return;
      }
      const size = SHAPES[shape];
      const src = buildGenUrl({ prompt: opts.prompt, model: opts.model, provider: opts.provider, width: size.width, height: size.height });
      const name = opts.prompt.length > 32 ? `${opts.prompt.slice(0, 32).trim()}…` : opts.prompt;
      const [id] = placeTrees([{ type: "Image", name, src, styles: { width: size.width, height: size.height, objectFit: "cover", flexShrink: 0 } }], frame, size, "Generate image");
      if (id) requestAnimationFrame(() => void generateForNode(file.id, id));
      onClose();
      return;
    }
    // SVG
    setBusy(true);
    abort.current = new AbortController();
    try {
      let context;
      if (frame) {
        context = { name: frame.name, html: nodeToHtml(doc, frame.id), width: rect?.width, height: rect?.height } as { name: string; html: string; width?: number; height?: number; image?: { data: string; mimeType: string } };
        try {
          const shot = await screenshotNode(file.id, frame.id, 1);
          context.image = { data: shot.data, mimeType: shot.mimeType };
        } catch {
          // the HTML is enough context
        }
      }
      const res = await aiApi.svg({ prompt: opts.prompt, providerId: provider!.id, ...(opts.model ? { model: opts.model } : {}), ...(context ? { context } : {}) }, abort.current.signal);
      if (getActiveFile()?.id !== file.id) throw new Error("The active file changed. Switch back to the original file and generate again.");
      const { trees } = htmlToTrees(res.svg);
      const svg = trees.find((t) => t.type === "SVG");
      if (!svg) throw new Error("The model's SVG could not be read. Try again or rephrase the prompt.");
      svg.name = opts.prompt.length > 32 ? `${opts.prompt.slice(0, 32).trim()}…` : opts.prompt;
      const w = Number(svg.styles?.width ?? svg.attrs?.width) || 240;
      const h = Number(svg.styles?.height ?? svg.attrs?.height) || 240;
      svg.styles = { ...svg.styles, width: w, height: h, flexShrink: 0 };
      placeTrees([svg], frame, { width: w, height: h }, "Generate SVG");
      onClose();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const noProvider = settings && !provider;
  const modelSuggestions = provider ? (image ? (info?.imageModels ?? []) : (info?.chatModels ?? [])) : [];
  const modelPlaceholder = provider ? (image ? provider.imageModel : provider.chatModel) || "Default model" : "";

  return (
    <Dialog onClose={onClose} width={460} top="14vh" label={title}>
      <div className="of-dlg-head" style={{ paddingBottom: 14 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="of-dlg-title" style={{ fontSize: "var(--of-text-lg)", lineHeight: "20px" }}>{title}</div>
          <div className="of-dlg-sub">{where}</div>
        </div>
        <button className="of-icon-btn sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {noProvider || settingsError ? (
        <div className="of-ai-empty">
          <span style={{ fontWeight: 600 }}>{settingsError ? "Could not load AI settings" : image ? "No image provider is set up" : "No chat provider is set up"}</span>
          <span className="of-hint">
            {settingsError
              ? settingsError
              : image
                ? "Add OpenAI, Google Gemini, Replicate, fal, xAI, an OpenAI-compatible endpoint, ComfyUI or Automatic1111. Keys stay on this computer."
                : "SVG generation uses a chat model. Add Anthropic or an OpenAI-compatible provider. Keys stay on this computer."}
          </span>
          <div>
            <Button size="sm" onClick={() => { onClose(); openAiSettings(); }}>Open AI settings</Button>
          </div>
        </div>
      ) : (
        <div className="of-ai-form">
          <textarea
            autoFocus
            className="of-ai-prompt"
            rows={4}
            value={prompt}
            placeholder={mode === "svg" ? "A line icon of a kiln, 2px strokes, rounded caps" : mode === "edit" ? "Make it dusk, warm window light" : "Hand-thrown stoneware vase on raw linen, soft north light"}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={busy}
          />
          {mode === "image" && existingTarget !== "new" ? (
            <div className="of-ai-row">
              <span className="lbl">Put it</span>
              <Segmented
                ariaLabel="Target"
                value={target}
                onChange={setTarget}
                options={[
                  { value: existingTarget, label: existingTarget === "src" ? "In this image" : "In the fill" },
                  { value: "new", label: "New layer" },
                ]}
              />
            </div>
          ) : null}
          {mode === "image" && target === "new" ? (
            <div className="of-ai-row">
              <span className="lbl">Shape</span>
              <Segmented ariaLabel="Shape" value={shape} onChange={setShape} options={(Object.keys(SHAPES) as Shape[]).map((k) => ({ value: k, label: SHAPES[k].label }))} />
            </div>
          ) : null}
          {mode === "image" && target !== "new" && rect ? (
            <div className="of-ai-row">
              <span className="lbl">Size</span>
              <span className="of-mono" style={{ fontSize: "var(--of-text-xs)", color: "var(--of-ink-2)" }}>
                {Math.round(rect.width)} × {Math.round(rect.height)}, the layer keeps its size
              </span>
            </div>
          ) : null}
          {providers.length > 1 ? (
            <div className="of-ai-row">
              <span className="lbl">Provider</span>
              <SelectField value={provider?.id ?? ""} options={providers.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => setProviderId(v)} ariaLabel="Provider" />
            </div>
          ) : null}
          <div className="of-ai-row">
            <span className="lbl">Model</span>
            <div className="of-field">
              <input className="sans" list="of-ai-models" value={model} placeholder={modelPlaceholder} onChange={(e) => setModel(e.target.value)} disabled={busy} aria-label="Model" />
              <datalist id="of-ai-models">
                {modelSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>
          {editUnsupported ? <div className="of-ai-error">{provider!.label} cannot edit images. Pick another provider in Settings, AI providers.</div> : null}
          {error ? <div className="of-ai-error">{error}</div> : null}
        </div>
      )}

      <div className="of-dlg-foot">
        <span className="of-hint" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {busy ? "Drawing with " + (provider?.label ?? "the model") : provider ? `Runs on ${provider.label}` : ""}
        </span>
        <Button onClick={() => (busy ? abort.current?.abort() : onClose())}>{busy ? "Stop" : "Cancel"}</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? <span className="of-gen-spin" style={{ borderColor: "#ffffff55", borderTopColor: "#fff" }} /> : null}
          {mode === "edit" ? "Edit" : "Generate"}
          <span style={{ opacity: 0.6, marginLeft: 2 }}>⌘↵</span>
        </Button>
      </div>
    </Dialog>
  );
}
