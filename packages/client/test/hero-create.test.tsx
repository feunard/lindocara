import { setLocale } from "@lindocara/client/i18n.js";
import { HeroCreate } from "@lindocara/client/ui/HeroCreate.js";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("hero creation class cards", () => {
  beforeEach(() => setLocale("en"));

  it("exposes the Rogue with the catalogued hooded Thief portrait", () => {
    render(<HeroCreate adventureId="adventure" onBack={vi.fn()} />);

    const classCards = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("class-card"));
    expect(classCards).toHaveLength(4);

    const rogue = screen.getByRole("button", {
      name: /Rogue\s*Opens from shadow, bursts, then escapes\./,
    });
    const portrait = rogue.querySelector<HTMLElement>(
      '[data-hero-class="rogue"] .class-card__portrait-sprite',
    );
    expect(portrait).not.toBeNull();
    expect(portrait?.style.backgroundImage).toContain("Thief_Idle");
    expect(rogue).toBeEnabled();
  });
});
