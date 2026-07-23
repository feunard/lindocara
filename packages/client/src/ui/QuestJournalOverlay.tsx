import type { AuthoredQuestTracker } from "@lindocara/engine/adventure-state.js";
import { useEffect, useState } from "react";
import { t, useLocale } from "../i18n.js";
import {
  questItemName,
  questObjectiveProgressText,
  questScopeLabel,
  questStatusLabel,
} from "../quest-presentation.js";
import { useUiStore } from "../store.js";
import { Bar } from "./hud/Bar.js";
import { TinyButton } from "./tiny-swords/TinyButton.js";

type JournalFilter = "active" | "ready" | "history";
const EMPTY_QUESTS: readonly AuthoredQuestTracker[] = [];

function belongsToFilter(quest: AuthoredQuestTracker, filter: JournalFilter): boolean {
  if (filter === "active") return quest.status === "active";
  if (filter === "ready") return quest.status === "ready";
  return quest.status === "completed" || quest.status === "failed" || quest.status === "abandoned";
}

function rewardItemCopy(item: { itemId: string; quantity: number }): string {
  return t("quest.journal.reward.item", {
    quantity: item.quantity,
    item: questItemName(item.itemId),
  });
}

function QuestRewards({ quest }: { quest: AuthoredQuestTracker }) {
  const rewards = quest.rewards;
  const hasBaseReward = rewards.experience > 0 || rewards.gold > 0 || rewards.items.length > 0;
  if (!hasBaseReward && rewards.choices.length === 0) {
    return <p className="quest-journal__muted">{t("quest.journal.rewards.none")}</p>;
  }
  return (
    <div className="quest-journal__rewards">
      {rewards.experience > 0 && (
        <span>{t("quest.journal.reward.xp", { amount: rewards.experience })}</span>
      )}
      {rewards.gold > 0 && <span>{t("quest.journal.reward.gold", { amount: rewards.gold })}</span>}
      {rewards.items.map((item) => (
        <span key={item.itemId}>{rewardItemCopy(item)}</span>
      ))}
      {rewards.choices.length > 0 && (
        <div className="quest-journal__choices">
          <strong>{t("quest.journal.reward.choose")}</strong>
          {rewards.choices.map((choice) => (
            <article key={choice.id}>
              <b>{choice.label}</b>
              <span>
                {[
                  choice.experience > 0
                    ? t("quest.journal.reward.xp", { amount: choice.experience })
                    : "",
                  choice.gold > 0 ? t("quest.journal.reward.gold", { amount: choice.gold }) : "",
                  ...choice.items.map(rewardItemCopy),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuestJournalOverlay() {
  useLocale();
  const open = useUiStore((state) => state.questJournalOpen);
  const setOpen = useUiStore((state) => state.setQuestJournalOpen);
  const quests = useUiStore((state) => state.selfState?.authoredQuests ?? EMPTY_QUESTS);
  const tracking = useUiStore((state) => state.questTracking);
  const setTracked = useUiStore((state) => state.setQuestTracked);
  const game = useUiStore((state) => state.game);
  const [filter, setFilter] = useState<JournalFilter>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;
  const visible = quests.filter((quest) => belongsToFilter(quest, filter));
  const selected =
    visible.find((quest) => quest.id === selectedId) ??
    visible.find((quest) => quest.status === "ready") ??
    visible[0];
  const tracked = selected ? (tracking[selected.id] ?? true) : false;

  const chooseFilter = (next: JournalFilter) => {
    setFilter(next);
    setSelectedId(null);
    setConfirmAbandon(null);
  };

  return (
    <section
      id="quest-journal"
      className="quest-journal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quest-journal-title"
    >
      <div className="quest-journal__panel panel">
        <header className="quest-journal__header">
          <div>
            <span className="quest-journal__eyebrow">{t("quest.journal.eyebrow")}</span>
            <h2 id="quest-journal-title">{t("quest.journal.title")}</h2>
          </div>
          <TinyButton size="sm" variant="secondary" onClick={() => setOpen(false)}>
            {t("common.close")}
          </TinyButton>
        </header>

        <nav className="quest-journal__filters" aria-label={t("quest.journal.filters")}>
          {(["active", "ready", "history"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={`quest-journal__filter${filter === value ? " quest-journal__filter--active" : ""}`}
              aria-pressed={filter === value}
              onClick={() => chooseFilter(value)}
            >
              {t(`quest.journal.filter.${value}`)}
              <span>{quests.filter((quest) => belongsToFilter(quest, value)).length}</span>
            </button>
          ))}
        </nav>

        <div className="quest-journal__body">
          <aside className="quest-journal__list" aria-label={t("quest.journal.list")}>
            {visible.length === 0 ? (
              <p className="quest-journal__empty">{t("quest.journal.empty")}</p>
            ) : (
              visible.map((quest) => (
                <button
                  type="button"
                  key={quest.id}
                  className={`quest-journal__entry${selected?.id === quest.id ? " quest-journal__entry--selected" : ""}`}
                  aria-current={selected?.id === quest.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(quest.id);
                    setConfirmAbandon(null);
                  }}
                >
                  <strong>{quest.title}</strong>
                  <span>{questStatusLabel(quest.status)}</span>
                </button>
              ))
            )}
          </aside>

          <main className="quest-journal__details">
            {selected ? (
              <>
                <header>
                  <div>
                    <span
                      className={`quest-journal__status quest-journal__status--${selected.status}`}
                    >
                      {questStatusLabel(selected.status)}
                    </span>
                    <h3>{selected.title}</h3>
                  </div>
                  {(selected.status === "active" || selected.status === "ready") && (
                    <TinyButton
                      size="sm"
                      variant={tracked ? "secondary" : "default"}
                      aria-pressed={tracked}
                      onClick={() => setTracked(selected.id, !tracked)}
                    >
                      {t(tracked ? "quest.journal.untrack" : "quest.journal.track")}
                    </TinyButton>
                  )}
                </header>

                <p className="quest-journal__summary">
                  {selected.journalSummary ||
                    selected.description ||
                    t("quest.journal.noDescription")}
                </p>
                {selected.description && selected.description !== selected.journalSummary && (
                  <p className="quest-journal__description">{selected.description}</p>
                )}
                <div className="quest-journal__meta">
                  <span>{questScopeLabel(selected.scope)}</span>
                  {selected.recommendedLevel !== null && (
                    <span>{t("quest.journal.level", { level: selected.recommendedLevel })}</span>
                  )}
                  {selected.repeatable && <span>{t("quest.journal.repeatable")}</span>}
                  <span>
                    {t(
                      selected.completion === "automatic"
                        ? "quest.journal.automatic"
                        : "quest.journal.turnIn",
                    )}
                  </span>
                </div>

                <section className="quest-journal__section">
                  <h4>{t("quest.journal.objectives")}</h4>
                  <div className="quest-journal__objectives">
                    {selected.objectives.map((objective) => (
                      <article
                        key={objective.id}
                        className={objective.progress >= objective.target ? "complete" : ""}
                      >
                        {selected.objectiveMode === "sequential" && (
                          <small>
                            {t("quest.journal.stage", { stage: objective.rule.stage + 1 })}
                          </small>
                        )}
                        <span>{questObjectiveProgressText(objective)}</span>
                        <Bar value={objective.progress} max={objective.target} variant="quest" />
                      </article>
                    ))}
                  </div>
                </section>

                <section className="quest-journal__section">
                  <h4>{t("quest.journal.rewards")}</h4>
                  <QuestRewards quest={selected} />
                </section>

                {selected.abandonable &&
                  (selected.status === "active" || selected.status === "ready") && (
                    <footer className="quest-journal__abandon">
                      {confirmAbandon === selected.id ? (
                        <>
                          <p>
                            {t(
                              selected.scope === "party"
                                ? "quest.journal.abandonPartyWarning"
                                : "quest.journal.abandonWarning",
                            )}
                          </p>
                          <TinyButton
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              game?.abandonQuest?.(selected.id);
                              setConfirmAbandon(null);
                            }}
                          >
                            {t("quest.journal.abandonConfirm")}
                          </TinyButton>
                          <TinyButton
                            size="sm"
                            variant="secondary"
                            onClick={() => setConfirmAbandon(null)}
                          >
                            {t("common.cancel")}
                          </TinyButton>
                        </>
                      ) : (
                        <TinyButton
                          size="sm"
                          variant="warning"
                          onClick={() => setConfirmAbandon(selected.id)}
                        >
                          {t("quest.journal.abandon")}
                        </TinyButton>
                      )}
                    </footer>
                  )}
              </>
            ) : (
              <p className="quest-journal__empty">{t("quest.journal.select")}</p>
            )}
          </main>
        </div>
      </div>
    </section>
  );
}
