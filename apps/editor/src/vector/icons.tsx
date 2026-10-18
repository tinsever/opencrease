// Icons for vector tools and operations (16px grid, 1.3 stroke like the toolbar set).
import type { CSSProperties } from "react";
import { RectIcon } from "../canvas/icons";
import type { ShapeKind } from "./shapes";

interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
}

const S = (size: number, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  style: { display: "block", flexShrink: 0, ...style },
  "aria-hidden": true,
});

export function LineIcon({ size = 16, color = "currentColor", style }: IconProps) {
  return (
    <svg {...S(size, style)}>
      <path d="M3 13L13 3" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function EllipseIcon({ size = 16, color = "currentColor", style }: IconProps) {
  return (
    <svg {...S(size, style)}>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.3" />
    </svg>
  );
}

export function PolygonIcon({ size = 16, color = "currentColor", style }: IconProps) {
  return (
    <svg {...S(size, style)}>
      <path d="M8 2.5l5.5 10h-11z" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function StarIcon({ size = 16, color = "currentColor", style }: IconProps) {
  return (
    <svg {...S(size, style)}>
      <path d="M8 2.2l1.75 3.7 4.05.5-3 2.8.8 4L8 11.2l-3.6 2 .8-4-3-2.8 4.05-.5z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function PathIcon({ size = 16, color = "currentColor", style }: IconProps) {
  return (
    <svg {...S(size, style)}>
      <path d="M8 2l4.5 7L8 14l-4.5-5z" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="8.5" r="1.2" fill={color} />
    </svg>
  );
}

export function ShapeIcon({ kind, size, color, style }: IconProps & { kind: ShapeKind }) {
  switch (kind) {
    case "line":
      return <LineIcon size={size} color={color} style={style} />;
    case "ellipse":
      return <EllipseIcon size={size} color={color} style={style} />;
    case "polygon":
      return <PolygonIcon size={size} color={color} style={style} />;
    case "star":
      return <StarIcon size={size} color={color} style={style} />;
    default:
      return <RectIcon size={size} color={color} style={style} />;
  }
}

// Boolean operation glyphs from the "Editor — Pen & path editing" design.
export function UnionIcon({ color = "currentColor" }: IconProps) {
  return (
    <svg {...S(16)}>
      <rect x="2" y="2" width="8" height="8" rx="1" fill={color} />
      <rect x="6" y="6" width="8" height="8" rx="1" fill={color} />
    </svg>
  );
}

export function SubtractIcon({ color = "currentColor" }: IconProps) {
  return (
    <svg {...S(16)}>
      <path d="M2 3a1 1 0 011-1h6a1 1 0 011 1v3H7a1 1 0 00-1 1v3H3a1 1 0 01-1-1z" fill={color} />
      <rect x="6.5" y="6.5" width="7" height="7" rx="1" fill="none" stroke={color} />
    </svg>
  );
}

export function IntersectIcon({ color = "currentColor" }: IconProps) {
  return (
    <svg {...S(16)}>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke={color} />
      <rect x="6.5" y="6.5" width="7" height="7" rx="1" fill="none" stroke={color} />
      <rect x="6" y="6" width="4" height="4" fill={color} />
    </svg>
  );
}

export function ExcludeIcon({ color = "currentColor" }: IconProps) {
  return (
    <svg {...S(16)}>
      <path d="M3 2h6a1 1 0 011 1v3H7a1 1 0 00-1 1v3H3a1 1 0 01-1-1V3a1 1 0 011-1zM10 6h3a1 1 0 011 1v6a1 1 0 01-1 1H7a1 1 0 01-1-1v-3h3a1 1 0 001-1z" fill={color} />
    </svg>
  );
}
