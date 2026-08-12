import { setLocale } from "@lindocara/client/i18n.js";
import type { GameHandle } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { WorldMap } from "@lindocara/client/ui/WorldMap.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    returnToTitle: vi.fn(),
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
    expect(view.container.querySelector(".world-map-panel")).toHaveAttribute(
      "data-text-surface",
      "information",
    );
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

  // A heightfield is SQUARE and the welcome carries one grid side, not a width/height pair, so the
  // panel can no longer be stretched to a world's aspect — and the old bug these two tests were
  // written against (assuming 16:9 and squashing a 4:3 map into it) is unrepresentable. What is
  // still worth pinning is that the canvas never inherits some other ratio, welcome or no welcome.
  it("keeps the canvas square, because a heightfield's grid is square", () => {
    useUiStore.setState({
      game: mockGame(),
      mapOpen: true,
      worldSize: { size: 64 },
    });

    const view = render(<WorldMap />);
    const canvas = view.container.querySelector(".world-map-canvas");

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect((canvas as HTMLCanvasElement).style.aspectRatio).toBe("1 / 1");
    expect((canvas as HTMLCanvasElement).style.getPropertyValue("--map-ratio")).toBe("1");
  });

  it("stays square before any welcome has set the world size", () => {
    useUiStore.setState({ game: mockGame(), mapOpen: true, worldSize: null });

    const view = render(<WorldMap />);
    const canvas = view.container.querySelector(".world-map-canvas");

    expect((canvas as HTMLCanvasElement).style.aspectRatio).toBe("1 / 1");
    expect((canvas as HTMLCanvasElement).style.getPropertyValue("--map-ratio")).toBe("1");
  });
});
