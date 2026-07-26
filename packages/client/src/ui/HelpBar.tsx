import type { ControlId } from "@lindocara/renderer/input-settings.js";
import { TinyKbd } from "@/ui/tiny-swords/TinyKbd.js";
import { t, useLocale } from "../i18n.js";
import { controlBindingLabel, useInputModeSettings } from "./input-hints.js";

export function HelpBar() {
  useLocale();
  const { mode, settings } = useInputModeSettings();
  const key = (control: ControlId) => controlBindingLabel(control, mode, settings);
  const movement = (["moveUp", "moveLeft", "moveDown", "moveRight"] as const).map(key).join("");
  const skills = (["skill1", "skill2", "skill3", "skill4", "skill5"] as const).map(key).join("/");

  return (
    <div id="help">
      <TinyKbd>{movement}</TinyKbd> {t("help.move")}
      <TinyKbd>{key("skill1")}</TinyKbd> {t("help.strike")}
      <TinyKbd>{skills}</TinyKbd> {t("hud.abilities")}
      <TinyKbd>{key("interact")}</TinyKbd> {t("help.commune")}
      <TinyKbd>{key("potion")}</TinyKbd> {t("help.tonic")}
      <TinyKbd>{key("release")}</TinyKbd> {t("help.release")}
      <TinyKbd>{key("map")}</TinyKbd> {t("help.map")}
      <TinyKbd>{key("quests")}</TinyKbd> {t("help.quests")}
      <TinyKbd>{key("settings")}</TinyKbd> {t("help.settings")}
    </div>
  );
}
