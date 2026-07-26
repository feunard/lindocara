import { type ReactNode, useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { MenuNav, useMenuItem } from "../tiny-swords/menu-nav.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";
import { TinyPanel } from "../tiny-swords/TinyPanel.js";

function QuestDialogueItem({
  order,
  onActivate,
  disabled,
  children,
}: {
  order: number;
  onActivate: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const item = useMenuItem({ order, onActivate, disabled: disabled === true });
  return (
    <span ref={item.ref} {...item.itemProps} style={{ display: "contents" }}>
      {children}
    </span>
  );
}

export function QuestDialoguePanel() {
  useLocale();
  const dialogue = useUiStore((state) => state.questDialogue);
  const game = useUiStore((state) => state.game);
  const [choices, setChoices] = useState<Record<string, string>>({});
  if (!dialogue) return null;

  const close = () => game?.questAction?.(dialogue.conversationId, "close");
  return (
    <MenuNav orientation="vertical" confirmControl="interact" onBack={close}>
      <TinyPanel
        className="event-dialogue quest-dialogue"
        role="dialog"
        aria-label={t("quest.dialogue.title")}
      >
        {dialogue.kind === "result" ? (
          <>
            <div className="quest-dialogue__heading">
              <div className="quest-dialogue__identity">
                <strong className="event-dialogue__name">{dialogue.speakerName}</strong>
                <span className="quest-dialogue__quest-title">{dialogue.title}</span>
              </div>
              <p className="quest-dialogue__phase">{t(`quest.dialogue.${dialogue.outcome}`)}</p>
            </div>
            <p className="event-dialogue__text">
              {dialogue.text ||
                (dialogue.outcome === "failed" ? t("quest.dialogue.failed.hint") : "")}
            </p>
          </>
        ) : (
          <div className="quest-dialogue__list">
            {dialogue.entries.map((entry, entryIndex) => {
              const choiceKey = `${dialogue.conversationId}:${entry.questId}`;
              const selectedChoice = choices[choiceKey];
              return (
                <section className="quest-dialogue__entry" key={entry.questId}>
                  <div className="quest-dialogue__heading">
                    <div className="quest-dialogue__identity">
                      <strong className="event-dialogue__name">{entry.speakerName}</strong>
                      <span className="quest-dialogue__quest-title">{entry.title}</span>
                    </div>
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
                      {entry.rewardChoices.map((choice, choiceIndex) => (
                        <QuestDialogueItem
                          key={choice.id}
                          order={entryIndex * 20 + choiceIndex}
                          onActivate={() =>
                            setChoices((current) => ({ ...current, [choiceKey]: choice.id }))
                          }
                        >
                          <TinyButton
                            size="sm"
                            variant={selectedChoice === choice.id ? "success" : "secondary"}
                            aria-pressed={selectedChoice === choice.id}
                          >
                            {choice.label}
                          </TinyButton>
                        </QuestDialogueItem>
                      ))}
                    </fieldset>
                  )}
                  {(entry.canAccept || entry.canTurnIn) && (
                    <div className="event-dialogue__actions quest-dialogue__actions">
                      {entry.canAccept && (
                        <QuestDialogueItem
                          order={entryIndex * 20 + 10}
                          onActivate={() =>
                            game?.questAction?.(dialogue.conversationId, "refuse", entry.questId)
                          }
                        >
                          <TinyButton size="sm" variant="secondary">
                            {t("quest.dialogue.refuse")}
                          </TinyButton>
                        </QuestDialogueItem>
                      )}
                      <QuestDialogueItem
                        order={entryIndex * 20 + 11}
                        disabled={
                          entry.canTurnIn &&
                          entry.rewardChoices.length > 0 &&
                          selectedChoice === undefined
                        }
                        onActivate={() =>
                          game?.questAction?.(
                            dialogue.conversationId,
                            entry.canAccept ? "accept" : "turn-in",
                            entry.questId,
                            selectedChoice,
                          )
                        }
                      >
                        <TinyButton
                          size="sm"
                          disabled={
                            entry.canTurnIn &&
                            entry.rewardChoices.length > 0 &&
                            selectedChoice === undefined
                          }
                        >
                          {t(entry.canAccept ? "quest.dialogue.accept" : "quest.dialogue.turnIn")}
                        </TinyButton>
                      </QuestDialogueItem>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        <div className="event-dialogue__actions">
          <QuestDialogueItem order={999} onActivate={close}>
            <TinyButton size="sm" variant="secondary">
              {t("quest.dialogue.close")}
            </TinyButton>
          </QuestDialogueItem>
        </div>
      </TinyPanel>
    </MenuNav>
  );
}
