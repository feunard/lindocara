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
  setInputMode,
} from "./input-settings.js";

const GAMEPAD_AXIS_DEADZONE = 0.2;
const CAMERA_MOUSE_RADIANS_PER_PIXEL = 0.006;
const CAMERA_GAMEPAD_RADIANS_PER_SECOND = 1.8;
export const CAMERA_YAW_RANGE = 20 * (Math.PI / 180);
const CAMERA_YAW_RETURN = 6;

const MOVEMENT_CONTROLS: Partial<Record<ControlId, keyof Input>> = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
  // Jump rides with movement rather than with the edge-triggered actions: `stepHero` reads it as a
  // LEVEL and finds the rising edge itself, so it must be polled like a direction, not dispatched
  // once on keydown.
  jump: "jump",
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
  "quests",
  "chat",
  "settings",
] as const satisfies readonly ControlId[];

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Math.abs(value) < GAMEPAD_AXIS_DEADZONE ? 0 : value;
  if (scaled <= -1) return -1;
  if (scaled >= 1) return 1;
  return scaled;
}

export function cameraOrbitDelta(mousePixels: number, gamepadAxis: number, dt: number): number {
  const safeMouse = Number.isFinite(mousePixels) ? mousePixels : 0;
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
  return (
    safeMouse * CAMERA_MOUSE_RADIANS_PER_PIXEL +
    clampAxis(gamepadAxis) * CAMERA_GAMEPAD_RADIANS_PER_SECOND * safeDt
  );
}

/** Applies the lab camera's bounded glance and exponential return to its default heading. */
export function limitedCameraYaw(
  currentYaw: number,
  orbitDelta: number,
  orbiting: boolean,
  dt: number,
): number {
  const yaw = Number.isFinite(currentYaw) ? currentYaw : 0;
  const delta = Number.isFinite(orbitDelta) ? orbitDelta : 0;
  const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  if (orbiting) {
    return Math.max(-CAMERA_YAW_RANGE, Math.min(CAMERA_YAW_RANGE, yaw + delta));
  }
  return yaw * Math.exp(-CAMERA_YAW_RETURN * safeDt);
}

/** Converts screen-relative movement into the world axes used by `stepHero`. */
export function rotateMovementInput(input: Input, cameraYaw: number): Input {
  const digitalX = Number(input.right) - Number(input.left);
  const digitalZ = Number(input.down) - Number(input.up);
  const sourceX =
    Number.isFinite(input.axisX) && Math.abs(input.axisX ?? 0) > 0.0001
      ? (input.axisX ?? 0)
      : digitalX;
  const sourceZ =
    Number.isFinite(input.axisY) && Math.abs(input.axisY ?? 0) > 0.0001
      ? (input.axisY ?? 0)
      : digitalZ;
  const yaw = Number.isFinite(cameraYaw) ? cameraYaw : 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const worldX = sourceX * cos + sourceZ * sin;
  const worldZ = -sourceX * sin + sourceZ * cos;
  const cleanX = Math.abs(worldX) < 1e-10 ? 0 : worldX;
  const cleanZ = Math.abs(worldZ) < 1e-10 ? 0 : worldZ;
  return {
    ...input,
    up: cleanZ < 0,
    down: cleanZ > 0,
    left: cleanX < 0,
    right: cleanX > 0,
    axisX: cleanX,
    axisY: cleanZ,
  };
}

export interface CameraOrbitTracker {
  takeSample(dt: number): { delta: number; orbiting: boolean };
  stop(): void;
}

/** Right-drag and the standard gamepad's right horizontal stick, scoped to the game canvas. */
export function trackCameraOrbit(element: HTMLElement): CameraOrbitTracker {
  let dragging = false;
  let lastX = 0;
  let mousePixels = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 2) return;
    dragging = true;
    lastX = event.clientX;
    setInputMode("keyboard");
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const fallback = event.clientX - lastX;
    mousePixels +=
      Number.isFinite(event.movementX) && event.movementX !== 0 ? event.movementX : fallback;
    lastX = event.clientX;
    event.preventDefault();
  };
  const stopDrag = (event?: PointerEvent): void => {
    if (event && event.button !== 2) return;
    dragging = false;
  };
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  const onBlur = (): void => {
    dragging = false;
    mousePixels = 0;
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", stopDrag);
  element.addEventListener("pointercancel", stopDrag);
  element.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("blur", onBlur);

  return {
    takeSample(dt) {
      const mouse = mousePixels;
      mousePixels = 0;
      const axis = firstConnectedGamepad()?.axes[2] ?? 0;
      if (Math.abs(axis) > GAMEPAD_AXIS_DEADZONE) setInputMode("gamepad");
      return {
        delta: cameraOrbitDelta(mouse, axis, dt),
        orbiting: dragging || mouse !== 0 || Math.abs(axis) > GAMEPAD_AXIS_DEADZONE,
      };
    },
    stop() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", stopDrag);
      element.removeEventListener("pointercancel", stopDrag);
      element.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("blur", onBlur);
    },
  };
}

