import { HERO_CLASSES, isHeroClass, parseCreateHeroInput } from "@lindocara/engine/hero.js";
import { describe, expect, it } from "vitest";

describe("hero classes", () => {
  it("are exactly the three player classes", () => {
    expect([...HERO_CLASSES]).toEqual(["warrior", "ranger", "priest"]);
    expect(isHeroClass("priest")).toBe(true);
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
