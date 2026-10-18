// An inner SVG element needs an SVG viewport and inherited presentation when captured on its own.
// Its screen matrix preserves nested group transforms; the crop is expressed in export CSS pixels.
export function svgCaptureRoot(source: SVGGraphicsElement, width: number, height: number): { el: HTMLElement; dispose(): void } {
  const rect = source.getBoundingClientRect();
  const matrix = source.getScreenCTM();
  if (!matrix || !rect.width || !rect.height) throw new Error("This SVG element has no visible bounds to export.");
  const ns = "http://www.w3.org/2000/svg";
  const host = document.createElement("div");
  host.setAttribute("data-of-capture-host", "");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: `${width}px`, height: `${height}px`, pointerEvents: "none" });
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("xmlns", ns);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.display = "block";
  for (const defs of source.ownerSVGElement?.querySelectorAll("defs") ?? []) svg.appendChild(defs.cloneNode(true));
  const group = document.createElementNS(ns, "g");
  const sx = width / rect.width, sy = height / rect.height;
  group.setAttribute("transform", `matrix(${matrix.a * sx} ${matrix.b * sy} ${matrix.c * sx} ${matrix.d * sy} ${(matrix.e - rect.left) * sx} ${(matrix.f - rect.top) * sy})`);
  const clone = source.cloneNode(true) as SVGGraphicsElement;
  const originals = [source, ...source.querySelectorAll<SVGElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  const presentation = ["color", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor", "dominant-baseline", "paint-order", "vector-effect", "clip-path", "mask", "filter", "visibility", "display", "transform", "transform-origin"];
  originals.forEach((node, index) => {
    const cs = getComputedStyle(node);
    const copy = copies[index];
    for (const property of presentation) {
      // Browser-computed SVG paint references may contain the current page's absolute URL.
      const value = cs.getPropertyValue(property).replace(/url\(["']?([^)"']*)#([^)'"\s]+)["']?\)/g, (url, base: string, id: string) =>
        !base || base === location.href.split("#")[0] ? `url("#${id}")` : url);
      if (value) copy.style.setProperty(property, value);
    }
  });
  // The selected root's own transform is already included in getScreenCTM().
  clone.removeAttribute("transform");
  clone.style.transform = "none";
  clone.style.rotate = "none";
  clone.style.translate = "none";
  clone.style.scale = "none";
  group.appendChild(clone);
  svg.appendChild(group);
  host.appendChild(svg);
  document.body.appendChild(host);
  return { el: host, dispose: () => host.remove() };
}
