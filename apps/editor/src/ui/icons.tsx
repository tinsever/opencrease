// Inline SVG icons for the editor chrome. Stroke icons use currentColor.
import type { CSSProperties, ReactNode } from "react";

type IconDef = { vb: number; sw?: number; body: ReactNode };

const s = (d: string, extra?: Record<string, string | number>) => <path d={d} {...extra} />;

const ICONS = {
  // generic
  plus: { vb: 12, sw: 1.4, body: s("M6 2v8M2 6h8") },
  minus: { vb: 12, sw: 1.4, body: s("M2.5 6h7") },
  close: { vb: 12, sw: 1.4, body: s("M3 3l6 6M9 3L3 9") },
  check: { vb: 12, sw: 1.5, body: s("M2.5 6.2l2.3 2.3L9.5 3.8") },
  chevronDown: { vb: 12, sw: 1.3, body: s("M3 4.5l3 3 3-3") },
  chevronRight: { vb: 12, sw: 1.3, body: s("M4.5 3l3 3-3 3") },
  chevronLeft: { vb: 12, sw: 1.3, body: s("M7.5 3l-3 3 3 3") },
  search: { vb: 14, sw: 1.3, body: <>{s("M8.7 8.7L11.5 11.5")}<circle cx="6" cy="6" r="3.5" /></> },
  more: { vb: 14, sw: 0, body: <g fill="currentColor"><circle cx="3" cy="7" r="1.1" /><circle cx="7" cy="7" r="1.1" /><circle cx="11" cy="7" r="1.1" /></g> },
  eye: { vb: 14, sw: 1.1, body: <>{s("M1.5 7s2-4 5.5-4 5.5 4 5.5 4-2 4-5.5 4-5.5-4-5.5-4z")}<circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none" /></> },
  eyeOff: { vb: 14, sw: 1.1, body: <>{s("M1.5 7s2-4 5.5-4 5.5 4 5.5 4-2 4-5.5 4-5.5-4-5.5-4z")}{s("M2 12L12 2")}</> },
  lock: { vb: 14, sw: 1.1, body: <><rect x="3" y="6.5" width="8" height="5.5" rx="1" />{s("M4.8 6.5V5a2.2 2.2 0 014.4 0v1.5")}</> },
  unlock: { vb: 14, sw: 1.1, body: <><rect x="3" y="6.5" width="8" height="5.5" rx="1" />{s("M4.8 6.5V5a2.2 2.2 0 014.3-.6")}</> },
  copy: { vb: 14, sw: 1.2, body: <><rect x="4.5" y="4.5" width="7" height="7" rx="1" />{s("M2.5 9.5V3a.5.5 0 01.5-.5h6.5")}</> },
  trash: { vb: 14, sw: 1.2, body: s("M2.5 4h9M5.5 4V2.8h3V4M3.8 4l.6 7.5h5.2l.6-7.5") },
  edit: { vb: 14, sw: 1.2, body: s("M3 11l2-.5 5.5-5.5-1.5-1.5L3.5 9 3 11z") },
  eyedropper: { vb: 14, sw: 1.2, body: <>{s("M9.5 2.5l2 2-6 6H3.5v-2z")}{s("M8 4l2 2")}</> },
  play: { vb: 14, sw: 1.3, body: s("M4 2.5l7 4.5-7 4.5z") },
  pause: { vb: 14, sw: 0, body: <g fill="currentColor"><rect x="3.5" y="3" width="2.4" height="8" rx=".6" /><rect x="8.1" y="3" width="2.4" height="8" rx=".6" /></g> },
  refresh: { vb: 14, sw: 1.2, body: s("M11 7a4 4 0 11-1.2-2.85M11 2.5V5H8.5") },
  link: { vb: 14, sw: 1.2, body: s("M5.5 8.5l3-3M4.5 6L3.3 7.2a2.1 2.1 0 003 3L7.5 9M9.5 8l1.2-1.2a2.1 2.1 0 00-3-3L6.5 5") },
  unlink: { vb: 14, sw: 1.2, body: s("M4.5 6L3.3 7.2a2.1 2.1 0 003 3L7.5 9M9.5 8l1.2-1.2a2.1 2.1 0 00-3-3L6.5 5M2 2l10 10") },
  corners: { vb: 14, sw: 1.2, body: s("M2 5V3a1 1 0 011-1h2M9 2h2a1 1 0 011 1v2M12 9v2a1 1 0 01-1 1H9M5 12H3a1 1 0 01-1-1V9") },
  sides: { vb: 14, sw: 1.2, body: <rect x="2" y="2" width="10" height="10" rx="1.5" strokeDasharray="2 2" /> },
  filter: { vb: 14, sw: 1.2, body: s("M2 4h10M4 7h6M5.5 10h3") },
  component: { vb: 14, sw: 1.2, body: s("M7 1.8l5.2 5.2L7 12.2 1.8 7z") },
  mainComponent: { vb: 14, sw: 1.1, body: s("M7 1.5l2 2-2 2-2-2zM7 8.5l2 2-2 2-2-2zM3.5 5l2 2-2 2-2-2zM10.5 5l2 2-2 2-2-2z") },
  componentSet: { vb: 14, sw: 1.1, body: <><rect x="1.5" y="1.5" width="11" height="11" rx="2" strokeDasharray="2 1.6" />{s("M7 4.2L9.8 7 7 9.8 4.2 7z")}</> },
  detach: { vb: 14, sw: 1.2, body: <>{s("M5.2 3.2L7 1.4l5.6 5.6L10.8 8.8M8.8 10.8L7 12.6 1.4 7l1.8-1.8")}{s("M2 2l10 10")}</> },
  goTo: { vb: 14, sw: 1.2, body: s("M5 3h6v6M11 3L4 10") },
  tokens: { vb: 12, sw: 1.1, body: <><circle cx="3.5" cy="3.5" r="2" /><circle cx="8.5" cy="3.5" r="2" /><circle cx="3.5" cy="8.5" r="2" /><circle cx="8.5" cy="8.5" r="2" /></> },
  home: { vb: 16, sw: 0, body: <><path d="M2 2h8l4 4v8H2z" fill="var(--of-ink)" /><path d="M10 2v4h4z" fill="var(--of-accent)" /></> },
  folder: { vb: 16, sw: 1.2, body: s("M2 4.5A1.5 1.5 0 013.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5z") },
  clock: { vb: 16, sw: 1.3, body: <><circle cx="8" cy="8" r="5.5" />{s("M8 5v3.2l2 1.3")}</> },
  star: { vb: 16, sw: 1.2, body: s("M8 2.5l1.7 3.4 3.8.6-2.7 2.6.6 3.8L8 11.1l-3.4 1.8.6-3.8-2.7-2.6 3.8-.6z") },
  template: { vb: 16, sw: 1.2, body: <><rect x="2.5" y="2.5" width="11" height="11" rx="2" />{s("M2.5 6h11")}</> },
  settings: { vb: 14, sw: 1.2, body: <><circle cx="7" cy="7" r="2" />{s("M7 1.5v1.6M7 10.9v1.6M1.5 7h1.6M10.9 7h1.6M3.1 3.1l1.1 1.1M9.8 9.8l1.1 1.1M3.1 10.9l1.1-1.1M9.8 4.2l1.1-1.1")}</> },
  image: { vb: 14, sw: 1.2, body: <><rect x="1.8" y="2.5" width="10.4" height="9" rx="1.5" />{s("M2.5 10l3-3 2.5 2.5L10 7.5l2 2")}</> },
  code: { vb: 14, sw: 1.2, body: s("M5 4L2 7l3 3M9 4l3 3-3 3") },
  upload: { vb: 14, sw: 1.2, body: s("M7 9.5V2.5M4.5 5L7 2.5 9.5 5M2.5 9.5v2h9v-2") },
  download: { vb: 14, sw: 1.2, body: s("M7 2.5v7M4.5 7L7 9.5 9.5 7M2.5 9.5v2h9v-2") },
  expand: { vb: 14, sw: 1.2, body: s("M8.5 2h3.5v3.5M5.5 12H2V8.5M12 2L8 6M2 12l4-4") },
  external: { vb: 14, sw: 1.2, body: s("M8 2.5h3.5V6M11.5 2.5L6.5 7.5M10 8.5v3H2.5V4h3") },
  // node types
  artboard: { vb: 14, sw: 1.2, body: s("M4 1.5v11M10 1.5v11M1.5 4h11M1.5 10h11") },
  frame: { vb: 14, sw: 1.2, body: <rect x="2.5" y="2.5" width="9" height="9" rx="1" /> },
  flexColumn: { vb: 14, sw: 1.2, body: s("M2 4h10M2 7h10M2 10h10") },
  flexRow: { vb: 14, sw: 1.2, body: s("M4 2v10M7 2v10M10 2v10") },
  text: { vb: 14, sw: 1.3, body: s("M3 3h8M7 3v8") },
  rect: { vb: 14, sw: 1.2, body: <rect x="2.5" y="3" width="9" height="8" rx="0.5" fill="currentColor" fillOpacity=".12" /> },
  svg: { vb: 14, sw: 1.2, body: s("M2.5 11.5C4 6 6 3 11.5 2.5M2.5 11.5l1.8-.2M11.5 2.5l-.2 1.8") },
  group: { vb: 14, sw: 1.1, body: <><rect x="1.5" y="1.5" width="11" height="11" rx="1" strokeDasharray="2 2" /><rect x="4" y="4" width="6" height="6" rx=".5" /></> },
  ellipse: { vb: 14, sw: 1.2, body: <ellipse cx="7" cy="7" rx="5" ry="4" /> },
  line: { vb: 14, sw: 1.2, body: s("M2.5 11.5l9-9") },
  polygon: { vb: 14, sw: 1.2, body: s("M7 1.8l5.2 3.8-2 6.1H3.8l-2-6.1z") },
  polyline: { vb: 14, sw: 1.2, body: s("M2 10l3-6 4 6 3-6") },
  path: { vb: 14, sw: 1.2, body: <>{s("M3 11C4 6 8 3 11 3")}<circle cx="3" cy="11" r="1.2" /><circle cx="11" cy="3" r="1.2" /></> },
  shader: { vb: 14, sw: 0, body: <circle cx="7" cy="7" r="5" fill="url(#of-shader-grad)" /> },
  // pages
  pageDesign: { vb: 14, sw: 1.2, body: s("M3 11l2-.5 5.5-5.5-1.5-1.5L3.5 9 3 11z") },
  pageBlank: { vb: 14, sw: 1.2, body: <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" /> },
  pageComponents: { vb: 14, sw: 1.2, body: <><circle cx="5" cy="5" r="2" /><circle cx="9.5" cy="9.5" r="2" /></> },
  pageList: { vb: 14, sw: 1.2, body: s("M3 4h8M3 7h8M3 10h5") },
  arrow: { vb: 14, sw: 1.2, body: s("M2.5 7h9M8.5 4l3 3-3 3") },
  info: { vb: 14, sw: 1.2, body: <><circle cx="7" cy="7" r="5" />{s("M7 6.3v3.2M7 4.4v.2")}</> },
  question: { vb: 14, sw: 1.2, body: <><circle cx="7" cy="7" r="5" />{s("M5.6 5.6a1.5 1.5 0 112.1 1.4c-.5.2-.7.6-.7 1v.3M7 10v.2")}</> },
  cross: { vb: 14, sw: 1.3, body: s("M4 4l6 6M10 4l-6 6") },
  checkPage: { vb: 14, sw: 1.3, body: s("M3 7.3l2.6 2.6L11 4.4") },
  vector: { vb: 14, sw: 1.2, body: <>{s("M3 11L11 3")}<rect x="1.5" y="9.5" width="3" height="3" /><rect x="9.5" y="1.5" width="3" height="3" /></> },
  table: { vb: 14, sw: 1.2, body: <><rect x="2" y="2.5" width="10" height="9" rx="1" />{s("M2 5.5h10M2 8.5h10M6 5.5v6")}</> },
  presentation: { vb: 14, sw: 1.2, body: <><rect x="2" y="2.5" width="10" height="7" rx="1" />{s("M7 9.5v2.5M5 12h4")}</> },
  blueprint: { vb: 14, sw: 1.2, body: <><rect x="2" y="2" width="10" height="10" rx="1" />{s("M2 6h4V2M6 12V9h6")}</> },
  swatches: { vb: 14, sw: 1.2, body: <><rect x="2" y="2" width="4" height="10" rx="1" />{s("M6 4.5l3-1.5 2 4.5-5 3.5")}</> },
  barChart: { vb: 14, sw: 1.3, body: s("M3 11.5V7M7 11.5V3M11 11.5V5.5") },
  lineChart: { vb: 14, sw: 1.2, body: s("M2 10.5l3-3.5 2.5 2L12 3.5M2 12h10") },
  pieChart: { vb: 14, sw: 1.2, body: <><circle cx="7" cy="7" r="5" />{s("M7 2v5h5")}</> },
  paper: { vb: 14, sw: 1.2, body: s("M3.5 1.5h5l2.5 2.5v8.5h-7.5zM8.5 1.5V4H11") },
  // inspector
  dirRow: { vb: 14, sw: 1.3, body: s("M2 7h9M8.5 4.5L11 7l-2.5 2.5") },
  dirColumn: { vb: 14, sw: 1.3, body: s("M7 2v9M4.5 8.5L7 11l2.5-2.5") },
  wrap: { vb: 14, sw: 1.2, body: s("M2 4h8a2 2 0 010 4H4a2 2 0 000 4h7") },
  gap: { vb: 12, sw: 1.2, body: s("M1.5 1.5v9M10.5 1.5v9M4.5 6h3") },
  padV: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="9" height="9" rx="1" />{s("M1.5 4h9M1.5 8h9")}</> },
  padH: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="9" height="9" rx="1" />{s("M4 1.5v9M8 1.5v9")}</> },
  padTop: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="9" height="9" rx="1" strokeOpacity=".4" />{s("M1.5 1.5h9", { strokeWidth: 1.6 })}</> },
  padRight: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="9" height="9" rx="1" strokeOpacity=".4" />{s("M10.5 1.5v9", { strokeWidth: 1.6 })}</> },
  padBottom: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="9" height="9" rx="1" strokeOpacity=".4" />{s("M1.5 10.5h9", { strokeWidth: 1.6 })}</> },
  padLeft: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="9" height="9" rx="1" strokeOpacity=".4" />{s("M1.5 1.5v9", { strokeWidth: 1.6 })}</> },
  opacity: { vb: 12, sw: 1.1, body: <><circle cx="6" cy="6" r="4.5" /><path d="M6 1.5a4.5 4.5 0 010 9z" fill="currentColor" stroke="none" /></> },
  radius: { vb: 12, sw: 1.2, body: s("M1.5 10.5V5a3.5 3.5 0 013.5-3.5h5.5") },
  radiusTL: { vb: 12, sw: 1.2, body: s("M2 10V5.5A3.5 3.5 0 015.5 2H10") },
  radiusTR: { vb: 12, sw: 1.2, body: s("M2 2h4.5A3.5 3.5 0 0110 5.5V10") },
  radiusBR: { vb: 12, sw: 1.2, body: s("M10 2v4.5A3.5 3.5 0 016.5 10H2") },
  radiusBL: { vb: 12, sw: 1.2, body: s("M10 10H5.5A3.5 3.5 0 012 6.5V2") },
  rotate: { vb: 12, sw: 1.2, body: s("M9.5 6A3.5 3.5 0 116 2.5h2M7 1l1.5 1.5L7 4") },
  blend: { vb: 12, sw: 1.1, body: <><circle cx="4.5" cy="6" r="3" /><circle cx="7.5" cy="6" r="3" /></> },
  lineHeight: { vb: 12, sw: 1.2, body: s("M1.5 2h9M1.5 10h9M6 4v4") },
  letterSpacing: { vb: 12, sw: 1.1, body: s("M2 10L4.5 2h1L8 10M3 7h4M10 3v7") },
  alignLeft: { vb: 14, sw: 1.3, body: s("M2 3.5h10M2 7h6M2 10.5h8") },
  alignCenter: { vb: 14, sw: 1.3, body: s("M2 3.5h10M4 7h6M3 10.5h8") },
  alignRight: { vb: 14, sw: 1.3, body: s("M2 3.5h10M6 7h6M4 10.5h8") },
  alignJustify: { vb: 14, sw: 1.3, body: s("M2 3.5h10M2 7h10M2 10.5h10") },
  underline: { vb: 12, sw: 1.2, body: s("M3.5 2v3.5a2.5 2.5 0 005 0V2M2.5 10.5h7") },
  strike: { vb: 12, sw: 1.2, body: s("M2 6h8M8.3 3.6C8 2.7 7.1 2 6 2 4.6 2 3.7 2.8 3.7 3.8M3.8 8.4c.3.9 1.2 1.6 2.4 1.6 1.4 0 2.3-.8 2.3-1.8") },
  absolute: { vb: 14, sw: 1.2, body: <><rect x="2" y="2" width="10" height="10" rx="1" strokeDasharray="2 1.5" /><rect x="5" y="5" width="4.5" height="4.5" rx=".5" fill="currentColor" stroke="none" /></> },
  sizeFixed: { vb: 12, sw: 1.2, body: s("M1.5 3.5v5M10.5 3.5v5M1.5 6h9") },
  sizeHug: { vb: 12, sw: 1.2, body: s("M1.5 3v6M10.5 3v6M3.5 6h1.5M7 6h1.5M4.5 4.5L6 6 4.5 7.5M7.5 4.5L6 6l1.5 1.5") },
  sizeFill: { vb: 12, sw: 1.2, body: s("M1.5 3v6M10.5 3v6M3 6h6M4.5 4.5L3 6l1.5 1.5M7.5 4.5L9 6 7.5 7.5") },
  border: { vb: 12, sw: 1.2, body: <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" /> },
  shadow: { vb: 12, sw: 1.1, body: <><rect x="1.5" y="1.5" width="7" height="7" rx="1" /><path d="M10.5 3.5v7h-7" /></> },
  blur: { vb: 12, sw: 1.1, body: <><circle cx="6" cy="6" r="4.5" strokeDasharray="1.5 1.5" /><circle cx="6" cy="6" r="2" /></> },
  // agent / tools
  plug: { vb: 14, sw: 1.2, body: s("M5 1.5v3M9 1.5v3M3.5 4.5h7v2.5a3.5 3.5 0 01-7 0zM7 10.5v2") },
  terminal: { vb: 14, sw: 1.2, body: <><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />{s("M4 5.5l2 1.5-2 1.5M7.5 9H10")}</> },
  dot: { vb: 12, sw: 0, body: <circle cx="6" cy="6" r="3" fill="currentColor" /> },
  warning: { vb: 12, sw: 1.2, body: <><circle cx="6" cy="6" r="4.5" />{s("M6 3.6v3M6 8.3v.2")}</> },
  keyboard: { vb: 14, sw: 1.2, body: <><rect x="1.5" y="3.5" width="11" height="7" rx="1.2" />{s("M4 6h.01M6 6h.01M8 6h.01M10 6h.01M4.5 8.3h5")}</> },
  guide: { vb: 14, sw: 1.2, body: s("M2.5 2.5h3.5a1 1 0 011 1v8.5a1 1 0 00-1-1H2.5zM11.5 2.5H8a1 1 0 00-1 1v8.5a1 1 0 011-1h3.5z") },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size, style, className, title }: { name: IconName; size?: number; style?: CSSProperties; className?: string; title?: string }) {
  const def: IconDef = ICONS[name];
  const px = size ?? def.vb;
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${def.vb} ${def.vb}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={def.sw ?? 1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {def.body}
    </svg>
  );
}

/** Mount once: gradient used by the shader layer icon. */
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="of-shader-grad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FF5B14" />
          <stop offset="1" stopColor="#2F64D6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
