const encoder = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `str`, as 8 lowercase hex chars. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(str)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Deep copy with object keys sorted (arrays keep their order, undefined values dropped). */
export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeysDeep(v))) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const src = value as Record<string, unknown>;
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v !== undefined) out[key] = sortKeysDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Deterministic JSON: sorted object keys, optional indentation. */
export function stableStringify(value: unknown, indent?: number): string {
  return JSON.stringify(sortKeysDeep(value), null, indent);
}
