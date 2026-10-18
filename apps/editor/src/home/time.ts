// "edited 2 min ago" style relative times for the file grid.
const DAY = 86_400_000;

export function editedAgo(t: number, now = Date.now()): string {
  const diff = now - t;
  if (diff < 45_000) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(diff / 3_600_000);
  const d = new Date(t);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return h <= 1 ? "an hour ago" : `${h} hours ago`;
  if (t >= today.getTime() - DAY) return "yesterday";
  if (t >= today.getTime() - 6 * DAY) return d.toLocaleDateString("en-US", { weekday: "long" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "Edited 2 min ago, Kiln": time first, folder relative to the workspace (nothing at the top level). */
export function cardMeta(updatedAt: number, folder: string, now = Date.now()): string {
  return `Edited ${editedAgo(updatedAt, now)}${folder ? `, ${folder}` : ""}`;
}
