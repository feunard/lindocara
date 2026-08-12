import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { QuestState } from "@lindocara/engine/protocol.js";
import { playerPortrait } from "@lindocara/renderer/portrait-art.js";
import { useStore } from "alepha/react";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { questObjectiveProgressText } from "../../quest-presentation.js";
import { activePartyAtom, questTrackingAtom } from "../../state/atoms.js";
import { useUiStore } from "../../store.js";
import { ActionDock } from "./ActionDock.js";
import { Bar } from "./Bar.js";
import { CampBankPanel } from "./CampBankPanel.js";
import { DeathOverlay } from "./DeathOverlay.js";
import { HealCooldownBar } from "./HealCooldownBar.js";
import { HudLayoutWidget } from "./HudLayoutWidget.js";
import { UnitPortrait } from "./UnitPortrait.js";

/** Same status -> copy mapping as the legacy `renderState`. */
function questText(quest: QuestState): string {
  const chapter = quest.chapter ?? "three_offerings";
  switch (quest.status) {
    case "available":
      return t("quest.available");
    case "active":
      return t(`quest.${chapter}.active` as MessageKey, {
        progress: quest.progress,
        target: quest.target,
      });
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
  const [activeParty] = useStore(activePartyAtom);
  const [questTracking] = useStore(questTrackingAtom);
  const setQuestJournalOpen = useUiStore((s) => s.setQuestJournalOpen);

  // Legacy juice (styles/legacy.css: .pulse / @keyframes panel-pulse) removed and re-added
  // the class on every state update, forcing a reflow in between so the animation could
  // restart. React can't do that dance, but remounting the panel via `key` has the same
  // effect: a fresh DOM node always (re)starts a CSS animation already on its className.
  // Only bump the key once the quest has actually changed, so the panel doesn't pulse on
  // its very first render.
  // The compiled catalogue quest is rollback content. Primary authored adventures always carry an
  // `activeParty`; showing the compiled oath beside their own journal creates a quest the creator
  // never authored and the room cannot progress.
  const questSnapshot = activeParty ? null : (selfState?.quest ?? null);
  const [questPulseKey, setQuestPulseKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
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

  useEffect(() => {
    if (!questSnapshot?.timerEndsAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [questSnapshot?.timerEndsAt]);

  if (self === null || selfState === null) return null;

  const { quest } = selfState;
  const authoredQuests = selfState.authoredQuests ?? [];
  const trackableAuthoredQuests = authoredQuests
    .filter(
      (authored) =>
        (authored.status === "active" || authored.status === "ready") &&
        (questTracking[authored.id] ?? true),
    )
    .sort((left, right) => Number(right.status === "ready") - Number(left.status === "ready"));
  const trackedAuthoredQuests = [
    ...trackableAuthoredQuests.filter((quest) => quest.category === "main").slice(0, 1),
    ...trackableAuthoredQuests.filter((quest) => quest.category === "side").slice(0, 2),
  ];
  const questChapter = quest.chapter ?? "three_offerings";
  const showQuestBar = quest.status === "active" || quest.status === "ready";
  const remainingSeconds =
    quest.timerEndsAt === undefined ? 0 : Math.max(0, Math.ceil((quest.timerEndsAt - now) / 1_000));

  return (
    <>
      <DeathOverlay />
      <CampBankPanel />
      <aside id="hud">
        <HudLayoutWidget id="hero">
          <section className="panel identity">
            <UnitPortrait portrait={playerPortrait(self.class, self.appearance)} />
            <div className="identity-copy">
              <strong>{self.nick}</strong>
              <span>{t("hud.level", { level: self.level })}</span>
              <span>{t(`class.${self.class}`)}</span>
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
            {selfState.resource && (
              // biome-ignore lint/a11y/noLabelWithoutControl: read-only progress row, matching the rows above/below.
              <label>
                <span>{t(`resource.${selfState.resource.kind}` as MessageKey)}</span>
                <Bar
                  value={selfState.resource.current}
                  max={selfState.resource.max}
                  variant="mana"
                />
                <span>
                  {Math.floor(selfState.resource.current)}/{selfState.resource.max}
                </span>
              </label>
            )}
            {self.breath && (
              // biome-ignore lint/a11y/noLabelWithoutControl: read-only progress row, matching HP.
              <label>
                <span>{t("hud.breath")}</span>
                <Bar value={self.breath.current} max={self.breath.max} variant="mana" />
                <span>
                  {self.breath.current}/{self.breath.max}
                </span>
              </label>
            )}
          </section>
        </HudLayoutWidget>

        <div className="hud-quest-stack">
          {!activeParty && (
            <section
              key={questPulseKey}
              className={questPulseKey > 0 ? "panel quest pulse" : "panel quest"}
            >
              <div className="panel-title">
                <span className="panel-icon panel-icon--oath" aria-hidden="true" />
                <strong>{t(`quest.${questChapter}.name` as MessageKey)}</strong>
              </div>
              <span>{questText(quest)}</span>
              {showQuestBar && (
                <Bar
                  value={quest.status === "ready" ? quest.target : quest.progress}
                  max={quest.target}
                  variant="quest"
                />
              )}
              {quest.timerEndsAt !== undefined && (
                <strong className="quest-timer" aria-live="polite">
                  {t("quest.timer", { seconds: remainingSeconds })}
                </strong>
              )}
            </section>
          )}

          {authoredQuests.length > 0 && (
            <button
              type="button"
              className="panel quest-journal-launch"
              onClick={() => setQuestJournalOpen(true)}
            >
              <span className="panel-icon panel-icon--oath" aria-hidden="true" />
              <strong>{t("quest.journal.open")}</strong>
              <span className="quest-journal-launch__hint">{t("quest.journal.openHint")}</span>
            </button>
          )}

          {trackedAuthoredQuests.map((authored) => (
            <section
              key={`${authored.id}:${authored.status}:${authored.objectives
                .map((objective) => objective.progress)
                .join("-")}`}
              className="panel quest pulse"
            >
              <div className="panel-title">
                <span className="panel-icon panel-icon--oath" aria-hidden="true" />
                <strong>{authored.title}</strong>
              </div>
              {(authored.journalSummary || authored.description) && (
                <span>{authored.journalSummary || authored.description}</span>
              )}
              {authored.objectives.map((objective) => (
                <div key={objective.id} className="flex flex-col gap-1">
                  <span>{questObjectiveProgressText(objective)}</span>
                  <Bar value={objective.progress} max={objective.target} variant="quest" />
                </div>
              ))}
              {authored.status === "ready" && <strong>{t("quest.ready")}</strong>}
            </section>
          ))}

          {self.class === "priest" && <HealCooldownBar />}
        </div>
      </aside>
      <ActionDock />
    </>
  );
}
