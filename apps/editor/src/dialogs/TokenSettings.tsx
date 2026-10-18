import { useEffect, useState } from "react";
import { checkSession } from "../auth/session";
import { Button } from "../ui";

export function TokenSettings() {
  const [canReset, setCanReset] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void fetch("/api/session").then((r) => r.json()).then((s: { canResetToken?: boolean }) => setCanReset(s.canResetToken === true)).catch(() => setMessage("Could not load token settings. Reopen Settings to try again."));
  }, []);
  const reset = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/session/reset-token", { method: "POST" });
      if (!res.ok) throw new Error("Could not reset the token. Try again.");
      await checkSession();
      setMessage("Token reset. Copy the new HTTP setup commands and Snapshot token from Connect an agent.");
      window.dispatchEvent(new Event("opencrease:token-changed"));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Transport token" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 24px", borderBottom: "1px solid var(--of-hairline)" }}>
      <span style={{ fontWeight: 600, fontSize: "var(--of-text-xs)" }}>Transport token</span>
      <span className="of-hint">Your token stays the same across restarts and ports. Resetting it requires connected HTTP clients and the Snapshot extension to be updated. Stdio discovers it automatically.</span>
      <Button size="sm" disabled={!canReset || busy} onClick={() => void reset()} style={{ alignSelf: "flex-start" }}>{busy ? "Resetting…" : "Reset token"}</Button>
      {canReset === false ? <span className="of-hint">Token reset is unavailable when OPENCREASE_TOKEN overrides the saved token.</span> : null}
      {message ? <span className="of-hint" role="status">{message}</span> : null}
    </section>
  );
}
