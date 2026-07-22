import { useEffect, useRef } from "react";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function VictoryOverlay() {
  useLocale();
  const visible = useUiStore((state) => state.adventureVictory);
  const setVisible = useUiStore((state) => state.setAdventureVictory);
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (visible) continueRef.current?.focus();
  }, [visible]);
  if (!visible) return null;
  return (
    <section
      className="victory-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="victory-title"
    >
      <div className="victory-overlay__panel">
        <h2 id="victory-title">{t("adventure.victory.title")}</h2>
        <p>{t("adventure.victory.copy")}</p>
        <button ref={continueRef} type="button" onClick={() => setVisible(false)}>
          {t("adventure.victory.continue")}
        </button>
      </div>
    </section>
  );
}
