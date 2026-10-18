// AI features (SPEC §10): provider catalogue, REST shapes shared by the server and the editor,
// the in-app agent's stream events and the gen:// image URL scheme.

export type AiProviderKind =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "gemini"
  | "replicate"
  | "fal"
  | "xai"
  | "comfyui"
  | "automatic1111";

export type AiCapability = "image" | "chat";

export interface AiProviderKindInfo {
  kind: AiProviderKind;
  label: string;
  capabilities: AiCapability[];
  /** default base URL; empty when the user must enter one */
  baseUrl: string;
  key: "required" | "optional" | "none";
  imageModels: string[];
  chatModels: string[];
  /** can edit an existing image (restyle, in-paint by prompt) */
  imageEdits: boolean;
  /** the provider honours a seed, so regenerating with the same seed is repeatable */
  seeds: boolean;
  /** one line shown under the provider in Settings */
  hint: string;
}

/** Current Claude models for the in-app agent, most capable default first. */
export const CLAUDE_MODELS: Array<{ id: string; label: string }> = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
];

export const AI_PROVIDER_KINDS: AiProviderKindInfo[] = [
  {
    kind: "anthropic",
    label: "Anthropic",
    capabilities: ["chat"],
    baseUrl: "https://api.anthropic.com",
    key: "required",
    imageModels: [],
    chatModels: CLAUDE_MODELS.map((m) => m.id),
    imageEdits: false,
    seeds: false,
    hint: "Claude for the in-app agent and SVG generation.",
  },
  {
    kind: "openai",
    label: "OpenAI",
    capabilities: ["chat", "image"],
    baseUrl: "https://api.openai.com/v1",
    key: "required",
    imageModels: ["gpt-image-1"],
    chatModels: ["gpt-5"],
    imageEdits: true,
    seeds: false,
    hint: "OpenAI Images for generation and edits, chat completions for the agent.",
  },
  {
    kind: "openai-compatible",
    label: "OpenAI-compatible",
    capabilities: ["chat", "image"],
    baseUrl: "",
    key: "optional",
    imageModels: [],
    chatModels: [],
    imageEdits: true,
    seeds: false,
    hint: "Any /v1 endpoint: OpenRouter (https://openrouter.ai/api/v1), Ollama (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1).",
  },
  {
    kind: "gemini",
    label: "Google Gemini",
    capabilities: ["image"],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    key: "required",
    imageModels: ["gemini-2.5-flash-image"],
    chatModels: [],
    imageEdits: true,
    seeds: false,
    hint: "Gemini image generation and editing with a Google AI Studio key.",
  },
  {
    kind: "replicate",
    label: "Replicate",
    capabilities: ["image"],
    baseUrl: "https://api.replicate.com/v1",
    key: "required",
    imageModels: ["black-forest-labs/flux-schnell", "black-forest-labs/flux-kontext-pro"],
    chatModels: [],
    imageEdits: true,
    seeds: true,
    hint: "Any image model on Replicate. Edits need a model that takes an input image, like flux-kontext-pro.",
  },
  {
    kind: "fal",
    label: "fal",
    capabilities: ["image"],
    baseUrl: "https://fal.run",
    key: "required",
    imageModels: ["fal-ai/flux/schnell", "fal-ai/flux/dev/image-to-image"],
    chatModels: [],
    imageEdits: true,
    seeds: true,
    hint: "fal model endpoints. Edits need an image-to-image endpoint.",
  },
  {
    kind: "xai",
    label: "xAI",
    capabilities: ["image"],
    baseUrl: "https://api.x.ai/v1",
    key: "required",
    imageModels: ["grok-2-image"],
    chatModels: [],
    imageEdits: false,
    seeds: false,
    hint: "Grok image generation. xAI picks the image size itself.",
  },
  {
    kind: "comfyui",
    label: "ComfyUI",
    capabilities: ["image"],
    baseUrl: "http://127.0.0.1:8188",
    key: "none",
    imageModels: [],
    chatModels: [],
    imageEdits: false,
    seeds: true,
    hint: "Local ComfyUI. Set the model to a checkpoint file name, e.g. sd_xl_base_1.0.safetensors.",
  },
  {
    kind: "automatic1111",
    label: "Automatic1111",
    capabilities: ["image"],
    baseUrl: "http://127.0.0.1:7860",
    key: "none",
    imageModels: [],
    chatModels: [],
    imageEdits: true,
    seeds: true,
    hint: "Local Stable Diffusion web UI started with --api. The model is optional (a checkpoint title).",
  },
];

export function providerKindInfo(kind: string): AiProviderKindInfo | undefined {
  return AI_PROVIDER_KINDS.find((k) => k.kind === kind);
}

// ------------------------------------------------------------------------------------- REST shapes

/** A configured provider as the browser sees it: never the key itself. */
export interface AiProviderView {
  id: string;
  kind: AiProviderKind;
  label: string;
  baseUrl: string;
  imageModel: string;
  chatModel: string;
  hasKey: boolean;
  /** "…abcd": the last four characters of the key, or "" */
  keyHint: string;
}

export interface AiDefaults {
  /** provider id used for image generation */
  image?: string;
  /** provider id used for the in-app agent and SVG generation */
  chat?: string;
}

