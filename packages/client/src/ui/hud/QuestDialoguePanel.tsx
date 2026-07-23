import { useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";
import { TinyPanel } from "../tiny-swords/TinyPanel.js";

export function QuestDialoguePanel() {
  useLocale();
  const dialogue = useUiStore((state) => state.questDialogue);
  const game = useUiStore((state) => state.game);
  const [choices, setChoices] = useState<Record<string, string>>({});
  if (!dialogue) return null;

  const close = () => game?.questAction?.(dialogue.conversationId, "close");
  return (
    <TinyPanel
      className="event-dialogue quest-dialogue"
      role="dialog"
      aria-label={t("quest.dialogue.title")}
    >
      {dialogue.kind === "result" ? (
        <>
          <strong className="event-dialogue__name">{dialogue.title}</strong>
          <p className="quest-dialogue__phase">{t(`quest.dialogue.${dialogue.outcome}`)}</p>
          <p className="event-dialogue__text">
            {dialogue.text ||
              (dialogue.outcome === "failed" ? t("quest.dialogue.failed.hint") : "")}
          </p>
        </>
      ) : (
        <div className="quest-dialogue__list">
          {dialogue.entries.map((entry) => {
            const choiceKey = `${dialogue.conversationId}:${entry.questId}`;
            const selectedChoice = choices[choiceKey];
            return (
              <section className="quest-dialogue__entry" key={entry.questId}>
                <div className="quest-dialogue__heading">
                  <strong className="event-dialogue__name">{entry.title}</strong>
                  <span className={`quest-dialogue__phase quest-dialogue__phase--${entry.phase}`}>
                    {t(`quest.dialogue.phase.${entry.phase}`)}
                  </span>
                </div>
                {entry.text && <p className="event-dialogue__text">{entry.text}</p>}
                {entry.canTurnIn && entry.rewardChoices.length > 0 && (
                  <fieldset className="event-dialogue__choices">
                    <legend className="event-dialogue__legend">
                      {t("quest.dialogue.rewardChoice")}
                    </legend>
                    {entry.rewardChoices.map((choice) => (
                      <TinyButton
                        key={choice.id}
                        size="sm"
                        variant={selectedChoice === choice.id ? "success" : "secondary"}
                        aria-pressed={selectedChoice === choice.id}
                        onClick={() =>
                          setChoices((current) => ({ ...current, [choiceKey]: choice.id }))
                        }
                      >
                        {choice.label}
                      </TinyButton>
                    ))}
                  </fieldset>
                )}
                {(entry.canAccept || entry.canTurnIn) && (
                  <div className="event-dialogue__actions quest-dialogue__actions">
                    {entry.canAccept && (
                      <TinyButton
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          game?.questAction?.(dialogue.conversationId, "refuse", entry.questId)
                        }
                      >
                        {t("quest.dialogue.refuse")}
                      </TinyButton>
                    )}
                    <TinyButton
                      size="sm"
                      disabled={
                        entry.canTurnIn &&
                        entry.rewardChoices.length > 0 &&
                        selectedChoice === undefined
                      }
                      onClick={() =>
                        game?.questAction?.(
                          dialogue.conversationId,
                          entry.canAccept ? "accept" : "turn-in",
                          entry.questId,
                          selectedChoice,
                        )
                      }
                    >
                      {t(entry.canAccept ? "quest.dialogue.accept" : "quest.dialogue.turnIn")}
                    </TinyButton>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <div className="event-dialogue__actions">
        <TinyButton size="sm" variant="secondary" onClick={close}>
          {t("quest.dialogue.close")}
        </TinyButton>
      </div>
    </TinyPanel>
  );
}
