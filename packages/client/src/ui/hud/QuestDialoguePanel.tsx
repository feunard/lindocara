import { gamepadBindingLabel } from "@lindocara/renderer/input-settings.js";
import { type ComponentProps, type ReactNode, useCallback, useState } from "react";

import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { controlBindingLabel, useInputModeSettings } from "../input-hints.js";
import { MenuNav, useMenuItem } from "../tiny-swords/menu-nav.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";
import { TinyKbd } from "../tiny-swords/TinyKbd.js";
import { TinyPanel } from "../tiny-swords/TinyPanel.js";

function QuestDialogueItem({
  order,
  onActivate,
  disabled,
  variant,
  pressed,
  children,
}: {
  order: number;
  onActivate: () => void;
  disabled?: boolean;
  variant?: ComponentProps<typeof TinyButton>["variant"];
  pressed?: boolean;
  children: ReactNode;
}) {
  const item = useMenuItem({ order, onActivate, disabled: disabled === true });
  return (
    <TinyButton
      ref={item.ref}
      {...item.itemProps}
      size="sm"
      variant={variant}
      disabled={disabled}
      aria-pressed={pressed}
    >
      {children}
    </TinyButton>
  );
}

export function QuestDialoguePanel() {
  useLocale();
  const dialogue = useUiStore((state) => state.questDialogue);
  const game = useUiStore((state) => state.game);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const { mode, settings } = useInputModeSettings();
  const conversationId = dialogue?.conversationId;
  const close = useCallback(() => {
    if (conversationId) game?.questAction?.(conversationId, "close");
  }, [conversationId, game]);
  if (!dialogue) return null;

  const confirmBinding =
    mode === "gamepad"
      ? gamepadBindingLabel({ kind: "button", index: 0 }, settings.controllerLayout)
      : controlBindingLabel("interact", mode, settings);
  return (
    <MenuNav orientation="vertical" onBack={close}>
      <TinyPanel
        className="event-dialogue quest-dialogue"
        role="dialog"
        aria-label={t("quest.dialogue.title")}
        data-text-surface="dialogue"
      >
        <p className="event-dialogue__confirm-hint">
          <TinyKbd>{confirmBinding}</TinyKbd> {t("dialogue.confirm")}
        </p>
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
                  <p className="quest-dialogue__meta">
                    {[
                      t(`quest.journal.category.${entry.category}`),
                      entry.giverName,
                      entry.region,
                      entry.landmark,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
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
                          variant={selectedChoice === choice.id ? "success" : "secondary"}
                          pressed={selectedChoice === choice.id}
                          onActivate={() =>
                            setChoices((current) => ({ ...current, [choiceKey]: choice.id }))
                          }
                        >
                          {choice.label}
                        </QuestDialogueItem>
                      ))}
                    </fieldset>
                  )}
                  {(entry.canAccept || entry.canTurnIn) && (
                    <div className="event-dialogue__actions quest-dialogue__actions">
                      {entry.canAccept && (
                        <QuestDialogueItem
                          order={entryIndex * 20 + 10}
                          variant="secondary"
                          onActivate={() =>
                            game?.questAction?.(dialogue.conversationId, "refuse", entry.questId)
                          }
                        >
                          {t("quest.dialogue.refuse")}
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
                        {t(entry.canAccept ? "quest.dialogue.accept" : "quest.dialogue.turnIn")}
                      </QuestDialogueItem>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        <div className="event-dialogue__actions">
          <QuestDialogueItem order={999} variant="secondary" onActivate={close}>
            {t("quest.dialogue.close")}
          </QuestDialogueItem>
        </div>
      </TinyPanel>
    </MenuNav>
  );
}
