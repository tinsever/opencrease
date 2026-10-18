// Screen-space status of AI images on the canvas: generating, ready, failed, or not generated yet.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { descendants, type NodeId } from "@opencrease/model";
import { openAiSettings } from "../ai/api";
import { dismissGenJob, generateForNode, useGenJobs, type GenJob } from "../ai/gen-jobs";
import { pendingGen } from "../ai/gen-logic";
import { useDoc, useWorkspace } from "../state/hooks";
import { Icon } from "../ui";
import { getViewportLive, getWorldRect, subscribeViewport } from "./registry";
import { rectToScreen, type ViewportValue } from "./viewport-math";
import "./gen-status.css";

interface Item {
  id: NodeId;
  job?: GenJob;
}

function Chip({ fileId, item, x, y, maxWidth }: { fileId: string; item: Item; x: number; y: number; maxWidth: number }) {
  const job = item.job;
  const status = job?.status ?? "pending";
  const noProvider = !!job?.error && /No image provider/i.test(job.error);
  return (
    <div className={`of-gen-chip ${status}`} style={{ left: x, top: y, maxWidth: Math.max(150, maxWidth) }} data-of-gen-status={status} onPointerDown={(e) => e.stopPropagation()}>
      {status === "processing" ? <span className="of-gen-spin" aria-hidden /> : null}
      {status === "ready" ? <Icon name="check" size={12} /> : null}
      {status === "error" ? <Icon name="warning" size={12} /> : null}
      {status === "pending" ? <Icon name="image" size={12} /> : null}
      <span className="msg" title={job?.error}>
        {status === "processing" ? `${job!.verb} image` : status === "ready" ? "Image ready" : status === "error" ? job!.error : "Image not generated"}
      </span>
      {status === "error" ? (
        <>
          {noProvider ? (
            <button onClick={openAiSettings}>Set up</button>
          ) : (
            <button onClick={() => void generateForNode(fileId, item.id)}>Retry</button>
          )}
          <button className="x" aria-label="Dismiss" onClick={() => dismissGenJob(fileId, item.id)}>
            <Icon name="close" size={10} />
          </button>
        </>
      ) : null}
      {status === "pending" ? <button onClick={() => void generateForNode(fileId, item.id)}>Generate</button> : null}
    </div>
  );
}

export function GenStatusLayer({ fileId }: { fileId: string }) {
  const vp = useSyncExternalStore(subscribeViewport, getViewportLive) as ViewportValue;
  const doc = useDoc(fileId);
  const pageId = useWorkspace((s) => s.openFiles.find((f) => f.id === fileId)?.activePageId);
  const jobs = useGenJobs(fileId);
  // measure after the canvas has rendered the latest document
  const [, setTick] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setTick((t) => t + 1));
    return () => cancelAnimationFrame(raf);
  }, [doc, pageId, jobs.size]);

  // Panning only repositions these chips; scan the document when its nodes or jobs change.
  const items = useMemo(() => {
    const rootId = pageId && doc?.pages[pageId]?.rootId;
    if (!doc || !rootId) return [];
    const out: Item[] = [];
    for (const n of descendants(doc, rootId)) {
      const job = jobs.get(n.id);
      if (n.visible && (job || pendingGen(n))) out.push({ id: n.id, job });
    }
    return out;
  }, [doc, pageId, jobs]);
  if (!items.length) return null;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }} aria-live="polite">
      {items.map((item) => {
        const r = getWorldRect(item.id);
        if (!r) return null;
        const s = rectToScreen(vp, r);
        const processing = item.job?.status === "processing";
        return (
          <div key={item.id}>
            {processing ? <div className="of-gen-outline" style={{ left: s.x, top: s.y, width: s.width, height: s.height }} /> : null}
            <Chip fileId={fileId} item={item} x={s.x + 8} y={s.y + 8} maxWidth={s.width - 16} />
          </div>
        );
      })}
    </div>
  );
}
