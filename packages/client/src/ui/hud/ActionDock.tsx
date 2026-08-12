import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";
import { HudLayoutWidget } from "./HudLayoutWidget.js";
import { PeasantResourcesPanel } from "./PeasantResourcesPanel.js";
import { QuickItemBar } from "./QuickItemBar.js";
import { SkillBar } from "./SkillBar.js";

export function ActionDock() {
  useLocale();
  const selfState = useUiStore((state) => state.selfState);
  return (
    <>
      <aside className="peasant-resources-dock" aria-label={t("hud.action_dock")}>
        <PeasantResourcesPanel />
      </aside>
      <HudLayoutWidget id="quick-items">
        <div className="action-dock__group action-dock__group--items">
          <strong className="action-dock__title">{t("inventory.quickbar")}</strong>
          <QuickItemBar />
        </div>
      </HudLayoutWidget>
      <SkillBar />
      {selfState && (
        <HudLayoutWidget id="xp">
          <div className="action-dock__experience">
            <strong>{t("hud.spark")}</strong>
            <Bar
              value={selfState.xp}
              max={selfState.xpToNext}
              variant="xp"
              label={`${selfState.xp}/${selfState.xpToNext}`}
            />
          </div>
        </HudLayoutWidget>
      )}
    </>
  );
}
