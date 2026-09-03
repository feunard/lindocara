import { setLocale } from "@lindocara/client/i18n.js";
import { classMovementPercent, HeroCreate } from "@lindocara/client/ui/HeroCreate.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("hero creation class cards", () => {
  beforeEach(() => setLocale("en"));

  it("exposes all classes with their dedicated catalogued portraits", () => {
    render(<HeroCreate adventureId="adventure" onBack={vi.fn()} />);

    const classCards = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("class-card"));
    expect(classCards).toHaveLength(7);

    const rogue = screen.getByRole("button", {
      name: /Rogue\s*Opens from shadow, bursts, then escapes\./,
    });
    const portrait = rogue.querySelector<HTMLElement>(
      '[data-hero-class="rogue"] .class-card__portrait-sprite',
    );
    expect(portrait).not.toBeNull();
    expect(portrait?.style.backgroundImage).toContain("Thief_Idle");
    expect(rogue).toBeEnabled();

    const peasant = screen.getByRole("button", {
      name: /Peasant\s*Tinkers, feeds, and causes cheerful trouble\./,
    });
    const peasantPortrait = peasant.querySelector<HTMLElement>(
      '[data-hero-class="peasant"] .class-card__portrait-sprite',
    );
    expect(peasantPortrait?.style.backgroundImage).toContain("Pawn_Idle");
    expect(peasant).toBeEnabled();

    const bonus = screen.getByRole("button", {
      name: /Runic Guardian · Prototype\s*Eight-direction 3D bake, with the Warrior's rules\./,
    });
    const bonusPortrait = bonus.querySelector<HTMLElement>(
      '[data-hero-body="runic_guardian"] .class-card__portrait-sprite',
    );
    expect(bonusPortrait?.style.backgroundImage).toContain("runic-guardian");
    expect(bonus).toBeEnabled();

    const assassin = screen.getByRole("button", {
      name: /Assassin · Prototype\s*Ten-phase, eight-direction Rogue animation with a unique move for every skill\./,
    });
    const assassinPortrait = assassin.querySelector<HTMLElement>(
      '[data-hero-body="assassin"] .class-card__portrait-sprite',
    );
    expect(assassinPortrait?.style.backgroundImage).toContain("assassin");
    expect(assassin).toBeEnabled();
  });

  it("re-rolls the suggested name to a different one on every dice click", () => {
    render(<HeroCreate adventureId="adventure" onBack={vi.fn()} />);

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    const dice = screen.getByRole("button", { name: "Random name" });
    expect(input.value).not.toBe("");

    // Never the name already on screen: a re-roll that re-suggests itself reads as a dead button.
    for (let i = 0; i < 12; i++) {
      const before = input.value;
      fireEvent.click(dice);
      expect(input.value).not.toBe(before);
    }
  });

  it("shows each class movement speed relative to the Warrior", () => {
    render(<HeroCreate adventureId="adventure" onBack={vi.fn()} />);
    expect(classMovementPercent("warrior")).toBe(100);
    expect(classMovementPercent("ranger")).toBe(110);
    expect(classMovementPercent("priest")).toBe(90);
    expect(classMovementPercent("rogue")).toBe(120);
    expect(classMovementPercent("peasant")).toBe(95);
    for (const percent of [100, 110, 90, 120, 95]) {
      const labels = screen.getAllByText(`Speed · ${percent}%`);
      expect(labels).toHaveLength(percent === 100 || percent === 120 ? 2 : 1);
      expect(labels[0]).toBeVisible();
    }
  });
});
