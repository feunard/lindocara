import { describe, expect, it } from "vitest";
import {
  combatActionFrameIndex,
  combatArt,
  localCombatTimeline,
  monsterCombatArt,
  projectileArt,
} from "../../src/client/game/combat-art.js";
import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "../../src/shared/game.js";

describe("Tiny Swords directional combat art", () => {
  it("uses the dedicated warrior, ranger and priest caster sheets", () => {
    expect(combatArt("warrior", "cleave", "azure").caster).toMatchObject({
      source: expect.stringContaining("units/blue/warrior/Warrior_Attack1.png"),
      frameWidth: 192,
      frameHeight: 192,
      frames: 4,
    });
    expect(combatArt("ranger", "quick_shot", "ember").caster.source).toContain(
      "units/red/archer/Archer_Shoot.png",
    );
    expect(combatArt("priest", "mend", "moss").caster.source).toContain(
      "units/yellow/monk/Heal.png",
    );
  });

  it("maps every hero colour to its matching Tiny Swords faction", () => {
    const factions = [
      ["azure", "blue"],
      ["ember", "red"],
      ["moss", "yellow"],
      ["violet", "purple"],
    ] as const;
    for (const [color, folder] of factions) {
      expect(combatArt("warrior", "cleave", color).caster.source).toContain(
        `/units/${folder}/warrior/`,
      );
    }
  });

  it("renders arrows at native size and uses Heal_Effect as the documented healing light", () => {
    expect(projectileArt("arrow", "azure")).toMatchObject({
      source: expect.stringContaining("/archer/Arrow.png"),
      frameWidth: 64,
      frameHeight: 64,
      frames: 1,
    });
    const mend = combatArt("priest", "mend", "violet");
    expect(mend.projectile).toMatchObject({
      source: expect.stringContaining("units/purple/monk/Heal_Effect.png"),
      frameWidth: 192,
      frameHeight: 192,
      frames: 11,
    });
    expect(mend.fallback).toContain("aucun projectile exact");
  });

  it("uses the exact Hex Shaman magic projectile for Radiant Bolt", () => {
    expect(combatArt("priest", "radiant_bolt", "azure")).toMatchObject({
      projectile: {
        source: expect.stringContaining("Hex%20Shaman_Projectile.png"),
        frameWidth: 128,
        frameHeight: 128,
        frames: 3,
      },
      impact: {
        source: expect.stringContaining("Hex%20Shaman_Explosion.png"),
        frames: 9,
      },
    });
  });

  it("maps every species to its dedicated attack strip", () => {
    for (const species of Object.keys(MONSTER_SPECIES_KIND) as MonsterSpecies[]) {
      expect(monsterCombatArt(species).caster.source).toContain("/attack.png");
      expect(monsterCombatArt(species).activeFrame).toBeGreaterThan(0);
    }
  });

  it("pins the declared animation frame to the authoritative impact", () => {
    const timeline = { startedAt: 100, impactAt: 300, recoveryEndsAt: 700 };
    expect(combatActionFrameIndex(8, 3, timeline, 100)).toBe(0);
    expect(combatActionFrameIndex(8, 3, timeline, 299)).toBeLessThan(3);
    expect(combatActionFrameIndex(8, 3, timeline, 300)).toBe(3);
    expect(combatActionFrameIndex(8, 3, timeline, 699)).toBe(7);
  });

  it("keeps authoritative impact and recovery timings under reduced motion", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, media: "(prefers-reduced-motion: reduce)" }),
    });
    expect(
      localCombatTimeline(
        { startedAt: 10_000, impactAt: 10_220, recoveryEndsAt: 10_650 },
        500,
        10_100,
      ),
    ).toEqual({ startedAt: 400, impactAt: 620, recoveryEndsAt: 1_050 });
  });
});