function mergedInput(movement: Input, virtual: Input): Input {
  const axisX = Number.isFinite(virtual.axisX) ? virtual.axisX : movement.axisX;
  const axisY = Number.isFinite(virtual.axisY) ? virtual.axisY : movement.axisY;
  return {
    up: movement.up || virtual.up,
    down: movement.down || virtual.down,
    left: movement.left || virtual.left,
    right: movement.right || virtual.right,
    jump: (movement.jump ?? false) || (virtual.jump ?? false),
    ...(axisX === undefined ? {} : { axisX }),
    ...(axisY === undefined ? {} : { axisY }),
  };
}

export interface InputTracker {
  current(): Input;
  setVirtual(input: Input): void;
  reset(): void;
  stop(): void;
}

export function trackInput(suppressGamepadJump: () => boolean = () => false): InputTracker {
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
    setInputMode("keyboard");
    if (event.target instanceof HTMLInputElement || event.repeat) return;
    if (set(event.code, true)) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    setInputMode("keyboard");
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
      if (gamepad) {
        const rawAxisX = gamepad.axes[0] ?? 0;
        const rawAxisY = gamepad.axes[1] ?? 0;
        const hasAxis =
          Math.abs(rawAxisX) > GAMEPAD_AXIS_DEADZONE || Math.abs(rawAxisY) > GAMEPAD_AXIS_DEADZONE;
        const hasAction = ACTION_CONTROLS.some((control) =>
          gamepadControlPressed(control, gamepad),
        );
        if (hasAxis || hasAction) setInputMode("gamepad");
      }
      const movement: Input = {
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
        jump:
          (keyboard.jump ?? false) ||
          (virtual.jump ?? false) ||
          (gamepad ? gamepadControlPressed("jump", gamepad) && !suppressGamepadJump() : false),
        axisX: 0,
        axisY: 0,
      };
      if (gamepad) {
        movement.axisX = clampAxis(gamepad.axes[0] ?? 0);
        movement.axisY = clampAxis(gamepad.axes[1] ?? 0);
      }
      if (movement.axisX === 0 && movement.axisY === 0) {
        return mergedInput(
          {
            ...movement,
            axisX: 0,
            axisY: 0,
          },
          {
            ...virtual,
            axisX: clampAxis(Number(virtual.right) - Number(virtual.left)),
            axisY: clampAxis(Number(virtual.down) - Number(virtual.up)),
          },
        );
      }
      return mergedInput(movement, virtual);
    },
    setVirtual: (input) => {
      virtual = {
        ...input,
        axisX: clampAxis(Number(input.right) - Number(input.left)),
        axisY: clampAxis(Number(input.down) - Number(input.up)),
      };
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
  toggleQuests?(): void;
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
  else if (control === "quests") handlers.toggleQuests?.();
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
  interactionAvailable: () => boolean = () => true,
): () => void {
  const pressedSkillCodes = new Map<string, SkillSlot>();
  const onKeyDown = (event: KeyboardEvent) => {
    setInputMode("keyboard");
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
      control !== "quests" &&
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
    setInputMode("keyboard");
    const slot = pressedSkillCodes.get(event.code);
    if (slot === undefined) return;
    pressedSkillCodes.delete(event.code);
    handlers.releaseSkill?.(slot);
    event.preventDefault();
  };

  let previousGamepad = new Set<ControlId>();
  let frame = 0;
  const pollGamepad = () => {
    const gamepad = firstConnectedGamepad();
    const pressed = new Set<ControlId>();
    if (gamepad) {
      if (ACTION_CONTROLS.some((control) => gamepadControlPressed(control, gamepad))) {
        setInputMode("gamepad");
      }
      for (const control of ACTION_CONTROLS) {
        if (!gamepadControlPressed(control, gamepad)) continue;
        pressed.add(control);
        if (
          !previousGamepad.has(control) &&
          (control !== "interact" || interactionAvailable()) &&
          (control === "settings" ||
            control === "talents" ||
            control === "inventory" ||
            control === "quests" ||
            actionsEnabled())
        ) {
          invokeAction(control, handlers);
        }
      }
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
