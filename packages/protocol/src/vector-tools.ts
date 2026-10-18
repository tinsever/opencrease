// OpenCrease extensions for editable SVG geometry.
import { z } from "zod";
import type { ToolDef } from "./tools";

const fileId = z.string().min(1).describe("File containing the vector layers.");
const nodeIds = z.array(z.string().min(1)).min(1).describe("Vector layers on one page, in any order. Stacking follows document order.");

export const VECTOR_TOOLS: ToolDef[] = [
  {
    name: "oc_boolean_op",
    title: "Combine vectors",
    description: "Combine SVG shapes or rectangles with a curve-preserving boolean operation. Subtract cuts upper layers out of the bottom layer. Replaces the operands with one editable SVG path using the bottom layer's paint, in one undo step. Empty results leave the document unchanged.",
    side: "editor",
    readOnly: false,
    destructive: true,
    inputShape: { fileId, nodeIds: nodeIds.min(2), operation: z.enum(["union", "subtract", "intersect", "exclude"]) },
  },
  {
    name: "oc_flatten",
    title: "Flatten vectors",
    description: "Flatten vector geometry into a compound path using the bottom layer's paint, outline strokes as filled paths, or convert primitive shapes to editable paths in place. Supports SVG layers, their inner shapes and rectangles. Each call is one undo step.",
    side: "editor",
    readOnly: false,
    destructive: true,
    inputShape: { fileId, nodeIds, operation: z.enum(["flatten", "outline-stroke", "convert-to-path"]).optional() },
  },
];
