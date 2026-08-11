import { trackActions, trackInput } from "@lindocara/renderer/input.js";
import {
  gamepadBindingLabel,
  gamepadControlPressed,
  getInputSettings,
  resetInputBindings,
  setGamepadBinding,
  setKeyboardBinding,
} from "@lindocara/renderer/input-settings.js";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("input remapping", () => {
  beforeEach(() => resetInputBindings());

  it("persists keyboard and controller remaps in the shared input profile", () => {
    setKeyboardBinding("interact", { code: "KeyK" });
    setGamepadBinding("interact", { kind: "button", index: 2 });

    expect(getInputSettings().keyboard.interact).toEqual([{ code: "KeyK" }]);
    expect(getInputSettings().gamepad.interact).toEqual([{ kind: "button", index: 2 }]);
    expect(JSON.parse(String(localStorage.getItem("lindocara.input"))).keyboard.interact).toEqual([
      { code: "KeyK" },
    ]);
  });

  it("maps the five ordered skills to the requested letters and numpad mirror", () => {
    expect(getInputSettings().keyboard.skill1).toEqual([{ code: "KeyO" }, { code: "Numpad5" }]);
    expect(getInputSettings().keyboard.skill2).toEqual([{ code: "KeyM" }, { code: "Numpad3" }]);
    expect(getInputSettings().keyboard.skill3).toEqual([{ code: "KeyL" }, { code: "Numpad2" }]);
    expect(getInputSettings().keyboard.skill4).toEqual([{ code: "KeyK" }, { code: "Numpad1" }]);
    expect(getInputSettings().keyboard.skill5).toEqual([{ code: "KeyJ" }, { code: "Numpad4" }]);
    expect(getInputSettings().keyboard.map).toEqual([{ code: "KeyC" }]);
    expect(getInputSettings().keyboard.talents).toEqual([{ code: "KeyH" }]);
    expect(getInputSettings().keyboard.quests).toEqual([{ code: "KeyN" }]);
    expect(getInputSettings().gamepad.talents).toEqual([{ kind: "button", index: 5 }]);
  });

  it("reserves both directional pads for shortcuts and shares the south button contextually", () => {
    const { keyboard, gamepad } = getInputSettings();
    expect(keyboard.moveUp).toEqual([{ code: "KeyW" }]);
    expect(keyboard.moveDown).toEqual([{ code: "KeyS" }]);
    expect(keyboard.moveLeft).toEqual([{ code: "KeyA" }]);
    expect(keyboard.moveRight).toEqual([{ code: "KeyD" }]);
    expect(keyboard.item1).toEqual([{ code: "Digit1" }, { code: "ArrowLeft" }]);
    expect(keyboard.item2).toEqual([{ code: "Digit2" }, { code: "ArrowUp" }]);
    expect(keyboard.item3).toEqual([{ code: "Digit3" }, { code: "ArrowRight" }]);
    expect(keyboard.inventory).toEqual([{ code: "KeyB" }, { code: "ArrowDown" }]);
    expect(gamepad.moveUp).toEqual([{ kind: "axis", index: 1, direction: -1 }]);
    expect(gamepad.moveDown).toEqual([{ kind: "axis", index: 1, direction: 1 }]);
    expect(gamepad.moveLeft).toEqual([{ kind: "axis", index: 0, direction: -1 }]);
    expect(gamepad.moveRight).toEqual([{ kind: "axis", index: 0, direction: 1 }]);
    expect(gamepad.item1).toEqual([{ kind: "button", index: 14 }]);
    expect(gamepad.item2).toEqual([{ kind: "button", index: 12 }]);
    expect(gamepad.item3).toEqual([{ kind: "button", index: 15 }]);
    expect(gamepad.inventory).toEqual([{ kind: "button", index: 13 }]);
    expect(gamepad.jump).toEqual([{ kind: "button", index: 0 }]);
    expect(gamepad.skill1).toEqual([{ kind: "button", index: 6 }]);
    expect(gamepad.skill2).toEqual([{ kind: "button", index: 2 }]);
    expect(gamepad.skill3).toEqual([{ kind: "button", index: 3 }]);
    expect(gamepad.skill4).toEqual([{ kind: "button", index: 1 }]);
    expect(gamepad.skill5).toEqual([{ kind: "button", index: 11 }]);
    expect(gamepad.interact).toEqual([{ kind: "button", index: 0 }]);
    expect(gamepad.chat).toEqual([{ kind: "button", index: 7 }]);
    expect(gamepad.settings).toEqual([{ kind: "button", index: 9 }]);
  });

  it("uses remapped movement keys in the prediction input tracker", () => {
    setKeyboardBinding("moveUp", { code: "KeyI" });
    const tracker = trackInput();

    fireEvent.keyDown(window, { code: "KeyI" });
    expect(tracker.current().up).toBe(true);
    fireEvent.keyUp(window, { code: "KeyI" });
    expect(tracker.current().up).toBe(false);
    tracker.stop();
  });

  it("swaps a conflicting key instead of hiding either action", () => {
    setKeyboardBinding("interact", { code: "KeyW" });

    expect(getInputSettings().keyboard.interact).toEqual([{ code: "KeyW" }]);
    expect(getInputSettings().keyboard.moveUp).toEqual([{ code: "KeyE" }]);
  });

  it("rejects arrow remaps for movement while keeping them available to actions", () => {
    expect(setKeyboardBinding("moveLeft", { code: "ArrowLeft" })).toBe(false);
    expect(getInputSettings().keyboard.moveLeft).toEqual([{ code: "KeyA" }]);

    expect(setKeyboardBinding("interact", { code: "ArrowLeft" })).toBe(true);
    expect(getInputSettings().keyboard.interact).toEqual([{ code: "ArrowLeft" }]);
  });

  it("reads analogue controller movement through the same input tracker", () => {
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const gamepad = {
      axes: [0.8, 0],
      buttons,
      connected: true,
      id: "Test controller",
    } as unknown as Gamepad;
    const original = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    const tracker = trackInput();

    try {
      expect(tracker.current().right).toBe(true);
      expect(tracker.current().left).toBe(false);
    } finally {
      tracker.stop();
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: original,
      });
    }
  });

  it("never turns a D-pad quick-item press into hero movement", () => {
    const buttons = Array.from({ length: 19 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    buttons[14] = { pressed: true, touched: true, value: 1 };
    const gamepad = {
      axes: [0, 0],
      buttons,
      connected: true,
      id: "Test controller",
    } as unknown as Gamepad;
    const original = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    const tracker = trackInput();

    try {
      expect(tracker.current()).toMatchObject({
        up: false,
        down: false,
        left: false,
        right: false,
        axisX: 0,
        axisY: 0,
      });
    } finally {
      tracker.stop();
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: original,
      });
    }
  });

  it("never turns keyboard item arrows into hero movement", () => {
    const tracker = trackInput();

    try {
      fireEvent.keyDown(window, { code: "ArrowLeft" });
      fireEvent.keyDown(window, { code: "ArrowUp" });
      expect(tracker.current()).toMatchObject({
        up: false,
        down: false,
        left: false,
        right: false,
      });
    } finally {
      tracker.stop();
    }
  });

  it("dispatches keyboard arrows to the same item shortcuts as the D-pad", () => {
    const useQuickItem = vi.fn();
    const toggleInventory = vi.fn();
    const stop = trackActions({
      attack: vi.fn(),
      interact: vi.fn(),
      usePotion: vi.fn(),
      useQuickItem,
      release: vi.fn(),
      castSkill: vi.fn(),
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleInventory,
      toggleSettings: vi.fn(),
    });

    fireEvent.keyDown(window, { code: "ArrowLeft" });
    fireEvent.keyDown(window, { code: "ArrowUp" });
    fireEvent.keyDown(window, { code: "ArrowRight" });
    fireEvent.keyDown(window, { code: "ArrowDown" });

    expect(useQuickItem.mock.calls).toEqual([[0], [1], [2]]);
    expect(toggleInventory).toHaveBeenCalledOnce();
    stop();
  });

  it("turns the south face button into jump only outside interaction range", () => {
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    buttons[0] = { pressed: true, touched: true, value: 1 };
    const gamepad = {
      axes: [0, 0],
      buttons,
      connected: true,
      id: "Test controller",
    } as unknown as Gamepad;
    const original = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    let interactionAvailable = false;
    const tracker = trackInput(() => interactionAvailable);

    try {
      expect(tracker.current().jump).toBe(true);
      interactionAvailable = true;
      expect(tracker.current().jump).toBe(false);
    } finally {
      tracker.stop();
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: original,
      });
    }
  });

  it("dispatches south-button interaction only when contextual interaction is available", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const gamepad = {
      axes: [0, 0],
      buttons,
      connected: true,
      id: "Test controller",
    } as unknown as Gamepad;
    const original = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    const interact = vi.fn();
    let interactionAvailable = false;
    const stop = trackActions(
      {
        attack: vi.fn(),
        interact,
        usePotion: vi.fn(),
        release: vi.fn(),
        castSkill: vi.fn(),
        focusChat: vi.fn(),
        toggleMap: vi.fn(),
        toggleSettings: vi.fn(),
      },
      () => true,
      () => interactionAvailable,
    );
    const poll = (pressed: boolean) => {
      buttons[0] = { pressed, touched: pressed, value: Number(pressed) };
      const callback = frames.shift();
      if (!callback) throw new Error("Missing gamepad polling frame");
      callback(0);
    };

    try {
      poll(true);
      expect(interact).not.toHaveBeenCalled();
      poll(false);
      interactionAvailable = true;
      poll(true);
      expect(interact).toHaveBeenCalledOnce();
    } finally {
      stop();
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: original,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("dispatches the four default D-pad shortcuts as independent edge-triggered actions", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const buttons = Array.from({ length: 19 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const gamepad = {
      axes: [0, 0],
      buttons,
      connected: true,
      id: "Test controller",
    } as unknown as Gamepad;
    const original = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    const useQuickItem = vi.fn();
    const toggleInventory = vi.fn();
    const stop = trackActions({
      attack: vi.fn(),
      interact: vi.fn(),
      usePotion: vi.fn(),
      useQuickItem,
      release: vi.fn(),
      castSkill: vi.fn(),
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleInventory,
      toggleSettings: vi.fn(),
    });
    const pressAndPoll = (index: number) => {
      for (const button of buttons) {
        button.pressed = false;
        button.touched = false;
        button.value = 0;
      }
      const button = buttons[index];
      if (!button) throw new Error(`Missing test gamepad button ${index}`);
      button.pressed = true;
      button.touched = true;
      button.value = 1;
      const callback = frames.shift();
      if (!callback) throw new Error("Missing gamepad polling frame");
      callback(0);
    };

    try {
      pressAndPoll(14);
      pressAndPoll(12);
      pressAndPoll(15);
      pressAndPoll(13);
      expect(useQuickItem.mock.calls).toEqual([[0], [1], [2]]);
      expect(toggleInventory).toHaveBeenCalledOnce();
    } finally {
      stop();
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: original,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("dispatches remapped shortcuts through the authoritative intent handlers", () => {
    setKeyboardBinding("interact", { code: "KeyK" });
    const interact = vi.fn();
    const stop = trackActions({
      attack: vi.fn(),
      interact,
      usePotion: vi.fn(),
      release: vi.fn(),
      castSkill: vi.fn(),
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleSettings: vi.fn(),
    });

    fireEvent.keyDown(window, { code: "KeyK" });
    expect(interact).toHaveBeenCalledOnce();
    stop();
  });

  it("uses remapped gamepad bindings when querying active control state", () => {
    setGamepadBinding("interact", { kind: "button", index: 2 });
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0.4,
    }));
    const gamepad = {
      buttons,
      axes: [],
      connected: true,
      id: "Test controller",
    } as unknown as Gamepad;
    expect(gamepadControlPressed("interact", gamepad)).toBe(false);
    buttons[2] = { pressed: true, touched: true, value: 0.8 };
    expect(gamepadControlPressed("interact", gamepad)).toBe(true);
  });

  it("rejects D-pad remaps for hero directions while allowing them for actions", () => {
    expect(setGamepadBinding("moveLeft", { kind: "button", index: 14 })).toBe(false);
    expect(getInputSettings().gamepad.moveLeft).toEqual([
      { kind: "axis", index: 0, direction: -1 },
    ]);

    expect(setGamepadBinding("interact", { kind: "button", index: 14 })).toBe(true);
    expect(getInputSettings().gamepad.interact).toEqual([{ kind: "button", index: 14 }]);
  });

  it("keeps jump and interact together when the south button is restored", () => {
    setGamepadBinding("interact", { kind: "button", index: 14 });

    expect(setGamepadBinding("interact", { kind: "button", index: 0 })).toBe(true);
    expect(getInputSettings().gamepad.interact).toEqual([{ kind: "button", index: 0 }]);
    expect(getInputSettings().gamepad.jump).toEqual([{ kind: "button", index: 0 }]);
  });

  it("leaves Tab unbound and never turns it into a combat selection", () => {
    const handlers = {
      attack: vi.fn(),
      interact: vi.fn(),
      usePotion: vi.fn(),
      release: vi.fn(),
      castSkill: vi.fn(),
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleSettings: vi.fn(),
    };
    const stop = trackActions(handlers);

    fireEvent.keyDown(window, { code: "Tab" });

    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
    expect(Object.values(getInputSettings().keyboard).flat()).not.toContainEqual({ code: "Tab" });
    stop();
  });

  it("releases a held skill only when its keyboard key is released", () => {
    const castSkill = vi.fn();
    const releaseSkill = vi.fn();
    const stop = trackActions({
      attack: vi.fn(),
      interact: vi.fn(),
      usePotion: vi.fn(),
      release: vi.fn(),
      castSkill,
      releaseSkill,
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleSettings: vi.fn(),
    });

    fireEvent.keyDown(window, { code: "KeyL" });
    expect(castSkill).toHaveBeenCalledWith(3);
    expect(releaseSkill).not.toHaveBeenCalled();
    fireEvent.keyUp(window, { code: "KeyL" });
    expect(releaseSkill).toHaveBeenCalledWith(3);
    stop();
  });

  it("dispatches the numpad mirror to the same skill slot", () => {
    const castSkill = vi.fn();
    const stop = trackActions({
      attack: vi.fn(),
      interact: vi.fn(),
      usePotion: vi.fn(),
      release: vi.fn(),
      castSkill,
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleSettings: vi.fn(),
    });

    fireEvent.keyDown(window, { code: "Numpad4" });
    expect(castSkill).toHaveBeenCalledWith(5);
    stop();
  });

  it("opens the talent tree with H through the shared shortcut handler", () => {
    const toggleTalents = vi.fn();
    const stop = trackActions({
      attack: vi.fn(),
      interact: vi.fn(),
      usePotion: vi.fn(),
      release: vi.fn(),
      castSkill: vi.fn(),
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleTalents,
      toggleSettings: vi.fn(),
    });

    fireEvent.keyDown(window, { code: "KeyH" });
    expect(toggleTalents).toHaveBeenCalledOnce();
    stop();
  });

  it("toggles the quest journal even while gameplay actions are paused", () => {
    const interact = vi.fn();
    const toggleQuests = vi.fn();
    const stop = trackActions(
      {
        attack: vi.fn(),
        interact,
        usePotion: vi.fn(),
        release: vi.fn(),
        castSkill: vi.fn(),
        focusChat: vi.fn(),
        toggleMap: vi.fn(),
        toggleQuests,
        toggleSettings: vi.fn(),
      },
      () => false,
    );

    fireEvent.keyDown(window, { code: "KeyN" });
    fireEvent.keyDown(window, { code: "KeyE" });
    expect(toggleQuests).toHaveBeenCalledOnce();
    expect(interact).not.toHaveBeenCalled();
    stop();
  });

  it("labels the same standard button for Xbox, PS5, Switch and generic pads", () => {
    const binding = { kind: "button", index: 0 } as const;
    expect(gamepadBindingLabel(binding, "xbox")).toBe("A");
    expect(gamepadBindingLabel(binding, "playstation")).toBe("Cross");
    expect(gamepadBindingLabel(binding, "switch")).toBe("B");
    expect(gamepadBindingLabel(binding, "generic")).toBe("Button 1");
  });
});
