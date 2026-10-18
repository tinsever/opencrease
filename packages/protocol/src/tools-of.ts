// OpenCrease tools beyond Paper's set (oc_ prefix): design briefs and version diffs.
import { z } from "zod";
import type { ToolDef } from "./tools";

const fileId = z.string().min(1).describe("ID of the file to work on. Get it from list_resources, create_file or get_basic_info.");
/** A string, or a list of strings that is joined with line breaks. */
const briefText = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const OF_TOOLS: ToolDef[] = [
  {
    name: "oc_post_brief",
    title: "Post design brief",
    side: "editor",
    readOnly: false,
    description: `Record the design brief before you build: mood, palette, type and direction. The user sees it in the Agent tab, and write_html refuses to write into an artboard of a file without tokens until a brief exists (when the "Post a design brief first" step is on, which is the default).
Pass artboardId for a brief about one artboard, or omit it for a brief that covers the whole file. Posting again for the same scope replaces the earlier brief.
Be specific: the mood is a real place, material or object; the palette lists 4 to 6 colours with roles; type names families, weights and a size scale; direction is one sentence about the layout idea. After the brief, create tokens for it with create_tokens.`,
    inputShape: {
      fileId,
      artboardId: z.string().optional().describe("Artboard the brief is for. Omit for the whole file."),
      subject: z.string().optional().describe("What this is and who it is for, in one line."),
      mood: briefText.describe('A real place, material or object and why it fits, e.g. "Ferry terminal at 6 am: wet concrete, safety yellow, ink."'),
      palette: briefText.describe('4 to 6 colours with roles, e.g. ["ground #F4F2EE", "ink #15171A", "muted #6B6F76", "line #DAD6CF", "accent #F2C230"].'),
      type: briefText.describe('Families, weights and a size scale, e.g. "Söhne 400/600, GT Sectra 500 for display; 13, 15, 20, 32, 56".'),
      direction: briefText.describe("One sentence on the layout idea."),
    },
  },
  {
    name: "oc_get_diff",
    title: "Get design diff",
    side: "editor",
    readOnly: true,
    description: `Report what changed in a file since a saved version, for syncing a design back to code. Returns added, removed and changed nodes (with the style, text and structure changes of each), token changes and page changes, grouped by artboard.
Versions are numbered per file. OpenCrease saves one automatically every few minutes while the file changes, and the user can name versions in the History panel. Omit sinceVersion to list the versions.
This is a read-only comparison with the live document. It never creates or changes snapshots; save a named version in Version history when you need a new baseline.`,
    inputShape: {
      fileId,
      sinceVersion: z.number().int().min(1).optional().describe("Version number to compare against. Omit to list versions."),
    },
  },
];
