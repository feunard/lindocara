/**
 * Keyboard -> intent. The client never says where it is, only what it is trying to do.
 *
 * Movement intent is polled once per predicted tick. Action keys stay edge-triggered.
 */

import { type Input, NO_INPUT } from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
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
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "interact",
  "potion",
  "item1",
  "item2",
  "item3",
  "release",
  "map",
  "talents",
  "inventory",
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
  useQuickItem?(index: 0 | 1 | 2): void;
  release(): void;
  castSkill(slot: SkillSlot): void;
  releaseSkill?(slot: SkillSlot): void;
  focusChat(): void;
  toggleMap(): void;
  toggleTalents?(): void;
  toggleInventory?(): void;
  toggleSettings(): void;
}

function invokeAction(control: (typeof ACTION_CONTROLS)[number], handlers: ActionHandlers): void {
  if (control === "skill1") handlers.castSkill(1);
  else if (control === "skill2") handlers.castSkill(2);
  else if (control === "skill3") handlers.castSkill(3);
  else if (control === "skill4") handlers.castSkill(4);
  else if (control === "skill5") handlers.castSkill(5);
  else if (control === "interact") handlers.interact();
  else if (control === "potion") handlers.usePotion();
  else if (control === "item1") handlers.useQuickItem?.(0);
  else if (control === "item2") handlers.useQuickItem?.(1);
  else if (control === "item3") handlers.useQuickItem?.(2);
  else if (control === "release") handlers.release();
  else if (control === "map") handlers.toggleMap();
  else if (control === "talents") handlers.toggleTalents?.();
  else if (control === "inventory") handlers.toggleInventory?.();
  else if (control === "chat") handlers.focusChat();
  else handlers.toggleSettings();
}

function skillSlotForControl(control: ControlId): SkillSlot | null {
  if (control === "skill1") return 1;
  if (control === "skill2") return 2;
  if (control === "skill3") return 3;
  if (control === "skill4") return 4;
  if (control === "skill5") return 5;
  return null;
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
  const pressedSkillCodes = new Map<string, SkillSlot>();
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
    if (
      control !== "settings" &&
      control !== "talents" &&
      control !== "inventory" &&
      !actionsEnabled()
    )
      return;
    const actionControl = control as (typeof ACTION_CONTROLS)[number];
    invokeAction(actionControl, handlers);
    const skillSlot = skillSlotForControl(actionControl);
    if (skillSlot !== null) pressedSkillCodes.set(event.code, skillSlot);
    event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    const slot = pressedSkillCodes.get(event.code);
    if (slot === undefined) return;
    pressedSkillCodes.delete(event.code);
    handlers.releaseSkill?.(slot);
    event.preventDefault();
  };

  let previousGamepad = new Set<ControlId>();
  let previousGamepadCombo: string | null = null;
  let frame = 0;
  const pollGamepad = () => {
    const gamepad = firstConnectedGamepad();
    const pressed = new Set<ControlId>();
    if (gamepad) {
      // Standard pads have no three spare face buttons. LT acts as a quick-item modifier:
      // LT alone uses slot 1, LT + D-pad down/right uses slots 2/3, and LT + Back opens the bag.
      // Individual mapped actions are suppressed for the chord so one press produces one intent.
      const modifier = gamepad.buttons[6]?.pressed === true;
      const inventoryChord = modifier && gamepad.buttons[8]?.pressed === true;
      const quickIndex = !modifier
        ? null
        : gamepad.buttons[13]?.pressed
          ? 1
          : gamepad.buttons[15]?.pressed
            ? 2
            : gamepad.buttons[14]?.pressed
              ? 0
              : null;
      const combo = inventoryChord
        ? "inventory"
        : quickIndex === null
          ? null
          : `item-${quickIndex}`;
      if (combo && combo !== previousGamepadCombo) {
        if (combo === "inventory") handlers.toggleInventory?.();
        else if (actionsEnabled()) handlers.useQuickItem?.(quickIndex as 0 | 1 | 2);
      }
      previousGamepadCombo = combo;
      for (const control of ACTION_CONTROLS) {
        if (!gamepadControlPressed(control, gamepad)) continue;
        pressed.add(control);
        if (
          (inventoryChord && (control === "potion" || control === "item1" || control === "map")) ||
          (quickIndex !== null && (control === "potion" || control === "item1"))
        )
          continue;
        if (
          !previousGamepad.has(control) &&
          (control === "settings" ||
            control === "talents" ||
            control === "inventory" ||
            actionsEnabled())
        ) {
          invokeAction(control, handlers);
        }
      }
    } else {
      previousGamepadCombo = null;
    }
    for (const control of previousGamepad) {
      if (pressed.has(control)) continue;
      const slot = skillSlotForControl(control);
      if (slot !== null) handlers.releaseSkill?.(slot);
    }
    previousGamepad = pressed;
    frame = window.requestAnimationFrame(pollGamepad);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  frame = window.requestAnimationFrame(pollGamepad);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.cancelAnimationFrame(frame);
  };
}
