import { t, useLocale } from "../../i18n.js";
import { PeasantResourcesPanel } from "./PeasantResourcesPanel.js";
import { QuickItemBar } from "./QuickItemBar.js";
import { SkillBar } from "./SkillBar.js";

export function ActionDock() {
  useLocale();
  return (
    <aside className="action-dock" aria-label={t("hud.action_dock")}>
      <PeasantResourcesPanel />
      <div className="action-dock__controls">
        <div className="action-dock__group action-dock__group--items">
          <strong className="action-dock__title">{t("inventory.quickbar")}</strong>
          <QuickItemBar />
        </div>
        <div className="action-dock__group action-dock__group--skills">
          <strong className="action-dock__title">{t("hud.abilities")}</strong>
          <SkillBar />
        </div>
      </div>
    </aside>
  );
}
