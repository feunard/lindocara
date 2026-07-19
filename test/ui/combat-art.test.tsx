import { describe, expect, it } from "vitest";
import {
  combatActionFrameIndex,
  combatArt,
  monsterCombatArt,
  projectileArt,
} from "../../src/client/game/combat-art.js";
import { ServerClock } from "../../src/client/game/server-clock.js";
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

  it("keeps the basic arrow plain and gives every ranger special shot a distinct treatment", () => {
    expect(projectileArt("arrow", "azure")).toMatchObject({
      source: expect.stringContaining("/archer/Arrow.png"),
      frameWidth: 64,
      frameHeight: 64,
      frames: 1,
    });
    expect(projectileArt("arrow", "azure").trail).toBeUndefined();
    const specialShots = ["piercing_arrow", "volley_arrow", "heartseeker"] as const;
    expect(new Set(specialShots.map((kind) => projectileArt(kind, "azure").tint)).size).toBe(3);
    expect(specialShots.every((kind) => projectileArt(kind, "azure").trail !== undefined)).toBe(
      true,
    );
  });

  it("uses a green Radiant-Bolt-style projectile for ally-only Mend", () => {
    const mend = combatArt("priest", "mend", "violet");
    expect(mend.projectile).toMatchObject({
      source: expect.stringContaining("Hex%20Shaman_Projectile.png"),
      frameWidth: 128,
      frameHeight: 128,
      frames: 3,
      tint: 0x62e68f,
      trail: { color: 0x62e68f },
    });
    expect(mend.impact).toMatchObject({ tint: 0x62e68f });
    expect(mend.fallback).toContain("teinté en vert");
  });

  it("gives charge, dash and blink distinct movement impact colours", () => {
    expect(combatArt("warrior", "shield_bash", "azure").impact?.tint).toBe(0xffd66b);
    expect(combatArt("ranger", "dash", "azure").impact?.tint).toBe(0x6ad9ff);
    expect(combatArt("priest", "blink", "azure").impact?.tint).toBe(0xb48cff);
  });

  it("gives every class ultimate a deliberately amplified visual treatment", () => {
    const whirlwind = combatArt("warrior", "whirlwind", "azure");
    const heartseeker = combatArt("ranger", "heartseeker", "azure");
    const nova = combatArt("priest", "divine_nova", "azure");

    expect(whirlwind.zone).toMatchObject({ tint: 0xffe08a, scale: 1.55 });
    expect(heartseeker.projectile).toMatchObject({
      scale: 1.78,
      trail: { length: 72, width: 7, glowRadius: 16 },
    });
    expect(heartseeker).toMatchObject({
      zone: { tint: 0xff557d, scale: 1.18 },
      impact: { tint: 0xff416c, scale: 1.65 },
    });
    expect(nova).toMatchObject({
      zone: { tint: 0xd8a0ff, scale: 1.45 },
      impact: { tint: 0xd8a0ff, scale: 1.55 },
    });
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
    const clock = new ServerClock();
    clock.sample(10_100, 500);
    expect(
      clock.combatTimeline({ startedAt: 10_000, impactAt: 10_220, recoveryEndsAt: 10_650 }, 999),
    ).toEqual({ startedAt: 400, impactAt: 620, recoveryEndsAt: 1_050 });
  });
});
