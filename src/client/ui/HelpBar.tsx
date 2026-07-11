import { Kbd } from "@/ui/pixelact-ui/kbd.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function HelpBar() {
  useLocale();
  const isPriest = useUiStore((s) => s.self?.class === "priest");

  return (
    <div id="help">
      <Kbd>WASD</Kbd> {t("help.move")}
      <Kbd>Space</Kbd> {t("help.strike")}
      <Kbd>E</Kbd> {t("help.commune")}
      <Kbd>Q</Kbd> {t("help.tonic")}
      {isPriest && (
        <>
          <Kbd>F</Kbd> {t("hud.heal")}
        </>
      )}
    </div>
  );
}
