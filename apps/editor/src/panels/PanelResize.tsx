import { getPrefs, PANEL_LIMITS, setPrefs, usePrefs } from "../state/prefs";

export function PanelResize({ side }: { side: "left" | "right" }) {
  const key = side === "left" ? "leftWidth" : "rightWidth";
  const width = usePrefs((p) => p[key]);
  const limits = PANEL_LIMITS[side];
  const change = (value: number) => setPrefs({ [key]: Math.min(limits.max, Math.max(limits.min, value)) });
  return <div className="of-panel-resize" role="separator" aria-label={`Resize ${side} sidebar`} aria-orientation="vertical" tabIndex={0} aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width}
    onDoubleClick={() => change(limits.default)}
    onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); change(width + (e.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1) * (e.shiftKey ? 40 : 10)); } }}
    onPointerDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget, x = e.clientX, start = getPrefs()[key];
      el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => change(start + (ev.clientX - x) * (side === "left" ? 1 : -1));
      const stop = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", stop); el.removeEventListener("pointercancel", stop); };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", stop); el.addEventListener("pointercancel", stop);
    }} />;
}
