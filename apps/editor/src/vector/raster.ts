// Object-fit/object-position placement in the image's displayed CSS box, before tracing at lower resolution.
export function rasterPlacement(naturalWidth: number, naturalHeight: number, width: number, height: number, fit: string, position = "50% 50%") {
  const ratio = fit === "cover" ? Math.max(width / naturalWidth, height / naturalHeight)
    : fit === "contain" ? Math.min(width / naturalWidth, height / naturalHeight)
    : fit === "scale-down" ? Math.min(1, width / naturalWidth, height / naturalHeight)
    : fit === "none" ? 1 : null;
  const drawWidth = ratio === null ? width : naturalWidth * ratio;
  const drawHeight = ratio === null ? height : naturalHeight * ratio;
  let [x, y] = position.trim().split(/\s+/);
  if (!y) {
    if (x === "top" || x === "bottom") { y = x; x = "50%"; }
    else y = "50%";
  }
  if (x === "top" || x === "bottom" || y === "left" || y === "right") [x, y] = [y, x];
  const offset = (value: string, free: number) => {
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return free;
    if (value === "center") return free / 2;
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return free / 2;
    return value.endsWith("%") ? free * number / 100 : number;
  };
  return { x: offset(x, width - drawWidth), y: offset(y, height - drawHeight), width: drawWidth, height: drawHeight };
}
