// AI image section: prompt, model and seed of a generated image, with regenerate and edit.
import { useEffect, useState } from "react";
import { generateForNode, useGenJobs } from "../../../ai/gen-jobs";
import { currentImage, pendingGen } from "../../../ai/gen-logic";
import { openAiGenerate } from "../../../dialogs/DialogHost";
import { getOpenFile } from "../../../state/workspace";
import { Button, IconButton, Section } from "../../../ui";
import { useCtx } from "./common";

export function AiImageSection() {
  const { fileId, nodes } = useCtx();
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const jobs = useGenJobs(fileId);
  const pending = node ? pendingGen(node) : null;
  const gen = node?.gen;
  const stored = gen?.prompt ?? pending?.spec.prompt ?? "";
  const [prompt, setPrompt] = useState(stored);
  useEffect(() => setPrompt(stored), [stored, node?.id]);

  if (!node || !["Image", "Frame", "Rectangle"].includes(node.type)) return null;
  const job = jobs.get(node.id);
  const has = !!gen || !!pending;
  if (!has && !currentImage(node)) {
    return (
      <Section
        title="AI image"
        collapsed
        onHeaderClick={() => openAiGenerate("image")}
        actions={<IconButton icon="plus" iconSize={12} size="xs" label="Generate image (⇧⌘I)" onClick={() => openAiGenerate("image")} />}
      />
    );
  }

  const busy = job?.status === "processing";
  const changed = prompt.trim() !== stored.trim();
  const canEdit = !!currentImage(node) && !pending;
  const savePrompt = () => {
    if (!gen || !changed || !prompt.trim()) return;
    getOpenFile(fileId)?.store.transact("Edit prompt", (tx) => tx.updateNode(node.id, { gen: { ...gen, prompt: prompt.trim() } }));
  };
  const meta = [gen?.model ?? pending?.spec.model, gen?.seed !== undefined ? `seed ${gen.seed}` : undefined, gen?.width && gen.height ? `${gen.width} × ${gen.height}` : undefined, gen?.edit ? "edited" : undefined]
    .filter(Boolean)
    .join(", ");

  return (
    <Section title="AI image">
      {has ? <textarea
        className="of-ai-inspector-prompt"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={savePrompt}
        aria-label="Prompt"
        spellCheck={false}
      /> : null}
      {meta ? <div className="of-hint of-mono" style={{ fontSize: 10, lineHeight: "14px" }}>{meta}</div> : null}
      {job?.status === "error" ? <div style={{ color: "var(--of-danger)", fontSize: "var(--of-text-xs)", lineHeight: "16px" }}>{job.error}</div> : null}
      {pending && !job ? <div className="of-hint">Not generated yet.</div> : null}
      <div className="of-row">
        <Button
          size="sm"
          style={{ flex: 1 }}
          disabled={busy || (has && !prompt.trim())}
          onClick={() => {
            if (!has) { openAiGenerate("image"); return; }
            savePrompt();
            void generateForNode(fileId, node.id, { prompt: prompt.trim() });
          }}
        >
          {busy ? (job?.verb === "Editing" ? "Editing" : "Generating") : pending || !has ? "Generate" : "Regenerate"}
        </Button>
        <Button size="sm" style={{ flex: 1 }} disabled={busy || !canEdit} onClick={() => openAiGenerate("edit")} title="Change this image with a prompt, keeping its size">
          Edit image
        </Button>
      </div>
    </Section>
  );
}
