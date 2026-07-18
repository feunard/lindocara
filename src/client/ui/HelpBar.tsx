import { useSyncExternalStore } from "react";
import { Kbd } from "@/ui/pixelact-ui/kbd.js";
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
      <Kbd>{movement}</Kbd> {t("help.move")}
      <Kbd>{key("target")}</Kbd> {t("help.target")}
      <Kbd>{key("skill1")}</Kbd> {t("help.strike")}
      <Kbd>{skills}</Kbd> {t("hud.abilities")}
      <Kbd>{key("interact")}</Kbd> {t("help.commune")}
      <Kbd>{key("potion")}</Kbd> {t("help.tonic")}
      <Kbd>{key("release")}</Kbd> {t("help.release")}
      <Kbd>{key("map")}</Kbd> {t("help.map")}
      <Kbd>{key("settings")}</Kbd> {t("help.settings")}
    </div>
  );
}
