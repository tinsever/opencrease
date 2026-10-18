// Exercise the actual shortcut dispatchers with isolated action stubs. No editor or files are changed.
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const sources = [
  ['canvas', 'apps/editor/src/canvas/interactions.ts', 'onKeyDown'],
  ['canvas', 'apps/editor/src/canvas/shortcuts.ts', 'onKeyDown'],
  ['canvas', 'apps/editor/src/canvas/shortcuts-extra.ts', 'handleExtraShortcut'],
  ['canvas', 'apps/editor/src/canvas/component-shortcuts.ts', 'handleComponentShortcut'],
  ['text selection', 'apps/editor/src/canvas/text-shortcuts.ts', 'handleTextShortcut'],
  ['vector edit', 'apps/editor/src/vector/controller.ts', 'onKeyDown'],
];
const file = { selection: ['node'], activePageId: 'page', store: { doc: { nodes: { node: { type: 'Text', styles: {}, children: [] } }, pages: { page: { rootId: 'root' } } } } };
const state = { route: { kind: 'file' }, editingTextId: null, tool: 'move' };
let calls;
const stub = (name) => (...args) => {
  calls.push(name);
  if (name === 'getState') return state;
  if (name === 'getActiveFile') return file;
  if (name === 'get') return { edit: true };
  if (name === 'canEditPath') return true;
  if (name === 'isDragging' || name.startsWith('handle')) return false;
};
const bindings = sources.map(([scope, path, handler]) => {
  const source = fs.readFileSync(path, 'utf8');
  let code = transformSync(`${source}\n;globalThis.__handler = ${handler};`, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  // Keep the dispatcher, stub its document-mutating helpers. esbuild emits top-level functions
  // without indentation; strings/comments are skipped when finding each function's closing brace.
  const helpers = [...code.matchAll(/^function (\w+)\([^\n]*\) \{/gm)];
  for (const match of helpers.reverse()) {
    const name = match[1];
    if (name === handler || name === 'stop') continue;
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    const tokens = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[{}]/g;
    tokens.lastIndex = start;
    for (let token; (token = tokens.exec(code));) {
      if (token[0] === '{') depth++;
      if (token[0] === '}' && --depth === 0) { end = token.index; break; }
    }
    const value = name === 'runStep' || name === 'toggle' ? 'true' : name.startsWith('is') || name.startsWith('handle') ? 'false' : '{}';
    code = code.slice(0, start) + ` __record(${JSON.stringify(name)}); return ${value}; ` + code.slice(end);
  }
  const Element = class {};
  const context = vm.createContext({
    exports: {}, module: { exports: {} }, Element, HTMLElement: Element, document: { activeElement: null },
    window: { dispatchEvent: () => {} }, CustomEvent: class {},
    __record: (name) => calls.push(name),
    require: () => new Proxy({}, { get: (_, name) => name === 'canvasUi' ? { get: () => ({ renaming: null }) } : name === 'vectorUi' ? { get: () => ({ edit: true }) } : stub(name) }),
  });
  vm.runInContext(code, context, { filename: path });
  return { scope, path, run: context.__handler };
});
const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((x) => [`Key${x}`, x.toLowerCase()]);
const keys = [...letters, ...[...Array(10).keys()].map((x) => [`Digit${x}`, String(x)]), ...Object.entries({ Comma: ',', Period: '.', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Equal: '=', Minus: '-', Space: ' ', Enter: 'Enter', Escape: 'Escape', Delete: 'Delete', Backspace: 'Backspace', Tab: 'Tab', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown' })];
const registrations = [];
for (const [code, key] of keys) for (const modifier of ['none', 'meta', 'ctrl']) for (const altKey of [false, true]) for (const shiftKey of [false, true]) {
  const metaKey = modifier === 'meta', ctrlKey = modifier === 'ctrl';
  const chord = `${metaKey ? 'Command+' : ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${code.replace('Key', '').replace('Digit', '')}`;
  for (const binding of bindings) {
    calls = [];
    let consumed = false;
    const event = { code, key, metaKey, ctrlKey, altKey, shiftKey, defaultPrevented: false, target: null, preventDefault() { consumed = true; throw 'consumed'; }, stopPropagation() {} };
    try { consumed = binding.run(event) === true || consumed; } catch (e) { if (e !== 'consumed') throw new Error(`${binding.path}: ${chord}: ${e}`); }
    if (consumed) registrations.push({ chord, scope: binding.scope, source: binding.path, action: calls.filter((x) => !['getState', 'getActiveFile', 'isDragging'].includes(x)).join(', ') });
  }
}
const byChord = Map.groupBy(registrations, (x) => x.chord);
const duplicates = [...byChord].filter(([, entries]) => entries.length > 1).map(([chord, entries]) => ({ chord, entries, contextual: entries.every((e) => e.scope !== 'canvas') || entries.filter((e) => e.scope === 'canvas').length === 1 }));
const unresolved = duplicates.filter((x) => !x.contextual);
// Native menu accelerators mirror the renderer; clipboard and text-edit keys are scoped to their DOM events.
const native = [...fs.readFileSync('apps/desktop/src/menu.ts', 'utf8').matchAll(/(?:cmd\("([^"]+)",\s*"[^"]+",\s*|accelerator:\s*)"([^"]+)"/g)].map((m) => ({ label: m[1] ?? 'Native window command', chord: m[2] }));
const report = { registrations, native, duplicates, unresolved };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Keyboard dispatch audit: ${registrations.length} accepted chord/handler combinations, ${native.length} native menu bindings.`);
  console.log(`Contextual overlaps: ${duplicates.length} (vector point editing and text formatting take priority over canvas actions).`);
  for (const d of duplicates) console.log(`  ${d.chord}: ${d.entries.map((e) => `${e.scope} (${e.source.split('/').at(-1)})`).join(', ')}`);
  console.log(`Unresolved collisions: ${unresolved.length}`);
}
if (unresolved.length) process.exitCode = 1;
