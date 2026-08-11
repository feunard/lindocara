import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";
import { PeasantResourcesPanel } from "./PeasantResourcesPanel.js";
import { QuickItemBar } from "./QuickItemBar.js";
import { SkillBar } from "./SkillBar.js";

export function ActionDock() {
  useLocale();
  const selfState = useUiStore((state) => state.selfState);
  return (
    <aside className="action-dock" aria-label={t("hud.action_dock")}>
      <PeasantResourcesPanel />
      <div className="action-dock__main">
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
        {selfState && (
          <div className="action-dock__experience">
            <strong>{t("hud.spark")}</strong>
            <Bar value={selfState.xp} max={selfState.xpToNext} variant="xp" />
            <span>
              {selfState.xp}/{selfState.xpToNext}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
