/**
 * Keyboard -> intent. The client never says where it is, only what it is trying to do.
 *
 * Movement intent is polled once per predicted tick. Action keys stay edge-triggered.
 */

import { type Input, NO_INPUT } from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";

import { getCameraSettings } from "./camera-settings.js";
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
const CAMERA_KEYBOARD_RADIANS_PER_SECOND = 1.8;
const CAMERA_WHEEL_PERCENT_PER_PIXEL = 0.1;
const CAMERA_DRAG_AXIS_THRESHOLD = 4;
export const CAMERA_PITCH_DEFAULT = 38 * (Math.PI / 180);
export const CAMERA_PITCH_MIN = 20 * (Math.PI / 180);
export const CAMERA_PITCH_MAX = 70 * (Math.PI / 180);
/** Keeps the default HD-2D composition while allowing a 90-degree lateral viewing arc. */
export const CAMERA_PARTIAL_YAW_LIMIT = Math.PI / 4;
export const CAMERA_ZOOM_MIN = 50;
export const CAMERA_ZOOM_MAX = 180;

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

/** Applies an unrestricted horizontal orbit and keeps the stored angle numerically stable. */
export function cameraYawAfterDelta(currentYaw: number, orbitDelta: number): number {
  const yaw = Number.isFinite(currentYaw) ? currentYaw : 0;
  const delta = Number.isFinite(orbitDelta) ? orbitDelta : 0;
  return Math.atan2(Math.sin(yaw + delta), Math.cos(yaw + delta));
}

/** Applies the lateral movement available in the default HD-2D camera mode. */
export function cameraPartialYawAfterDelta(currentYaw: number, orbitDelta: number): number {
  const yaw = Number.isFinite(currentYaw) ? currentYaw : 0;
  const delta = Number.isFinite(orbitDelta) ? orbitDelta : 0;
  return Math.max(-CAMERA_PARTIAL_YAW_LIMIT, Math.min(CAMERA_PARTIAL_YAW_LIMIT, yaw + delta));
}

export function cameraPitchAfterDelta(currentPitch: number, orbitDelta: number): number {
  const pitch = Number.isFinite(currentPitch) ? currentPitch : CAMERA_PITCH_DEFAULT;
  const delta = Number.isFinite(orbitDelta) ? orbitDelta : 0;
  return Math.max(CAMERA_PITCH_MIN, Math.min(CAMERA_PITCH_MAX, pitch + delta));
}

export function cameraZoomAfterWheel(currentZoom: number, wheelPixels: number): number {
  const zoom = Number.isFinite(currentZoom) ? currentZoom : 100;
  const wheel = Number.isFinite(wheelPixels) ? wheelPixels : 0;
  return Math.max(
    CAMERA_ZOOM_MIN,
    Math.min(CAMERA_ZOOM_MAX, zoom - wheel * CAMERA_WHEEL_PERCENT_PER_PIXEL),
  );
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
  takeSample(dt: number): { yawDelta: number; pitchDelta: number; wheelPixels: number };
  stop(): void;
}

