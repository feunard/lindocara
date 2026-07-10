import { Kbd } from "@/ui/pixelact-ui/kbd.js";
import { t, useLocale } from "../i18n.js";

export function HelpBar() {
  useLocale();

  return (
    <div id="help">
      <Kbd>WASD</Kbd> {t("help.move")}
      <Kbd>Space</Kbd> {t("help.strike")}
      <Kbd>E</Kbd> {t("help.commune")}
      <Kbd>Q</Kbd> {t("help.tonic")}
    </div>
  );
}
