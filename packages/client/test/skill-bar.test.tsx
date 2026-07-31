import { setLocale } from "@lindocara/client/i18n.js";
import type { GameHandle } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { SKILL_PAD_LAYOUT, SkillBar } from "@lindocara/client/ui/hud/SkillBar.js";
import { fireEvent, render, screen } from "@testing-library/react";
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
      attackCooldownUntil: 0,
      skillCooldowns: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it("uses the dedicated basic-attack deadline for slot one", () => {
    const game = gameHandle();
    useUiStore.setState({
      game,
      attackCooldownUntil: performance.now() + 5_000,
    });
    render(<SkillBar />);

    const primary = screen.getByRole("button", { name: "1. Quick Shot" });
    const secondary = screen.getByRole("button", { name: "2. Piercing Arrow" });
    expect(primary).toBeDisabled();
    expect(secondary).toBeEnabled();

    fireEvent.click(primary);
    fireEvent.click(secondary);
    expect(game.castSkill).toHaveBeenCalledOnce();
    expect(game.castSkill).toHaveBeenCalledWith(2);
    expect(primary.querySelector(".skill-slot__icon--quick-shot")).not.toBeNull();
    expect(secondary.querySelector(".skill-slot__icon--piercing-arrow")).not.toBeNull();
    expect(primary.querySelector(".skill-slot__key")).toHaveTextContent("O");
    expect(primary.querySelector(".skill-slot__pad")).toHaveTextContent("Num 5");
    expect(secondary.querySelector(".skill-slot__key")).toHaveTextContent("M");
    expect(secondary.querySelector(".skill-slot__pad")).toHaveTextContent("Num 3");
  });

  it("mirrors the five default numpad positions as a controller-style button cluster", () => {
    useUiStore.setState({ game: gameHandle() });
    render(<SkillBar />);

    expect(SKILL_PAD_LAYOUT).toEqual({
      1: { row: 1, column: 2, numpad: 5 },
      2: { row: 2, column: 3, numpad: 3 },
      3: { row: 2, column: 2, numpad: 2 },
      4: { row: 2, column: 1, numpad: 1 },
      5: { row: 1, column: 1, numpad: 4 },
    });
    for (const [slot, expected] of Object.entries(SKILL_PAD_LAYOUT)) {
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
    expect(screen.getByRole("button", { name: "1. Cleave" })).toBeDisabled();
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
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        serverNow: 1_000,
        rogue: {
          openingUntil: 0,
          stealthUntil: 0,
          smokeProtectionUntil: 0,
          shadowReturnUntil: 3_000,
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
});
