import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";

/**
 * The two faces of death. Over your body: a choice — wait for a priest, or let go. As a ghost:
 * a heading, because the only thing left to do is find your way back.
 */
export function DeathOverlay() {
  useLocale();
  const self = useUiStore((state) => state.self);
  const game = useUiStore((state) => state.game);
  const hardcore = useUiStore((state) => state.gameMode === "hardcore_runner");

  if (!self || self.life === "alive") return null;

  if (self.life === "corpse") {
    return (
      <div className="death-overlay" role="status">
        <p className="death-title">
          {t(hardcore ? "hardcore.game_over.title" : "death.fallen_title")}
        </p>
        <p className="death-copy">
          {t(hardcore ? "hardcore.game_over.copy" : "death.fallen_copy")}
        </p>
        <TinyButton type="button" className="death-release" onClick={() => game?.release()}>
          {t(hardcore ? "hardcore.retry" : "death.release")}
        </TinyButton>
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
