import { useEffect, useRef, useState, type ReactNode } from "react";
import { providerKindInfo, type AgentTurn } from "@opencrease/protocol";
import { capable, defaultProvider, openAiSettings, useAiSettings } from "../../ai/api";
import { clearConversation, loadConversation, sendAgentMessage, stopAgent, useConversation } from "../../ai/conversation";
import { getOpenFile } from "../../state/workspace";
import { AgentAvatar, Button, Icon, SelectField } from "../../ui";
import "./agent-chat.css";

function Turn({ turn }: { turn: AgentTurn }) {
  return (
    <article className={`of-chat-turn ${turn.role}`}>
      <div className="of-chat-author">
        {turn.role === "assistant" ? <AgentAvatar client={turn.client ?? "opencrease-agent"} size={18} /> : null}
        <span>{turn.role === "user" ? "You" : turn.providerKind === "anthropic" ? "Claude" : "Agent"}</span>
        {turn.model ? <span className="of-chat-model" title={turn.model}>{turn.model}</span> : null}
      </div>
      {turn.selection?.length ? <div className="of-chat-selection">{turn.selection.map((s) => s.name).join(", ")}</div> : null}
      {turn.text ? <div className="of-chat-text">{turn.text}</div> : null}
      {turn.parts?.map((part, index) => part.type === "text" ? <div key={index} className="of-chat-text">{part.text}</div> : (
        <div key={index} className="of-steps">
          {part.steps.map((step) => (
            <div key={step.id} className={`of-step${step.status === "error" ? " error" : ""}`} title={step.error ?? step.tool}>
              {step.status === "running" ? <span className="of-gen-spin" /> : <Icon name={step.status === "error" ? "warning" : step.image ? "image" : "check"} size={12} />}
              <span className="what">{step.tool.replaceAll("_", " ")}{step.label ? `: ${step.label}` : ""}</span>
            </div>
          ))}
        </div>
      ))}
      {turn.error ? <div className="of-ai-error" role="alert">{turn.error}</div> : null}
      {turn.stopped ? <div className="of-hint">Stopped</div> : null}
    </article>
  );
}

export function AgentChat({ fileId, activity }: { fileId: string; activity: ReactNode }) {
  const { settings, error: settingsError } = useAiSettings();
  const conversation = useConversation(fileId);
  const [draft, setDraft] = useState("");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [sending, setSending] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  const providers = settings?.providers.filter((p) => capable(p, "chat")) ?? [];
  const provider = providers.find((p) => p.id === providerId) ?? defaultProvider(settings, "chat");
  const info = provider && providerKindInfo(provider.kind);
  const running = conversation.running;
  const canSend = !!draft.trim() && !!provider && !running && !conversation.loading && !sending;
  useEffect(() => { setDraft(""); setModel(""); }, [fileId]);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }); }, [conversation.turns, running]);

  const submit = async () => {
    if (!canSend) return;
    const text = draft.trim();
    const file = getOpenFile(fileId);
    const selection = file?.selection.flatMap((id) => {
      const node = file.store.doc.nodes[id];
      return node ? [{ id, name: node.name, type: node.type }] : [];
    });
    setDraft("");
    setSending(true);
    const accepted = await sendAgentMessage(fileId, { text, providerId: provider.id, ...(model.trim() ? { model: model.trim() } : {}), selection, pageId: file?.activePageId });
    if (!accepted) setDraft(text);
    setSending(false);
  };

  return (
    <div className="of-agent-chat">
      <div className="of-chat-toolbar">
        <button className={`of-chat-view${!showActivity ? " active" : ""}`} onClick={() => setShowActivity(false)}>Chat</button>
        <button className={`of-chat-view${showActivity ? " active" : ""}`} onClick={() => setShowActivity(true)}>Activity</button>
        <button className="of-icon-btn sm" style={{ marginLeft: "auto" }} aria-label="AI provider settings" onClick={openAiSettings}><Icon name="settings" size={13} /></button>
        <button className="of-icon-btn sm" aria-label="Clear conversation" title="Clear conversation" disabled={running || !conversation.turns.length} onClick={() => void clearConversation(fileId)}><Icon name="trash" size={13} /></button>
      </div>
      <div className="of-agent-feed" ref={feed}>
        {showActivity ? activity : <>
          {!conversation.turns.length ? (
            <div className="of-chat-welcome">
              <span className="of-chat-welcome-title">Design with an agent</span>
              <span className="of-hint">Describe what to make or select a layer to refine. Your agent reads the design guide, edits the canvas and reviews its work with screenshots.</span>
              {!provider && settings ? <Button size="sm" onClick={openAiSettings}>Set up a provider</Button> : null}
            </div>
          ) : null}
          {conversation.turns.map((turn) => <Turn key={turn.id} turn={turn} />)}
          {running ? <div className="of-chat-working" role="status"><span className="of-gen-spin" /> Agent is working</div> : null}
        </>}
        {conversation.error || settingsError ? <div className="of-ai-error" role="alert">{conversation.error ?? settingsError}<button className="of-chat-retry" onClick={() => void loadConversation(fileId)}>Reload</button></div> : null}
      </div>
      <div className="of-composer of-chat-composer">
        {provider ? <div className="of-chat-provider">
          <AgentAvatar client={provider.kind === "anthropic" ? "claude-in-app" : "opencrease-agent"} size={18} />
          <SelectField value={provider.id} options={providers.map((p) => ({ value: p.id, label: p.label }))} onChange={(id) => { setProviderId(id); setModel(""); }} ariaLabel="Agent provider" />
        </div> : <button className="of-chat-setup" onClick={openAiSettings}>{settings ? "Add a chat provider to start" : "Loading providers"}</button>}
        {provider ? <input className="of-chat-model-input" aria-label="Agent model" list="of-agent-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider.chatModel || "Model id"} disabled={running} /> : null}
        <datalist id="of-agent-models">{info?.chatModels.map((id) => <option key={id} value={id} />)}</datalist>
        <textarea className="of-input" aria-label="Message agent" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!provider || conversation.loading} placeholder={provider ? "Describe a design or ask for an edit…" : "Configure Anthropic or an OpenAI-compatible provider in Settings."} onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); setShowActivity(false); void submit(); }
        }} />
        <div className="of-chat-send-row">
          <span className="of-hint">Shift Enter for a new line</span>
          {running ? <Button size="sm" onClick={() => void stopAgent(fileId)}>Stop</Button> : <Button size="sm" variant="primary" disabled={!canSend} onClick={() => { setShowActivity(false); void submit(); }}>Send <Icon name="arrow" size={12} /></Button>}
        </div>
      </div>
    </div>
  );
}
