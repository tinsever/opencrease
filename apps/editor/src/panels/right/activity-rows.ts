// Turns the raw agent log into scan-friendly rows: writes and failures stand alone,
// consecutive successful reads collapse into one row.
import type { AgentLogEntry } from "../../agent/activity";

export type ActivityRow = { kind: "entry"; entry: AgentLogEntry } | { kind: "reads"; entries: AgentLogEntry[] };

/** "get_node_info" → "Get node info" */
export function humanizeTool(tool: string): string {
  const s = tool.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One human-readable label per entry (the bridge label, else the tool name in words). */
export function activityLabel(e: Pick<AgentLogEntry, "label" | "tool">): string {
  return e.label?.trim() || humanizeTool(e.tool);
}

export function groupActivity(entries: AgentLogEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let reads: AgentLogEntry[] = [];
  const flush = () => {
    if (reads.length === 1) rows.push({ kind: "entry", entry: reads[0] });
    else if (reads.length > 1) rows.push({ kind: "reads", entries: reads });
    reads = [];
  };
  for (const e of entries) {
    if (!e.write && e.ok) {
      reads.push(e);
      continue;
    }
    flush();
    rows.push({ kind: "entry", entry: e });
  }
  flush();
  return rows;
}

/** "Read 6 times" plus the distinct things read, most frequent first ("node info, selection"). */
export function readsSummary(entries: AgentLogEntry[]): { title: string; detail: string } {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const what = activityLabel(e).replace(/^Get\s+/i, "");
    counts.set(what, (counts.get(what) ?? 0) + 1);
  }
  const detail = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w.charAt(0).toLowerCase() + w.slice(1)).join(", ");
  return { title: `Read ${entries.length} times`, detail };
}
