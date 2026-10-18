// Plugins execute in opaque-origin iframes with no network, storage or parent DOM access.
// Only source-checked messages can reach the ordinary tool router and permission gate.
import { getTool, type ToolResult } from "@opencrease/protocol";

export interface PluginInfo { id: string; name: string; description: string; builtin: boolean; commands: Array<{ id: string; title: string }> }
export async function listPlugins(): Promise<PluginInfo[]> {
  const res = await fetch("/api/plugins");
  if (!res.ok) throw new Error(`Could not load plugins (${res.status})`);
  return ((await res.json()) as { plugins: PluginInfo[] }).plugins;
}

export async function runPlugin(plugin: PluginInfo, command: string, fileId: string, notify: (text: string) => void): Promise<void> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(plugin.id)}/source`);
  if (!res.ok) throw new Error(`Could not read plugin (${res.status})`);
  const source = await res.text();
  const nonce = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.sandbox.add("allow-scripts");
  frame.title = plugin.name;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob:; connect-src 'none'; worker-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'"><script nonce="${nonce}">
  let seq=0; const waiting=new Map();
  const request=(type,data)=>new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});parent.postMessage({type,id,...data},'*')});
  addEventListener('message', async e=>{
    if(e.source!==parent)return;
    const m=e.data;
    if(m.type==='reply'){const p=waiting.get(m.id);if(p){waiting.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.value)}return}
    if(m.type!=='start')return;
    try{
      const url=URL.createObjectURL(new Blob([m.source],{type:'text/javascript'}));
      const mod=await import(url);URL.revokeObjectURL(url);
      const api={call:(tool,args={})=>request('call',{tool,args}),callJson:async(tool,args={})=>{const r=await api.call(tool,args);if(r.isError)throw new Error(r.content.filter(c=>c.type==='text').map(c=>c.text).join('\\n'));const texts=r.content.filter(c=>c.type==='text');for(const c of texts){try{const v=JSON.parse(c.text);if(!v.file||!v.contentHash)return v}catch{}}return {}},notify:text=>parent.postMessage({type:'notify',text:String(text)},'*'),prompt:(text,value='')=>request('prompt',{text:String(text),value:String(value)})};
      await mod.default(api,{command:m.command,fileId:m.fileId});parent.postMessage({type:'done'},'*');
    }catch(error){parent.postMessage({type:'failed',error:String(error.message||error)},'*')}
  });parent.postMessage({type:'ready'},'*');
  <\/script>`;
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", onMessage); frame.remove(); };
    const finish = (error?: string) => { cleanup(); error ? reject(new Error(error)) : resolve(); };
    const timer = setTimeout(() => finish("Plugin exceeded the two minute time limit"), 120_000);
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
      const m = event.data as Record<string, unknown>;
      const reply = (value?: unknown, error?: string) => frame.contentWindow?.postMessage({ type: "reply", id: m.id, value, error }, "*");
      if (m.type === "ready") frame.contentWindow?.postMessage({ type: "start", source, command, fileId }, "*");
      else if (m.type === "done") finish();
      else if (m.type === "failed") finish(String(m.error));
      else if (m.type === "notify") notify(String(m.text).slice(0, 1000));
      else if (m.type === "prompt") reply(window.prompt(String(m.text).slice(0, 500), String(m.value).slice(0, 500)));
      else if (m.type === "call") {
        try {
          const tool = typeof m.tool === "string" ? getTool(m.tool) : undefined;
          if (!tool) throw new Error("Unknown tool");
          const args = m.args && typeof m.args === "object" && !Array.isArray(m.args) ? { ...m.args } as Record<string, unknown> : {};
          if ("fileId" in tool.inputShape) args.fileId = fileId;
          const r = await fetch("/api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: tool.name, args, client: { name: `plugin:${plugin.id}` } }) });
          if (!r.ok) throw new Error(`Tool request failed (${r.status})`);
          reply(await r.json() as ToolResult);
        } catch (error) { reply(undefined, String((error as Error).message)); }
      }
    };
    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}
