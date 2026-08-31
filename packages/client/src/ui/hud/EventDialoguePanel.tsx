import { gamepadBindingLabel } from "@lindocara/renderer/input-settings.js";
import { useEffect } from "react";

import { t, useLocale } from "../../i18n.js";
import { type EventDialogue, useUiStore } from "../../store.js";
import { controlBindingLabel, useInputModeSettings } from "../input-hints.js";
import { MenuNav, useMenuItem } from "../tiny-swords/menu-nav.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";
import { TinyKbd } from "../tiny-swords/TinyKbd.js";
import { TinyPanel } from "../tiny-swords/TinyPanel.js";

/** Digit1..Digit4 and Numpad1..Numpad4 -> a zero-based option index, or null for any other key. */
function digitIndex(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-4])$/.exec(code);
  return match?.[1] ? Number(match[1]) - 1 : null;
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function EventDialogueSay({
  dialogue,
  game,
  order,
  confirmBinding,
}: {
  dialogue: Extract<EventDialogue, { kind: "say" }>;
  game: ReturnType<typeof useUiStore.getState>["game"];
  order: number;
  confirmBinding: string;
}) {
  const continueItem = useMenuItem({
    order,
    onActivate: () => game?.eventAdvance?.(dialogue.runId),
  });
  return (
    <>
      {dialogue.name && <strong className="event-dialogue__name">{dialogue.name}</strong>}
      <p className="event-dialogue__text">{dialogue.text}</p>
      <div className="event-dialogue__actions">
        <TinyButton
          ref={continueItem.ref}
          {...continueItem.itemProps}
          size="sm"
          type="button"
          data-dialogue-advance
        >
          {t("dialogue.continue")} <TinyKbd>{confirmBinding}</TinyKbd>
        </TinyButton>
      </div>
    </>
  );
}

function EventDialogueChoices({
  dialogue,
  game,
  order,
  confirmBinding,
}: {
  dialogue: Extract<EventDialogue, { kind: "choices" }>;
  game: ReturnType<typeof useUiStore.getState>["game"];
  order: number;
  confirmBinding: string;
}) {
  return (
    <>
      <p className="event-dialogue__text">{dialogue.prompt}</p>
      <fieldset className="event-dialogue__choices">
        <legend className="event-dialogue__legend">{t("dialogue.choose")}</legend>
        <p className="event-dialogue__confirm-hint">
          <TinyKbd>{confirmBinding}</TinyKbd> {t("dialogue.confirm")}
        </p>
        {dialogue.options.map((label, index) => (
          <EventDialogueChoice
            key={`${dialogue.runId}-${label}`}
            dialogue={dialogue}
            game={game}
            index={index}
            order={order + index}
            label={label}
          />
        ))}
      </fieldset>
    </>
  );
}

function EventDialogueChoice({
  dialogue,
  game,
  index,
  order,
  label,
}: {
  dialogue: Extract<EventDialogue, { kind: "choices" }>;
  game: ReturnType<typeof useUiStore.getState>["game"];
  index: number;
  order: number;
  label: string;
}) {
  const choiceItem = useMenuItem({
    order,
    onActivate: () => game?.eventChoose?.(dialogue.runId, index),
  });
  return (
    <TinyButton
      ref={choiceItem.ref}
      {...choiceItem.itemProps}
      size="sm"
      variant="secondary"
      type="button"
      className="event-dialogue__choice"
      data-dialogue-choice={index}
    >
      <TinyKbd>{String(index + 1)}</TinyKbd> {label}
    </TinyButton>
  );
}

export function EventDialoguePanel() {
  useLocale();
  const dialogue = useUiStore((s) => s.eventDialogue);
  const game = useUiStore((s) => s.game);
  const { mode, settings } = useInputModeSettings();
  const confirmBinding =
    mode === "gamepad"
      ? gamepadBindingLabel({ kind: "button", index: 0 }, settings.controllerLayout)
      : controlBindingLabel("interact", mode, settings);

  useEffect(() => {
    if (!dialogue) return;
    const chooseOption = (index: number) => {
      if (dialogue.kind !== "choices" || index < 0 || index >= dialogue.options.length) return;
      game?.eventChoose?.(dialogue.runId, index);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTextEntry(event.target)) return;
      const index = digitIndex(event.code);
      if (index === null) return;
      if (dialogue.kind === "choices") {
        event.preventDefault();
      }
      chooseOption(index);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [dialogue, game]);

  if (!dialogue) return null;

  return (
    <TinyPanel
      className="event-dialogue"
      role="dialog"
      aria-label={t("dialogue.title")}
      data-text-surface="dialogue"
      data-dialogue-kind={dialogue.kind}
    >
      <MenuNav orientation="vertical">
        {dialogue.kind === "say" ? (
          <EventDialogueSay
            dialogue={dialogue}
            game={game}
            order={0}
            confirmBinding={confirmBinding}
          />
        ) : (
          <EventDialogueChoices
            dialogue={dialogue}
            game={game}
            order={0}
            confirmBinding={confirmBinding}
          />
        )}
      </MenuNav>
    </TinyPanel>
  );
}
