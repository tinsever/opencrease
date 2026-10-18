// Export section (mock 24A-0): export rows with scale and format, presets, PDF and video options,
// a live preview of the first export with its file name, size and weight, and the export button.
// ExportAllSection is the page-level "Export all with settings" shown when nothing is selected.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { descendants, getNode, type ExportSetting, type FoldDocument, type NodeId, type OFNode } from "@opencrease/model";
import { captureNode, exportCombinedPdf, exportNodes, exportRequests, type ExportProgress } from "../../../agent/exporter";
import { EXPORT_PRESETS, presetWarnings } from "../../../agent/export-presets";
import {
  DEFAULT_EXPORT, DEFAULT_VIDEO, IMAGE_FORMATS, VIDEO_FORMATS, VIDEO_FPS, exportFileName, formatBytes, settingOutputSize, videoTiming,
} from "../../../agent/export-settings";
import { videoSupported } from "../../../agent/video";
import { measureNode } from "../../../agent/dom";
import { Button, Icon, IconButton, NumberField, Section, SelectField, useMenu } from "../../../ui";
import { updateNodes, useCtx } from "./common";
import "./export.css";

type Format = ExportSetting["format"];

const IMAGE_SCALES = ["0.5x", "1x", "1.5x", "2x", "3x", "4x", "512w", "1024w", "512h", "720p", "1080p"];
const VIDEO_SCALES = ["0.5x", "1x", "2x", "480p", "720p", "1080p", "1440p", "2160p"];
const FORMATS: Array<{ value: Format; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
  { value: "svg", label: "SVG" },
  { value: "pdf", label: "PDF" },
  { value: "mp4", label: "MP4 video" },
  { value: "webm", label: "WebM video" },
];
const PDF_QUALITY = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;
const PDF_RESAMPLING = [
  { value: "detailed", label: "Detailed" },
  { value: "basic", label: "Basic" },
] as const;

const isVideo = (s: ExportSetting) => VIDEO_FORMATS.has(s.format);

/** Animated shader names inside a node (or the node itself). */
export function animatedShaders(doc: FoldDocument, id: NodeId): string[] {
  const node = getNode(doc, id);
  if (!node) return [];
  const all = [node, ...descendants(doc, id)].filter((n) => n.type === "Shader" && n.visible);
  const moving = all.filter((n) => {
    const speed = n.shader?.params?.speed;
    return typeof speed === "number" ? speed !== 0 : !/^Static/.test(n.shader?.name ?? "");
  });
  return [...new Set(moving.map((n) => n.name))];
}

/** Switching format keeps the row sensible: video rows get a video size and timing. */
export function withFormat(s: ExportSetting, format: Format): ExportSetting {
  const next: ExportSetting = { format, scale: s.scale };
  if (s.suffix) next.suffix = s.suffix;
  if (VIDEO_FORMATS.has(format)) {
    if (!VIDEO_SCALES.includes(s.scale)) next.scale = "1x";
    next.durationSeconds = s.durationSeconds ?? DEFAULT_VIDEO.durationSeconds;
    next.fps = s.fps ?? DEFAULT_VIDEO.fps;
  } else if (VIDEO_FORMATS.has(s.format) && !IMAGE_SCALES.includes(s.scale)) {
    next.scale = DEFAULT_EXPORT.scale;
  }
  if (format === "pdf") {
    if (s.pdfQuality) next.pdfQuality = s.pdfQuality;
    if (s.pdfResampling) next.pdfResampling = s.pdfResampling;
  }
  return next;
}

function sizeLabel(s: ExportSetting, node: OFNode, size: { width: number; height: number } | null, bytes: number | null): string {
  if (!size) return "";
  const out = settingOutputSize(s, size.width, size.height);
  if (!out) return "";
  const dims = `${out.width} × ${out.height}`;
  if (isVideo(s)) {
    const t = videoTiming(s);
    return `${dims}, ${t.seconds} s at ${t.fps} fps`;
  }
  if (s.format === "pdf") return `${dims}, vector`;
  if (s.format === "svg" && node.type !== "SVG") return "SVG layers only";
  return bytes !== null ? `${dims}, ${formatBytes(bytes)}` : dims;
}

interface Preview {
  key: string;
  url: string;
  bytes: number | null;
}

