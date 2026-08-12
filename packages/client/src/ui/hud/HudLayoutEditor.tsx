import { useEffect } from "react";
import { t, useLocale } from "../../i18n.js";
import {
  cancelHudLayoutEdit,
  resetHudLayoutDraft,
  saveHudLayoutEdit,
} from "../../state/hud-layout.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";
import { TinyPanel } from "../tiny-swords/TinyPanel.js";
import { useHudLayout } from "./useHudLayout.js";

export function HudLayoutEditor() {
  useLocale();
  const { editing } = useHudLayout();

  useEffect(() => {
    if (!editing) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.code !== "Escape") return;
      event.preventDefault();
      cancelHudLayoutEdit();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [editing]);

  if (!editing) return null;

  return (
    <TinyPanel className="hud-layout-editor" role="dialog" aria-label={t("hud.layout.title")}>
      <div className="hud-layout-editor__copy">
        <strong>{t("hud.layout.title")}</strong>
        <span>{t("hud.layout.instructions")}</span>
      </div>
      <div className="hud-layout-editor__actions">
        <TinyButton type="button" size="sm" onClick={resetHudLayoutDraft}>
          {t("hud.layout.reset")}
        </TinyButton>
        <TinyButton type="button" size="sm" onClick={cancelHudLayoutEdit}>
          {t("hud.layout.cancel")}
        </TinyButton>
        <TinyButton type="button" size="sm" onClick={saveHudLayoutEdit}>
          {t("hud.layout.save")}
        </TinyButton>
      </div>
    </TinyPanel>
  );
}
