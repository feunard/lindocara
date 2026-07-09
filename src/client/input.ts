/**
 * Keyboard -> intent. The client never says where it is, only what it is trying to do.
 *
 * Intent is *polled*, not pushed: the simulation samples it once per fixed tick. Pushing on
 * every keydown would emit commands on the browser's key-repeat schedule rather than the
 * simulation's, and prediction depends on the client stepping in exactly the increments the
 * server does.
 */

import { type Input, NO_INPUT } from "../shared/simulation.js";

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
  /** The intent held right now. */
  current(): Input;
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
    if (set(event.code, true)) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (set(event.code, false)) event.preventDefault();
  };

  // Alt-tabbing away while holding a key would otherwise leave the square sprinting forever,
  // since the keyup lands on another window.
  const onBlur = () => {
    held = { ...NO_INPUT };
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    current: () => held,
    stop: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
