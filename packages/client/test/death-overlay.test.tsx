import { setLocale } from "@lindocara/client/i18n.js";
import { type GameHandle, useUiStore } from "@lindocara/client/store.js";
import { DeathOverlay } from "@lindocara/client/ui/hud/DeathOverlay.js";
import {
  resetInputBindings,
  setInputMode,
  setKeyboardBinding,
} from "@lindocara/renderer/input-settings.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("DeathOverlay", () => {
  const release = vi.fn();

  beforeEach(() => {
    setLocale("en");
    resetInputBindings();
    setInputMode("keyboard");
    release.mockReset();
    useUiStore.setState({
      self: {
        nick: "Fallen hero",
        level: 1,
        hp: 0,
        maxHp: 100,
        life: "corpse",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      game: { release } as unknown as GameHandle,
      gameMode: "standard",
    });
  });

  afterEach(() => {
    useUiStore.setState({ self: null, game: null, gameMode: "standard" });
  });

  it("follows the remapped binding and the currently used device", () => {
    render(<DeathOverlay />);
    expect(screen.getByRole("button", { name: "Release spirit (R)" })).toBeInTheDocument();

    act(() => {
      setKeyboardBinding("release", { code: "KeyM" });
    });
    expect(screen.getByRole("button", { name: "Release spirit (M)" })).toBeInTheDocument();

    act(() => {
      setInputMode("gamepad");
    });
    const gamepadButton = screen.getByRole("button", { name: "Release spirit (Menu)" });
    fireEvent.click(gamepadButton);
    expect(release).toHaveBeenCalledOnce();
  });
});
