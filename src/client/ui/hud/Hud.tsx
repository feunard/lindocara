import { useEffect, useRef, useState } from "react";
import type { QuestState } from "../../../shared/protocol.js";
import { logout } from "../../api.js";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";
import { CooldownBar } from "./CooldownBar.js";
import { HealCooldownBar } from "./HealCooldownBar.js";
import { InventoryChip } from "./InventoryChip.js";

/** Same status -> copy mapping as the legacy `renderState`. */
function questText(quest: QuestState): string {
  switch (quest.status) {
    case "available":
      return t("quest.available");
    case "active":
      return t("quest.active", { progress: quest.progress, target: quest.target });
    case "ready":
      return t("quest.ready");
    default:
      return t("quest.completed");
  }
}

export function Hud() {
  useLocale();
  const self = useUiStore((s) => s.self);
  const selfState = useUiStore((s) => s.selfState);
  const game = useUiStore((s) => s.game);

  // Legacy juice (styles/legacy.css: .pulse / @keyframes panel-pulse) removed and re-added
  // the class on every state update, forcing a reflow in between so the animation could
  // restart. React can't do that dance, but remounting the panel via `key` has the same
  // effect: a fresh DOM node always (re)starts a CSS animation already on its className.
  // Only bump the key once the quest has actually changed, so the panel doesn't pulse on
  // its very first render.
  const questSnapshot = selfState?.quest ?? null;
  const [questPulseKey, setQuestPulseKey] = useState(0);
  const prevQuestRef = useRef(questSnapshot);
  useEffect(() => {
    const prev = prevQuestRef.current;
    prevQuestRef.current = questSnapshot;
    if (
      prev &&
      questSnapshot &&
      (prev.status !== questSnapshot.status ||
        prev.progress !== questSnapshot.progress ||
        prev.target !== questSnapshot.target)
    ) {
      setQuestPulseKey((key) => key + 1);
    }
  }, [questSnapshot]);

  if (self === null || selfState === null) return null;

  const { potions, gold, crystals, weapon } = selfState.inventory;
  const { quest } = selfState;
  const showQuestBar = quest.status === "active" || quest.status === "ready";

  // `game` goes null on any disconnect (kicked, character deleted, network drop). These
  // buttons must stay usable even then, so each falls back to the same escape hatch the
  // logged-out screens use instead of going dead.
  const handleSwitchCharacter = () => {
    if (game) game.switchCharacter();
    else window.location.reload();
  };
  const handleLogout = () => {
    if (game) game.logout();
    else void logout();
  };

  return (
    <aside id="hud">
      <section className="panel identity">
        <div className="crest" aria-hidden="true" />
        <div className="identity-copy">
          <strong>{self.nick}</strong>
          <span>{t("hud.level", { level: self.level })}</span>
          <span>{t(`class.${self.class}`)}</span>
        </div>
        <div className="session-actions">
          <button type="button" onClick={handleSwitchCharacter}>
            {t("hud.switch_character")}
          </button>
          <button type="button" onClick={handleLogout}>
            {t("hud.logout")}
          </button>
        </div>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: reuses the legacy `.identity label`
            grid layout (styles/legacy.css); the row labels a read-only <Bar> progressbar, not a
            form control, so there is nothing to htmlFor. */}
        <label>
          <span>{t("hud.vit")}</span>
          <Bar value={self.hp} max={self.maxHp} variant="hp" />
          <span>
            {self.hp}/{self.maxHp}
          </span>
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: see above. */}
        <label>
          <span>{t("hud.spark")}</span>
          <Bar value={selfState.xp} max={selfState.xpToNext} variant="xp" />
          <span>
            {selfState.xp}/{selfState.xpToNext}
          </span>
        </label>
      </section>

      <section
        key={questPulseKey}
        className={questPulseKey > 0 ? "panel quest pulse" : "panel quest"}
      >
        <div className="panel-title">
          <span className="panel-icon panel-icon--oath" aria-hidden="true" />
          <strong>{t("hud.oath")}</strong>
        </div>
        <span>{questText(quest)}</span>
        {showQuestBar && (
          // "ready" shows a full bar, same as legacy renderState (value = target, not progress).
          <Bar
            value={quest.status === "ready" ? quest.target : quest.progress}
            max={quest.target}
            variant="quest"
          />
        )}
      </section>

      <CooldownBar />
      {self.class === "priest" && <HealCooldownBar />}

      <section className="panel inventory">
        <div className="panel-title">
          <span className="panel-icon panel-icon--pack" aria-hidden="true" />
          <strong>{t("hud.pack")}</strong>
        </div>
        <div className="item-grid">
          <InventoryChip
            icon="potion"
            label={t("item.potion")}
            value={String(potions)}
            hotkey="Q"
          />
          <InventoryChip icon="gold" label={t("item.gold")} value={String(gold)} />
          <InventoryChip icon="crystal" label={t("item.crystal")} value={String(crystals)} />
          <InventoryChip
            icon="sword"
            label={t("item.sword")}
            value={weapon === "rusty_sword" ? t("item.sword_on") : "?"}
          />
        </div>
      </section>
    </aside>
  );
}
