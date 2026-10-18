// Image generation jobs: one per node at a time. A job asks the server to generate (or edit) an image,
// then swaps it into the node's src or background fill and stores the prompt, model and seed on the node.
// Status (processing, ready, error) is kept here and drawn on the canvas by GenStatusLayer.
import { descendants, type NodeId } from "@opencrease/model";
import { useMemo, useSyncExternalStore } from "react";
import { getWorldRect } from "../canvas/registry";
import { api } from "../state/api";
import { getOpenFile } from "../state/workspace";
import { aiApi, defaultProvider, ensureAiSettings, getAiSettings } from "./api";
import { assetHashOf, currentImage, genSpec, pendingGen, replaceFillUrl, setFillImage, type GenTarget } from "./gen-logic";

export type GenStatus = "processing" | "ready" | "error";

export interface GenJob {
  status: GenStatus;
  error?: string;
  /** "Generating" or "Editing" */
  verb: string;
  started: number;
  options?: GenerateOptions;
}

const jobs = new Map<string, GenJob>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, GenJob> = new Map();
const READY_MS = 2600;

const key = (fileId: string, nodeId: NodeId) => `${fileId}|${nodeId}`;

function emit() {
  snapshot = new Map(jobs);
  for (const l of [...listeners]) l();
}

function setJob(fileId: string, nodeId: NodeId, job: GenJob | null) {
  if (job) jobs.set(key(fileId, nodeId), job);
  else jobs.delete(key(fileId, nodeId));
  emit();
}

export function getGenJob(fileId: string, nodeId: NodeId): GenJob | undefined {
  return jobs.get(key(fileId, nodeId));
}

export function dismissGenJob(fileId: string, nodeId: NodeId): void {
  setJob(fileId, nodeId, null);
}

/** All jobs of a file, by node id. */
export function useGenJobs(fileId: string): Map<NodeId, GenJob> {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
  return useMemo(() => {
    const out = new Map<NodeId, GenJob>();
    const prefix = `${fileId}|`;
    for (const [k, v] of all) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
    return out;
  }, [all, fileId]);
}

export interface GenerateOptions {
  /** new prompt (default: the pending URL's or the stored one) */
  prompt?: string;
  model?: string;
  provider?: string;
  /** keep the stored seed (default: a fresh image) */
  keepSeed?: boolean;
  /** edit the current image instead of generating from scratch */
  edit?: boolean;
  /** for nodes without a pending URL or stored spec */
  target?: GenTarget;
}

function sizeFor(nodeId: NodeId, spec?: { width?: number; height?: number }): { width: number; height: number } {
  if (spec?.width && spec.height) return { width: spec.width, height: spec.height };
  const r = getWorldRect(nodeId);
  if (r && r.width >= 8 && r.height >= 8) return { width: Math.round(r.width), height: Math.round(r.height) };
  return { width: 1024, height: 1024 };
}

/**
 * Generate an image for a node. Uses, in order: the node's pending gen:// URL, its stored gen spec
 * (regenerate), or `opts` (a new generation from the dialog). Resolves when the job ends; never throws.
 */
