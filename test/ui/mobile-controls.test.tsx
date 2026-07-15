import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import type { GameHandle } from "../../src/client/store.js";
import { useUiStore } from "../../src/client/store.js";
import { MobileControls, resolveJoystick } from "../../src/client/ui/MobileControls.js";

function gameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    heal: vi.fn(),
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
});
