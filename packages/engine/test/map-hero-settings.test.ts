import {
  defaultMapHeroSettings,
  isMapSkillEnabled,
  mapHeroClassSettings,
  maxMapHeroMovementSpeed,
  parseMapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, test } from "vitest";

describe("map hero settings", () => {
  test("legacy maps inherit all central class profiles", () => {
    const settings = parseMapHeroSettings(undefined);
    expect(settings).not.toBeNull();
    // Tiles per second: the same ground per second the pixel values covered, over a ruler 64
    // times shorter. Written as the quotient rather than as `4.0625` so the relationship to the
    // value it replaced stays visible in the assertion.
    expect(settings?.classes.warrior.stats.movementSpeed).toBe(260 / 64);
    expect(settings?.classes.ranger.stats.movementSpeed).toBe(286 / 64);
    expect(settings?.classes.priest.stats.movementSpeed).toBe(234 / 64);
    expect(settings?.classes.rogue.stats.movementSpeed).toBe(312 / 64);
    expect(settings?.classes.peasant.stats).toMatchObject({
      attackBase: 8,
      attackPerLevel: 1,
      attackRange: 54 / TILE_SIZE,
      movementSpeed: 247 / 64,
    });
    expect(settings?.classes.priest.stats.heal).toEqual({
      base: 35,
      perLevel: 3,
      range: 390 / TILE_SIZE,
    });
  });

  test("round-trips map overrides and ability locks", () => {
    const authored = defaultMapHeroSettings();
    authored.classes.rogue.stats.movementSpeed = 340 / 64;
    authored.classes.rogue.disabledSkills = [2, 5];
    const parsed = parseMapHeroSettings(authored);
    expect(parsed).not.toBeNull();
    expect(mapHeroClassSettings(parsed ?? undefined, "rogue").stats.movementSpeed).toBe(340 / 64);
    expect(isMapSkillEnabled(parsed ?? undefined, "rogue", 1)).toBe(true);
    expect(isMapSkillEnabled(parsed ?? undefined, "rogue", 2)).toBe(false);
    expect(maxMapHeroMovementSpeed(parsed ?? undefined)).toBe(340 / 64);
  });

  test("normalizes pixel-era authored movement and ranges to tile units", () => {
    const legacy = defaultMapHeroSettings();
    legacy.classes.warrior.stats.movementSpeed = 260;
    legacy.classes.warrior.stats.attackRange = 60;
    legacy.classes.ranger.stats.movementSpeed = 286;
    legacy.classes.ranger.stats.attackRange = 382.5;
    legacy.classes.priest.stats.movementSpeed = 234;
    legacy.classes.priest.stats.attackRange = 337.5;
    if (legacy.classes.priest.stats.heal) legacy.classes.priest.stats.heal.range = 390;
    legacy.classes.rogue.stats.movementSpeed = 312;
    legacy.classes.rogue.stats.attackRange = 58;

    const parsed = parseMapHeroSettings(legacy);

    expect(parsed?.classes.warrior.stats).toMatchObject({
      movementSpeed: 260 / TILE_SIZE,
      attackRange: 60 / TILE_SIZE,
    });
    expect(parsed?.classes.ranger.stats).toMatchObject({
      movementSpeed: 286 / TILE_SIZE,
      attackRange: 382.5 / TILE_SIZE,
    });
    expect(parsed?.classes.priest.stats).toMatchObject({
      movementSpeed: 234 / TILE_SIZE,
      attackRange: 337.5 / TILE_SIZE,
      heal: { range: 390 / TILE_SIZE },
    });
    expect(parsed?.classes.rogue.stats).toMatchObject({
      movementSpeed: 312 / TILE_SIZE,
      attackRange: 58 / TILE_SIZE,
    });
    expect(parsed?.classes.peasant).toEqual(defaultMapHeroSettings().classes.peasant);
  });

  test("rejects abusive values, duplicate locks and incomplete class records", () => {
    const tooFast = defaultMapHeroSettings();
    tooFast.classes.rogue.stats.movementSpeed = 521;
    expect(parseMapHeroSettings(tooFast)).toBeNull();

    const duplicate = defaultMapHeroSettings();
    duplicate.classes.warrior.disabledSkills = [2, 2];
    expect(parseMapHeroSettings(duplicate)).toBeNull();

    const incomplete = defaultMapHeroSettings() as unknown as {
      classes: Record<string, unknown>;
    };
    delete incomplete.classes.ranger;
    expect(parseMapHeroSettings(incomplete)).toBeNull();
  });

  test("round-trips Peasant map overrides without affecting legacy defaults", () => {
    const authored = defaultMapHeroSettings();
    authored.classes.peasant.stats.movementSpeed = 230 / 64;
    authored.classes.peasant.disabledSkills = [4, 5];
    const parsed = parseMapHeroSettings(authored);
    expect(parsed?.classes.peasant).toMatchObject({
      stats: { movementSpeed: 230 / 64 },
      disabledSkills: [4, 5],
    });
  });

  test("preserves four-class authored maps and adds only the default Peasant profile", () => {
    const legacy = defaultMapHeroSettings() as unknown as {
      classes: Record<string, unknown>;
    };
    const rogue = legacy.classes.rogue as ReturnType<
      typeof defaultMapHeroSettings
    >["classes"]["rogue"];
    rogue.stats.movementSpeed = 341 / 64;
    rogue.disabledSkills = [2, 5];
    delete legacy.classes.peasant;

    const parsed = parseMapHeroSettings(legacy);

    expect(parsed?.classes.rogue).toMatchObject({
      stats: { movementSpeed: 341 / 64 },
      disabledSkills: [2, 5],
    });
    expect(parsed?.classes.peasant).toEqual(defaultMapHeroSettings().classes.peasant);
  });
});
