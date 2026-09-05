import { normalizeAppearance } from "@lindocara/engine/character.js";
import { HERO_CLASSES, isHeroClass, parseCreateHeroInput } from "@lindocara/engine/hero.js";
import { describe, expect, it } from "vitest";

describe("hero classes", () => {
  it("exposes every complete playable class", () => {
    expect([...HERO_CLASSES]).toEqual(["warrior", "ranger", "priest", "rogue", "peasant"]);
    expect(isHeroClass("priest")).toBe(true);
    expect(isHeroClass("rogue")).toBe(true);
    expect(isHeroClass("peasant")).toBe(true);
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

  it("accepts direct Peasant creation through the shared class validator", () => {
    expect(parseCreateHeroInput({ name: "Till", class: "peasant" })).toEqual({
      name: "Till",
      class: "peasant",
    });
  });

  it("accepts the temporary Runic Guardian as a Warrior body", () => {
    expect(
      parseCreateHeroInput({
        name: "Aster",
        class: "warrior",
        body: "runic_guardian",
      }),
    ).toEqual({ name: "Aster", class: "warrior", body: "runic_guardian" });
  });

  it("creates V2 Rogues and reads saved V1 bodies as V2", () => {
    expect(
      parseCreateHeroInput({
        name: "Nyx",
        class: "rogue",
        body: "assassin_v2",
      }),
    ).toEqual({ name: "Nyx", class: "rogue", body: "assassin_v2" });
    expect(parseCreateHeroInput({ name: "Nyx", class: "rogue", body: "assassin" })).toBeNull();
    expect(normalizeAppearance({ body: "assassin", primaryColor: "violet" })).toEqual({
      body: "assassin_v2",
      primaryColor: "violet",
    });
  });

  it("accepts the animated Peasant body only for the Peasant class", () => {
    expect(
      parseCreateHeroInput({
        name: "Till",
        class: "peasant",
        body: "peasant",
      }),
    ).toEqual({ name: "Till", class: "peasant", body: "peasant" });
  });

  it("accepts the animated Ranger body only for the Ranger class", () => {
    expect(
      parseCreateHeroInput({
        name: "Fern",
        class: "ranger",
        body: "ranger",
      }),
    ).toEqual({ name: "Fern", class: "ranger", body: "ranger" });
  });

  it("accepts the animated Priest body only for the Priest class", () => {
    expect(
      parseCreateHeroInput({
        name: "Sol",
        class: "priest",
        body: "priest",
      }),
    ).toEqual({ name: "Sol", class: "priest", body: "priest" });
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
      { name: "Mira", class: "warrior", body: "unknown" },
      { name: "Mira", class: "ranger", body: "runic_guardian" },
      { name: "Mira", class: "warrior", body: "assassin" },
      { name: "Mira", class: "rogue", body: "peasant" },
      { name: "Mira", class: "priest", body: "ranger" },
      { name: "Mira", class: "ranger", body: "priest" },
      { name: "Mira", class: "rogue", body: "runic_guardian" },
      { name: 7, class: "warrior" },
    ];
    for (const value of bad) expect(parseCreateHeroInput(value)).toBeNull();
  });
});
