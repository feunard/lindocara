import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import type { GameHandle } from "../../src/client/store.js";
import { useUiStore } from "../../src/client/store.js";
import { WorldMap } from "../../src/client/ui/WorldMap.js";

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

describe("WorldMap", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ mapOpen: false, game: null, zoneNameKey: null, worldSize: null });
  });

  it("renders nothing at all when mapOpen is false", () => {
    useUiStore.setState({ game: mockGame() });

    const { container } = render(<WorldMap />);

    expect(container).toBeEmptyDOMElement();
  });

  it("hands its canvas to game.attachWorldMap once open", () => {
    const game = mockGame();
    useUiStore.setState({ game, mapOpen: true });

    const view = render(<WorldMap />);
    const canvas = view.container.querySelector(".world-map-canvas");

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(game.attachWorldMap).toHaveBeenCalledTimes(1);
    expect(game.attachWorldMap).toHaveBeenCalledWith(canvas);
  });

  it("detaches with null on unmount, so a closed map keeps no live surface", () => {
    const game = mockGame();
    useUiStore.setState({ game, mapOpen: true });

    const view = render(<WorldMap />);
    expect(game.attachWorldMap).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(game.attachWorldMap).toHaveBeenCalledTimes(2);
    expect(game.attachWorldMap).toHaveBeenLastCalledWith(null);
  });

  it("detaches with null when it closes without unmounting", async () => {
    const game = mockGame();
    useUiStore.setState({ game, mapOpen: true });

    render(<WorldMap />);
    expect(game.attachWorldMap).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useUiStore.getState().mapOpen).toBe(false);
    expect(game.attachWorldMap).toHaveBeenCalledTimes(2);
    expect(game.attachWorldMap).toHaveBeenLastCalledWith(null);
  });

  it("closes via its own close button", async () => {
    useUiStore.setState({ game: mockGame(), mapOpen: true });
    render(<WorldMap />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useUiStore.getState().mapOpen).toBe(false);
  });

  it("titles itself after the current zone once the welcome has landed", () => {
    useUiStore.setState({
      game: mockGame(),
      mapOpen: true,
      zoneNameKey: "zone.mmo_test_zone.name",
    });

    render(<WorldMap />);

    expect(screen.getByRole("heading")).toHaveTextContent("Crossing Annex");
  });

  it("falls back to the generic title before any welcome has set the zone", () => {
    useUiStore.setState({ game: mockGame(), mapOpen: true, zoneNameKey: null });

    render(<WorldMap />);

    expect(screen.getByRole("heading")).toHaveTextContent("Verdant Reach");
  });

  it("sizes the canvas to Verdant Reach's 16:9 world", () => {
    useUiStore.setState({
      game: mockGame(),
      mapOpen: true,
      worldSize: { width: 4800, height: 2700 },
    });

    const view = render(<WorldMap />);
    const canvas = view.container.querySelector(".world-map-canvas");

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect((canvas as HTMLCanvasElement).style.aspectRatio).toBe("4800 / 2700");
    expect((canvas as HTMLCanvasElement).style.getPropertyValue("--map-ratio")).toBe(
      String(4800 / 2700),
    );
  });

  it("sizes the canvas to mmo-test-zone's 4:3 world instead of assuming 16:9", () => {
    useUiStore.setState({
      game: mockGame(),
      mapOpen: true,
      worldSize: { width: 640, height: 480 },
    });

    const view = render(<WorldMap />);
    const canvas = view.container.querySelector(".world-map-canvas");

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect((canvas as HTMLCanvasElement).style.aspectRatio).toBe("640 / 480");
    expect((canvas as HTMLCanvasElement).style.getPropertyValue("--map-ratio")).toBe(
      String(640 / 480),
    );
  });

  it("falls back to Verdant Reach's aspect before any welcome has set the world size", () => {
    useUiStore.setState({ game: mockGame(), mapOpen: true, worldSize: null });

    const view = render(<WorldMap />);
    const canvas = view.container.querySelector(".world-map-canvas");

    expect((canvas as HTMLCanvasElement).style.aspectRatio).toBe("4800 / 2700");
    expect((canvas as HTMLCanvasElement).style.getPropertyValue("--map-ratio")).toBe(
      String(4800 / 2700),
    );
  });
});
