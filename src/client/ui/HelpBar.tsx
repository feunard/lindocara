import { useSyncExternalStore } from "react";
import { TinyKbd } from "@/ui/tiny-swords/TinyKbd.js";
import {
  getInputSettings,
  keyboardBindingLabel,
  subscribeInputSettings,
} from "../game/input-settings.js";
import { t, useLocale } from "../i18n.js";

export function HelpBar() {
  useLocale();
  const settings = useSyncExternalStore(subscribeInputSettings, getInputSettings, getInputSettings);
  const key = (control: keyof typeof settings.keyboard) => {
    const binding = settings.keyboard[control][0];
    return binding ? keyboardBindingLabel(binding) : "—";
  };
  const movement = (["moveUp", "moveLeft", "moveDown", "moveRight"] as const).map(key).join("");
  const skills = (["skill1", "skill2", "skill3", "skill4", "skill5"] as const).map(key).join("/");

  return (
    <div id="help">
      <TinyKbd>{movement}</TinyKbd> {t("help.move")}
      <TinyKbd>{key("target")}</TinyKbd> {t("help.target")}
      <TinyKbd>{key("skill1")}</TinyKbd> {t("help.strike")}
      <TinyKbd>{skills}</TinyKbd> {t("hud.abilities")}
      <TinyKbd>{key("interact")}</TinyKbd> {t("help.commune")}
      <TinyKbd>{key("potion")}</TinyKbd> {t("help.tonic")}
      <TinyKbd>{key("release")}</TinyKbd> {t("help.release")}
      <TinyKbd>{key("map")}</TinyKbd> {t("help.map")}
      <TinyKbd>{key("settings")}</TinyKbd> {t("help.settings")}
    </div>
  );
}
