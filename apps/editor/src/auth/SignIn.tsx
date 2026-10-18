// Shown instead of the app when the browser has no session with the local server.
import "../ui";
import { useState } from "react";
import { t } from "../i18n";
import { Button, Icon } from "../ui";
import { signIn } from "./session";

export function SignIn() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "invalid" | "error">("idle");
  const submit = async () => {
    if (!token.trim()) return;
    setState("busy");
    const r = await signIn(token);
    if (r === "ok") location.reload();
    else setState(r);
  };
  return (
    <main style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--of-chrome)" }}>
      <form
        aria-labelledby="of-signin-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ width: 420, maxWidth: "calc(100vw - 32px)", background: "var(--of-panel)", border: "1px solid var(--of-hairline)", borderRadius: "var(--of-radius-lg)", padding: 28, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 12px 32px #0000000f" }}
      >
        <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--of-ink)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="home" size={18} />
        </span>
        <h1 id="of-signin-title" style={{ margin: 0, font: "700 var(--of-text-xl)/24px var(--of-font-sans)", letterSpacing: "-0.02em" }}>{t("auth.title")}</h1>
        <p style={{ margin: 0, color: "var(--of-ink-2)", font: "var(--of-text-md)/19px var(--of-font-sans)" }}>{t("auth.body", { path: "$OPENCREASE_HOME/token (default ~/.opencrease/token)" })}</p>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>{t("auth.token")}</span>
          <span className="of-field" style={{ flex: "none" }}>
            <input
              autoFocus
              value={token}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={state === "invalid"}
              onChange={(e) => {
                setToken(e.target.value);
                if (state !== "busy") setState("idle");
              }}
            />
          </span>
        </label>
        {state === "invalid" || state === "error" ? (
          <span role="alert" style={{ color: "var(--of-danger)", fontSize: "var(--of-text-sm)" }}>{t(state === "invalid" ? "auth.invalid" : "auth.failed")}</span>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="submit" variant="primary" size="md" disabled={!token.trim() || state === "busy"}>{t("auth.submit")}</Button>
        </div>
      </form>
    </main>
  );
}
