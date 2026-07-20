import { useEffect } from "react";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
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

/**
 * The per-player dialogue panel (spec Decision 4, the WoW compass). A GAME UI surface — the Tiny
 * tree — driven entirely by the store's `eventDialogue`, which session.ts fills from the server's
 * `event.say`/`event.choices` beats and clears on `event.close` (or a reconnect). The authored PROSE
 * (`text`/`name`/`prompt`/option labels) renders verbatim: it is the author's data, the one
 * sanctioned codes-not-sentences exception. Every framing string here stays i18n.
 *
 * Movement and combat stay LIVE while the panel is open — it captures only its own keys and never the
 * WASD/arrow movement or the skill keys, so free movement is preserved (the server closes the run
 * when the hero walks past `DIALOGUE_CLOSE_RADIUS`, and `event.close` hides this panel):
 *  - a `say` page advances on Space here, or on the interact key (routed to `event.advance` in
 *    session.ts, the RPG convention), or a click on Continue;
 *  - a `choices` page picks an option on click or the number keys 1-4.
 *
 * The panel's keydown runs in the CAPTURE phase and `preventDefault()`s the keys it consumes, so the
 * game's own `trackActions` (a bubble listener that bails on `defaultPrevented`) never double-handles
 * a number key as a quick-item, nor Space as anything.
 */
export function EventDialoguePanel() {
  useLocale();
  const dialogue = useUiStore((s) => s.eventDialogue);
  const game = useUiStore((s) => s.game);

  useEffect(() => {
    if (!dialogue) return;
    const advance = () => {
      if (dialogue.kind === "say") game?.eventAdvance?.(dialogue.runId);
    };
    const chooseOption = (index: number) => {
      // GUARD: never emit a choose unless a choices offer is actually pending and the index names a
      // real option. Removing this lets a stray number key fire a choose with no pending offer.
      if (dialogue.kind !== "choices" || index < 0 || index >= dialogue.options.length) return;
      game?.eventChoose?.(dialogue.runId, index);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTextEntry(event.target)) return;
      if (dialogue.kind === "say" && event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        advance();
        return;
      }
      const index = digitIndex(event.code);
      if (index === null) return;
      // Only a choices page consumes the number keys; a say page leaves them to the quick-item bar.
      if (dialogue.kind === "choices") {
        event.preventDefault();
        event.stopPropagation();
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
      data-dialogue-kind={dialogue.kind}
    >
      {dialogue.kind === "say" ? (
        <>
          {dialogue.name && <strong className="event-dialogue__name">{dialogue.name}</strong>}
          <p className="event-dialogue__text">{dialogue.text}</p>
          <div className="event-dialogue__actions">
            <TinyButton
              size="sm"
              onClick={() => game?.eventAdvance?.(dialogue.runId)}
              data-dialogue-advance
            >
              {t("dialogue.continue")} <TinyKbd>{t("dialogue.space")}</TinyKbd>
            </TinyButton>
          </div>
        </>
      ) : (
        <>
          <p className="event-dialogue__text">{dialogue.prompt}</p>
          <fieldset className="event-dialogue__choices">
            <legend className="event-dialogue__legend">{t("dialogue.choose")}</legend>
            {dialogue.options.map((label, index) => (
              <TinyButton
                // The options are a fixed authored offer, rendered once and never reordered in place;
                // labels can repeat, so pairing the index with the runId is the stable identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed, non-reordered authored offer.
                key={`${dialogue.runId}-${index}`}
                size="sm"
                variant="secondary"
                className="event-dialogue__choice"
                onClick={() => game?.eventChoose?.(dialogue.runId, index)}
                data-dialogue-choice={index}
              >
                <TinyKbd>{String(index + 1)}</TinyKbd> {label}
              </TinyButton>
            ))}
          </fieldset>
        </>
      )}
    </TinyPanel>
  );
}
