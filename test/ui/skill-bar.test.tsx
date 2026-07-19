import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import type { GameHandle } from "../../src/client/store.js";
import { useUiStore } from "../../src/client/store.js";
import { SkillBar } from "../../src/client/ui/hud/SkillBar.js";

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
    expect(primary.querySelector(".skill-slot__key")).toHaveTextContent("O / Num 5");
    expect(secondary.querySelector(".skill-slot__key")).toHaveTextContent("M / Num 3");
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
});
