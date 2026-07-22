import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";

/**
 * The two faces of death. Over your body: a choice — wait for a priest, or let go. As a ghost:
 * a heading, because the only thing left to do is find your way back.
 */
export function DeathOverlay() {
  useLocale();
  const self = useUiStore((state) => state.self);
  const game = useUiStore((state) => state.game);

  if (!self || self.life === "alive") return null;

  if (self.life === "corpse") {
    return (
      <div className="death-overlay" role="status">
        <p className="death-title">{t("death.fallen_title")}</p>
        <p className="death-copy">{t("death.fallen_copy")}</p>
        <button type="button" className="death-release" onClick={() => game?.release()}>
          {t("death.release")}
        </button>
      </div>
    );
  }

  return (
    <div className="death-overlay ghost" role="status">
      <p className="death-title">{t("death.ghost_title")}</p>
      <p className="death-copy">
        {self.corpseDistance === null
          ? t("death.ghost_copy")
          : t("death.ghost_distance", { distance: self.corpseDistance })}
      </p>
    </div>
  );
}
