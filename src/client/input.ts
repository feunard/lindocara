/**
 * Keyboard -> intent. The client never says where it is, only what it is trying to do.
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

function sameInput(a: Input, b: Input): boolean {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right;
}

/**
 * Watches the keyboard and calls `onChange` only when the intent actually changes —
 * key repeat would otherwise flood the socket with identical frames.
 *
 * Returns a teardown function.
 */
export function trackInput(onChange: (input: Input) => void): () => void {
  let current: Input = { ...NO_INPUT };

  const set = (code: string, pressed: boolean): boolean => {
    const action = KEY_BINDINGS[code];
    if (!action) return false;

    if (current[action] === pressed) return true;
    const next = { ...current, [action]: pressed };
    current = next;
    onChange(next);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (set(event.code, true)) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (set(event.code, false)) event.preventDefault();
  };

  // Alt-tabbing away while holding a key would otherwise leave the square sprinting
  // forever, since the keyup lands on another window.
  const onBlur = () => {
    if (sameInput(current, NO_INPUT)) return;
    current = { ...NO_INPUT };
    onChange(current);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}
