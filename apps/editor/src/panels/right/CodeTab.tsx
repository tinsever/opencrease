import { useMemo, useState, type ReactNode } from "react";
import { nodeToHtml, nodeToJsx, shaderComponentsIn, textStylesToCss, textStylesToTailwind } from "@opencrease/css";
import { themeToCss, themeToTailwind } from "@opencrease/model";
import { useDoc, useSelection } from "../../state/hooks";
import { Button, copyText, Icon, Segmented, ToggleRow } from "../../ui";
import { Dialog } from "../../dialogs/Dialog";

type Format = "react" | "tailwind" | "html";

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function componentName(name: string): string {
  const words = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(pascal) ? pascal : `Layer${pascal}`;
}

/** Tiny highlighter for JSX/HTML output: tags, attribute names, strings. */
export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(<\/?[\w.-]+)|(\s[\w:-]+)(?==)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\/?>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? "t-tag" : m[2] ? "t-attr" : m[3] ? "t-str" : "t-punct";
    out.push(<span key={k++} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeTab({ fileId }: { fileId: string }) {
  const doc = useDoc(fileId);
  const selection = useSelection();
  const [format, setFormatState] = useState<Format>(() => readPref<Format>("opencrease.code.format", "tailwind"));
  const [ids, setIdsState] = useState(() => readPref<string>("opencrease.code.ids", "0") === "1");
  const [wrap, setWrapState] = useState(() => readPref<string>("opencrease.code.wrap", "1") === "1");
  const [large, setLarge] = useState(false);
  const setWrap = (v: boolean) => {
    setWrapState(v);
    writePref("opencrease.code.wrap", v ? "1" : "0");
  };
  const [copied, setCopied] = useState<string | null>(null);
  const setFormat = (f: Format) => {
    setFormatState(f);
    writePref("opencrease.code.format", f);
  };
  const setIds = (v: boolean) => {
    setIdsState(v);
    writePref("opencrease.code.ids", v ? "1" : "0");
  };

  const nodes = useMemo(() => (doc ? selection.map((id) => doc.nodes[id]).filter((n) => n && n.type !== "Root") : []), [doc, selection]);
  const code = useMemo(() => {
    if (!doc || nodes.length === 0) return "";
    try {
      const shaders = format === "html" ? [] : [...new Set(nodes.flatMap((n) => shaderComponentsIn(doc, n.id)))];
      const imports = shaders.length ? `import { ${shaders.join(", ")} } from "@paper-design/shaders-react";\n\n` : "";
      return imports + nodes
        .map((n) =>
          format === "html"
            ? nodeToHtml(doc, n.id, { includeNodeIds: ids })
            : nodeToJsx(doc, n.id, { format: format === "tailwind" ? "tailwind" : "inline-styles", includeNodeIds: ids }),
        )
        .join("\n\n");
    } catch (e) {
      return `/* Could not generate code: ${e instanceof Error ? e.message : String(e)} */`;
    }
  }, [doc, nodes, format, ids]);

  if (!doc) return null;
  const first = nodes[0];
  const filename = first ? `${componentName(first.name)}${format === "html" ? ".html" : ".tsx"}` : "";
  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1400);
  };
  const wrapped = format === "html" ? code : `export function ${first ? componentName(first.name) : "Layer"}() {\n  return (\n${code.split("\n").map((l) => `    ${l}`).join("\n")}\n  );\n}\n`;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {first ? (
        <div className="of-sel-header">
          <div className="titles">
            <div className="t1">{nodes.length === 1 ? first.name : `${nodes.length} layers`}</div>
            <div className="t2">{format === "html" ? "HTML with inline styles" : format === "tailwind" ? "React with Tailwind classes" : "React with inline styles"}</div>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 12px 12px", borderBottom: "1px solid var(--of-hairline)" }}>
        <Segmented
          className="tabs"
          ariaLabel="Code format"
          value={format}
          onChange={setFormat}
          options={[
            { value: "react", label: "React" },
            { value: "tailwind", label: "Tailwind" },
            { value: "html", label: "HTML" },
          ]}
        />
        <ToggleRow label="Include node IDs" on={ids} onChange={setIds} />
        <ToggleRow label="Wrap lines" on={wrap} onChange={setWrap} />
      </div>
      {first ? (
        <>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--of-code-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 12px", borderBottom: "1px solid #FFFFFF14", flexShrink: 0 }}>
              <span style={{ flex: 1, color: "#FFFFFF99", font: "var(--of-text-xs)/14px var(--of-font-mono)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{filename}</span>
              <button
                style={{ all: "unset", display: "flex", alignItems: "center", gap: 4, color: "#FFFFFFCC", font: "500 var(--of-text-xs)/14px var(--of-font-sans)", cursor: "default" }}
                aria-label="Open in larger view"
                title="Open in larger view"
                onClick={() => setLarge(true)}
              >
                <Icon name="expand" size={12} />
              </button>
              <button
                style={{ all: "unset", display: "flex", alignItems: "center", gap: 4, color: "#FFFFFFCC", font: "500 var(--of-text-xs)/14px var(--of-font-sans)", cursor: "default" }}
                onClick={() => void copyText(format === "html" ? code : wrapped).then(() => flash("code"))}
              >
                <Icon name="copy" size={12} />
                {copied === "code" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className={`of-code${wrap ? " wrap" : ""}`} style={{ flex: 1, minHeight: 0 }}>{highlight(code)}</pre>
          </div>
          {large ? (
            <Dialog onClose={() => setLarge(false)} width={1100} top="6vh" label="Code">
              <div style={{ display: "flex", alignItems: "center", gap: 12, height: 48, padding: "0 16px 0 20px", borderBottom: "1px solid var(--of-hairline)", flexShrink: 0 }}>
                <span style={{ fontWeight: 600, fontSize: "var(--of-text-md)" }}>{filename}</span>
                <span className="of-hint" style={{ flex: 1 }}>{format === "html" ? "HTML with inline styles" : format === "tailwind" ? "React with Tailwind classes" : "React with inline styles"}</span>
                <span style={{ width: 120 }}><ToggleRow label="Wrap lines" on={wrap} onChange={setWrap} /></span>
                <Button onClick={() => void copyText(format === "html" ? code : wrapped).then(() => flash("code"))}>
                  <Icon name="copy" size={12} /> {copied === "code" ? "Copied" : "Copy"}
                </Button>
                <button className="of-icon-btn sm" aria-label="Close" onClick={() => setLarge(false)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <pre className={`of-code${wrap ? " wrap" : ""}`} style={{ height: "min(72vh, 900px)", fontSize: "var(--of-text-sm)", lineHeight: "20px", padding: 20 }}>{highlight(code)}</pre>
            </Dialog>
          ) : null}
          <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderTop: "1px solid var(--of-hairline)", flexShrink: 0 }}>
            <Button
              style={{ flex: 1, height: 30 }}
              onClick={() => {
                const blob = new Blob([format === "html" ? code : wrapped], { type: "text/plain" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              }}
            >
              Download {format === "html" ? ".html" : ".tsx"}
            </Button>
            {doc.tokens.length || doc.textStyles?.length ? (
              <Button
                style={{ height: 30 }}
                title={format === "tailwind" ? "Tailwind v4 @theme, mode variants and text style @utility rules" : "CSS variables, mode blocks and text style classes"}
                onClick={() =>
                  void copyText(
                    format === "tailwind"
                      ? [themeToTailwind(doc), textStylesToTailwind(doc)].filter((x) => x.trim()).join("\n")
                      : [themeToCss(doc), textStylesToCss(doc)].filter((x) => x.trim()).join("\n"),
                  ).then(() => flash("theme"))
                }
              >
                {copied === "theme" ? "Copied" : "Copy theme"}
              </Button>
            ) : null}
            <Button
              variant="agent"
              style={{ flex: 1, height: 30 }}
              title="Copies a prompt that points your coding agent at this layer"
              onClick={() =>
                void copyText(
                  `Implement ${nodes.length === 1 ? `the "${first.name}" layer` : `${nodes.length} layers`} from the OpenCrease file "${doc.name}" (fileId ${doc.id}, nodeIds ${nodes.map((n) => n.id).join(", ")}). ` +
                    `Read the design with the OpenCrease MCP tools (get_jsx, get_screenshot) or start from this ${format === "html" ? "HTML" : "JSX"}:\n\n${code}\n`,
                ).then(() => flash("agent"))
              }
            >
              {copied === "agent" ? "Copied" : "Copy for agent"}
            </Button>
          </div>
        </>
      ) : (
        <div className="of-empty">Select a layer to see its code.</div>
      )}
    </div>
  );
}
