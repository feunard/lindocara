import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import type { GameHandle } from "../../src/client/store.js";
import { useUiStore } from "../../src/client/store.js";
import { TalentTree } from "../../src/client/ui/TalentTree.js";

function gameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    unlockTalent: vi.fn(),
    resetTalents: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("TalentTree", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      talentsOpen: false,
      game: null,
      self: {
        nick: "Bulwark",
        level: 10,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        talents: { selected: [], pointsSpent: 0, pointsAvailable: 10 },
      },
    });
  });

  it("shows free skill roots and sends only a talent id when a node is chosen", async () => {
    const game = gameHandle();
    useUiStore.setState({ talentsOpen: true, game });
    const view = render(<TalentTree />);

    expect(screen.getByText("10 of 10 points available")).toBeInTheDocument();
    expect(screen.getByText("Evolutions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Iron Guard\./ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.container.querySelectorAll(".talent-node__icon")).toHaveLength(20);
    await userEvent.click(screen.getByRole("button", { name: /Fortified guard\./ }));
    expect(game.unlockTalent).toHaveBeenCalledWith("warrior.iron_guard.fortified");
    expect(screen.getByText("Reduce damage taken in Iron Guard by another 10%.")).toBeVisible();
  });

  it("names every final node as an evolved technique", async () => {
    useUiStore.setState({ talentsOpen: true, game: gameHandle() });
    render(<TalentTree />);

    await userEvent.click(screen.getByRole("button", { name: /Steel Tempest\./ }));
    expect(screen.getAllByText("Steel Tempest")).toHaveLength(2);
    expect(screen.queryByText("V2 form")).not.toBeInTheDocument();
  });

  it("requires explicit confirmation before the free reset is sent", async () => {
    const game = gameHandle();
    const selfState = useUiStore.getState().selfState;
    if (!selfState) throw new Error("self state fixture missing");
    useUiStore.setState({
      talentsOpen: true,
      game,
      selfState: {
        ...selfState,
        talents: {
          selected: ["warrior.iron_guard.fortified"],
          pointsSpent: 1,
          pointsAvailable: 9,
        },
      },
    });
    render(<TalentTree />);

    await userEvent.click(screen.getByRole("button", { name: "Reset talents" }));
    expect(game.resetTalents).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect(game.resetTalents).toHaveBeenCalledOnce();
  });
});