/** A thumbnail of the node, and the real file size of the first raster export when it is cheap to make. */
function usePreview(fileId: string, node: OFNode | null, setting: ExportSetting, doc: FoldDocument): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  const key = node ? `${node.id}:${JSON.stringify(setting)}` : "";
  const run = useRef(0);
  const url = useRef<string | null>(null);
  useEffect(() => {
    if (!node) return;
    const id = ++run.current;
    const t = setTimeout(async () => {
      try {
        const rect = measureNode(fileId, node.id);
        const out = rect ? settingOutputSize(setting, rect.width, rect.height) : null;
        const cheap = IMAGE_FORMATS.has(setting.format) && setting.format !== "avif" && out && out.width * out.height <= 8_000_000;
        let blob: Blob;
        let bytes: number | null = null;
        if (cheap) {
          const res = await exportNodes(fileId, [node.id], [setting], { destination: "none" });
          if (!res.files[0]) throw new Error(res.errors[0] ?? "no preview");
          blob = res.files[0].blob;
          bytes = blob.size;
        } else {
          const shot = await captureNode(fileId, node.id, ({ width, height }) => Math.min(2, (2 * 236) / width, (2 * 110) / height));
          blob = await new Promise<Blob>((resolve, reject) => shot.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no preview"))), "image/png"));
        }
        if (id !== run.current) return;
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(blob);
        setPreview({ key, url: url.current, bytes });
      } catch {
        if (id === run.current) {
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = null;
          setPreview(null);
        }
      }
    }, 450);
    return () => { clearTimeout(t); run.current++; };
    // doc: refresh when anything changes; the timer debounces edits
  }, [fileId, node, key, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  return preview?.key === key ? preview : null;
}

function OptionChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="of-export-opt">
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

function ExportRow({ setting, onChange, onRemove, doc, node }: { setting: ExportSetting; onChange: (s: ExportSetting) => void; onRemove: () => void; doc: FoldDocument; node: OFNode | null }) {
  const video = isVideo(setting);
  const scales = video ? VIDEO_SCALES : IMAGE_SCALES;
  const row = (
    <div className="of-row" style={{ gap: 6 }}>
      <SelectField mono ariaLabel="Scale" value={setting.scale} options={[...new Set([...scales, setting.scale])].map((v) => ({ value: v, label: v }))} onChange={(v) => onChange({ ...setting, scale: v })} style={{ flex: "0 0 64px" }} />
      <SelectField ariaLabel="Format" value={setting.format} options={FORMATS} onChange={(f) => onChange(withFormat(setting, f))} />
      <IconButton icon="minus" iconSize={12} size="sm" label="Remove export" onClick={onRemove} style={{ width: 24, flexShrink: 0 }} />
    </div>
  );
  if (video) {
    const t = videoTiming(setting);
    const shaders = node ? animatedShaders(doc, node.id) : [];
    const supported = videoSupported();
    return (
      <div className="of-export-card">
        {row}
        <div className="of-row" style={{ gap: 6 }}>
          <NumberField label="Length" value={t.seconds} suffix="s" min={1} max={300} step={1} ariaLabel="Video length in seconds" onCommit={(v) => onChange({ ...setting, durationSeconds: Math.min(300, Math.max(1, Number(v) || DEFAULT_VIDEO.durationSeconds!)) })} style={{ height: 26 }} />
          <SelectField mono label="FPS" ariaLabel="Frames per second" value={String(t.fps)} options={VIDEO_FPS.map((f) => ({ value: String(f), label: String(f) }))} onChange={(f) => onChange({ ...setting, fps: Number(f) })} style={{ height: 26 }} />
        </div>
        <span className="of-hint" style={!supported ? { color: "var(--of-danger)" } : undefined}>
          {!supported
            ? "This browser cannot encode video because WebCodecs is missing. Use a Chromium based browser or the opencrease CLI."
            : shaders.length
              ? `Animates ${shaders.slice(0, 3).join(", ")}${shaders.length > 3 ? ` and ${shaders.length - 3} more` : ""}. Encoded on this computer.`
              : "No animated shader in this layer, so the video shows a still frame."}
          {supported && setting.format === "webm" ? " Keeps transparency." : ""}
        </span>
      </div>
    );
  }
  if (setting.format === "pdf") {
    return (
      <div className="of-export-card">
        {row}
        <div className="of-row" style={{ gap: 6 }}>
          <OptionChip label="Images">
            <SelectField ariaLabel="PDF image quality" value={setting.pdfQuality ?? "high"} options={[...PDF_QUALITY]} onChange={(q) => onChange({ ...setting, pdfQuality: q })} style={{ height: 26 }} />
          </OptionChip>
          <OptionChip label="Resampling">
            <SelectField ariaLabel="PDF image resampling" value={setting.pdfResampling ?? "detailed"} options={[...PDF_RESAMPLING]} onChange={(r) => onChange({ ...setting, pdfResampling: r })} style={{ height: 26 }} />
          </OptionChip>
        </div>
      </div>
    );
  }
  return row;
}

export function ExportSection() {
  const ctx = useCtx();
  const { nodes, fileId, ids, doc } = ctx;
  const [busy, setBusy] = useState<ExportProgress | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const [menu, openMenu] = useMenu();
  const single = nodes.length === 1 ? nodes[0] : null;
  const settings = single?.exports ?? [];
  const first = settings[0] ?? DEFAULT_EXPORT;
  const write = (next: ExportSetting[], label = "Export settings") => updateNodes(ctx, label, () => ({ exports: next }));
  const fileCount = nodes.reduce((n, node) => n + Math.max(1, node.exports?.length ?? 0), 0);
  const hasVideo = nodes.some((n) => n.exports?.some(isVideo));
  const preview = usePreview(fileId, single, first, doc);
  const rect = single ? measureNode(fileId, single.id) : null;

  const run = async (destination: "download" | "workspace" = "download") => {
    if (busy) {
      abort.current?.abort();
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setBusy({ fraction: 0, label: "Starting" });
    setStatus(null);
    try {
      const out = await exportNodes(fileId, ids, undefined, { destination, onProgress: setBusy, signal: controller.signal });
      const parts = [out.files.length ? `${destination === "download" ? "Downloaded" : "Saved to workspace"} ${out.files.length} ${out.files.length === 1 ? "file" : "files"}.` : "", ...out.warnings, ...out.errors].filter(Boolean);
      setStatus({ text: parts.join(" "), error: out.errors.length > 0 });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const combinedPdf = async () => {
    setBusy({ fraction: 0, label: "Printing PDF" });
    setStatus(null);
    try {
      const out = await exportCombinedPdf(fileId, ids, { destination: "download" });
      setStatus({ text: [`Downloaded ${out.pages.length} pages as one PDF.`, out.warning].filter(Boolean).join(" ") });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally { setBusy(null); }
  };

  const copyPng = async () => {
    setStatus(null);
    try {
      const out = await exportNodes(fileId, ids.slice(0, 1), [{ format: "png", scale: "2x" }], { destination: "none" });
      const blob = out.files[0]?.blob;
      if (!blob) throw new Error(out.errors[0] ?? "Nothing to copy");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus({ text: "Copied as PNG at 2x" });
    } catch (e) {
      setStatus({ text: `Copy failed: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  };

  const presets = (e: MouseEvent<HTMLButtonElement>) =>
    openMenu(
      [
        { type: "label", label: nodes.length > 1 ? `Replace the settings of ${nodes.length} layers` : "Replace export settings" },
        ...EXPORT_PRESETS.map((p) => ({
          label: `${p.label}  (${p.settings.length} ${p.settings.length === 1 ? "file" : "files"})`,
          onSelect: () => {
            write(p.settings, `Export preset ${p.label}`);
            const warn = single && rect ? presetWarnings(p, rect.width, rect.height) : [];
            setStatus(warn.length ? { text: warn.join(" "), error: true } : { text: `${p.label}: ${p.detail}.` });
          },
        })),
      ],
      e.currentTarget,
      { minWidth: 240 },
    );

  const previewName = single ? exportFileName(single.name, first) : "";
  return (
    <Section
      title="Export"
      actions={
        <>
          <button type="button" className="of-text-btn accent" onClick={presets}>Presets</button>
          {single ? <IconButton icon="plus" iconSize={12} size="xs" label="Add export" onClick={() => write([...settings, { format: "png", scale: settings.length ? (["1x", "2x", "3x", "4x"].find((scale) => !settings.some((s) => s.scale === scale)) ?? "2x") : "2x" }])} /> : null}
        </>
      }
    >
      {single
        ? settings.map((s, i) => (
            <ExportRow key={i} setting={s} doc={doc} node={single} onChange={(next) => write(settings.map((x, j) => (j === i ? next : x)))} onRemove={() => write(settings.filter((_, j) => j !== i))} />
          ))
        : <span className="of-hint">{nodes.length} layers, each with its own export settings (PNG at 2x when none are set).</span>}
      {single && settings.length === 0 ? <span className="of-hint">No export settings yet. Exports PNG at 2x.</span> : null}
      {single ? (
        <div className="of-export-preview">
          <div className="thumb">
            {preview ? <img src={preview.url} alt={`Preview of ${single.name}`} /> : <Icon name="image" size={16} style={{ color: "var(--of-muted)" }} />}
          </div>
          <div className="meta">
            <span className="name">{previewName}{settings.length > 1 ? ` and ${settings.length - 1} more` : ""}</span>
            <span>{sizeLabel(first, single, rect, preview && preview.key === `${single.id}:${JSON.stringify(first)}` ? preview.bytes : null)}</span>
          </div>
        </div>
      ) : null}
      <div className="of-row" style={{ gap: 6, paddingTop: 4 }}>
        <Button variant="primary" size="md" className="of-export-go" onClick={() => void run()} aria-label={busy ? "Cancel export" : undefined}>
          {busy ? (
            <>
              <span className="bar" style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
              <span className="lbl">{hasVideo ? `${Math.round(busy.fraction * 100)}%  Cancel` : "Exporting"}</span>
            </>
          ) : (
            `Export ${fileCount} ${fileCount === 1 ? "file" : "files"}`
          )}
        </Button>
        <IconButton icon="copy" iconSize={14} outlined label="Copy as PNG" disabled={!single || !!busy} onClick={() => void copyPng()} className="of-export-copy" />
        <IconButton icon="more" iconSize={14} outlined label="More export options" disabled={!!busy} className="of-export-copy" onClick={(e) => openMenu([
          { label: "Save to workspace Exports folder", onSelect: () => void run("workspace") },
          { label: "Export combined PDF", disabled: ids.length < 2, onSelect: () => void combinedPdf() },
        ], e.currentTarget, { placement: "top" })} />
      </div>
      {busy && hasVideo ? <span className="of-hint of-mono">{busy.label}</span> : null}
      {status ? <span className="of-hint" style={{ color: status.error ? "var(--of-danger)" : "var(--of-success)" }}>{status.text}</span> : null}
      {menu}
    </Section>
  );
}

/** Page level: every layer on the page that has export settings, in one go. */
export function ExportAllSection({ doc, fileId, pageId }: { doc: FoldDocument; fileId: string; pageId: string }) {
  const page = doc.pages[pageId];
  const [busy, setBusy] = useState<ExportProgress | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  if (!page) return null;
  const withSettings = descendants(doc, page.rootId).filter((n) => n.exports?.length);
  const files = withSettings.reduce((n, node) => n + node.exports!.length, 0);
  const run = async () => {
    setBusy({ fraction: 0, label: "Starting" });
    setStatus(null);
    try {
      const out = await exportRequests(fileId, withSettings.map((n) => ({ nodeId: n.id, settings: n.exports! })), "download", { onProgress: setBusy });
      setStatus({ text: [`Downloaded ${out.files.length} ${out.files.length === 1 ? "file" : "files"}.`, ...out.warnings, ...out.errors].join(" "), error: out.errors.length > 0 });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Export">
      <span className="of-hint">
        {withSettings.length
          ? `${withSettings.length} ${withSettings.length === 1 ? "layer" : "layers"} on this page ${withSettings.length === 1 ? "has" : "have"} export settings.`
          : "No layer on this page has export settings yet. Select a layer and add some in its Export section."}
      </span>
      <Button variant="primary" size="md" className="of-export-go" disabled={!withSettings.length || !!busy} onClick={() => void run()}>
        {busy ? (
          <>
            <span className="bar" style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
            <span className="lbl">Exporting</span>
          </>
        ) : (
          `Export all with settings${files ? ` (${files})` : ""}`
        )}
      </Button>
      {status ? <span className="of-hint" style={{ color: status.error ? "var(--of-danger)" : "var(--of-success)" }}>{status.text}</span> : null}
    </Section>
  );
}
