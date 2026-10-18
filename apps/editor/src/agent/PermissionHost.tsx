// "Allow <client> to read and edit your designs?" Asked once per agent client; the server remembers
// the answer (Settings, Agents lists and revokes them).
import { Dialog } from "../dialogs/Dialog";
import { t } from "../i18n";
import { AgentAvatar, Button, clientLabel } from "../ui";
import { usePermissionQuestions } from "./permissions";

const ignore = () => {};

export function PermissionHost() {
  const questions = usePermissionQuestions();
  const q = questions[0];
  if (!q) return null;
  const name = clientLabel(q.client.name);
  return (
    // Esc and outside clicks do not answer: the agent waits for an explicit choice
    <Dialog key={q.id} onClose={ignore} width={440} top="18vh" label={t("permission.title", { client: name })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "24px 24px 20px" }}>
        <AgentAvatar client={q.client.name} size={36} shape="square" />
        <div style={{ font: "700 var(--of-text-xl)/26px var(--of-font-sans)", letterSpacing: "-0.02em", color: "var(--of-ink)" }}>{t("permission.title", { client: name })}</div>
        <div style={{ color: "var(--of-ink-2)", font: "var(--of-text-md)/19px var(--of-font-sans)" }}>
          {t("permission.body", { client: name })}
          {q.client.name !== name || q.client.version ? (
            <span className="of-mono" style={{ display: "block", marginTop: 8, color: "var(--of-muted)", fontSize: "var(--of-text-xs)" }}>
              {q.client.name}
              {q.client.version ? ` ${q.client.version}` : ""}
            </span>
          ) : null}
        </div>
      </div>
      <div className="of-dlg-foot">
        <span className="of-hint" style={{ flex: 1 }}>{t("permission.remember")}</span>
        <Button size="md" onClick={() => q.answer(false)}>{t("permission.deny")}</Button>
        <Button size="md" variant="primary" autoFocus onClick={() => q.answer(true)}>{t("permission.allow")}</Button>
      </div>
    </Dialog>
  );
}
