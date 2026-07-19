import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackActions, trackInput } from "../../src/client/game/input.js";
import {
  gamepadBindingLabel,
  getInputSettings,
  resetInputBindings,
  setGamepadBinding,
  setKeyboardBinding,
} from "../../src/client/game/input-settings.js";

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
    expect(getInputSettings().gamepad.talents).toEqual([{ kind: "button", index: 5 }]);
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
    expect(getInputSettings().keyboard.moveUp).toEqual([{ code: "ArrowUp" }]);
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

  it("labels the same standard button for Xbox, PS5, Switch and generic pads", () => {
    const binding = { kind: "button", index: 0 } as const;
    expect(gamepadBindingLabel(binding, "xbox")).toBe("A");
    expect(gamepadBindingLabel(binding, "playstation")).toBe("Cross");
    expect(gamepadBindingLabel(binding, "switch")).toBe("B");
    expect(gamepadBindingLabel(binding, "generic")).toBe("Button 1");
  });
});
