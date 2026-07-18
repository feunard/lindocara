import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import type { GameHandle } from "../../src/client/store.js";
import { useUiStore } from "../../src/client/store.js";
import { Minimap } from "../../src/client/ui/hud/Minimap.js";

function mockGame(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("Minimap", () => {
  beforeEach(() => setLocale("en"));

  it("hands its own canvas to game.attachMinimap on mount", () => {
    const game = mockGame();
    useUiStore.setState({ game });

    const view = render(<Minimap />);
    const canvas = view.container.querySelector(".minimap-canvas");

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(game.attachMinimap).toHaveBeenCalledTimes(1);
    expect(game.attachMinimap).toHaveBeenCalledWith(canvas);
  });

  it("detaches with null on unmount, so a dead surface cannot retain a live DOM node", () => {
    const game = mockGame();
    useUiStore.setState({ game });

    const view = render(<Minimap />);
    expect(game.attachMinimap).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(game.attachMinimap).toHaveBeenCalledTimes(2);
    expect(game.attachMinimap).toHaveBeenLastCalledWith(null);
  });

  it("renders without a game handle (store nulls it on disconnect)", () => {
    useUiStore.setState({ game: null });

    const view = render(<Minimap />);
    const canvas = view.container.querySelector(".minimap-canvas");

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    // Nothing to attach to, and nothing throws either.
    expect(() => view.unmount()).not.toThrow();
  });
});
