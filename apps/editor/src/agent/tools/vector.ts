// Agent entry points for the same vector operations used by the inspector.
import { pageOfNode, type NodeId } from "@opencrease/model";
import { booleanOp, BOOLEAN_OPS, isVectorOperand, runFlattenOp, type BooleanOp, type FlattenOp, type OpsEnv } from "../../vector/ops";
import { ToolError, type EditorTool, type ToolEnv } from "../env";
import { svgWorldMatrix } from "../../vector/dom";
import { asArray, assertUnlocked, pageOfIds, requireNode } from "./common";

function operationEnv(env: ToolEnv): OpsEnv {
  return {
    doc: env.doc,
    measure: (id) => env.measure(id),
    matrix: svgWorldMatrix,
    origin(id) {
      // Absolute offsets are relative to the nearest positioned ancestor's padding box.
      for (let n = env.doc.nodes[id]; n?.type !== "Root"; n = env.doc.nodes[n.parentId!]) {
        if (!n) break;
        const cs = env.computedStyle(n.id);
        if ((cs?.("position") ?? n.styles.position ?? "static") === "static") continue;
        const rect = env.measure(n.id);
        if (rect) return { x: rect.x + (parseFloat(cs?.("border-left-width") ?? "0") || 0), y: rect.y + (parseFloat(cs?.("border-top-width") ?? "0") || 0) };
        break;
      }
      return { x: 0, y: 0 };
    },
  };
}

function vectorTool(kind: "boolean" | "flatten"): EditorTool {
  return {
    write: true,
    page: (args, doc) => pageOfIds(doc, asArray(args.nodeIds)),
    label: () => kind === "boolean" ? "Combining vectors" : "Flattening vectors",
    async run(args, env) {
      const ids = [...new Set(asArray<NodeId>(args.nodeIds))];
      if (!ids.length) throw new ToolError("Select vector layers with nodeIds.");
      const pages = new Set<string>();
      for (const id of ids) {
        const n = requireNode(env.doc, id);
        assertUnlocked(env.doc, n);
        if (!isVectorOperand(n)) throw new ToolError(`"${n.name}" is not a vector shape or rectangle.`);
        pages.add(pageOfNode(env.doc, id)!.id);
      }
      if (pages.size !== 1) throw new ToolError("Vector operations require layers on the same page.");
      const op = String(args.operation ?? (kind === "flatten" ? "flatten" : ""));
      if (kind === "boolean" ? !BOOLEAN_OPS.includes(op as BooleanOp) : !["flatten", "outline-stroke", "convert-to-path"].includes(op)) {
        throw new ToolError(`Unknown vector operation "${op}".`);
      }
      await env.settle();
      const geometry = operationEnv(env);
      const result = env.transact((tx) => kind === "boolean"
        ? booleanOp(geometry, tx, ids, op as BooleanOp)
        : runFlattenOp(geometry, tx, ids, op as FlattenOp));
      env.touch(result.created.length ? result.created : ids);
      await env.settle();
      return [{ operation: op, createdNodes: result.created.map((id) => ({ id, name: env.doc.nodes[id].name, component: env.doc.nodes[id].type })), removedNodeIds: result.removed }];
    },
  };
}

export const vectorTools: Record<string, EditorTool> = {
  oc_boolean_op: vectorTool("boolean"),
  oc_flatten: vectorTool("flatten"),
};
