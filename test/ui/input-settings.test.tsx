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
      heal: vi.fn(),
      release: vi.fn(),
      castSkill: vi.fn(),
      switchTarget: vi.fn(),
      focusChat: vi.fn(),
      toggleMap: vi.fn(),
      toggleSettings: vi.fn(),
    });

    fireEvent.keyDown(window, { code: "KeyK" });
    expect(interact).toHaveBeenCalledOnce();
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
