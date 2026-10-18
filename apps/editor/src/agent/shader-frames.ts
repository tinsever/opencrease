// Deterministic shader frames for screenshots, exports and video.
//
// Shaders draw into WebGL canvases whose drawing buffer is cleared once it is shown, so a DOM
// screenshot taken a few awaits later sees a blank canvas. Here every shader under a node is paused,
// rendered at an exact time and resolution, and copied out synchronously right after the draw. The
// screenshot then swaps each shader canvas for that copy (see `captureOptions`).

/** The parts of @paper-design/shaders' ShaderMount we drive (it hangs off the host element). */
interface ShaderMountLike {
  canvasElement: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  parentWidth: number;
  parentHeight: number;
  renderScale: number;
  resolutionChanged: boolean;
  speed: number;
  resizeObserver: ResizeObserver | null;
  getCurrentFrame(): number;
  setFrame(frame: number): void;
  setSpeed(speed: number): void;
  handleVisualViewportChange(): void;
}

type ShaderHost = HTMLElement & { paperShaderMount?: ShaderMountLike };

export const SLOT_ATTR = "data-of-shader-slot";
/** Largest shader canvas we render for an export (pixels). */
const MAX_SHADER_PIXELS = 33_177_600; // 7680 x 4320

interface Slot {
  key: string;
  host: ShaderHost;
  mount: ShaderMountLike;
  /** animation speed before freezing (frames advance by ms x speed) */
  speed: number;
  /** frame shown when frozen */
  frame: number;
  /** id of the Shader node that owns it */
  nodeId: string | null;
}

let slotCounter = 0;

function mountsUnder(root: Element): ShaderHost[] {
  const hosts: ShaderHost[] = [];
  if ((root as ShaderHost).paperShaderMount) hosts.push(root as ShaderHost);
  for (const el of root.querySelectorAll<ShaderHost>("[data-paper-shader]")) if (el.paperShaderMount) hosts.push(el);
  return hosts;
}

/** Does this subtree contain shaders that animate (speed other than 0)? */
export function animatedShaderNodes(root: Element): string[] {
  const ids: string[] = [];
  for (const host of mountsUnder(root)) {
    if ((host.paperShaderMount?.speed ?? 0) === 0) continue;
    const id = host.closest("[data-of-id]")?.getAttribute("data-of-id");
    if (id) ids.push(id);
  }
  return ids;
}

export class FrozenShaders {
  private constructor(readonly slots: Slot[]) {}

  /**
   * Pause every shader under `root` and size its canvas for `ratio` output pixels per CSS px.
   * Always call `restore()` afterwards.
   */
  static freeze(root: Element, ratio: number): FrozenShaders {
    const slots: Slot[] = [];
    for (const host of mountsUnder(root)) {
      const mount = host.paperShaderMount!;
      const key = `s${++slotCounter}`;
      host.setAttribute(SLOT_ATTR, key);
      slots.push({ key, host, mount, speed: mount.speed ?? 0, frame: mount.getCurrentFrame(), nodeId: host.closest("[data-of-id]")?.getAttribute("data-of-id") ?? null });
      mount.setSpeed(0);
      mount.resizeObserver?.disconnect();
      const cssW = Math.max(1, Math.round(mount.parentWidth || host.clientWidth || 1));
      const cssH = Math.max(1, Math.round(mount.parentHeight || host.clientHeight || 1));
      let r = Math.max(ratio, 0.25);
      if (cssW * r * cssH * r > MAX_SHADER_PIXELS) r = Math.sqrt(MAX_SHADER_PIXELS / (cssW * cssH));
      const w = Math.max(1, Math.round(cssW * r));
      const h = Math.max(1, Math.round(cssH * r));
      const canvas = mount.canvasElement;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      mount.renderScale = w / cssW;
      mount.resolutionChanged = true;
      mount.gl.viewport(0, 0, w, h);
    }
    return new FrozenShaders(slots);
  }

  get size(): number {
    return this.slots.length;
  }

  /** Shader node ids that animate. */
  get animatedNodeIds(): string[] {
    return this.slots.filter((s) => s.speed !== 0 && s.nodeId).map((s) => s.nodeId!);
  }

  /**
   * Draw every shader and copy it out in the same task. `timeMs` is the time since the start of the
   * video; when omitted, each shader keeps the frame it showed when it was frozen.
   */
  render(timeMs?: number, mime = "image/png", quality?: number): Map<string, string> {
    const out = new Map<string, string>();
    for (const s of this.slots) {
      s.mount.setFrame(timeMs === undefined ? s.frame : timeMs * s.speed);
      out.set(s.key, s.mount.canvasElement.toDataURL(mime, quality));
    }
    return out;
  }

  restore(): void {
    for (const s of this.slots) {
      s.host.removeAttribute(SLOT_ATTR);
      s.mount.setFrame(s.frame);
      // re-observes the size, which sizes the canvas for the screen again and redraws it
      s.mount.handleVisualViewportChange();
      s.mount.setSpeed(s.speed);
    }
  }
}

/** A transparent 1x1 PNG, tagged with the slot key so it can be found in serialised markup. */
export function slotPlaceholder(key: string): string {
  return `data:image/png;of-slot=${key};base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`;
}

/**
 * modern-screenshot options that replace shader canvases with images: the given snapshots, or
 * placeholders (for templates whose images are filled in per frame).
 */
export function captureOptions(frames: Map<string, string> | null): {
  filter: (n: Node) => boolean;
  onCloneEachNode: (cloned: Node) => void;
} {
  return {
    filter: (n) => !(n instanceof HTMLCanvasElement && n.parentElement?.hasAttribute(SLOT_ATTR)),
    onCloneEachNode: (cloned) => {
      if (!(cloned instanceof Element)) return;
      const key = cloned.getAttribute(SLOT_ATTR);
      if (!key) return;
      const img = cloned.ownerDocument.createElement("img");
      img.src = frames?.get(key) ?? slotPlaceholder(key);
      img.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;display:block;");
      cloned.appendChild(img);
    },
  };
}
