// kebab-case <-> camelCase conversion for CSS property names.
// Vendor prefixes follow React conventions: "-webkit-text-stroke" <-> "WebkitTextStroke",
// "-ms-transform" <-> "msTransform". Custom properties ("--x") are never converted.

/** "background-color" → "backgroundColor", "-webkit-text-stroke" → "WebkitTextStroke". Already-camel input is returned as is. */
export function kebabToCamel(name: string): string {
  const prop = name.trim();
  if (prop.startsWith("--")) return prop;
  if (!prop.includes("-")) return prop;
  let s = prop.toLowerCase();
  let prefix = "";
  if (s.startsWith("-ms-")) {
    prefix = "ms";
    s = s.slice(4);
  } else if (s.startsWith("-")) {
    // -webkit-, -moz-, -o-
    const end = s.indexOf("-", 1);
    if (end > 1) {
      const vendor = s.slice(1, end);
      prefix = vendor.charAt(0).toUpperCase() + vendor.slice(1);
      s = s.slice(end + 1);
    } else {
      s = s.slice(1);
    }
  }
  const camel = s.replace(/-+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  if (!prefix) return camel;
  return prefix + camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** "backgroundColor" → "background-color", "WebkitTextStroke" → "-webkit-text-stroke", "msTransform" → "-ms-transform". */
export function camelToKebab(name: string): string {
  const prop = name.trim();
  if (prop.startsWith("--")) return prop;
  if (prop.includes("-")) return prop.toLowerCase();
  let s = prop;
  let prefix = "";
  const vendor = /^(Webkit|Moz|O|ms|webkit|moz)(?=[A-Z])/.exec(s);
  if (vendor) {
    prefix = `-${vendor[1].toLowerCase()}`;
    s = s.slice(vendor[1].length);
  }
  const kebab = s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, "");
  return prefix ? `${prefix}-${kebab}` : kebab;
}

/**
 * Normalises any property spelling (kebab, camel, lower-case vendor camel like "webkitTextStroke")
 * to the canonical camelCase key used in StyleMaps.
 */
export function canonicalPropName(name: string): string {
  const camel = kebabToCamel(name);
  const m = /^(webkit|moz)([A-Z].*)$/.exec(camel);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + m[2];
  return camel;
}
