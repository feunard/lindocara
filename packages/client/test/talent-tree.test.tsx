import { setLocale } from "@lindocara/client/i18n.js";
import type { GameHandle } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { TalentTree } from "@lindocara/client/ui/TalentTree.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    returnToTitle: vi.fn(),
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
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
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
    expect(
      [...view.container.querySelectorAll(".talent-branch > h3")].map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(["Iron Guard", "Shield Bash", "Battle Cry", "Whirlwind"]);
    expect(view.container.querySelectorAll(".talent-node__icon")).toHaveLength(28);
    await userEvent.click(screen.getByRole("button", { name: /Fortified guard\./ }));
    expect(game.unlockTalent).toHaveBeenCalledWith("warrior.iron_guard.fortified");
    expect(screen.getByText("Reduce damage taken in Iron Guard by another 10%.")).toBeVisible();
  });

  it("names every final node as an evolved technique", async () => {
    useUiStore.setState({ talentsOpen: true, game: gameHandle() });
    const view = render(<TalentTree />);

    await userEvent.click(screen.getByRole("button", { name: /Steel Tempest\./ }));
    expect(screen.getAllByText("Steel Tempest")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Cyclone\./ })).toBeInTheDocument();
    expect(screen.getAllByText("Final evolution: choose A or B")).toHaveLength(4);
    expect(view.container.querySelectorAll(".talent-node__variant")).toHaveLength(8);
    expect(view.container.querySelectorAll(".talent-node--ultimate")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Counteroffensive\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inexorable Breakthrough\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /War Banner\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Eye of the Storm\./ })).toBeInTheDocument();
    expect(screen.queryByText("V2 form")).not.toBeInTheDocument();
  });

  it("marks the selected final evolution and disables its exclusive alternative", async () => {
    const game = gameHandle();
    const selfState = useUiStore.getState().selfState;
    if (!selfState) throw new Error("self state fixture missing");
    useUiStore.setState({
      talentsOpen: true,
      game,
      selfState: {
        ...selfState,
        talents: {
          selected: [
            "warrior.iron_guard.fortified",
            "warrior.iron_guard.perfect",
            "warrior.iron_guard.readiness",
            "warrior.iron_guard.riposte",
          ],
          pointsSpent: 4,
          pointsAvailable: 6,
        },
      },
    });
    render(<TalentTree />);

    const selected = screen.getByRole("button", { name: /Perfect Riposte\. Evolution A\./ });
    const alternative = screen.getByRole("button", {
      name: /Bulwark\. Evolution B\..*Unavailable.*Perfect Riposte is active/,
    });
    expect(selected).toHaveClass("talent-node--active", "talent-node--variant-a");
    expect(alternative).toHaveClass("talent-node--exclusive-disabled", "talent-node--variant-b");
    expect(alternative).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(alternative);
    expect(game.unlockTalent).not.toHaveBeenCalled();
    expect(screen.getByText("Unavailable — Perfect Riposte is active")).toBeVisible();
  });

  it("exposes the ranger B evolution names without changing legacy A names", () => {
    const self = useUiStore.getState().self;
    if (!self) throw new Error("self fixture missing");
    useUiStore.setState({
      talentsOpen: true,
      game: gameHandle(),
      self: { ...self, class: "ranger" },
    });
    render(<TalentTree />);

    expect(screen.getByRole("button", { name: /Ricochet\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Linebreaker\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focused Volley\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retreat Shot\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Comet Arrow\./ })).toBeInTheDocument();
  });

  it("exposes the priest specializations with their distinct healing roles", () => {
    const self = useUiStore.getState().self;
    if (!self) throw new Error("self fixture missing");
    useUiStore.setState({
      talentsOpen: true,
      game: gameHandle(),
      self: { ...self, class: "priest" },
    });
    render(<TalentTree />);

    expect(screen.getByRole("button", { name: /Leaping Grace\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Emergency Aid\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sacred Passage\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Absolution\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Judgment\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mercy\./ })).toBeInTheDocument();
  });

  it("shows the exact shared support costs in the Peasant talent branches", () => {
    const self = useUiStore.getState().self;
    if (!self) throw new Error("Peasant talent fixture missing");
    useUiStore.setState({
      talentsOpen: true,
      game: gameHandle(),
      self: { ...self, class: "peasant" },
    });
    render(<TalentTree />);

    expect(screen.getByText("Cost: Wood 1 · Stone 1 · Meat 1")).toBeVisible();
    expect(screen.getByText("Cost: Stone 2")).toBeVisible();
    expect(screen.getByRole("button", { name: /Makeshift Camp\..*Cost: Wood 1/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Homemade Bomb\..*Cost: Stone 2/ })).toBeVisible();
  });

  it("renders the unlocked Shadow Step ultimate on the generic fifth row", async () => {
    const game = gameHandle();
    const self = useUiStore.getState().self;
    const selfState = useUiStore.getState().selfState;
    if (!self || !selfState) throw new Error("Rogue talent fixture missing");
    useUiStore.setState({
      talentsOpen: true,
      game,
      self: { ...self, class: "rogue" },
      selfState: {
        ...selfState,
        talents: {
          selected: [
            "rogue.shadow_step.ambush",
            "rogue.shadow_step.reach",
            "rogue.shadow_step.readiness",
            "rogue.shadow_step.executor",
          ],
          pointsSpent: 4,
          pointsAvailable: 6,
        },
      },
    });
    const view = render(<TalentTree />);

    const ultimate = screen.getByRole("button", { name: /Veil Crossing\..*Available/ });
    expect(ultimate).toHaveClass("talent-node--ultimate", "talent-node--available");
    expect(ultimate).toHaveStyle({ gridRow: "5", gridColumn: "2" });
    expect(view.container.querySelectorAll(".talent-node--ultimate")).toHaveLength(4);

    await userEvent.click(ultimate);
    expect(game.unlockTalent).toHaveBeenCalledWith("rogue.shadow_step.veil_crossing");
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
