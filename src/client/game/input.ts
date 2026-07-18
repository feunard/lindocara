/**
 * Keyboard -> intent. The client never says where it is, only what it is trying to do.
 *
 * Movement intent is polled once per predicted tick. Action keys stay edge-triggered.
 */

import { type Input, NO_INPUT } from "../../shared/simulation.js";
import type { SkillSlot } from "../../shared/skills.js";
import {
  type ControlId,
  firstConnectedGamepad,
  gamepadControlPressed,
  keyboardControlForCode,
} from "./input-settings.js";

const MOVEMENT_CONTROLS: Partial<Record<ControlId, keyof Input>> = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
};

const ACTION_CONTROLS = [
  "target",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "interact",
  "potion",
  "release",
  "map",
  "chat",
  "settings",
] as const satisfies readonly ControlId[];

export interface InputTracker {
  current(): Input;
  setVirtual(input: Input): void;
  reset(): void;
  stop(): void;
}

export function trackInput(): InputTracker {
  let keyboard: Input = { ...NO_INPUT };
  let virtual: Input = { ...NO_INPUT };

  const set = (code: string, pressed: boolean): boolean => {
    const control = keyboardControlForCode(code);
    const action = control ? MOVEMENT_CONTROLS[control] : undefined;
    if (!action) return false;
    keyboard = { ...keyboard, [action]: pressed };
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.repeat) return;
    if (set(event.code, true)) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (set(event.code, false)) event.preventDefault();
  };

  const onBlur = () => {
    keyboard = { ...NO_INPUT };
    virtual = { ...NO_INPUT };
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    current: () => {
      const gamepad = firstConnectedGamepad();
      return {
        up:
          keyboard.up || virtual.up || (gamepad ? gamepadControlPressed("moveUp", gamepad) : false),
        down:
          keyboard.down ||
          virtual.down ||
          (gamepad ? gamepadControlPressed("moveDown", gamepad) : false),
        left:
          keyboard.left ||
          virtual.left ||
          (gamepad ? gamepadControlPressed("moveLeft", gamepad) : false),
        right:
          keyboard.right ||
          virtual.right ||
          (gamepad ? gamepadControlPressed("moveRight", gamepad) : false),
      };
    },
    setVirtual: (input) => {
      virtual = { ...input };
    },
    reset: () => {
      keyboard = { ...NO_INPUT };
      virtual = { ...NO_INPUT };
    },
    stop: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}

export interface ActionHandlers {
  attack(): void;
  interact(): void;
  usePotion(): void;
  heal(): void;
  release(): void;
  castSkill(slot: SkillSlot): void;
  switchTarget(reverse: boolean): void;
  focusChat(): void;
  toggleMap(): void;
  toggleSettings(): void;
}

function invokeAction(
  control: (typeof ACTION_CONTROLS)[number],
  handlers: ActionHandlers,
  reverse = false,
): void {
  if (control === "target") handlers.switchTarget(reverse);
  else if (control === "skill1") handlers.castSkill(1);
  else if (control === "skill2") handlers.castSkill(2);
  else if (control === "skill3") handlers.castSkill(3);
  else if (control === "skill4") handlers.castSkill(4);
  else if (control === "skill5") handlers.castSkill(5);
  else if (control === "interact") handlers.interact();
  else if (control === "potion") handlers.usePotion();
  else if (control === "release") handlers.release();
  else if (control === "map") handlers.toggleMap();
  else if (control === "chat") handlers.focusChat();
  else handlers.toggleSettings();
}

function isTextEntry(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Edge-triggered gameplay actions; repeats are ignored and never become trusted outcomes. */
export function trackActions(
  handlers: ActionHandlers,
  actionsEnabled: () => boolean = () => true,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isTextEntry(event.target)) {
      if (event.code === "Escape") {
        event.target.blur();
        event.preventDefault();
      }
      return;
    }
    const control = keyboardControlForCode(event.code);
    if (!control || !ACTION_CONTROLS.includes(control as (typeof ACTION_CONTROLS)[number])) return;
    if (control !== "settings" && !actionsEnabled()) return;
    invokeAction(control as (typeof ACTION_CONTROLS)[number], handlers, event.shiftKey);
    event.preventDefault();
  };

  let previousGamepad = new Set<ControlId>();
  let frame = 0;
  const pollGamepad = () => {
    const gamepad = firstConnectedGamepad();
    const pressed = new Set<ControlId>();
    if (gamepad) {
      for (const control of ACTION_CONTROLS) {
        if (!gamepadControlPressed(control, gamepad)) continue;
        pressed.add(control);
        if (!previousGamepad.has(control) && (control === "settings" || actionsEnabled())) {
          invokeAction(control, handlers);
        }
      }
    }
    previousGamepad = pressed;
    frame = window.requestAnimationFrame(pollGamepad);
  };

  window.addEventListener("keydown", onKeyDown);
  frame = window.requestAnimationFrame(pollGamepad);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.cancelAnimationFrame(frame);
  };
}
