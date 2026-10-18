// Applies parsed tokens (CSS, Tailwind or DTCG imports, pasted tokens) inside a transaction.
import type { Tx } from "./contracts";
import { collectionOfMode, normalizeModeName } from "./modes";
import { normalizeTokenName } from "./tokens";
import type { ModeCollection, TokenType } from "./types";

export interface TokenImportData {
  tokens: Array<{ type: TokenType; name: string; value: string | number; description?: string; modes?: Record<string, string | number> }>;
  modeCollections?: Array<Pick<ModeCollection, "name" | "modes">>;
}

export interface TokenImportResult {
  created: number;
  updated: number;
  warnings: string[];
}

/**
 * Creates missing mode collections (or adds missing modes to a collection with the same name), then
 * creates new tokens and updates existing ones by name. Throws (aborting the transaction) on invalid
 * tokens or alias cycles; mode values for unknown modes are skipped with a warning.
 */
export function importTokens(tx: Tx, data: TokenImportData): TokenImportResult {
  const result: TokenImportResult = { created: 0, updated: 0, warnings: [] };
  for (const c of data.modeCollections ?? []) {
    const modes = c.modes.map(normalizeModeName).filter(Boolean);
    const existing = tx.doc.modeCollections?.find((x) => x.name === c.name);
    if (existing) {
      const missing = modes.filter((m) => !existing.modes.includes(m));
      const free = missing.filter((m) => !collectionOfMode(tx.doc, m));
      if (free.length) tx.updateModeCollection(existing.id, { modes: [...existing.modes, ...free] });
      for (const m of missing.filter((x) => !free.includes(x))) result.warnings.push(`Mode "${m}" already belongs to another collection.`);
      continue;
    }
    const free = modes.filter((m) => !collectionOfMode(tx.doc, m));
    if (free.length !== modes.length) result.warnings.push(`Some modes of "${c.name}" already exist in other collections.`);
    if (free.length) tx.createModeCollection(c.name, free);
  }
  for (const t of data.tokens) {
    const name = normalizeTokenName(t.name);
    let modes: Record<string, string | number> | undefined;
    if (t.modes) {
      modes = {};
      for (const [m, v] of Object.entries(t.modes)) {
        if (collectionOfMode(tx.doc, normalizeModeName(m))) modes[m] = v;
        else result.warnings.push(`${name}: mode "${m}" does not exist, its value was skipped.`);
      }
      if (!Object.keys(modes).length) modes = undefined;
    }
    const exists = tx.doc.tokens.some((x) => x.name === name);
    if (exists) {
      const patch: Parameters<Tx["updateToken"]>[1] = { value: t.value, type: t.type };
      if (t.description !== undefined) patch.description = t.description;
      if (modes) patch.modes = modes;
      tx.updateToken(name, patch);
      result.updated++;
    } else {
      tx.createToken({ type: t.type, name, value: t.value, description: t.description, modes });
      result.created++;
    }
  }
  return result;
}