/** Right-drag, wheel and the standard gamepad's right stick, scoped to the game canvas. */
export function trackCameraOrbit(element: HTMLElement): CameraOrbitTracker {
  let dragging = false;
  let dragAxis: "pitch" | "yaw" | null = null;
  let lastX = 0;
  let lastY = 0;
  let pendingPixelsX = 0;
  let pendingPixelsY = 0;
  let mousePixelsX = 0;
  let mousePixelsY = 0;
  let wheelPixels = 0;
  const keyboardYawControls = new Set<"moveLeft" | "moveRight">();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable) ||
      event.repeat
    )
      return;
    const control = keyboardControlForCode(event.code);
    if (control !== "moveLeft" && control !== "moveRight") return;
    keyboardYawControls.add(control);
    setInputMode("keyboard");
    event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    const control = keyboardControlForCode(event.code);
    if (control !== "moveLeft" && control !== "moveRight") return;
    keyboardYawControls.delete(control);
    setInputMode("keyboard");
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 2) return;
    dragging = true;
    dragAxis = null;
    pendingPixelsX = 0;
    pendingPixelsY = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    setInputMode("keyboard");
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const fallbackX = event.clientX - lastX;
    const fallbackY = event.clientY - lastY;
    const deltaX =
      Number.isFinite(event.movementX) && event.movementX !== 0 ? event.movementX : fallbackX;
    const deltaY =
      Number.isFinite(event.movementY) && event.movementY !== 0 ? event.movementY : fallbackY;
    if (dragAxis === "yaw") mousePixelsX += deltaX;
    else if (dragAxis === "pitch") mousePixelsY += deltaY;
    else {
      pendingPixelsX += deltaX;
      pendingPixelsY += deltaY;
      if (
        Math.max(Math.abs(pendingPixelsX), Math.abs(pendingPixelsY)) >= CAMERA_DRAG_AXIS_THRESHOLD
      ) {
        dragAxis = Math.abs(pendingPixelsX) >= Math.abs(pendingPixelsY) ? "yaw" : "pitch";
        if (dragAxis === "yaw") mousePixelsX += pendingPixelsX;
        else mousePixelsY += pendingPixelsY;
        pendingPixelsX = 0;
        pendingPixelsY = 0;
      }
    }
    lastX = event.clientX;
    lastY = event.clientY;
    event.preventDefault();
  };
  const stopDrag = (event?: PointerEvent): void => {
    if (event && event.button !== 2) return;
    dragging = false;
    dragAxis = null;
    pendingPixelsX = 0;
    pendingPixelsY = 0;
  };
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  const onWheel = (event: WheelEvent): void => {
    wheelPixels += event.deltaY;
    setInputMode("keyboard");
    event.preventDefault();
  };
  const onBlur = (): void => {
    dragging = false;
    dragAxis = null;
    pendingPixelsX = 0;
    pendingPixelsY = 0;
    mousePixelsX = 0;
    mousePixelsY = 0;
    wheelPixels = 0;
    keyboardYawControls.clear();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", stopDrag);
  element.addEventListener("pointercancel", stopDrag);
  element.addEventListener("contextmenu", onContextMenu);
  element.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    takeSample(dt) {
      const mouseX = mousePixelsX;
      const mouseY = mousePixelsY;
      const wheel = wheelPixels;
      mousePixelsX = 0;
      mousePixelsY = 0;
      wheelPixels = 0;
      const gamepad = firstConnectedGamepad();
      const axisX = gamepad?.axes[2] ?? 0;
      const axisY = gamepad?.axes[3] ?? 0;
      if (Math.abs(axisX) > GAMEPAD_AXIS_DEADZONE || Math.abs(axisY) > GAMEPAD_AXIS_DEADZONE)
        setInputMode("gamepad");
      // One gesture owns one axis. Horizontal orbit therefore keeps camera height/pitch fixed,
      // while a separate deliberate vertical drag still offers the manual look control. The
      // gamepad follows the same dominant-axis rule so a diagonal stick cannot drift both.
      const yawAxis = Math.abs(axisX) >= Math.abs(axisY) ? axisX : 0;
      const pitchAxis = Math.abs(axisY) > Math.abs(axisX) ? axisY : 0;
      const sensitivity = getCameraSettings();
      const keyboardYaw =
        Number(keyboardYawControls.has("moveLeft")) - Number(keyboardYawControls.has("moveRight"));
      // A standard stick reports left/up as negative values. The camera orbits from the opposite
      // side of its focus, so gamepad axes use the opposite pointer-drag sign: the view follows the
      // physical direction in which the player pushes the stick.
      const pitchDelta =
        (-cameraOrbitDelta(mouseY, 0, dt) + cameraOrbitDelta(0, pitchAxis, dt)) *
        sensitivity.verticalSensitivity;
      return {
        yawDelta:
          (cameraOrbitDelta(mouseX, -yawAxis, dt) +
            keyboardYaw * CAMERA_KEYBOARD_RADIANS_PER_SECOND * Math.max(0, Math.min(dt, 0.1))) *
          sensitivity.horizontalSensitivity,
        pitchDelta: pitchDelta === 0 ? 0 : pitchDelta,
        wheelPixels: wheel,
      };
    },
    stop() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", stopDrag);
      element.removeEventListener("pointercancel", stopDrag);
      element.removeEventListener("contextmenu", onContextMenu);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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
    // Keyboard left/right are camera-turn controls. Lateral locomotion remains analogue on the
    // gamepad's left stick, while A/D can change the view without sliding the hero across a tile.
    if (action === "left" || action === "right") return false;
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
  releaseAvailable: () => boolean = () => true,
  menuConsumesActions: () => boolean = () => false,
): () => void {
  const pressedSkillCodes = new Map<string, SkillSlot>();
  const onKeyDown = (event: KeyboardEvent) => {
    setInputMode("keyboard");
    if (event.defaultPrevented || event.repeat) return;
    // Dialogue MenuNav owns arrows and confirm. The gameplay tracker is registered before React's
    // panel and therefore cannot rely on `defaultPrevented` being set yet.
    if (menuConsumesActions()) return;
    if (isTextEntry(event.target)) {
      if (event.code === "Escape") {
        event.target.blur();
        event.preventDefault();
      }
      return;
    }
    const control = keyboardControlForCode(event.code);
    if (!control || !ACTION_CONTROLS.includes(control as (typeof ACTION_CONTROLS)[number])) return;
    const contextualRelease = control === "release" && releaseAvailable();
    if (control === "release" && !contextualRelease) return;
    if (
      !contextualRelease &&
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
      const contextualRelease = releaseAvailable() && gamepadControlPressed("release", gamepad);
      if (ACTION_CONTROLS.some((control) => gamepadControlPressed(control, gamepad))) {
        setInputMode("gamepad");
      }
      for (const control of ACTION_CONTROLS) {
        if (!gamepadControlPressed(control, gamepad)) continue;
        pressed.add(control);
        // Still record held controls while a menu owns the pad. Releasing the dialogue while A or
        // a D-pad shortcut remains held must not leak a fresh gameplay action on the next frame.
        if (menuConsumesActions()) continue;
        if (control === "release" && !contextualRelease) continue;
        // Start/Menu is shared by the two default bindings. Remember both as held, but let exactly
        // one intent through so a retry never opens settings and a menu press never releases life.
        if (control === "settings" && contextualRelease) continue;
        if (
          !previousGamepad.has(control) &&
          (control !== "interact" || interactionAvailable()) &&
          (contextualRelease ||
            control === "settings" ||
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