export async function generateForNode(fileId: string, nodeId: NodeId, opts: GenerateOptions = {}): Promise<void> {
  const file = getOpenFile(fileId);
  const node = file?.store.doc.nodes[nodeId];
  if (!file || !node) return;
  if (getGenJob(fileId, nodeId)?.status === "processing") return;

  if (getGenJob(fileId, nodeId)?.status === "error") opts = { ...getGenJob(fileId, nodeId)?.options, ...opts };
  const pending = pendingGen(node);
  const current = currentImage(node);
  const target: GenTarget = pending?.target ?? node.gen?.target ?? opts.target ?? (node.type === "Image" ? "src" : "fill");
  const prompt = (opts.prompt ?? pending?.spec.prompt ?? node.gen?.prompt ?? "").trim();
  const verb = opts.edit ? "Editing" : "Generating";
  if (!prompt) {
    setJob(fileId, nodeId, { status: "error", error: "Write a prompt first.", verb, started: Date.now() });
    return;
  }
  const size = sizeFor(nodeId, pending?.spec ?? (opts.edit ? undefined : node.gen));
  const model = opts.model ?? pending?.spec.model ?? (opts.edit ? undefined : node.gen?.model);
  const provider = opts.provider ?? pending?.spec.provider ?? node.gen?.provider;
  const seed = pending?.spec.seed ?? (opts.keepSeed ? node.gen?.seed : undefined);
  const oldUrl = pending?.url ?? (current?.target === target ? current.url : undefined);
  const reference = opts.edit ? current?.url : undefined;
  if (opts.edit && !reference) {
    setJob(fileId, nodeId, { status: "error", error: "There is no image to edit yet.", verb, started: Date.now() });
    return;
  }

  setJob(fileId, nodeId, { status: "processing", verb, started: Date.now(), options: opts });
  try {
    await ensureAiSettings();
    const ref = reference ? (assetHashOf(reference) ?? reference) : undefined;
    const contextRoot = node.parentId ?? node.id;
    const contextText = opts.edit ? [node, ...descendants(file.store.doc, contextRoot)].filter((n) => n.type === "Text").map((n) => n.text).filter(Boolean).join("\n").slice(0, 4000) : "";
    const res = await aiApi.image({
      fileId,
      prompt,
      width: size.width,
      height: size.height,
      ...(model ? { model } : {}),
      ...(provider ? { providerId: provider } : {}),
      ...(seed ? { seed } : {}),
      ...(contextText ? { contextText } : {}),
      ...(ref ? { reference: ref.startsWith("/") ? new URL(ref, location.origin).href : ref } : {}),
    });
    const live = getOpenFile(fileId);
    const now = live?.store.doc.nodes[nodeId];
    if (!live || !now || (target === "src" ? now.src !== node.src : currentImage(now)?.url !== current?.url || pendingGen(now)?.url !== pending?.url)) {
      setJob(fileId, nodeId, null);
      return;
    }
    const spec = genSpec({ prompt, target, provider: res.providerId, model: res.model, seed: res.seed, width: size.width, height: size.height, edit: opts.edit });
    live.store.transact(
      opts.edit ? "Edit image" : "Generate image",
      (tx) => {
        tx.addAsset(res.asset);
        if (target === "src" && now.type === "Image") {
          tx.updateNode(nodeId, { src: `asset://${res.asset.hash}`, gen: spec });
          if (now.styles.objectFit === undefined) tx.setStyles(nodeId, { objectFit: "cover" });
        } else {
          const url = api.assetUrl(fileId, res.asset.hash);
          const patch = (oldUrl && replaceFillUrl(now.styles, oldUrl, url)) || setFillImage(now.styles, url);
          tx.setStyles(nodeId, patch);
          tx.updateNode(nodeId, { gen: { ...spec, target: "fill" } });
        }
      },
      { origin: "system" },
    );
    setJob(fileId, nodeId, { status: "ready", verb, started: Date.now() });
    setTimeout(() => {
      if (getGenJob(fileId, nodeId)?.status === "ready") setJob(fileId, nodeId, null);
    }, READY_MS);
  } catch (err) {
    setJob(fileId, nodeId, { status: "error", error: err instanceof Error ? err.message : String(err), verb, started: Date.now(), options: opts });
  }
}

/** Nodes (and their descendants) that hold gen:// URLs without a running job. */
export function pendingNodeIds(fileId: string, ids: Iterable<NodeId>): NodeId[] {
  const file = getOpenFile(fileId);
  if (!file) return [];
  const doc = file.store.doc;
  const out = new Set<NodeId>();
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n) continue;
    for (const c of [n, ...descendants(doc, id)]) {
      if (out.has(c.id) || !pendingGen(c)) continue;
      if (getGenJob(fileId, c.id)?.status === "processing") continue;
      out.add(c.id);
    }
  }
  return [...out];
}

/**
 * After an agent write: start jobs for new gen:// URLs. Returns a note for the agent, or "" when
 * there was nothing to generate.
 */
export function startPendingGeneration(fileId: string, ids: Iterable<NodeId>): string {
  const pending = pendingNodeIds(fileId, ids);
  if (!pending.length) return "";
  const settings = getAiSettings();
  if (settings && !defaultProvider(settings, "image")) {
    for (const id of pending) setJob(fileId, id, { status: "error", error: "No image provider is configured. Add one in Settings, AI providers.", verb: "Generating", started: Date.now() });
    return `${pending.length === 1 ? "1 image" : `${pending.length} images`} could not be generated: no image provider is configured. The layers keep their gen:// URLs; ask the user to add a provider in Settings, AI providers, then they can generate from the canvas.`;
  }
  for (const id of pending) void generateForNode(fileId, id);
  return `${pending.length === 1 ? "1 image is" : `${pending.length} images are`} generating in the background and will appear on the canvas when ready (usually within a minute). get_node_info shows an asset:// source once an image is done.`;
}
