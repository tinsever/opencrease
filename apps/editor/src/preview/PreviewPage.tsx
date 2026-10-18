import { useEffect, useRef, useState } from "react";
import type { FoldDocument } from "@opencrease/model";
import { api } from "../state/api";
import { loadFontMeta } from "../canvas/font-meta";
import { loadSystemFonts } from "../desktop/desktop";
import { previewChannel } from "./preview";
import { previewHtml } from "./html";

export function Preview({ fileId, nodeId }: { fileId: string; nodeId: string }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef({ x: 0, y: 0 });
  useEffect(() => {
    let disposed = false;
    let lastLive = 0;
    let current: FoldDocument | undefined;
    const render = (doc: FoldDocument) => {
      if (disposed || doc.id !== fileId) return;
      current = doc;
      try {
        const view = frame.current?.contentWindow;
        if (view) scroll.current = { x: view.scrollX, y: view.scrollY };
        setHtml(previewHtml(doc, nodeId, location.origin));
        setError("");
        document.title = `${doc.nodes[nodeId].name} — Preview`;
      } catch (e) { setError((e as Error).message); }
    };
    const channel = new BroadcastChannel(previewChannel(fileId));
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === "document" && event.data.doc?.id === fileId) {
        lastLive = Date.now();
        render(event.data.doc as FoldDocument);
      }
    };
    channel.postMessage({ type: "request" });
    // Reloaded or independently opened previews can use the last saved document too.
    const refresh = () => void api.getFile(fileId).then((doc) => { if (Date.now() - lastLive > 4000) render(doc); }).catch((e: Error) => { if (!disposed && Date.now() - lastLive > 4000) setError(e.message); });
    refresh();
    const poll = setInterval(() => { channel.postMessage({ type: "request" }); if (Date.now() - lastLive > 4000) refresh(); }, 2000);
    loadSystemFonts();
    void loadFontMeta().then(() => { if (current) render(current); });
    return () => { disposed = true; clearInterval(poll); channel.close(); };
  }, [fileId, nodeId]);
  if (error) return <div role="alert" style={{ padding: 24 }}>{error}</div>;
  return <iframe ref={frame} title="Artboard preview" sandbox="allow-same-origin" srcDoc={html} onLoad={() => frame.current?.contentWindow?.scrollTo(scroll.current.x, scroll.current.y)} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, background: "white" }} />;
}
