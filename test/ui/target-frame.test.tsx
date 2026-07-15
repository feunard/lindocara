import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../src/client/store.js";
import { TargetFrame } from "../../src/client/ui/hud/TargetFrame.js";

afterEach(() => {
  useUiStore.setState({ combatTarget: null, game: null });
});

describe("TargetFrame", () => {
  it("shows the selected unit health and lets the player clear it", () => {
    const clearTarget = vi.fn();
    useUiStore.setState({
      combatTarget: {
        id: "road-goblin-scout",
        kind: "monster",
        name: "Gobelin de la Route",
        hp: 24,
        maxHp: 40,
        portrait: { source: "/enemy.png", frames: 1, kind: "enemy" },
      },
      game: {
        attack: () => {},
        interact: () => {},
        usePotion: () => {},
        heal: () => {},
        release: () => {},
        castSkill: () => {},
        clearTarget,
        sendChat: () => {},
        switchCharacter: () => {},
        logout: () => {},
        attachMinimap: () => {},
        attachWorldMap: () => {},
      },
    });

    render(<TargetFrame />);
    expect(screen.getByText("Gobelin de la Route")).toBeInTheDocument();
    expect(document.querySelector('[data-portrait-kind="enemy"]')).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "24");
    fireEvent.click(screen.getByRole("button", { name: /cible|target/i }));
    expect(clearTarget).toHaveBeenCalledOnce();
  });
});
