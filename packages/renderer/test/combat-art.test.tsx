import {
  MONSTER_SPECIAL_TECHNIQUES,
  MONSTER_SPECIES_KIND,
  type MonsterSpecies,
} from "@lindocara/engine/game.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import {
  allCombatSheets,
  combatActionFrameIndex,
  combatArt,
  MONSTER_SPECIAL_IMPACT_ART,
  monsterCombatArt,
  monsterSpecialImpactPosition,
  multiImpactActionFrameIndex,
  PEASANT_CAMP_ART,
  PEASANT_RATION_ART,
  projectileArt,
  teleportEffectArt,
} from "@lindocara/renderer/combat-art.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";
import {
  allUnitSheets,
  PEASANT_ABILITY_SHEETS,
  PEASANT_CARRY_PRIORITY,
  PEASANT_SKILL_IDS,
  PEASANT_TOOL_SPECS,
  peasantCarrySheet,
  peasantToolSheet,
  prioritizedPeasantCarry,
  skillIconArt,
  TINY_SWORDS_PEASANT_BOMB_SHEETS,
  TINY_SWORDS_ROGUE_SHEETS,
  unitSheet,
} from "@lindocara/renderer/tiny-swords-art.js";
import { describe, expect, it } from "vitest";

describe("Tiny Swords directional combat art", () => {
  it("uses dedicated caster sheets for all five playable classes", () => {
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
    expect(combatArt("peasant", "woodcutters_swing", "ember").caster).toMatchObject({
      source: expect.stringContaining("Pawn_Interact"),
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

  it("maps every Peasant skill to an explicit visual source", () => {
    expect(PEASANT_SKILL_IDS).toEqual(CLASS_SKILLS.peasant.map((skill) => skill.id));
    const expectedCasters = {
      woodcutters_swing: ["Pawn_Interact Axe.png", 6, 3],
      prospectors_pick: ["Pawn_Idle.png", 8, 0],
      butchers_cut: ["Pawn_Idle.png", 8, 0],
      makeshift_camp: ["Pawn_Interact Hammer.png", 3, 1],
      homemade_bomb: ["Pawn_Idle.png", 8, 0],
    } as const;

    for (const color of ["azure", "ember", "moss", "violet"] as const) {
      const visualSources = new Set<string>();
      for (const [skillId, [file, frames, activeFrame]] of Object.entries(expectedCasters)) {
        const art = combatArt("peasant", skillId, color);
        expect(decodeURI(art.caster.source)).toContain(file);
        expect(art.caster).toMatchObject({ frames, activeFrame });
        const effect = art.impact ?? art.zone;
        expect(effect).toMatchObject({
          source: PEASANT_ABILITY_SHEETS[skillId as keyof typeof PEASANT_ABILITY_SHEETS].source,
          frames: 6,
          frameWidth: 256,
          frameHeight: 256,
        });
        expect(art.fallback ?? "").not.toContain("Axe fournit le geste générique");
        visualSources.add(effect?.source ?? "");
      }
      const bomb = combatArt("peasant", "homemade_bomb", color);
      expect(decodeURI(bomb.caster.source)).toContain("Pawn_Idle.png");
      expect(decodeURI(bomb.projectile?.source ?? "")).toContain("Bomb_Spinning.png");
      expect(visualSources.size).toBe(5);
    }
    expect(() => combatArt("peasant", "unknown_skill", "azure")).toThrow(
      "Unknown Peasant skill art",
    );
  });

  it("preloads every Peasant base, tool and carried-resource strip in all four colours", () => {
    const sheets = allUnitSheets().filter((sheet) => sheet.source.includes("Pawn_"));
    expect(sheets).toHaveLength(48);
    const preloaded = new Set(sheets.map((sheet) => sheet.source));
    for (const color of ["azure", "ember", "moss", "violet"] as const) {
      const motions = ["idle", "run", "attack"] as const;
      expect(
        motions.map((motion) =>
          unitSheet("peasant", { body: "wayfarer", primaryColor: color }, motion),
        ),
      ).toEqual([
        expect.objectContaining({ frames: 8, frameWidth: 192, frameHeight: 192 }),
        expect.objectContaining({ frames: 6, frameWidth: 192, frameHeight: 192 }),
        expect.objectContaining({
          source: expect.stringContaining("Pawn_Interact"),
          frames: 6,
          frameWidth: 192,
          frameHeight: 192,
          footOffset: 57,
        }),
      ]);
      for (const skillId of Object.keys(PEASANT_TOOL_SPECS) as Array<
        keyof typeof PEASANT_TOOL_SPECS
      >) {
        expect(preloaded.has(peasantToolSheet(color, skillId).source)).toBe(true);
      }
      for (const kind of PEASANT_CARRY_PRIORITY) {
        for (const motion of ["idle", "run"] as const) {
          const carry = peasantCarrySheet(color, kind, motion);
          expect(preloaded.has(carry.source)).toBe(true);
          expect(carry.frames).toBe(motion === "idle" ? 8 : 6);
        }
      }
    }
    expect(prioritizedPeasantCarry(["wood", "meat", "gold"])).toBe("gold");
    expect(prioritizedPeasantCarry(["wood", "meat"])).toBe("meat");
    expect(prioritizedPeasantCarry([])).toBeUndefined();
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

  it("keeps the Peasant bomb distinct from enemy bombs and preloads its complete art", () => {
    const peasantBomb = combatArt("peasant", "homemade_bomb", "azure");
    const enemyBomb = projectileArt("enemy_bomb", "ember");

    expect(peasantBomb.projectile).toMatchObject({
      source: TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.source,
      frameWidth: 128,
      frameHeight: 128,
      frames: 4,
      activeFrame: 0,
      scale: 0.38,
    });
    expect(peasantBomb.impact).toMatchObject({
      source: PEASANT_ABILITY_SHEETS.homemade_bomb.source,
      frames: 6,
      activeFrame: 4,
      durationMs: 820,
      scale: 0.56,
    });
    expect(enemyBomb).toMatchObject({
      frameWidth: 192,
      frameHeight: 192,
      frames: 8,
      durationMs: 650,
      activeFrame: 3,
      scale: 0.46,
      trail: { color: 0xff8d4a, length: 18, width: 3, glowRadius: 6 },
    });
    expect(decodeURI(enemyBomb.source)).toContain("Bomb_Idle.png");
    expect(enemyBomb.source).not.toBe(peasantBomb.projectile?.source);

    const preloaded = new Set(allCombatSheets().map((entry) => entry.source));
    expect(preloaded.has(TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.source)).toBe(true);
    for (const sheet of Object.values(PEASANT_ABILITY_SHEETS)) {
      expect(preloaded.has(sheet.source)).toBe(true);
    }
  });

  it("keeps Peasant support props near hero scale and leaves the rally readable", () => {
    const rally = combatArt("peasant", "prospectors_pick", "moss").zone;
    const ration = combatArt("peasant", "butchers_cut", "moss").zone;

    expect(rally).toMatchObject({ scale: 0.58, durationMs: 1_800 });
    expect(ration).toMatchObject({ scale: 0.54, durationMs: 1_500 });
    expect(rally?.scale).toBeLessThan(1);
    expect(ration?.scale).toBeLessThan(1);
  });

  it("preloads the original persistent makeshift-camp illustration", () => {
    expect(PEASANT_CAMP_ART).toMatchObject({
      source: expect.stringContaining("makeshift-camp.png"),
      frames: 1,
      frameWidth: 1_254,
      frameHeight: 1_254,
      anchor: { x: 0.5, y: 0.145 },
    });
    expect(new Set(allCombatSheets().map((entry) => entry.source))).toContain(
      PEASANT_CAMP_ART.source,
    );
    expect(new Set(allCombatSheets().map((entry) => entry.source))).toContain(
      PEASANT_RATION_ART.source,
    );
  });

  it("defines and preloads an explicit impact profile for every monster special", () => {
    const techniques = MONSTER_SPECIAL_TECHNIQUES.filter((technique) => technique !== "none");
    expect(Object.keys(MONSTER_SPECIAL_IMPACT_ART).sort()).toEqual([...techniques].sort());
    const preloaded = new Set(allCombatSheets().map((entry) => entry.source));
    for (const technique of techniques) {
      const profile = MONSTER_SPECIAL_IMPACT_ART[technique];
      expect(profile.visualRadius).toBeGreaterThan(0);
      expect(profile.shake).toMatchObject({
        intensity: expect.any(Number),
        durationMs: expect.any(Number),
        maxDistance: expect.any(Number),
      });
      expect(preloaded.has(profile.effect.source)).toBe(true);
      if ("accent" in profile) expect(preloaded.has(profile.accent.source)).toBe(true);
    }
  });

  it("uses the measured nine-frame Tiny Swords ground-impact strip for heavy earth attacks", () => {
    for (const technique of [
      "ground_slam",
      "horn_charge",
      "labyrinth_stomp",
      "troll_quake",
      "troll_sweep",
      "mounted_trample",
    ] as const) {
      expect(MONSTER_SPECIAL_IMPACT_ART[technique].effect).toMatchObject({
        source: expect.stringContaining("Effects/Explosion/Explosions.png"),
        frameWidth: 192,
        frameHeight: 192,
        frames: 9,
      });
      expect(MONSTER_SPECIAL_IMPACT_ART[technique].effect.frameWidth * 9).toBe(1_728);
    }
  });

  it("positions directional impact art from the typed profile rather than an asset heuristic", () => {
    expect(
      monsterSpecialImpactPosition({
        technique: "shadow_cone",
        x: 100,
        z: 200,
        direction: { x: 0, z: -1 },
      }),
    ).toEqual({ x: 100, z: 142 });
    expect(
      monsterSpecialImpactPosition({
        technique: "troll_quake",
        x: 100,
        z: 200,
        direction: { x: 1, z: 0 },
      }),
    ).toEqual({ x: 100, z: 200 });
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
    expect(skillIconArt("priest", 2).source).toContain("Heal_Effect.png");
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
    const peasantIcons = [1, 2, 3, 4, 5].map((slot) =>
      skillIconArt("peasant", slot as 1 | 2 | 3 | 4 | 5),
    );
    for (const [index, file] of [
      "contextual-tools.png",
      "rally-rooster.png",
      "ration-basket.png",
      "makeshift-camp.png",
      "turnip-bomb.png",
    ].entries()) {
      expect(decodeURI(peasantIcons[index]?.source ?? "")).toContain(file);
    }
    expect(peasantIcons.map((icon) => icon.frames)).toEqual([6, 6, 6, 6, 6]);
    expect(peasantIcons.map((icon) => icon.frame)).toEqual([5, 4, 3, 5, 4]);
    expect(new Set(peasantIcons.map((icon) => icon.source)).size).toBe(5);
    expect(peasantIcons.map((icon) => icon.variant)).toEqual([
      "woodcutters-swing",
      "prospectors-pick",
      "butchers-cut",
      "makeshift-camp",
      "homemade-bomb",
    ]);
  });

  it("restores the rounded violet pre-HD-2D cloud for Lumen traversal", () => {
    const blink = combatArt("priest", "blink", "azure");
    expect(blink.impact).toMatchObject({
      source: expect.stringContaining("Dust_02.png"),
      frames: 10,
      tint: 0xb48cff,
      scale: 1.35,
    });
    expect(new Set(allCombatSheets().map((entry) => entry.source))).toContain(blink.impact?.source);
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
