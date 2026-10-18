// Basic controls: buttons, segmented control, toggle, section, select, inline rename.
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Tooltip } from "./Popover";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "agent" | "danger"; size?: "sm" | "md" | "default" };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "default", size = "default", className, type = "button", ...rest }, ref) {
  const cls = ["of-btn", variant !== "default" ? variant : "", size !== "default" ? size : "", className ?? ""].filter(Boolean).join(" ");
  return <button ref={ref} type={type} className={cls} {...rest} />;
});

type IconBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  iconSize?: number;
  size?: "xs" | "sm" | "default";
  outlined?: boolean;
  active?: boolean;
  tooltip?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton(
  { icon, label, iconSize, size = "default", outlined, active, className, tooltip = true, type = "button", ...rest },
  ref,
) {
  const cls = ["of-icon-btn", size !== "default" ? size : "", outlined ? "outlined" : "", active ? "active" : "", className ?? ""].filter(Boolean).join(" ");
  const btn = (
    <button ref={ref} type={type} className={cls} aria-label={label} aria-pressed={active} {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
  return tooltip ? <Tooltip label={label}>{btn}</Tooltip> : btn;
});

export interface SegmentOption<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: IconName;
  title?: string;
}

export function Segmented<T extends string>({
  options, value, onChange, className, style, ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <div className={`of-seg ${className ?? ""}`} style={style} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const item = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.title ?? (typeof o.label === "string" ? o.label : o.value)}
            className={`of-seg-item${value === o.value ? " on" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon ? <Icon name={o.icon} size={14} /> : null}
            {o.label}
          </button>
        );
        return item;
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`of-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

export function ToggleRow({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="of-row" style={{ gap: 8, minHeight: 16 }}>
      <span style={{ flex: 1, color: "var(--of-ink-2)", fontSize: "var(--of-text-xs)", lineHeight: "14px" }}>{label}</span>
      <Toggle on={on} onChange={onChange} label={label} disabled={disabled} />
    </label>
  );
}

/**
 * Inspector section. When `collapsed` is true it renders as a 40px header row with the `actions`
 * (usually a + button) and no body.
 */
export function Section({ title, actions, children, collapsed, onHeaderClick }: { title: string; actions?: ReactNode; children?: ReactNode; collapsed?: boolean; onHeaderClick?: () => void }) {
  if (collapsed) {
    return (
      <div className="of-section collapsed" onClick={onHeaderClick}>
        <div className="of-section-title">{title}</div>
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2 }}>{actions}</div>
        {/* collapsed sections render no body, but popups (menus are portals) still need to mount */}
        <div onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>{children}</div>
      </div>
    );
  }
  return (
    <div className="of-section">
      <div className="of-section-head">
        <div className="of-section-title">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function SelectField<T extends string>({
  value, options, onChange, style, mono, label, ariaLabel, placeholder,
}: {
  value: T | "" | null | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  style?: CSSProperties;
  mono?: boolean;
  label?: ReactNode;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <div className="of-field select" style={style}>
      {label ? <span className="of-field-label">{label}</span> : null}
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value as T)}
        style={{ fontFamily: mono ? "var(--of-font-mono)" : undefined, fontSize: "var(--of-text-xs)", fontWeight: 500 }}
      >
        {!known ? <option value={value ?? ""}>{value ? String(value) : (placeholder ?? "Mixed")}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={10} style={{ color: "var(--of-muted)" }} />
    </div>
  );
}

/** Text that turns into an input on double-click (or when `editing` is forced). */
export function InlineRename({
  value, onCommit, editing, onEditingChange, style, className,
}: {
  value: string;
  onCommit: (v: string) => void;
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
  style?: CSSProperties;
  className?: string;
}) {
  const [local, setLocal] = useState(false);
  const isEditing = editing ?? local;
  const set = (v: boolean) => (onEditingChange ? onEditingChange(v) : setLocal(v));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing) ref.current?.select();
  }, [isEditing]);
  if (!isEditing) {
    return (
      <span className={className} style={style} onDoubleClick={(e) => { e.stopPropagation(); set(true); }}>
        {value}
      </span>
    );
  }
  const commit = (v: string) => {
    set(false);
    const trimmed = v.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
  };
  return (
    <input
      ref={ref}
      className="of-inline-input"
      defaultValue={value}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        if (e.key === "Escape") set(false);
      }}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="of-kbd">{children}</span>;
}
