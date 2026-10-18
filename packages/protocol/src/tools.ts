// MCP tool catalogue. Names and argument shapes follow Paper's public MCP interface so
// existing agent prompts keep working. Descriptions are our own.
import { z } from "zod";
import { VECTOR_TOOLS } from "./vector-tools";
import type { PageIcon, TokenType } from "@opencrease/model";
import { THEME_TOOLS, tokenModeArg, tokenModesArg } from "./tools-theme";
import { COMPONENT_TOOLS } from "./component-tools";
import { OF_TOOLS } from "./tools-of";

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  /** Paper-compatible name */
  name: string;
  title: string;
  description: string;
  /** zod raw shape, passed to McpServer.registerTool as inputSchema */
  inputShape: S;
  readOnly: boolean;
  /** where the tool executes */
  side: "server" | "editor";
  /** how long the server waits for the editor to answer (default 60 s) */
  timeoutMs?: number;
  /** removes or overwrites existing content (MCP destructiveHint) */
  destructive?: boolean;
}

export const PAGE_ICONS = [
  "arrow", "padlock", "check", "cross", "info", "question", "design", "vector",
  "images", "table", "presentation", "blueprint", "swatches", "bar-chart",
  "line-chart", "pie-chart", "paper",
] as const satisfies readonly PageIcon[];

export const TOKEN_TYPES = [
  "breakpoint", "color", "container", "fontFamily", "fontSize", "fontWeight",
  "letterSpacing", "lineHeight", "opacity", "radius", "spacing",
] as const satisfies readonly TokenType[];

export const EXPORT_FORMATS = ["png", "jpg", "webp", "avif", "svg", "pdf", "mp4", "webm"] as const;

export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
export const LONG_TOOL_TIMEOUT_MS = 300_000;
/** export renders videos frame by frame (up to 300 s at 60 fps) */
export const EXPORT_TOOL_TIMEOUT_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Shared fields

const fileId = z.string().min(1).describe("ID of the file to work on. Get it from list_resources, create_file or get_basic_info.");
const optionalFileId = z
  .string()
  .optional()
  .describe("ID of the file to work on. Omit to use the file the user currently has in front of them.");
const optionalPageId = z
  .string()
  .optional()
  .describe("Page to work on. Omit to use the page the user is viewing. The user can switch pages at any time, so pass an explicit pageId when you can.");
const nodeId = z.string().min(1);
const styleValue = z.union([z.string(), z.number()]);
const styleMap = z
  .record(z.string(), styleValue)
  .describe('camelCase CSS properties, like React style objects, e.g. {"backgroundColor": "var(--color-surface)", "padding": "24px", "gap": 12}. Numbers are pixels for length properties.');
const pageIcon = z.enum(PAGE_ICONS);
const tokenType = z.enum(TOKEN_TYPES);
const tokenName = z
  .string()
  .regex(/^--[a-zA-Z0-9_-]+$/, "Token names are CSS custom property names like --color-primary")
  .describe('CSS custom property name, e.g. "--color-primary".');
const tokenValue = z
  .union([z.string(), z.number()])
  .describe('Colors as CSS color strings ("#1a1a1a", "oklch(0.7 0.1 250)"), sizes as px strings ("16px"), font weights as numbers (600), opacity as 0-1. Use "var(--other-token)" to alias another token.');

const exportSetting = z.object({
  format: z.enum(EXPORT_FORMATS).describe('File format. "svg" only works for SVG nodes. For video use "mp4" (opaque) or "webm" (transparent).'),
  scale: z
    .string()
    .regex(/^\d+(\.\d+)?(x|w|h|p)$/, 'Scale is a number with a unit: "2x", "512w", "512h" or "720p"')
    .describe('Size of the output: a multiplier ("1x", "2x"), a target width ("1200w"), a target height ("630h") or pixels on the shortest side ("720p").'),
  suffix: z.string().max(60).optional().describe('File name suffix, e.g. "@2x" or "-og". Defaults to "@<scale>" for scales other than 1x.'),
  durationSeconds: z.number().min(1).max(300).optional().describe("Video length in seconds (video exports only, default 10)."),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional().describe("Video frame rate (video exports only, default 30)."),
  pdfQuality: z.enum(["low", "medium", "high"]).optional().describe("Image quality inside PDFs (default high)."),
  pdfResampling: z.enum(["detailed", "basic"]).optional().describe('How images inside PDFs are resized: "detailed" keeps fine detail, "basic" gives smaller files.'),
});

