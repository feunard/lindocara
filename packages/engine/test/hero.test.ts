import { HERO_CLASSES, isHeroClass, parseCreateHeroInput } from "@lindocara/engine/hero.js";
import { describe, expect, it } from "vitest";

describe("hero classes", () => {
  it("exposes every complete playable class", () => {
    expect([...HERO_CLASSES]).toEqual(["warrior", "ranger", "priest", "rogue"]);
    expect(isHeroClass("priest")).toBe(true);
    expect(isHeroClass("rogue")).toBe(true);
    expect(isHeroClass("necromancer")).toBe(false);
    expect(isHeroClass(3)).toBe(false);
    expect(isHeroClass(null)).toBe(false);
  });
});

describe("parseCreateHeroInput", () => {
  it("accepts a trimmed name and a valid class", () => {
    expect(parseCreateHeroInput({ name: "  Mira ", class: "ranger" })).toEqual({
      name: "Mira",
      class: "ranger",
    });
  });

  it("accepts direct Rogue creation once its authoritative kit is complete", () => {
    expect(parseCreateHeroInput({ name: "Shade", class: "rogue" })).toEqual({
      name: "Shade",
      class: "rogue",
    });
  });

  it("rejects malformed bodies", () => {
    const bad: unknown[] = [
      null,
      "hero",
      {},
      { name: "Mira" },
      { class: "warrior" },
      { name: "", class: "warrior" },
      { name: "   ", class: "warrior" },
      { name: "x".repeat(25), class: "warrior" },
      { name: "Mira", class: "necromancer" },
      { name: 7, class: "warrior" },
    ];
    for (const value of bad) expect(parseCreateHeroInput(value)).toBeNull();
  });
});