export interface AiSettingsView {
  providers: AiProviderView[];
  defaults: AiDefaults;
  /** where the keys live, for the settings page */
  secretsPath: string;
}

/** POST /api/ai/providers and PATCH /api/ai/providers/:id. apiKey: a string sets it, null clears it, omitted keeps it. */
export interface AiProviderInput {
  kind?: AiProviderKind;
  label?: string;
  baseUrl?: string;
  imageModel?: string;
  chatModel?: string;
  apiKey?: string | null;
}

export interface AiImageRequest {
  fileId: string;
  prompt: string;
  providerId?: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  /** edit this image instead of generating from scratch: an asset hash of the file, or an http(s)/data URL */
  reference?: string;
  /** nearby canvas text to preserve the design context when editing */
  contextText?: string;
}

export interface AiImageResult {
  asset: { hash: string; mime: string; size: number; width?: number; height?: number; name?: string };
  providerId: string;
  providerKind: AiProviderKind;
  model: string;
  /** only when the provider honours seeds */
  seed?: number;
}

export interface AiSvgRequest {
  prompt: string;
  providerId?: string;
  model?: string;
  /** the selected frame, as context */
  context?: { name?: string; html?: string; width?: number; height?: number; image?: { data: string; mimeType: string } };
}

export interface AiSvgResult {
  svg: string;
  providerId: string;
  model: string;
}

// ------------------------------------------------------------------------------------- in-app agent

export interface AgentSelectionItem {
  id: string;
  name: string;
  type: string;
}

export interface AgentMessageRequest {
  text: string;
  providerId?: string;
  model?: string;
  selection?: AgentSelectionItem[];
  pageId?: string;
}

export interface AgentStep {
  id: string;
  tool: string;
  /** short human label, e.g. "Hero" */
  label: string;
  status: "running" | "ok" | "error";
  error?: string;
  /** the tool returned an image (screenshots) */
  image?: boolean;
}

export type AgentTurnPart = { type: "text"; text: string } | { type: "steps"; steps: AgentStep[] };

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  time: number;
  /** user turns */
  text?: string;
  selection?: AgentSelectionItem[];
  /** assistant turns */
  parts?: AgentTurnPart[];
  model?: string;
  providerKind?: AiProviderKind;
  /** MCP client name the agent's tool calls are attributed to */
  client?: string;
  error?: string;
  stopped?: boolean;
}

export interface AgentConversationView {
  fileId: string;
  turns: AgentTurn[];
  running: boolean;
}

/** Server-sent events of POST /api/ai/agent/:fileId (one JSON object per `data:` line). */
export type AgentStreamEvent =
  | { type: "turn"; turn: AgentTurn }
  | { type: "text"; delta: string }
  | { type: "step"; step: AgentStep }
  | { type: "done"; stopReason: string; turn: AgentTurn }
  | { type: "error"; message: string; turn?: AgentTurn };

/** Client name for in-app agent tool calls: Claude-backed agents show the Claude mark. */
export function inAppAgentClient(kind: AiProviderKind): string {
  return kind === "anthropic" ? "claude-in-app" : "opencrease-agent";
}

// ------------------------------------------------------------------------------------- gen:// URLs

export interface GenUrlSpec {
  prompt: string;
  model?: string;
  provider?: string;
  width?: number;
  height?: number;
  seed?: number;
}

const GEN_RE = /^(?:paper-)?gen:\/\//i;

export function isGenUrl(url: string): boolean {
  return GEN_RE.test(url.trim());
}

/** Parse `gen://image?prompt=…&model=…&w=…&h=…` (also `paper-gen://`). Returns null when there is no prompt. */
export function parseGenUrl(url: string): GenUrlSpec | null {
  const s = url.trim();
  if (!GEN_RE.test(s)) return null;
  const q = s.indexOf("?");
  if (q < 0) return null;
  const params = new URLSearchParams(s.slice(q + 1));
  const prompt = (params.get("prompt") ?? params.get("p") ?? "").trim();
  if (!prompt) return null;
  const out: GenUrlSpec = { prompt };
  const model = params.get("model");
  if (model) out.model = model;
  const provider = params.get("provider");
  if (provider) out.provider = provider;
  const num = (k: string[]) => {
    for (const key of k) {
      const v = Number(params.get(key));
      if (params.get(key) !== null && Number.isFinite(v) && v > 0) return Math.round(v);
    }
    return undefined;
  };
  const w = num(["w", "width"]);
  const h = num(["h", "height"]);
  const seed = num(["seed"]);
  if (w) out.width = w;
  if (h) out.height = h;
  if (seed) out.seed = seed;
  return out;
}

export function buildGenUrl(spec: GenUrlSpec): string {
  const p = new URLSearchParams({ prompt: spec.prompt });
  if (spec.model) p.set("model", spec.model);
  if (spec.provider) p.set("provider", spec.provider);
  if (spec.width) p.set("w", String(Math.round(spec.width)));
  if (spec.height) p.set("h", String(Math.round(spec.height)));
  if (spec.seed) p.set("seed", String(spec.seed));
  return `gen://image?${p.toString()}`;
}

/** All gen URLs inside a CSS value like `url("gen://image?...")`, in order. */
export function genUrlsInCss(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/url\(\s*(['"]?)((?:paper-)?gen:\/\/[^'")]+)\1\s*\)/gi)) out.push(m[2]!);
  return out;
}
