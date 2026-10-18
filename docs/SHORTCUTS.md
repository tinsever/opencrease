# Keyboard shortcuts

Command below means Command on macOS and Ctrl on Windows/Linux. Letter shortcuts use physical key codes. Canvas tools and transforms are inactive while typing, composing text, renaming, or using panel/dialog controls. Command-K opens the palette from panels too. Text formatting, vector point editing, token lists and native clipboard events have their own focused contexts.

## General and canvas

| Shortcut | Action |
|---|---|
| Command-K | Command palette |
| Alt-P | Preview artboard in a new tab or desktop window |
| Command-Z / Shift-Command-Z / Command-Y | Undo / redo / redo |
| Command-D | Duplicate, repeating the previous offset and rotation |
| Command-G / Shift-A | Wrap in frame / add flex layout |
| Command-A | Select all at the current layer level |
| Command-C / Command-X / Command-V | Copy / cut / paste through clipboard events |
| Delete or Backspace | Delete selection |
| V or M / F or A / R / T / I / H | Move / frame / rectangle / text / place image / hand |
| P / L / O | Pen / line / ellipse |
| K / Z / Space held | Scale / zoom / temporarily pan |
| Shift-1 / Shift-2 / Command-0 | Zoom to fit / selection / 100% |
| Command-Plus / Command-Minus | Zoom in / out |
| Command-Backslash | Show or hide interface |
| Arrows / Shift-Arrows | Nudge 1 / 10 px, or pan when nothing is selected |
| Enter / Shift-Enter / Escape | Edit text or enter first child / select parent / leave tool or select parent |
| Tab / Shift-Tab | Next / previous sibling |
| Command-] / Command-[ | Bring forward / send backward |
| Alt-Command-] / Alt-Command-[ | Bring to front / send to back |
| Alt-R / Alt-T / Shift-Command-C | Copy React / Tailwind / PNG |
| Shift-Command-R | Paste to replace |
| Alt-L | Collapse the layer tree |
| Alt-A / Alt-D / Alt-W / Alt-S | Align left / right / top / bottom |
| Alt-H / Alt-V | Align horizontal / vertical centres |
| Shift-Alt-H / Shift-Alt-V | Distribute horizontally / vertically |
| Shift-Alt-T | Tidy up |
| Alt-Command-K / Alt-Command-B | Create component or variant set / detach instance |
| Shift-Command-I / Shift-Command-J | Generate image / SVG |
| Shift-Command-Quote | Toggle half-pixel vector snapping |

Tidy up uses Shift-Alt-T. The previous Ctrl-Alt-T binding was unreachable because Ctrl entered the general command branch first. Command-D is registered once, in the repeat-duplicate handler.

## Focused editing

Text selections and active text ranges use Command-B, Command-I and Command-U for bold, italic and underline. Shift-Command-Comma/Period changes font size; Alt-Command-Comma/Period changes weight; Alt-Comma/Period changes tracking; Shift-Alt-Comma/Period changes line height. Enter inserts a line break; Escape or Command-Enter finishes text editing.

Vector point editing takes priority over canvas Enter, Escape, Delete/Backspace, arrows, Tab and Command-A. While drawing a pen path, Enter/Escape finishes it and Delete/Backspace removes the last point. These overlaps are intentional and scoped to the active vector session.

The Theme token list handles Command-A, Command-D, Delete/Backspace and Command-C/V within the list. Form fields and menus retain their own Enter, Escape, arrows, Tab and clipboard behavior. Native desktop menu accelerators mirror the renderer; window/file commands are additionally registered by Electron.

## Audit

Run `node scripts/audit-shortcuts.mjs`, or add `--json` for the full inventory. The script loads the actual global, transform, component, typography, vector and temporary-pan dispatchers with document-mutating actions stubbed out, enumerates physical keys/modifiers, and collects native menu accelerators. It reports exact chord overlaps and fails on unscoped canvas collisions. Point-editing precedence accounts for the contextual overlaps. Focused panel/form keys are local DOM handlers, not competing global shortcuts.
