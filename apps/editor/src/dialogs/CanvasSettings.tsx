import { t } from "../i18n";
import { setPrefs, usePrefs, type ThemePref } from "../state/prefs";
import { Segmented, ToggleRow } from "../ui";

export function CanvasSettings() {
  const prefs = usePrefs((p) => p);
  return <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 20, marginBottom: 12, borderBottom: "1px solid var(--of-hairline)" }}>
    <div className="of-row"><span style={{ flex: 1 }}>{t("settings.appearance")}</span><Segmented<ThemePref> ariaLabel={t("settings.theme.label")} value={prefs.theme} options={[{ value: "system", label: t("settings.theme.system") }, { value: "light", label: t("settings.theme.light") }, { value: "dark", label: t("settings.theme.dark") }]} onChange={(theme) => setPrefs({ theme })} /></div>
    <ToggleRow label={t("settings.scrollZoom")} on={prefs.scrollZoom} onChange={(scrollZoom) => setPrefs({ scrollZoom })} />
    <ToggleRow label={t("settings.invertZoom")} on={prefs.invertZoom} onChange={(invertZoom) => setPrefs({ invertZoom })} />
    <ToggleRow label={t("settings.agentMotion")} on={prefs.reduceAgentMotion} onChange={(reduceAgentMotion) => setPrefs({ reduceAgentMotion })} />
  </div>;
}
