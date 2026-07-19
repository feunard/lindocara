import { useEffect, useRef, useState } from "react";
import { type Input, NO_INPUT } from "../../shared/simulation.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

const DEAD_ZONE_RATIO = 0.2;
const AXIS_THRESHOLD = 0.34;

export interface JoystickState {
  input: Input;
  thumbX: number;
  thumbY: number;
}

/** Turns an analogue pointer offset into the same eight-way intent used by keyboard prediction. */
export function resolveJoystick(dx: number, dy: number, radius: number): JoystickState {
  const safeRadius = Math.max(1, radius);
  const distance = Math.hypot(dx, dy);
  const thumbLimit = safeRadius * 0.58;
  const thumbScale = distance > thumbLimit ? thumbLimit / distance : 1;
  if (distance <= safeRadius * DEAD_ZONE_RATIO) {
    return { input: { ...NO_INPUT }, thumbX: dx * thumbScale, thumbY: dy * thumbScale };
  }
  const x = dx / distance;
  const y = dy / distance;
  return {
    input: {
      up: y < -AXIS_THRESHOLD,
      down: y > AXIS_THRESHOLD,
      left: x < -AXIS_THRESHOLD,
      right: x > AXIS_THRESHOLD,
    },
    thumbX: dx * thumbScale,
    thumbY: dy * thumbScale,
  };
}

export function MobileControls() {
  useLocale();
  const game = useUiStore((state) => state.game);
  const self = useUiStore((state) => state.self);
  const mapOpen = useUiStore((state) => state.mapOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const talentsOpen = useUiStore((state) => state.talentsOpen);
  const chatFocusRequest = useUiStore((state) => state.chatFocusRequest);
  const setMapOpen = useUiStore((state) => state.setMapOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const setTalentsOpen = useUiStore((state) => state.setTalentsOpen);
  const requestChatFocus = useUiStore((state) => state.requestChatFocus);
  const activePointer = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  useEffect(
    () => () => {
      activePointer.current = null;
      game?.setMovement?.({ ...NO_INPUT });
    },
    [game],
  );

  useEffect(() => {
    if (!mapOpen && !settingsOpen && !talentsOpen && chatFocusRequest === 0) return;
    activePointer.current = null;
    setThumb({ x: 0, y: 0 });
    game?.setMovement?.({ ...NO_INPUT });
  }, [chatFocusRequest, game, mapOpen, settingsOpen, talentsOpen]);

  if (!game || !self) return null;
  const drinkPotion = game.usePotion;

  const stopMovement = () => {
    activePointer.current = null;
    setThumb({ x: 0, y: 0 });
    game.setMovement?.({ ...NO_INPUT });
  };

  const stopPointer = (event: React.PointerEvent<HTMLFieldSetElement>) => {
    if (activePointer.current !== event.pointerId) return;
    stopMovement();
  };

  const updateMovement = (
    event: React.PointerEvent<HTMLFieldSetElement>,
    capture: boolean,
  ): void => {
    event.preventDefault();
    if (activePointer.current !== null && activePointer.current !== event.pointerId) return;
    activePointer.current = event.pointerId;
    if (capture) event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const state = resolveJoystick(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height / 2),
      Math.min(rect.width, rect.height) / 2,
    );
    setThumb({ x: state.thumbX, y: state.thumbY });
    game.setMovement?.(state.input);
  };

  const openOverlay = (action: () => void) => {
    stopMovement();
    action();
  };

  return (
    <section className="mobile-controls" aria-label={t("mobile.controls")}>
      <fieldset
        className="mobile-joystick"
        aria-label={t("mobile.move")}
        onPointerDown={(event) => updateMovement(event, true)}
        onPointerMove={(event) => {
          if (activePointer.current === event.pointerId) updateMovement(event, false);
        }}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onLostPointerCapture={stopPointer}
      >
        <span
          className="mobile-joystick__thumb"
          style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
        />
      </fieldset>

      <div className="mobile-utilities">
        <button type="button" onClick={() => game.interact()} aria-label={t("mobile.interact")}>
          <span aria-hidden="true">&#9670;</span>
        </button>
        <button type="button" onClick={drinkPotion} aria-label={t("mobile.potion")}>
          <span className="mobile-utility__potion" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => openOverlay(() => setMapOpen(!mapOpen))}
          aria-label={t("mobile.map")}
        >
          <span aria-hidden="true">&#10021;</span>
        </button>
        <button
          type="button"
          onClick={() =>
            openOverlay(() => {
              setMapOpen(false);
              setSettingsOpen(false);
              setTalentsOpen(!talentsOpen);
            })
          }
          aria-label={t("mobile.talents")}
        >
          <span aria-hidden="true">✦</span>
        </button>
        <button
          type="button"
          onClick={() => openOverlay(requestChatFocus)}
          aria-label={t("mobile.chat")}
        >
          <span aria-hidden="true">&#8230;</span>
        </button>
        <button
          type="button"
          onClick={() => openOverlay(() => setSettingsOpen(true))}
          aria-label={t("mobile.settings")}
        >
          <span aria-hidden="true">&#8801;</span>
        </button>
      </div>
    </section>
  );
}
