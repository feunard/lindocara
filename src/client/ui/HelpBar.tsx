import { Kbd } from "@/ui/pixelact-ui/kbd.js";
import { t, useLocale } from "../i18n.js";

export function HelpBar() {
  useLocale();
  return (
    <div id="help">
      <Kbd>WASD</Kbd> {t("help.move")}
      <Kbd>Tab</Kbd> {t("help.target")}
      <Kbd>Space</Kbd> {t("help.strike")}
      <Kbd>1–5</Kbd> {t("hud.abilities")}
      <Kbd>E</Kbd> {t("help.commune")}
      <Kbd>Q</Kbd> {t("help.tonic")}
      <Kbd>R</Kbd> {t("help.release")}
      <Kbd>M</Kbd> {t("help.map")}
      <Kbd>Esc</Kbd> {t("help.settings")}
    </div>
  );
}