const WRITE_RULES = `HTML rules:
- Style with inline style="..." attributes only. Classes, ids and <style> tags are ignored.
- Lay out with flexbox, padding and gap, or CSS grid (grid-template-columns/rows, gap, grid-column/grid-row on children) for two-dimensional layouts. Do not use margin, display: inline, grid-template-areas or tables; they are dropped. Everything is border-box.
- position: absolute is fine for decorative layers, but do not cover a whole artboard with one absolute element.
- Use the file's design tokens as CSS variables (var(--color-primary)) instead of raw values whenever a token fits. Raw values that equal a token come back with a warning naming the token.
- Any Google Font can be used in font-family. Sizes in px, letter-spacing in em, line-height in px or unitless.
- Icons are inline <svg> or images, never emoji.
- Inline <span>, <b>, <em> and similar inside a text element become rich text runs; only text styles (colour, font, size, weight, decoration) apply to them. Use <pre> or white-space: pre for code.
- data-mode="dark" on a frame renders it in that token mode (see oc_set_mode).
- Name layers with layer-name="Hero" so the layer tree stays readable.
- Reuse existing nodes with <x-clone node-id="ID" style="..."/> (x-paper-clone also works) instead of rewriting them.
- Place component instances with <x-instance component="Button" label="Shop" variant="ghost"></x-instance> (see oc_list_components). Code component tags from get_jsx, such as <Button variant="ghost" />, work too.
- Local images: <img src="asset:///absolute/path/to/image.png"> (paper-asset:// also works). Remote http(s) URLs work too.
- AI images, only when the user asks for them: src="gen://image?prompt=...&w=...&h=..." or url(gen://...) in styles. Read get_guide({ topic: "image-generation" }) first.`;

// ---------------------------------------------------------------------------
// Definitions

function def<S extends z.ZodRawShape>(d: ToolDef<S>): ToolDef {
  return d;
}

