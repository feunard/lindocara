import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { QuestState } from "@lindocara/engine/protocol.js";
import { playerPortrait } from "@lindocara/renderer/portrait-art.js";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { questObjectiveProgressText } from "../../quest-presentation.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";
import { CooldownBar } from "./CooldownBar.js";
import { DeathOverlay } from "./DeathOverlay.js";
import { HealCooldownBar } from "./HealCooldownBar.js";
import { InventoryChip } from "./InventoryChip.js";
import { QuickItemBar } from "./QuickItemBar.js";
import { SkillBar } from "./SkillBar.js";
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
  const game = useUiStore((s) => s.game);
  const party = useUiStore((s) => s.party);
  const partyInvite = useUiStore((s) => s.partyInvite);
  const activeParty = useUiStore((s) => s.activeParty);
  const adventureTestSession = useUiStore((s) => s.adventureTestSession);
  const questTracking = useUiStore((s) => s.questTracking);
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

  const { potions, gold, crystals } = selfState.inventory;
  const { quest } = selfState;
  const authoredQuests = selfState.authoredQuests ?? [];
  const trackedAuthoredQuests = authoredQuests
    .filter(
      (authored) =>
        (authored.status === "active" || authored.status === "ready") &&
        (questTracking[authored.id] ?? true),
    )
    .sort((left, right) => Number(right.status === "ready") - Number(left.status === "ready"))
    .slice(0, 3);
  const questChapter = quest.chapter ?? "three_offerings";
  const showQuestBar = quest.status === "active" || quest.status === "ready";
  const remainingSeconds =
    quest.timerEndsAt === undefined ? 0 : Math.max(0, Math.ceil((quest.timerEndsAt - now) / 1_000));

  return (
    <>
      <DeathOverlay />
      <aside id="hud">
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
              <Bar value={selfState.resource.current} max={selfState.resource.max} variant="mana" />
              <span>
                {Math.floor(selfState.resource.current)}/{selfState.resource.max}
              </span>
            </label>
          )}
          {/* biome-ignore lint/a11y/noLabelWithoutControl: see above. */}
          <label>
            <span>{t("hud.spark")}</span>
            <Bar value={selfState.xp} max={selfState.xpToNext} variant="xp" />
            <span>
              {selfState.xp}/{selfState.xpToNext}
            </span>
          </label>
        </section>

        <section className="panel party">
          <div className="panel-title">
            <strong>{t("party.title")}</strong>
          </div>
          {activeParty ? (
            <div className="party-save">
              <strong>{activeParty.name ?? activeParty.adventureTitle}</strong>
              <span>
                {adventureTestSession
                  ? t("party.test_session")
                  : t("party.saved_session", {
                      status:
                        activeParty.status === "completed"
                          ? t("parties.completed")
                          : t("party.in_progress"),
                    })}
              </span>
            </div>
          ) : party ? (
            party.members.map((member) => (
              <div key={member.id}>
                <span>
                  {member.nick}
                  {member.id === party.leaderId ? " ★" : ""}
                </span>
                <Bar value={member.hp} max={member.maxHp} variant="hp" />
              </div>
            ))
          ) : (
            <button type="button" onClick={() => game?.partyCreate?.()}>
              {t("party.create")}
            </button>
          )}
          {!activeParty && party && (
            <button
              type="button"
              onClick={() =>
                party.leaderId === self.id ? game?.partyDissolve?.() : game?.partyLeave?.()
              }
            >
              {party.leaderId === self.id ? t("party.dissolve") : t("party.leave")}
            </button>
          )}
          {!activeParty && partyInvite && (
            <div>
              <span>{t("party.invite_received", { name: partyInvite.from })}</span>
              <button type="button" onClick={() => game?.partyAccept?.(partyInvite.inviteId)}>
                {t("party.accept")}
              </button>
              <button type="button" onClick={() => game?.partyRefuse?.(partyInvite.inviteId)}>
                {t("party.refuse")}
              </button>
            </div>
          )}
        </section>

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
              label={t(`item.${self.equipment.mainHand}`)}
              value={t("item.sword_on")}
            />
          </div>
        </section>
      </aside>
      <SkillBar />
      <QuickItemBar />
    </>
  );
}
