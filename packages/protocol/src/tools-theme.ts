// OpenCrease tools beyond Paper's set for token modes and text styles (`oc_` prefix).
import { z } from "zod";
import type { ToolDef } from "./tools";

const fileId = z.string().min(1).describe("ID of the file to work on. Get it from list_resources, create_file or get_basic_info.");
const styleValue = z.union([z.string(), z.number()]);

/** Optional `mode` argument shared by get_tokens, create_tokens and set_tokens. */
export const tokenModeArg = z
  .string()
  .optional()
  .describe('Token mode, e.g. "dark". Values are read or written for that mode instead of the default one. Modes come from oc_set_mode.');

/** Per-token values in other modes, accepted by create_tokens and set_tokens. */
export const tokenModesArg = z
  .record(z.string(), z.union([z.string(), z.number(), z.null()]))
  .optional()
  .describe('Values in other modes, e.g. {"dark": "#111111"}. All modes must belong to one collection. null removes a mode value (set_tokens).');

export const THEME_TOOLS: ToolDef[] = [
  {
    name: "oc_set_mode",
    title: "Set token modes",
    side: "editor",
    readOnly: false,
    description:
      'Define token mode collections (light/dark, comfortable/compact) and pin modes on frames. A collection lists its modes; the first one is the default and uses each token\'s normal value, the others take the values you give with create_tokens or set_tokens and mode. Pinning a mode on a frame (an artboard or any frame) renders its whole subtree in that mode through data-mode and scoped CSS variables, so you can show the same screen light and dark side by side. Pass collections to create or update them (by name, the modes list replaces the old one, renames keep values), and pins to set or clear (null) the mode of frames.',
    inputShape: {
      fileId,
      collections: z
        .array(
          z.object({
            name: z.string().min(1).describe('Collection name, e.g. "Theme" or "Density".'),
            modes: z.array(z.string().min(1)).min(1).describe('Ordered mode names, default first, e.g. ["light", "dark"].'),
            renames: z.record(z.string(), z.string()).optional().describe('Old mode name to new name, e.g. {"dark": "night"}.'),
            delete: z.boolean().optional().describe("Delete this collection and its per-mode values."),
          }),
        )
        .optional(),
      pins: z
        .array(
          z.object({
            nodeId: z.string().min(1).describe("A frame or artboard."),
            mode: z.union([z.string(), z.null()]).describe('Mode name(s), space separated for several collections ("dark compact"), or null to clear.'),
          }),
        )
        .optional(),
    },
  },
  {
    name: "oc_set_text_styles",
    title: "Set text styles",
    side: "editor",
    readOnly: false,
    description:
      "Create, update or delete named text styles (bundles of typography values, ideally token references like var(--text-xl)) and apply them to Text nodes. Applying copies the values and links the node, so later edits to the style update every linked node; code export uses one utility class per style. Prefer text styles over repeating the same font, size, weight, line height and tracking on many text layers.",
    inputShape: {
      fileId,
      styles: z
        .array(
          z.object({
            name: z.string().min(1).max(80).describe('Style name, e.g. "Heading 1". Matches an existing style to update it.'),
            styles: z.record(z.string(), styleValue).optional().describe('Typography properties in camelCase, e.g. {"fontFamily": "var(--font-display)", "fontSize": "var(--text-3xl)", "lineHeight": "40px"}.'),
            newName: z.string().min(1).max(80).optional(),
            description: z.string().max(1024).optional(),
            delete: z.boolean().optional().describe("Delete the style; linked nodes keep their values."),
          }),
        )
        .optional(),
      apply: z
        .array(z.object({ nodeIds: z.array(z.string().min(1)).min(1), style: z.union([z.string(), z.null()]).describe("Style name, or null to unlink.") }))
        .optional(),
    },
  },
];
