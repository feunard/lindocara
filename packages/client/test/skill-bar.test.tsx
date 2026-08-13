import { setLocale } from "@lindocara/client/i18n.js";
import type { GameHandle } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { PeasantResourcesPanel } from "@lindocara/client/ui/hud/PeasantResourcesPanel.js";
import { SKILL_PAD_LAYOUT, SkillBar } from "@lindocara/client/ui/hud/SkillBar.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function gameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    releaseSkill: vi.fn(),
    setMovement: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    returnToTitle: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("skill bar cooldowns", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      game: null,
      self: {
        nick: "Scout",
        level: 10,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "ranger",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "hunter_bow", offHand: null },
      },
      selfState: null,
      mapHeroSettings: null,
      attackCooldownUntil: 0,
      skillCooldowns: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it("hides the primary attack while keeping the other abilities actionable", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
      attackCooldownUntil: performance.now() + 5_000,
    });
    render(<SkillBar />);

    const secondary = screen.getByRole("button", { name: "2. Piercing Arrow" });
    expect(screen.queryByRole("button", { name: "1. Quick Shot" })).not.toBeInTheDocument();
    expect(secondary).toBeEnabled();

    fireEvent.click(secondary);
    expect(game.castSkill).toHaveBeenCalledOnce();
    expect(game.castSkill).toHaveBeenCalledWith(2);
    expect(secondary.querySelector(".skill-slot__icon--piercing-arrow")).not.toBeNull();
    expect(secondary.querySelector(".skill-slot__key")).toHaveTextContent("M");
    expect(secondary.querySelector(".skill-slot__key")).not.toHaveTextContent("Num 3");
    expect(secondary.querySelector(".skill-slot__pad")).not.toBeInTheDocument();
  });

  it("updates disabled and re-enabled abilities immediately when map settings change", () => {
    const game = gameHandle();
    const mapASettings = defaultMapHeroSettings();
    mapASettings.classes.ranger.disabledSkills = [2];
    useUiStore.setState({ game, mapHeroSettings: mapASettings });
    render(<SkillBar />);

    const piercingArrow = screen.getByRole("button", { name: "2. Piercing Arrow" });
    const volley = screen.getByRole("button", { name: "3. Volley" });
    expect(piercingArrow).toBeDisabled();
    expect(piercingArrow).toHaveAttribute("title", "Piercing Arrow — Disabled on this map");
    expect(piercingArrow.querySelector(".skill-slot__lock")).toHaveTextContent("×");
    fireEvent.click(piercingArrow);
    expect(game.castSkill).not.toHaveBeenCalled();

    const mapBSettings = defaultMapHeroSettings();
    mapBSettings.classes.ranger.disabledSkills = [3];
    act(() => useUiStore.getState().setMapHeroSettings(mapBSettings));

    expect(piercingArrow).toBeEnabled();
    expect(volley).toBeDisabled();
    fireEvent.click(piercingArrow);
    fireEvent.click(volley);
    expect(game.castSkill).toHaveBeenCalledOnce();
    expect(game.castSkill).toHaveBeenCalledWith(2);
  });

  it("places the four visible abilities in an Xbox face-button diamond", () => {
    useUiStore.setState({ game: gameHandle() });
    render(<SkillBar />);

    expect(SKILL_PAD_LAYOUT).toEqual({
      1: { row: 2, column: 2, numpad: 5 },
      2: { row: 2, column: 3, numpad: 3 },
      3: { row: 3, column: 2, numpad: 2 },
      4: { row: 2, column: 1, numpad: 1 },
      5: { row: 1, column: 2, numpad: 4 },
    });
    expect(screen.queryByRole("button", { name: /^1\./ })).not.toBeInTheDocument();
    for (const slot of [2, 3, 4, 5] as const) {
      const expected = SKILL_PAD_LAYOUT[slot];
      const button = screen.getByRole("button", { name: new RegExp(`^${slot}\\.`) });
      expect(button).toHaveStyle({
        gridRow: String(expected.row),
        gridColumn: String(expected.column),
      });
      expect(button).toHaveAttribute("data-numpad", String(expected.numpad));
    }
  });

  it("keeps Iron Guard clickable while active and greys every other warrior action", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
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
        guarding: true,
      },
    });
    render(<SkillBar />);

    const guard = screen.getByRole("button", { name: "2. Iron Guard" });
    expect(guard).toBeEnabled();
    expect(guard).toHaveAttribute("aria-pressed", "true");
    expect(guard).toHaveClass("active");
    expect(screen.queryByRole("button", { name: "1. Cleave" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3. Shield Bash" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "4. Battle Cry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "5. Whirlwind" })).toBeDisabled();

    fireEvent.click(guard);
    expect(game.castSkill).toHaveBeenCalledWith(2);
  });

  it("holds Lumen Step from pointer down until pointer up", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
      self: {
        nick: "Cloudstep",
        level: 10,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "priest",
        appearance: { body: "wayfarer", primaryColor: "violet" },
        equipment: { mainHand: "heartwood_staff", offHand: null },
      },
    });
    render(<SkillBar />);

    const lumen = screen.getByRole("button", { name: "3. Lumen Step" });
    fireEvent.pointerDown(lumen, { pointerId: 7 });
    expect(game.castSkill).toHaveBeenCalledWith(3);
    expect(game.releaseSkill).not.toHaveBeenCalled();
    fireEvent.pointerUp(lumen, { pointerId: 7 });
    expect(game.releaseSkill).toHaveBeenCalledWith(3);
  });

  it("shows the exact active evolution name, description, and A/B marker", () => {
    useUiStore.setState({
      game: gameHandle(),
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        talents: {
          selected: ["ranger.piercing_arrow.line_piercer"],
          pointsSpent: 1,
          pointsAvailable: 9,
        },
      },
    });
    render(<SkillBar />);

    const evolved = screen.getByRole("button", {
      name: "2. Linebreaker. Evolution B",
    });
    expect(evolved).toHaveClass("evolved", "evolved--b");
    expect(evolved).toHaveAttribute("data-evolution-variant", "b");
    expect(evolved.querySelector(".skill-slot__variant")).toHaveTextContent("B");
    expect(evolved.querySelector(".skill-slot__name")).toHaveTextContent("Linebreaker");
    expect(evolved.querySelector('[role="tooltip"]')).toHaveTextContent(
      "Each distinct enemy pierced adds 15% damage to the next, capped at 60%.",
    );
  });

  it("keeps Shadow Return actionable inside its authoritative window despite the base cooldown", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
      self: {
        nick: "Shade",
        level: 10,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "rogue",
        appearance: { body: "wayfarer", primaryColor: "violet" },
        equipment: { mainHand: "shadow_daggers", offHand: null },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        serverNow: 1_000,
        rogue: {
          openingUntil: 0,
          stealthUntil: 0,
          smokeProtectionUntil: 0,
          shadowReturnUntil: 3_000,
          danceMarksUntil: 0,
        },
        talents: {
          selected: ["rogue.shadow_step.shadow_return"],
          pointsSpent: 1,
          pointsAvailable: 9,
        },
      },
      skillCooldowns: {
        1: 0,
        2: performance.now() + 4_500,
        3: 0,
        4: 0,
        5: 0,
      },
    });
    render(<SkillBar />);

    const shadowReturn = screen.getByRole("button", {
      name: "2. Shadow Return. Evolution B. Return ready",
    });
    expect(shadowReturn).toBeEnabled();
    expect(shadowReturn).toHaveClass("return-ready", "evolved--b");
    expect(shadowReturn).toHaveAttribute("data-shadow-return-ready", "true");
    expect(shadowReturn.querySelector(".skill-slot__return")).toHaveTextContent("Return ready");

    fireEvent.click(shadowReturn);
    expect(game.castSkill).toHaveBeenCalledWith(2);
  });

  it("keeps the Afterimage swap actionable during Dash cooldown", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
      self: {
        nick: "Echo",
        level: 10,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "ranger",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "hunter_bow", offHand: null },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        serverNow: 1_000,
        ranger: { afterimageUntil: 3_000 },
        talents: {
          selected: ["ranger.dash.mastery", "ranger.dash.afterimage"],
          pointsSpent: 2,
          pointsAvailable: 8,
        },
      },
      skillCooldowns: { 1: 0, 2: 0, 3: 0, 4: performance.now() + 5_000, 5: 0 },
    });
    render(<SkillBar />);

    const swap = screen.getByRole("button", {
      name: "4. Windstep. Evolution A. Swap ready",
    });
    expect(swap).toBeEnabled();
    expect(swap).toHaveAttribute("data-afterimage-ready", "true");
    fireEvent.click(swap);
    expect(game.castSkill).toHaveBeenCalledWith(4);
  });

  it("treats Sworn Prey as a held skill and releases it on key-style activation", () => {
    const game = gameHandle();
    const self = useUiStore.getState().self;
    if (!self) throw new Error("skill fixture missing");
    useUiStore.setState({
      game,
      self: { ...self, class: "ranger", equipment: { mainHand: "hunter_bow", offHand: null } },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        talents: {
          selected: ["ranger.heartseeker.execute", "ranger.heartseeker.sworn_prey"],
          pointsSpent: 2,
          pointsAvailable: 8,
        },
      },
    });
    render(<SkillBar />);

    const heartseeker = screen.getByRole("button", { name: /5\. Heartstopper/ });
    fireEvent.click(heartseeker, { detail: 0 });
    expect(game.castSkill).toHaveBeenCalledWith(5);
    expect(game.releaseSkill).toHaveBeenCalledWith(5);
  });

  it("shows authoritative shared materials and updates support affordability immediately", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
      self: {
        nick: "Fieldhand",
        level: 10,
        hp: 72,
        maxHp: 72,
        life: "alive",
        corpseDistance: null,
        class: "peasant",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "worn_toolkit", offHand: null },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        materials: { wood: 0, stone: 1, iron: 0, meat: 1 },
      },
    });
    render(
      <>
        <PeasantResourcesPanel />
        <SkillBar />
      </>,
    );

    expect(screen.getByRole("status", { name: "Peasant resources" })).toBeInTheDocument();
    expect(screen.getByLabelText("Wood: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Stone: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Iron: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Meat: 1")).toBeInTheDocument();

    const camp = screen.getByRole("button", { name: /^4\. Makeshift Camp/ });
    const bomb = screen.getByRole("button", { name: /^5\. Homemade Bomb/ });
    expect(camp).toBeEnabled();
    expect(camp).toHaveClass("unaffordable");
    expect(camp).toHaveAttribute("data-material-affordable", "false");
    expect(camp).toHaveAccessibleName(/Cost: Wood 1 · Stone 1 · Meat 1/);
    expect(camp).toHaveAccessibleName(/Insufficient shared materials/);
    expect(camp.querySelector('[data-material-cost="wood"]')).toHaveTextContent("W1");
    expect(bomb).toBeEnabled();
    expect(bomb).toHaveAttribute("data-material-affordable", "false");
    expect(bomb.querySelector('[data-material-cost="iron"]')).toHaveTextContent("I1");
    expect(camp.querySelector('[role="tooltip"]')).toHaveTextContent(
      "Cost: Wood 1 · Stone 1 · Meat 1",
    );

    fireEvent.click(camp);
    expect(game.castSkill).toHaveBeenCalledWith(4);

    act(() => {
      useUiStore.getState().setSelfState({
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        materials: { wood: 1, stone: 1, iron: 1, meat: 1 },
      });
    });

    expect(screen.getByLabelText("Wood: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Iron: 1")).toBeInTheDocument();
    expect(camp).not.toHaveClass("unaffordable");
    expect(camp).toHaveAttribute("data-material-affordable", "true");
    expect(bomb).not.toHaveClass("unaffordable");
    expect(bomb).toHaveAttribute("data-material-affordable", "true");
    fireEvent.click(bomb);
    expect(game.castSkill).toHaveBeenCalledWith(5);
  });

  it("uses the same talented support costs for HUD affordability as the server plans", () => {
    useUiStore.setState({
      game: gameHandle(),
      self: {
        nick: "Quartermaster",
        level: 20,
        hp: 72,
        maxHp: 72,
        life: "alive",
        corpseDistance: null,
        class: "peasant",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "worn_toolkit", offHand: null },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        materials: { wood: 2, stone: 1, iron: 1, meat: 1 },
        talents: {
          selected: [
            "peasant.makeshift_camp.complete_encampment",
            "peasant.homemade_bomb.powder_keg",
          ],
          pointsSpent: 2,
          pointsAvailable: 18,
        },
      },
    });
    render(<SkillBar />);

    const camp = screen.getByRole("button", { name: /^4\./ });
    const bomb = screen.getByRole("button", { name: /^5\./ });
    expect(camp).toHaveAttribute("data-material-affordable", "true");
    expect(camp.querySelector('[data-material-cost="wood"]')).toHaveTextContent("W1");
    expect(camp.querySelector('[data-material-cost="stone"]')).toHaveTextContent("S1");
    expect(camp.querySelector('[data-material-cost="meat"]')).toHaveTextContent("M1");
    expect(bomb).toHaveAttribute("data-material-affordable", "true");
    expect(bomb.querySelector('[data-material-cost="iron"]')).toHaveTextContent("I1");
    expect(bomb.querySelector('[data-material-cost="stone"]')).toHaveTextContent("S1");
  });

  it("clears the shared material stock with the authoritative self state", () => {
    useUiStore.setState({
      game: gameHandle(),
      self: {
        nick: "Fieldhand",
        level: 10,
        hp: 72,
        maxHp: 72,
        life: "alive",
        corpseDistance: null,
        class: "peasant",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "worn_toolkit", offHand: null },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        materials: { wood: 8, stone: 6, iron: 4, meat: 3 },
      },
    });
    render(
      <>
        <PeasantResourcesPanel />
        <SkillBar />
      </>,
    );

    expect(screen.getByRole("status", { name: "Peasant resources" })).toBeInTheDocument();
    act(() => useUiStore.getState().clearedGameSession());
    expect(screen.queryByRole("status", { name: "Peasant resources" })).not.toBeInTheDocument();
  });
});
