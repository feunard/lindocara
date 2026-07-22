import { setLocale } from "@lindocara/client/i18n.js";
import type { GameHandle } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { MobileControls, resolveJoystick } from "@lindocara/client/ui/MobileControls.js";
import { NO_INPUT } from "@lindocara/engine/simulation.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function gameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    setMovement: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("mobile controls", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      game: null,
      mapOpen: false,
      settingsOpen: false,
      chatFocusRequest: 0,
      self: {
        nick: "Scout",
        level: 1,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "ranger",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "hunter_bow", offHand: null },
      },
    });
  });

  it("converts the analogue stick into dead-zone, cardinal and diagonal intent", () => {
    expect(resolveJoystick(4, 3, 50).input).toEqual({
      up: false,
      down: false,
      left: false,
      right: false,
    });
    expect(resolveJoystick(50, 0, 50).input).toMatchObject({ right: true, up: false, down: false });
    expect(resolveJoystick(-40, -40, 50).input).toMatchObject({ left: true, up: true });
    expect(Math.hypot(resolveJoystick(200, 0, 50).thumbX, 0)).toBeLessThanOrEqual(29);
  });

  it("exposes touch access to interaction, consumables, map, chat and settings", () => {
    const game = gameHandle();
    useUiStore.setState({ game });
    render(<MobileControls />);

    fireEvent.click(screen.getByRole("button", { name: "Interact" }));
    fireEvent.click(screen.getByRole("button", { name: "Use tonic" }));
    fireEvent.click(screen.getByRole("button", { name: "Open world map" }));
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(game.interact).toHaveBeenCalledOnce();
    expect(game.usePotion).toHaveBeenCalledOnce();
    expect(useUiStore.getState().mapOpen).toBe(true);
    expect(useUiStore.getState().chatFocusRequest).toBe(1);
    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(game.setMovement).toHaveBeenCalledWith({
      up: false,
      down: false,
      left: false,
      right: false,
    });
  });

  it("opens the talent tree from the touch utility cluster", () => {
    const game = gameHandle();
    useUiStore.setState({ game, talentsOpen: false });
    render(<MobileControls />);

    fireEvent.click(screen.getByRole("button", { name: "Open talents" }));

    expect(useUiStore.getState().talentsOpen).toBe(true);
    expect(useUiStore.getState().mapOpen).toBe(false);
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("keeps the first pointer in control until that pointer is released", () => {
    const game = gameHandle();
    const setMovement = game.setMovement;
    if (!setMovement) throw new Error("movement spy missing");
    useUiStore.setState({ game });
    render(<MobileControls />);
    const joystick = screen.getByRole("group", { name: "Move character" });
    Object.defineProperty(joystick, "setPointerCapture", { value: vi.fn() });
    vi.spyOn(joystick, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(joystick, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(game.setMovement).toHaveBeenLastCalledWith(
      expect.objectContaining({ right: true, left: false }),
    );
    const callsAfterPrimary = vi.mocked(setMovement).mock.calls.length;

    fireEvent.pointerDown(joystick, { pointerId: 2, clientX: 0, clientY: 50 });
    fireEvent.pointerUp(joystick, { pointerId: 2 });
    expect(game.setMovement).toHaveBeenCalledTimes(callsAfterPrimary);

    fireEvent.pointerMove(joystick, { pointerId: 1, clientX: 50, clientY: 0 });
    expect(game.setMovement).toHaveBeenLastCalledWith(
      expect.objectContaining({ up: true, down: false }),
    );
    fireEvent.pointerUp(joystick, { pointerId: 1 });
    expect(game.setMovement).toHaveBeenLastCalledWith({ ...NO_INPUT });
  });

  it("stops on active capture loss and on unmount, but ignores another pointer", () => {
    const game = gameHandle();
    const setMovement = game.setMovement;
    if (!setMovement) throw new Error("movement spy missing");
    useUiStore.setState({ game });
    const view = render(<MobileControls />);
    const joystick = screen.getByRole("group", { name: "Move character" });
    Object.defineProperty(joystick, "setPointerCapture", { value: vi.fn() });
    vi.spyOn(joystick, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(joystick, { pointerId: 7, clientX: 100, clientY: 50 });
    const movingCalls = vi.mocked(setMovement).mock.calls.length;
    fireEvent.lostPointerCapture(joystick, { pointerId: 8 });
    expect(game.setMovement).toHaveBeenCalledTimes(movingCalls);
    fireEvent.lostPointerCapture(joystick, { pointerId: 7 });
    expect(game.setMovement).toHaveBeenLastCalledWith({ ...NO_INPUT });

    fireEvent.pointerDown(joystick, { pointerId: 9, clientX: 100, clientY: 50 });
    view.unmount();
    expect(game.setMovement).toHaveBeenLastCalledWith({ ...NO_INPUT });
  });
});
