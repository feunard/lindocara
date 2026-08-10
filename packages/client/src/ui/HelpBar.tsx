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
      <span className="help-hint">
        <TinyKbd>{movement}</TinyKbd>
        <span>{t("help.move")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("skill1")}</TinyKbd>
        <span>{t("help.strike")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{skills}</TinyKbd>
        <span>{t("hud.abilities")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("interact")}</TinyKbd>
        <span>{t("help.commune")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("potion")}</TinyKbd>
        <span>{t("help.tonic")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("release")}</TinyKbd>
        <span>{t("help.release")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("map")}</TinyKbd>
        <span>{t("help.map")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("quests")}</TinyKbd>
        <span>{t("help.quests")}</span>
      </span>
      <span className="help-hint">
        <TinyKbd>{key("settings")}</TinyKbd>
        <span>{t("help.settings")}</span>
      </span>
    </div>
  );
}
