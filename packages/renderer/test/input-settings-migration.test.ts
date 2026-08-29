import { beforeEach, describe, expect, it, vi } from "vitest";

describe("controller default migration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("moves untouched version 3 bindings onto the action D-pad layout", async () => {
    localStorage.setItem(
      "lindocara.input",
      JSON.stringify({
        version: 3,
        controllerLayout: "xbox",
        keyboard: {},
        gamepad: {
          moveUp: [
            { kind: "axis", index: 1, direction: -1 },
            { kind: "button", index: 12 },
          ],
          moveDown: [
            { kind: "axis", index: 1, direction: 1 },
            { kind: "button", index: 13 },
          ],
          moveLeft: [
            { kind: "axis", index: 0, direction: -1 },
            { kind: "button", index: 14 },
          ],
          moveRight: [
            { kind: "axis", index: 0, direction: 1 },
            { kind: "button", index: 15 },
          ],
          jump: [],
          skill1: [{ kind: "button", index: 0 }],
          skill4: [{ kind: "button", index: 4 }],
          skill5: [{ kind: "button", index: 7 }],
          interact: [{ kind: "button", index: 1 }],
          item1: [{ kind: "button", index: 6 }],
          item2: [{ kind: "button", index: 10 }],
          item3: [{ kind: "button", index: 11 }],
          inventory: [{ kind: "button", index: 16 }],
          chat: [{ kind: "button", index: 11 }],
        },
      }),
    );

    const { getInputSettings } = await import("@lindocara/renderer/input-settings.js");
    const { gamepad } = getInputSettings();

    expect(gamepad.moveUp).toEqual([{ kind: "axis", index: 1, direction: -1 }]);
    expect(gamepad.moveDown).toEqual([{ kind: "axis", index: 1, direction: 1 }]);
    expect(gamepad.moveLeft).toEqual([{ kind: "axis", index: 0, direction: -1 }]);
    expect(gamepad.moveRight).toEqual([{ kind: "axis", index: 0, direction: 1 }]);
    expect(gamepad.jump).toEqual([{ kind: "button", index: 0 }]);
    expect(gamepad.skill1).toEqual([{ kind: "button", index: 7 }]);
    expect(gamepad.skill4).toEqual([{ kind: "button", index: 1 }]);
    expect(gamepad.skill5).toEqual([{ kind: "button", index: 11 }]);
    expect(gamepad.interact).toEqual([{ kind: "button", index: 0 }]);
    expect(gamepad.item1).toEqual([{ kind: "button", index: 14 }]);
    expect(gamepad.item2).toEqual([{ kind: "button", index: 12 }]);
    expect(gamepad.item3).toEqual([{ kind: "button", index: 15 }]);
    expect(gamepad.inventory).toEqual([{ kind: "button", index: 13 }]);
    expect(gamepad.chat).toEqual([{ kind: "button", index: 10 }]);
  });

  it("moves untouched version 4 arrows to items and shares interaction with jump", async () => {
    localStorage.setItem(
      "lindocara.input",
      JSON.stringify({
        version: 4,
        controllerLayout: "xbox",
        keyboard: {
          moveUp: [{ code: "KeyW" }, { code: "ArrowUp" }],
          moveDown: [{ code: "KeyS" }, { code: "ArrowDown" }],
          moveLeft: [{ code: "KeyA" }, { code: "ArrowLeft" }],
          moveRight: [{ code: "KeyD" }, { code: "ArrowRight" }],
          item1: [{ code: "Digit1" }],
          item2: [{ code: "Digit2" }],
          item3: [{ code: "Digit3" }],
          inventory: [{ code: "KeyB" }],
        },
        gamepad: {
          jump: [{ kind: "button", index: 0 }],
          interact: [{ kind: "button", index: 4 }],
        },
      }),
    );

    const { getInputSettings } = await import("@lindocara/renderer/input-settings.js");
    const { keyboard, gamepad } = getInputSettings();

    expect(keyboard.moveUp).toEqual([{ code: "KeyW" }]);
    expect(keyboard.moveDown).toEqual([{ code: "KeyS" }]);
    expect(keyboard.moveLeft).toEqual([{ code: "KeyA" }]);
    expect(keyboard.moveRight).toEqual([{ code: "KeyD" }]);
    expect(keyboard.item1).toEqual([{ code: "Digit1" }, { code: "ArrowLeft" }]);
    expect(keyboard.item2).toEqual([{ code: "Digit2" }, { code: "ArrowUp" }]);
    expect(keyboard.item3).toEqual([{ code: "Digit3" }, { code: "ArrowRight" }]);
    expect(keyboard.inventory).toEqual([{ code: "KeyB" }, { code: "ArrowDown" }]);
    expect(gamepad.jump).toEqual([{ kind: "button", index: 0 }]);
    expect(gamepad.interact).toEqual([{ kind: "button", index: 0 }]);
  });
});
