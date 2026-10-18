// Token tools: create_tokens, set_tokens (get_tokens lives with the read tools). Both take an optional
// `mode`: values are then written for that token mode (see packages/model/src/modes.ts).
import {
  collectionOfMode, findModeCycle, findToken, normalizeModeName, normalizeTokenName, varReferences,
  type FoldDocument, type NodeId, type Token, type TokenType, type Tx,
} from "@opencrease/model";
import { ToolError, type EditorTool } from "../env";
import { asArray, plural } from "./common";
import { modeArg } from "./read";

interface TokenInput {
  type: TokenType;
  name: string;
  value: string | number;
  description?: string;
  modes?: Record<string, string | number>;
}

interface TokenUpdate {
  name: string;
  value?: string | number;
  newName?: string;
  description?: string;
  modes?: Record<string, string | number | null>;
}

type TokenDoc = Pick<FoldDocument, "tokens" | "modeCollections">;

function cycleError(doc: TokenDoc): string | undefined {
  const found = findModeCycle(doc);
  if (!found) return undefined;
  return `Token alias cycle${found.mode ? ` in mode "${found.mode}"` : ""}: ${[...found.cycle, found.cycle[0]].join(" -> ")}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Replace var(--from ...) with var(--to ...) in a value. */
export function renameVarRefs(value: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`var\\(\\s*${esc}(?=\\s*[,)])`, "g"), `var(${to}`);
}

/** Nodes whose styles, rich text runs or SVG attributes reference a token. */
export function nodesUsingToken(doc: FoldDocument, name: string): NodeId[] {
  const out: NodeId[] = [];
  for (const node of Object.values(doc.nodes)) {
    const values = [...Object.values(node.styles), ...Object.values(node.attrs ?? {}), ...(node.spans ?? []).flatMap((s) => Object.values(s.styles ?? {}))];
    if (values.some((v) => varReferences(v).includes(name))) out.push(node.id);
  }
  return out;
}

function renameIn<T extends Record<string, string | number>>(map: T, from: string, to: string): T | null {
  let out: Record<string, string | number> | null = null;
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === "string" && varReferences(v).includes(from)) (out ??= { ...map })[k] = renameVarRefs(v, from, to);
  }
  return out as T | null;
}

/**
 * Rewrite every reference to a renamed token: node styles, rich text runs, SVG attributes, other
 * tokens (all modes) and text styles. Returns touched node ids.
 */
export function rewriteTokenReferences(tx: Tx, from: string, to: string): NodeId[] {
  const touched: NodeId[] = [];
  for (const node of Object.values(tx.doc.nodes)) {
    const styles = renameIn(node.styles, from, to);
    if (styles) tx.setStyles(node.id, styles);
    const attrs = node.attrs ? renameIn(node.attrs, from, to) : null;
    if (attrs) tx.updateNode(node.id, { attrs });
    let spansChanged = false;
    const spans = node.spans?.map((s) => {
      const st = s.styles ? renameIn(s.styles, from, to) : null;
      if (!st) return s;
      spansChanged = true;
      return { ...s, styles: st };
    });
    if (spansChanged) tx.updateNode(node.id, { spans });
    if (styles || attrs || spansChanged) touched.push(node.id);
  }
  for (const t of tx.doc.tokens) {
    const patch: Partial<Omit<Token, "id">> = {};
    if (typeof t.value === "string" && varReferences(t.value).includes(from)) patch.value = renameVarRefs(t.value, from, to);
    const modes = t.modes ? renameIn(t.modes, from, to) : null;
    if (modes) patch.modes = modes;
    if (Object.keys(patch).length) tx.updateToken(t.id, patch);
  }
  for (const s of tx.doc.textStyles ?? []) {
    const styles = renameIn(s.styles, from, to);
    if (styles) tx.updateTextStyle(s.id, { styles });
  }
  return touched;
}

const create_tokens: EditorTool = {
  write: true,
  label: (args) => `Creating ${plural(asArray(args.tokens).length, "token")}`,
  run(args, env) {
    const inputs = asArray<TokenInput>(args.tokens);
    const mode = modeArg(env.doc, args.mode);
    const results = env.transact((tx) =>
      inputs.map((t) => {
        const name = normalizeTokenName(String(t.name ?? ""));
        try {
          const value = typeof t.value === "string" ? t.value.trim() : t.value;
          const existing = findToken(tx.doc, name);
          if (existing && !mode) throw new Error(`A token named ${name} already exists. Use set_tokens to change it, or pass mode to add a value for a mode.`);
          if (existing && mode) {
            const next = tx.doc.tokens.map((x) => (x.id === existing.id ? withModeValue(tx.doc, x, mode, value) : x));
            const cycle = cycleError({ tokens: next, modeCollections: tx.doc.modeCollections });
            if (cycle) throw new Error(cycle);
            const token = tx.setTokenModeValue(existing.id, mode, value);
            return { name: token.name, status: "updated" as const, mode, value };
          }
          const modes = { ...(t.modes ?? {}) };
          if (mode) modes[mode] = value;
          checkModes(tx.doc, modes);
          const draft: Token = { id: "_", type: t.type, name, value, ...(Object.keys(modes).length ? { modes: stripDefault(tx.doc, modes) } : {}) };
          const cycle = cycleError({ tokens: [...tx.doc.tokens, draft], modeCollections: tx.doc.modeCollections });
          if (cycle) throw new Error(cycle);
          const token = tx.createToken({ type: t.type, name, value, description: t.description, modes: draft.modes });
          const entry: Record<string, unknown> = { name: token.name, status: "created", type: token.type, value: token.value };
          if (token.modes) entry.modes = token.modes;
          return entry;
        } catch (err) {
          return { name, status: "error" as const, error: errorMessage(err) };
        }
      }),
    );
    if (results.every((r) => r.status === "error")) {
      throw new ToolError(`No tokens were created. ${results.map((r) => `${r.name}: ${"error" in r ? r.error : ""}`).join(" ")}`);
    }
    return [{ results }];
  },
};

/** Throws for unknown modes or modes from several collections (before touching the document). */
function checkModes(doc: FoldDocument, modes: Record<string, unknown>): void {
  let collection: string | undefined;
  for (const m of Object.keys(modes)) {
    const c = collectionOfMode(doc, normalizeModeName(m));
    if (!c) throw new Error(`Unknown mode "${m}".`);
    if (collection && collection !== c.id) throw new Error("A token can vary by one mode collection only.");
    collection = c.id;
  }
}

/** Mode values without the default mode (that one is the token's value). */
function stripDefault(doc: FoldDocument, modes: Record<string, string | number>): Record<string, string | number> | undefined {
  const out: Record<string, string | number> = {};
  for (const [raw, v] of Object.entries(modes)) {
    const m = normalizeModeName(raw);
    const c = collectionOfMode(doc, m);
    if (c && c.modes[0] !== m) out[m] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function withModeValue(doc: FoldDocument, t: Token, mode: string, value: string | number | null): Token {
  const c = collectionOfMode(doc, mode);
  if (c && c.modes[0] === mode) return value === null ? t : { ...t, value };
  const modes = { ...(t.modes ?? {}) };
  if (value === null) delete modes[mode];
  else modes[mode] = value;
  return { ...t, modes };
}

const set_tokens: EditorTool = {
  write: true,
  label: () => "Updating tokens",
  run(args, env) {
    const updates = asArray<TokenUpdate>(args.updates);
    const deletes = asArray<string>(args.deletes).map((n) => normalizeTokenName(String(n)));
    const mode = modeArg(env.doc, args.mode);
    if (!updates.length && !deletes.length) throw new ToolError("Pass updates and/or deletes.");
    const touched: NodeId[] = [];
    const results = env.transact((tx) => {
      const out: Array<Record<string, unknown>> = [];
      for (const u of updates) {
        const name = normalizeTokenName(String(u.name ?? ""));
        try {
          const token = findToken(tx.doc, name);
          if (!token) throw new Error(`No token named ${name}. Use create_tokens to add it.`);
          const patch: Partial<Omit<Token, "id">> = {};
          const value = typeof u.value === "string" ? u.value.trim() : u.value;
          if (value !== undefined && !mode) patch.value = value;
          if (u.newName !== undefined) patch.name = normalizeTokenName(u.newName);
          if (u.description !== undefined) patch.description = u.description;
          if (patch.name && patch.name !== token.name && findToken(tx.doc, patch.name)) throw new Error(`A token named ${patch.name} already exists.`);
          // per-mode values: the top-level mode for `value`, plus an optional modes map (null removes)
          const modeValues: Record<string, string | number | null> = { ...(u.modes ?? {}) };
          if (value !== undefined && mode) modeValues[mode] = value;
          checkModes(tx.doc, modeValues);
          let draft: Token = { ...token, ...patch };
          for (const [m, v] of Object.entries(modeValues)) draft = withModeValue(tx.doc, draft, normalizeModeName(m), v);
          const next = tx.doc.tokens.map((t) => (t.id === token.id ? draft : t));
          if (patch.name && patch.name !== token.name) {
            for (const t of next) if (typeof t.value === "string") t.value = renameVarRefs(t.value, token.name, patch.name);
          }
          const cycle = cycleError({ tokens: next, modeCollections: tx.doc.modeCollections });
          if (cycle) throw new Error(cycle);
          const oldName = token.name;
          let updated = Object.keys(patch).length ? tx.updateToken(token.id, patch) : token;
          for (const [m, v] of Object.entries(modeValues)) updated = tx.setTokenModeValue(token.id, m, v);
          const entry: Record<string, unknown> = { name: oldName, status: "updated", token: { name: updated.name, type: updated.type, value: updated.value, ...(updated.modes ? { modes: updated.modes } : {}) } };
          if (mode) entry.mode = mode;
          if (updated.name !== oldName) {
            const nodes = rewriteTokenReferences(tx, oldName, updated.name);
            touched.push(...nodes);
            entry.renamed = { from: oldName, to: updated.name, updatedNodeCount: nodes.length };
          }
          out.push(entry);
        } catch (err) {
          out.push({ name, status: "error", error: errorMessage(err) });
        }
      }
      for (const name of deletes) {
        try {
          if (!findToken(tx.doc, name)) throw new Error(`No token named ${name}.`);
          tx.deleteToken(name);
          const users = nodesUsingToken(tx.doc, name);
          const entry: Record<string, unknown> = { name, status: "deleted" };
          if (users.length) entry.warning = `${plural(users.length, "layer")} still reference${users.length === 1 ? "s" : ""} var(${name}): ${users.slice(0, 20).join(", ")}${users.length > 20 ? ", ..." : ""}. Update them with update_styles.`;
          out.push(entry);
        } catch (err) {
          out.push({ name, status: "error", error: errorMessage(err) });
        }
      }
      return out;
    });
    env.touch(touched);
    if (results.every((r) => r.status === "error")) {
      throw new ToolError(`No tokens were changed. ${results.map((r) => `${r.name}: ${r.error}`).join(" ")}`);
    }
    return [{ results }];
  },
};

export const tokenTools: Record<string, EditorTool> = { create_tokens, set_tokens };
