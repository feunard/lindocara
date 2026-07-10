/**
 * Keyboard -> intent. The client never says where it is, only what it is trying to do.
 *
 * Movement intent is polled once per predicted tick. Action keys stay edge-triggered.
 */

import { type Input, NO_INPUT } from "../../shared/simulation.js";

const KEY_BINDINGS: Record<string, keyof Input> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

export interface InputTracker {
  current(): Input;
  reset(): void;
  stop(): void;
}

export function trackInput(): InputTracker {
  let held: Input = { ...NO_INPUT };

  const set = (code: string, pressed: boolean): boolean => {
    const action = KEY_BINDINGS[code];
    if (!action) return false;
    held = { ...held, [action]: pressed };
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
    held = { ...NO_INPUT };
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    current: () => held,
    reset: () => {
      held = { ...NO_INPUT };
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
  focusChat(): void;
}

/** Edge-triggered gameplay actions; repeats are ignored and never become trusted outcomes. */
export function trackActions(handlers: ActionHandlers): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.repeat) return;
    if (event.code === "Space") handlers.attack();
    else if (event.code === "KeyE") handlers.interact();
    else if (event.code === "KeyQ") handlers.usePotion();
    else if (event.code === "Enter") handlers.focusChat();
    else return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
