import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "@lindocara/engine/game.js";
import {
  allCombatSheets,
  combatActionFrameIndex,
  combatArt,
  monsterCombatArt,
  multiImpactActionFrameIndex,
  projectileArt,
  teleportEffectArt,
} from "@lindocara/renderer/combat-art.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";
import {
  allUnitSheets,
  skillIconArt,
  TINY_SWORDS_ROGUE_SHEETS,
  unitSheet,
} from "@lindocara/renderer/tiny-swords-art.js";
import { describe, expect, it } from "vitest";

describe("Tiny Swords directional combat art", () => {
  it("uses dedicated caster sheets for all four playable classes", () => {
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
    expect(combatArt("rogue", "dual_slash", "violet").caster).toMatchObject({
      source: expect.stringContaining("Thief_Attack"),
      frameWidth: 192,
      frameHeight: 192,
      frames: 6,
      activeFrame: 3,
    });
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

  it("preloads the Rogue idle, run and authored attack strips exactly once", () => {
    const rogue = ["idle", "run", "attack"].map((motion) =>
      unitSheet(
        "rogue",
        { body: "wayfarer", primaryColor: "violet" },
        motion as "idle" | "run" | "attack",
      ),
    );
    expect(rogue).toEqual([
      expect.objectContaining({
        source: expect.stringContaining("Thief_Idle"),
        frameWidth: 192,
        footOffset: 60,
      }),
      expect.objectContaining({
        source: expect.stringContaining("Thief_Run"),
        frameWidth: 192,
        footOffset: 59,
      }),
      expect.objectContaining({
        source: expect.stringContaining("Thief_Attack"),
        frames: 6,
        frameWidth: 192,
        frameHeight: 192,
        footOffset: 56,
      }),
    ]);
    for (const sheet of Object.values(TINY_SWORDS_ROGUE_SHEETS)) {
      expect(sheet.frames * sheet.frameWidth).toBe(1_152);
      expect(sheet.frameHeight).toBe(192);
    }
    expect(allUnitSheets().filter((sheet) => sheet.source.includes("Thief"))).toHaveLength(3);
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

  it("preloads every authored enemy projectile sheet", () => {
    const sheets = new Set(allCombatSheets().map((entry) => entry.source));
    for (const kind of ["hex_orb", "enemy_harpoon", "enemy_bomb"] as const) {
      const art = projectileArt(kind, "ember");
      expect(sheets.has(art.source)).toBe(true);
      expect(art.source).not.toBe("");
    }
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

  it("uses a dedicated neutral Tiny Swords dust sheet for authored teleports", () => {
    expect(teleportEffectArt()).toMatchObject({
      source: expect.stringContaining("Dust_02.png"),
      frames: 10,
      tint: 0xb48cff,
      scale: 1.5,
    });
  });

  it("gives every class ultimate a deliberately amplified visual treatment", () => {
    const whirlwind = combatArt("warrior", "whirlwind", "azure");
    const heartseeker = combatArt("ranger", "heartseeker", "azure");
    const nova = combatArt("priest", "divine_nova", "azure");
    const dance = combatArt("rogue", "shadow_dance", "violet");

    expect(whirlwind).toMatchObject({
      zone: { source: expect.stringContaining("Explosion_02.png"), scale: 1.78 },
      accent: { source: expect.stringContaining("Explosion_01.png"), scale: 1.42 },
    });
    expect(heartseeker.projectile).toMatchObject({
      scale: 1.78,
      trail: { length: 72, width: 7, glowRadius: 16 },
    });
    expect(heartseeker).toMatchObject({
      zone: { tint: 0xff557d, scale: 1.18 },
      impact: { tint: 0xff416c, scale: 1.65 },
    });
    expect(nova).toMatchObject({
      zone: { source: expect.stringContaining("Heal_Effect.png"), scale: 1.72 },
      accent: { source: expect.stringContaining("Explosion_02.png"), scale: 1.88 },
      impact: { source: expect.stringContaining("Explosion_01.png"), scale: 1.65 },
    });
    expect(dance).toMatchObject({
      zone: { tint: 0x8f55d9, scale: 1.18 },
      accent: { tint: 0xc58cff, scale: 1.58 },
      fallback: expect.stringContaining("Thief_Attack"),
    });
  });

  it("uses authored Tiny Swords sheets as the primary Battle Cry visual", () => {
    expect(combatArt("warrior", "battle_cry", "azure")).toMatchObject({
      zone: { source: expect.stringContaining("Explosion_02.png"), frames: 10 },
      accent: { source: expect.stringContaining("Dust_02.png"), frames: 10 },
    });
  });

  it("maps ultimate and mobility icons to the assets now used in-world", () => {
    expect(skillIconArt("warrior", 4).source).toContain("Explosion_02.png");
    expect(skillIconArt("warrior", 5).source).toContain("Explosion_02.png");
    expect(skillIconArt("priest", 3).source).toContain("Dust_02.png");
    expect(skillIconArt("priest", 5).source).toContain("Heal_Effect.png");
    expect(skillIconArt("rogue", 1)).toMatchObject({
      source: expect.stringContaining("Thief_Attack"),
      frames: 6,
      frame: 3,
      variant: "dual-slash",
    });
    expect(skillIconArt("rogue", 2)).toMatchObject({ variant: "shadow-step" });
    expect(skillIconArt("rogue", 4)).toMatchObject({ variant: "poisoned-shiv" });
    expect(skillIconArt("rogue", 5)).toMatchObject({
      frames: 6,
      frame: 2,
      variant: "shadow-dance",
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

  it("replays the full caster strip at every authoritative multi-hit contact", () => {
    const timeline = { startedAt: 100, impactAt: 300, recoveryEndsAt: 1_300 };
    const impacts = [300, 550, 800, 1_050];
    for (const impactAt of impacts) {
      expect(multiImpactActionFrameIndex(4, 1, timeline, impacts, impactAt)).toBe(1);
    }
    expect(multiImpactActionFrameIndex(4, 1, timeline, impacts, 425)).not.toBe(1);
    expect(multiImpactActionFrameIndex(4, 1, timeline, impacts, 675)).not.toBe(1);
    expect(multiImpactActionFrameIndex(4, 1, timeline, impacts, 1_299)).toBe(3);
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
