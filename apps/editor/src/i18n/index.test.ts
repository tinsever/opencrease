import { afterEach, expect, it } from "vitest";
import { addMessages, setLocale, t } from "./index";
afterEach(() => setLocale("en"));
it("formats ICU plurals and falls back to English for missing messages", () => {
  expect(t("home.agent.connected", { more: 2, ago: "just now" })).toContain("with 2 more");
  addMessages("de", { "home.newFile": "Neue Datei" });
  setLocale("de");
  expect(t("home.newFile")).toBe("Neue Datei");
  expect(t("settings.title")).toBe("Settings");
});
