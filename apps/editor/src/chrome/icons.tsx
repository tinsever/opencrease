// Title bar icons (from the "OpenCrease — UI" design).

export function LogoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
      <path d="M2 2h8l4 4v8H2z" fill="var(--of-ink)" />
      <path d="M10 2v4h4z" fill="var(--of-accent)" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="of-icon-close">
      <path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: "block" }}>
      <path d="M6 2v8M2 6h8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
