// Shader nodes: render the named @paper-design/shaders-react component, with a gradient fallback.
import { Component, type ComponentType, type ReactNode } from "react";
import * as Shaders from "@paper-design/shaders-react";
import { safeImageUrl } from "@opencrease/css";
import type { ShaderSpec } from "@opencrease/model";

const FILL = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

function Fallback({ name, fill, reason }: { name?: string; fill?: boolean; reason?: string }) {
  return (
    <div
      aria-label={reason ? `${name ?? "Shader"}: ${reason}` : name ? `${name} shader` : "Shader"}
      style={{ ...FILL, ...(fill ? { zIndex: -1, pointerEvents: "none" as const, borderRadius: "inherit", overflow: "hidden" } : {}), background: "linear-gradient(135deg, #E0EAFF 0%, #9F50D3 45%, #F75092 75%, #241D9A 100%)", display: "grid", placeItems: "center" }}
    >
      {reason ? <span style={{ padding: "4px 8px", borderRadius: 4, background: "var(--of-panel)", color: "var(--of-muted)", font: "11px/16px var(--of-font-sans)" }}>{reason}</span> : null}
    </div>
  );
}

class ShaderBoundary extends Component<{ name?: string; fill?: boolean; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("Shader failed to render", err);
  }
  render() {
    return this.state.failed ? <Fallback name={this.props.name} fill={this.props.fill} /> : this.props.children;
  }
}

function lookup(name: string | undefined): ComponentType<Record<string, unknown>> | null {
  if (!name) return null;
  const c = (Shaders as unknown as Record<string, unknown>)[name];
  return typeof c === "function" || (typeof c === "object" && c !== null && "$$typeof" in c)
    ? (c as ComponentType<Record<string, unknown>>)
    : null;
}

let webgl: boolean | undefined;
function supportsWebGL(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Behind the children of the frame (which gets `isolation: isolate`). */
const BEHIND = { ...FILL, zIndex: -1, pointerEvents: "none", borderRadius: "inherit", overflow: "hidden" } as const;
// keep the drawing buffer so screenshots, exports and the eyedropper can read the pixels
const GL_ATTRIBUTES: WebGLContextAttributes = { preserveDrawingBuffer: true, premultipliedAlpha: true };

/**
 * Renders a shader. `resolveImage` maps `asset://` image params to URLs. `fill` draws it as a shader
 * fill behind a frame's children.
 */
export function ShaderView({ spec, resolveImage, fill }: { spec?: ShaderSpec; resolveImage?: (src: string) => string | undefined; fill?: boolean }) {
  const Comp = lookup(spec?.name);
  if (!Comp || spec?.name === "ShaderMount") return <Fallback name={spec?.name} fill={fill} />;
  if (!supportsWebGL()) return <Fallback name={spec?.name} fill={fill} reason="WebGL is unavailable" />;
  const params: Record<string, unknown> = Object.fromEntries(Object.entries(spec?.params ?? {}).filter(([key]) => !/^on/i.test(key) && !["dangerouslySetInnerHTML", "children", "style", "ref", "srcDoc"].includes(key)));
  if (typeof params.image === "string") {
    const url = params.image ? (resolveImage ? resolveImage(params.image) : undefined) : "";
    if (url && safeImageUrl(url)) params.image = url;
    else delete params.image;
  }
  return (
    <ShaderBoundary key={spec?.name} name={spec?.name} fill={fill}>
      <Comp {...params} webGlContextAttributes={GL_ATTRIBUTES} style={fill ? BEHIND : FILL} data-of-shader-fill={fill ? "" : undefined} />
    </ShaderBoundary>
  );
}

/** Default params for a new MeshGradient shader node. */
export const DEFAULT_SHADER: ShaderSpec = {
  name: "MeshGradient",
  params: { colors: ["#E0EAFF", "#241D9A", "#F75092", "#9F50D3"], distortion: 0.8, swirl: 0.1, speed: 1 },
};