export const TOOLS: ToolDef[] = [
  ...VECTOR_TOOLS,
  // ----- server side -------------------------------------------------------
  def({
    name: "get_guide",
    title: "Get guide",
    side: "server",
    readOnly: true,
    description: `Read a usage guide. Call get_guide({ topic: "craft" }) once at the start of every design session, before any other tool: it explains how to work in OpenCrease and the design standards to follow, including the user's own taste and the current file's brand rules. Call it again if the conversation is long and you no longer remember it. Unknown topics return the list of available topics.`,
    inputShape: {
      topic: z.string().describe('Guide topic. "craft" is the main design and workflow guide ("mcp-instructions" is an alias). "image-generation" explains gen:// image URLs.'),
    },
  }),
  def({
    name: "list_resources",
    title: "List files",
    side: "server",
    readOnly: true,
    description: "List the design files in the user's workspace. Open files come first (open = has an editor tab, active = the tab in the foreground), then the rest by last update, newest first. If the result says truncated, call again with a higher limit before assuming you have seen every file.",
    inputShape: {
      limit: z.number().int().min(1).max(200).optional().describe("Maximum number of files to return (default 50, max 200)."),
    },
  }),
  def({
    name: "create_file",
    title: "Create file",
    side: "server",
    readOnly: false,
    description: "Create a new design file in the workspace and return its fileId and URL. Pass cloneFileId to start from a copy of an existing file. The file is not opened automatically: call open_file with the new id to start working in it.",
    inputShape: {
      name: z.string().optional().describe('Display name for the new file. Defaults to "Untitled" (or "<source> copy" when cloning).'),
      cloneFileId: z.string().optional().describe("ID of a file to copy. The new file gets its pages, nodes, tokens and assets."),
    },
  }),
  def({
    name: "open_file",
    title: "Open file",
    side: "server",
    readOnly: false,
    description: "Open a file in the editor so you can work on it, and return the same overview as get_basic_info. Accepts a bare file id, a /file/<id> path or a full editor URL. pageId is only applied when the file was not already open, so the user is not pulled away from the page they are looking at.",
    inputShape: {
      fileId: z.string().min(1).describe("File id, /file/<id> path or editor URL."),
      pageId: z.string().optional().describe("Page to show when the file is opened for the first time."),
    },
  }),
  def({
    name: "rename_resource",
    title: "Rename file",
    side: "server",
    readOnly: false,
    description: "Rename a file in the workspace. The name is trimmed and capped at 500 characters; an empty name leaves the file unchanged. Returns the stored name.",
    inputShape: {
      id: z.string().optional().describe("ID of the file to rename."),
      resourceId: z.string().optional().describe("Same as id (accepted for compatibility). Pass one of id or resourceId."),
      name: z.string().describe("The new display name."),
    },
  }),

  // ----- editor side: reading ----------------------------------------------
  def({
    name: "get_basic_info",
    title: "Get basic info",
    side: "editor",
    readOnly: true,
    description: "Orient yourself in a file: file and page names, the page list (pages and dividers), node count, every artboard on the page with its size and world position, font families in use and a compact token list. Call this first when you start working on a file, after get_guide. worldX/worldY/width/height are null when a size depends on layout and the page has not been measured.",
    inputShape: { fileId: optionalFileId, pageId: optionalPageId },
  }),
  def({
    name: "get_selection",
    title: "Get selection",
    side: "editor",
    readOnly: true,
    description: "Return the nodes the user has selected: ids, names, types, sizes and the artboard each belongs to. Use it when the user says \"this\", \"these\" or \"the selected ...\".",
    inputShape: { fileId: optionalFileId },
  }),
  def({
    name: "get_tree_summary",
    title: "Get tree summary",
    side: "editor",
    readOnly: true,
    description: 'Show the structure under a node as an indented outline, one line per node: Type "name" (id) WxH. Sizes show "?" when they depend on layout and are not measured. It costs far fewer tokens than get_jsx, so start here to find your way around before reading or editing specific nodes.',
    inputShape: {
      fileId,
      nodeId: nodeId.describe("Node to start from (an artboard, or a page root id from get_basic_info)."),
      depth: z.number().optional().describe("How many levels to descend (default 3, max 10). Deeper nodes are summarised as a child count."),
    },
  }),
  def({
    name: "get_children",
    title: "Get children",
    side: "editor",
    readOnly: true,
    description: "List the direct children of a node in order (first is at the back), with id, name, type and size.",
    inputShape: { fileId, nodeId: nodeId.describe("Parent node.") },
  }),
  def({
    name: "get_node_info",
    title: "Get node info",
    side: "editor",
    readOnly: true,
    description: "Return everything about one node: type, name, parent, children ids, visibility, lock state, authored styles, text, image source, size and world position.",
    inputShape: { fileId, nodeId: nodeId.describe("Node to inspect.") },
  }),
  def({
    name: "get_jsx",
    title: "Get JSX",
    side: "editor",
    readOnly: true,
    description: "Return a node and its subtree as JSX, either with Tailwind classes (default, with inline styles for anything Tailwind cannot express) or with inline styles. Use it to port a design into code or to read exact structure and values. Pass includeNodeIds: false for clean code to paste into a codebase.",
    inputShape: {
      fileId,
      nodeId: nodeId.describe("Root node of the JSX."),
      format: z.enum(["tailwind", "inline-styles"]).optional().describe('"tailwind" (default) or "inline-styles".'),
      includeNodeIds: z.boolean().optional().describe("Add each node's id as an id attribute so you can target it in edits (default true)."),
      includeRootPositioning: z.boolean().optional().describe("Keep the root's canvas position (position/top/left). Default false, which makes the output portable."),
    },
  }),
  def({
    name: "get_computed_styles",
    title: "Get computed styles",
    side: "editor",
    readOnly: true,
    description: "Return the computed CSS of one or more nodes as a map of node id to camelCase properties. Use it for exact colours, sizes and fonts; never estimate values from a screenshot.",
    inputShape: { fileId, nodeIds: z.array(nodeId).min(1).describe("Nodes to read.") },
  }),
  def({
    name: "get_screenshot",
    title: "Get screenshot",
    side: "editor",
    readOnly: true,
    timeoutMs: 120_000,
    description: "Render a node to an image so you can see what you built. Take one after every section you add and check spacing, type hierarchy, contrast, alignment and clipping before moving on. Scale 1 (default) is enough for layout; use 2 only to read small text. For more detail, screenshot a smaller child node.",
    inputShape: {
      fileId,
      nodeId: nodeId.describe("Node to capture, usually an artboard or a section inside it."),
      scale: z.number().optional().describe("1 (default) or 2."),
    },
  }),
  def({
    name: "get_fill_image",
    title: "Get fill image",
    side: "editor",
    readOnly: true,
    description: "Return the image used by an Image node (or a background image) as a JPEG sized for analysis, plus the original source URL. SVG nodes have no fill image; use get_jsx for those.",
    inputShape: { fileId, nodeId: nodeId.describe("Node with the image.") },
  }),
  def({
    name: "get_font_family_info",
    title: "Get font family info",
    side: "editor",
    readOnly: true,
    description: "Check whether font families are available (Google Fonts and fonts on the user's machine) and list their weights, styles and variable axes. Call it before you first set typography in a session, and prefer families already used in the file.",
    inputShape: { fileId, familyNames: z.array(z.string()).min(1).describe('Family names, e.g. ["Inter", "Fraunces"].') },
  }),
  def({
    name: "get_tokens",
    title: "Get tokens",
    side: "editor",
    readOnly: true,
    description: "List the file's design tokens (colours, spacing, radii, type and more) as JSON, a CSS :root block or a Tailwind v4 @theme block. Read them before designing and reference them with var(--name) in your styles.",
    inputShape: {
      fileId,
      format: z.enum(["json", "css", "tailwind"]).optional().describe('"json" (default), "css" or "tailwind".'),
      types: z.array(tokenType).optional().describe("Only these token types. Omit for all."),
      namePattern: z.string().optional().describe('Case-insensitive glob on the full name, "*" is the wildcard: "--color-*", "*brand*".'),
      mode: tokenModeArg,
    },
  }),
  def({
    name: "find_nodes",
    title: "Find nodes",
    side: "editor",
    readOnly: true,
    description: 'Find nodes by style and/or text, for example every node using a colour before replacing it with a token. Searches the whole file by default; pass pageId for one page or nodeId for one subtree (nodeId wins). Style filters are ANDed: each is {styleName?, styleValue?} where both accept "*" wildcards, colours compare by value ("#fff" equals "rgb(255, 255, 255)") and a literal colour also finds nodes that use a token resolving to it. textValue matches Text content case-insensitively, with "*" wildcards anchored to the whole text ("Get *", "*pricing*"). Each result lists what matched.',
    inputShape: {
      fileId,
      filters: z
        .array(
          z.object({
            styleName: z.string().optional().describe('Property, e.g. "backgroundColor", "font-size" or "border*". Omit to match any property.'),
            styleValue: z.string().optional().describe('Value: a literal ("#ff0000", "16px") or a token ("--color-primary" or "var(--color-primary)"). Omit to match any value.'),
          }),
        )
        .min(1)
        .optional()
        .describe("Style matchers, all must match."),
      textValue: z.string().optional().describe("Text content to match."),
      pageId: z.string().optional().describe("Search only this page."),
      nodeId: z.string().optional().describe("Search only this node and its descendants."),
    },
  }),

  // ----- editor side: pages -------------------------------------------------
  def({
    name: "create_page",
    title: "Create page",
    side: "editor",
    readOnly: false,
    description: "Add a page after the one the user is viewing and return its id. The user stays on their page; pass the new pageId to page-scoped tools (create_artboard, get_basic_info) to work on it. Use arrange_pages to move it.",
    inputShape: {
      fileId,
      name: z.string().optional().describe('Page name. Defaults to "Page N".'),
      icon: pageIcon.optional().describe('Decorative icon in the page list. "arrow" works well to mark the key page, "paper" for old drafts.'),
    },
  }),
  def({
    name: "update_pages",
    title: "Update pages",
    side: "editor",
    readOnly: false,
    description: "Rename pages or change their icons, several at once. Does not switch the page the user is viewing.",
    inputShape: {
      fileId,
      updates: z
        .array(
          z.object({
            pageId: z.string().describe("Page to change."),
            name: z.string().optional().describe("New name. Omit to keep."),
            icon: pageIcon.nullable().optional().describe("New icon, null for the default icon. Omit to keep."),
          }),
        )
        .min(1),
    },
  }),
  def({
    name: "arrange_pages",
    title: "Arrange pages",
    side: "editor",
    readOnly: false,
    description: 'Reorder the page list and add or remove dividers. Pass the complete new order: every page id and divider id from get_basic_info exactly once (minus dividers in removeDividerIds), with {"type": "divider"} where a new divider goes. Incomplete or stale lists are rejected without changes. Pages are never deleted. Returns the new page list.',
    inputShape: {
      fileId,
      order: z.array(z.union([z.string(), z.object({ type: z.literal("divider") })])).describe("Full page list in its new order."),
      removeDividerIds: z.array(z.string()).optional().describe("Divider ids to remove."),
    },
  }),

  // ----- editor side: writing -----------------------------------------------
  def({
    name: "create_artboard",
    title: "Create artboard",
    side: "editor",
    readOnly: false,
    description: `Create an artboard (a top-level frame) in free space on the page and return its id. Then fill it with write_html in insert-children mode. Artboards default to a flex column.
Sizes when the user does not give one: desktop 1440x900, tablet 768x1024, mobile 390x844. The height is only a starting point: when you finish and content clips, set height: "fit-content" with update_styles rather than guessing a new number.
Before the first artboard of a new design, post a brief with oc_post_brief (mood, palette, type, direction) and create tokens for it unless the file already has a design system. write_html refuses to fill an artboard of a file without tokens until a brief exists.`,
    inputShape: {
      fileId,
      name: z.string().describe('Artboard name shown in the layer tree, e.g. "Pricing, desktop".'),
      styles: z
        .object({
          width: styleValue.describe('Whole pixels, e.g. "1440px".'),
          height: styleValue.describe('Whole pixels, e.g. "900px", or "fit-content".'),
        })
        .catchall(styleValue)
        .describe('Artboard styles in camelCase. width and height are required, e.g. {"width": "1440px", "height": "900px", "backgroundColor": "var(--color-bg)", "padding": "64px", "gap": "48px"}.'),
      pageId: optionalPageId,
    },
  }),
  def({
    name: "write_html",
    title: "Write HTML",
    side: "editor",
    readOnly: false,
    destructive: true,
    description: `Turn HTML into design nodes, either inside a node (insert-children) or in place of it (replace). Returns the created nodes.
Work in small steps: one visual group per call (a nav bar, a heading block, one card, one list row). The user watches the canvas as you write, and small steps keep mistakes cheap; very large writes get a warning. For repeated items, build the first one, then duplicate_nodes and adjust it with set_text_content and update_styles. Take a get_screenshot after each section and fix problems before continuing.
Brief first: in a file without tokens, post a brief with oc_post_brief before the first write, or this tool returns an error asking for one.
${WRITE_RULES}`,
    inputShape: {
      fileId,
      targetNodeId: nodeId.describe("insert-children: the parent to append to. replace: the node to swap out."),
      mode: z.enum(["insert-children", "replace"]).describe('"insert-children" appends the new nodes to the target, "replace" deletes the target and puts the new nodes where it was.'),
      html: z.string().describe("HTML with inline styles."),
    },
  }),
  def({
    name: "update_styles",
    title: "Update styles",
    side: "editor",
    readOnly: false,
    description: 'Change styles on existing nodes, several groups in one call. Prefer this over rewriting HTML for targeted tweaks. Values merge into the existing styles; set a property to "" to remove it. Use var(--token) values where a token fits. Setting top/left on an artboard moves it on the canvas. Properties that are not supported or have no effect in that context (margins, display: inline) are dropped and listed under ignoredStyles.',
    inputShape: {
      fileId,
      updates: z
        .array(
          z.object({
            nodeIds: z.array(nodeId).min(1).describe("Nodes that get these styles."),
            styles: styleMap,
          }),
        )
        .min(1),
    },
  }),
  def({
    name: "set_text_content",
    title: "Set text content",
    side: "editor",
    readOnly: false,
    description: "Replace the text of Text nodes, several at once. Use it instead of write_html when only the words change, for example after duplicating a card. Only works on nodes of type Text.",
    inputShape: {
      fileId,
      updates: z.array(z.object({ nodeId: nodeId.describe("Text node."), textContent: z.string().describe("New text. Use \\n for line breaks.") })).min(1),
    },
  }),
  def({
    name: "rename_nodes",
    title: "Rename nodes",
    side: "editor",
    readOnly: false,
    description: "Rename layers, several at once. Clear names (\"Hero\", \"Price card, Pro\") make the layer tree and exported code easier to use.",
    inputShape: {
      fileId,
      updates: z.array(z.object({ nodeId, name: z.string().describe("New layer name.") })).min(1),
    },
  }),
  def({
    name: "move_nodes",
    title: "Move nodes",
    side: "editor",
    readOnly: false,
    description: `Reorder or reparent existing nodes while keeping their ids. Prefer this over duplicate and delete. Each move is either relative to a sibling ({nodeId, before} or {nodeId, after}, the parent comes from the sibling) or absolute ({nodeId, parentId, index?}: index is clamped, 0 is first, omit to append; parentId "root" means the root of the node's current page). Moves run in order and each sees the result of the previous ones. In flex parents this changes visual order; in free-form parents it changes stacking (last child is on top). Nodes can move across pages. Returns the resolved parent and index of each move, plus affectedParents: the final child lists of every parent that changed.`,
    inputShape: {
      fileId,
      moves: z
        .array(
          z.union([
            z.object({ nodeId, before: z.string().describe("Sibling to place the node in front of.") }).strict(),
            z.object({ nodeId, after: z.string().describe("Sibling to place the node after.") }).strict(),
            z
              .object({
                nodeId,
                parentId: z.string().describe('New parent, or "root" for the page root.'),
                index: z.number().int().min(0).optional().describe("Position among the parent's children, omit to append."),
              })
              .strict(),
          ]),
        )
        .min(1),
    },
  }),
  def({
    name: "duplicate_nodes",
    title: "Duplicate nodes",
    side: "editor",
    readOnly: false,
    description: "Deep-copy nodes with all their descendants. A copy goes right after its source unless you give a parentId; duplicated artboards are placed in free space. Returns each new id plus descendantIdMap (original descendant id to copy id), so you can edit the copy's children right away with set_text_content or update_styles. The fastest way to build repeated rows, cards and variants.",
    inputShape: {
      fileId,
      nodes: z
        .array(z.object({ id: nodeId.describe("Node to copy."), parentId: z.string().optional().describe("Parent for the copy. Omit to use the source's parent.") }))
        .min(1),
    },
  }),
  def({
    name: "delete_nodes",
    title: "Delete nodes",
    side: "editor",
    readOnly: false,
    destructive: true,
    description: "Delete nodes and everything inside them. Check with get_node_info or get_tree_summary first if you are not sure what a node contains. The user can undo it.",
    inputShape: { fileId, nodeIds: z.array(nodeId).min(1).describe("Nodes to delete.") },
  }),
  def({
    name: "create_tokens",
    title: "Create tokens",
    side: "editor",
    readOnly: false,
    description: "Add design tokens to the file. They become CSS variables on the canvas, so reference them as var(--name) in write_html and update_styles. Reuse existing tokens before adding new ones. Order matters for readability: for colours put neutrals first, then primary, secondary and accents (semantic names before raw palette); for everything else go from smallest to largest. Returns one result per token.",
    inputShape: {
      fileId,
      tokens: z
        .array(
          z.object({
            type: tokenType.describe("Token category."),
            name: tokenName,
            value: tokenValue,
            description: z.string().max(1024).optional().describe("What the token is for."),
            modes: tokenModesArg,
          }),
        )
        .min(1),
      mode: tokenModeArg,
    },
  }),
  def({
    name: "set_tokens",
    title: "Set tokens",
    side: "editor",
    readOnly: false,
    destructive: true,
    description: 'Change, rename or delete existing tokens by name. Pass updates (each with name plus any of value, newName, description) and/or deletes (token names). A tokens array where each entry may carry delete: true is accepted too. Nodes that reference a renamed token keep working. Returns one result per entry.',
    inputShape: {
      fileId,
      updates: z
        .array(
          z.object({
            name: tokenName.describe("Current name of the token."),
            value: tokenValue.optional(),
            newName: tokenName.optional().describe("New name."),
            description: z.string().max(1024).optional().describe("New description, empty string to clear."),
            modes: tokenModesArg,
          }),
        )
        .optional(),
      deletes: z.array(z.string()).optional().describe("Names of tokens to delete."),
      mode: tokenModeArg,
      tokens: z
        .array(
          z.object({
            name: tokenName,
            value: tokenValue.optional(),
            newName: tokenName.optional(),
            description: z.string().max(1024).optional(),
            delete: z.boolean().optional().describe("Delete this token."),
          }),
        )
        .optional()
        .describe("Alternative form: updates and deletions in one list, applied in order."),
    },
  }),
  def({
    name: "export",
    title: "Export",
    side: "editor",
    readOnly: true,
    timeoutMs: EXPORT_TOOL_TIMEOUT_MS,
    description: 'Export nodes to image, PDF or video files in the workspace and return their paths. Pass a map of node id to export settings (an empty array uses the node\'s own settings, or PNG at 2x), or "nodes-with-exports-only" to export every node on the page that has export settings. Keep the defaults unless the user asks for something specific. Videos animate the shaders inside the node: pass type "video" with settings like {"format": "mp4", "scale": "1080p", "durationSeconds": 10, "fps": 30} ("webm" keeps transparency).',
    inputShape: {
      fileId,
      nodes: z
        .union([z.literal("nodes-with-exports-only"), z.record(z.string(), z.array(exportSetting))])
        .describe('Either "nodes-with-exports-only" or {"<nodeId>": [{"format": "png", "scale": "2x"}]}.'),
      type: z.enum(["image", "video"]).optional().describe('"image" (default) or "video". With "video", nodes without settings export as MP4, 10 s at 30 fps.'),
      pageId: z.string().optional().describe('Page used by "nodes-with-exports-only". Omit for the page the user is viewing.'),
    },
  }),
  def({
    name: "export_combined_pdf",
    title: "Export combined PDF",
    side: "editor",
    readOnly: true,
    timeoutMs: LONG_TOOL_TIMEOUT_MS,
    description: "Export several nodes into one PDF, one page per node, ordered by canvas position (top to bottom, then left to right). Use it for decks and multi-page documents. Returns the file path.",
    inputShape: { fileId, nodeIds: z.array(nodeId).min(1).describe("Nodes to include, usually artboards.") },
  }),
  def({
    name: "finish_working_on_nodes",
    title: "Finish working on nodes",
    side: "editor",
    readOnly: false,
    description: "Always call this when you are done with a task. It clears the \"agent is working\" indicator from the artboards you edited. Pass the artboard ids you worked on (better when several agents share a file), or omit nodeIds to clear all of yours.",
    inputShape: { fileId, nodeIds: z.array(z.string()).optional().describe("Artboards to release. Omit for all.") },
  }),
  ...THEME_TOOLS,
  ...COMPONENT_TOOLS,

  // ----- OpenCrease additions (oc_*) ------------------------------------------
  ...OF_TOOLS,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

/** zod object schema for a tool's arguments. */
export function toolInputSchema(tool: ToolDef): z.ZodObject<z.ZodRawShape> {
  return z.object(tool.inputShape);
}

/**
 * Normalise validated arguments into the canonical shape the editor executes:
 * fills documented defaults, clamps ranges and folds compatibility aliases.
 * The server applies this before forwarding a call over the bridge.
 */
export function normalizeArgs(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = { ...input };
  switch (name) {
    case "get_tree_summary": {
      const d = typeof args.depth === "number" && Number.isFinite(args.depth) ? Math.round(args.depth) : 3;
      args.depth = Math.min(10, Math.max(1, d));
      break;
    }
    case "get_screenshot": {
      const s = typeof args.scale === "number" ? args.scale : 1;
      args.scale = s >= 1.5 ? 2 : 1;
      break;
    }
    case "get_jsx":
      args.format ??= "tailwind";
      args.includeNodeIds ??= true;
      args.includeRootPositioning ??= false;
      break;
    case "get_tokens":
      args.format ??= "json";
      break;
    case "export":
      args.type ??= "image";
      break;
    case "set_tokens": {
      const updates = Array.isArray(args.updates) ? [...(args.updates as Array<Record<string, unknown>>)] : [];
      const deletes = Array.isArray(args.deletes) ? [...(args.deletes as string[])] : [];
      if (Array.isArray(args.tokens)) {
        for (const t of args.tokens as Array<Record<string, unknown>>) {
          const { delete: del, ...rest } = t;
          if (del === true) deletes.push(String(rest.name));
          else updates.push(rest);
        }
      }
      delete args.tokens;
      args.updates = updates;
      args.deletes = deletes;
      break;
    }
  }
  return args;
}

/** Instructions sent to MCP clients on initialize. */
export const SERVER_INSTRUCTIONS = `OpenCrease is a local design tool whose canvas is real HTML and CSS. These tools let you read and edit the user's designs.

- Start every session with get_guide({ topic: "craft" }). It holds the workflow, the design standards and the user's own rules. Load it again if it may have dropped out of a long conversation.
- Orient with get_basic_info (omit fileId for the file the user has open), and get_selection when the user refers to what they selected. Use list_resources to find other files.
- Before a new design, post a brief with oc_post_brief (mood, palette, type, direction) and store it as tokens unless the file already has a design system; write_html asks for the brief first. Call get_font_family_info before your first typography.
- Use tokens through var(--name) instead of raw values; writes that repeat a token's value get a warning naming it.
- Write incrementally: one visual group per write_html call. Reuse work with duplicate_nodes, update_styles and set_text_content.
- After each section, review it with get_screenshot and fix spacing, type, contrast, alignment and clipping before moving on.
- Read exact values with get_jsx, get_computed_styles and get_tokens, never from screenshots. Do not show raw node ids to the user.
- When you are done, call finish_working_on_nodes.`;
