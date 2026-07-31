/**
 * The enemy scale rule, pinned.
 *
 * Every Tiny Swords sprite is drawn at its sheet's native frame size — that is how the pack keeps a
 * goblin, a hero and a troll in proportion with each other despite living on 192/256/320/384 sheets.
 * The player was once pinned to 96 and the guard to 102; both were fixed. The enemies kept a table of
 * hand-tuned `spriteSize` values (a spear goblin at 98 off a 256 sheet — 38% scale) until this test
 * existed to stop it coming back. A goblin that renders knee-high to the hero standing next to it is
 * the observable this file protects.
 */
import { describe, expect, it } from "vitest";
import {
  ENEMY_RENDER_METRICS,
  type EnemyRenderMetrics,
  TINY_SWORDS_ENEMIES,
} from "../src/enemy-art.js";

const SPECIES = Object.keys(ENEMY_RENDER_METRICS) as (keyof typeof ENEMY_RENDER_METRICS)[];

/** The ground line every species stands on, in actor space (the monster twin of the player's y=31). */
const GROUND_Y = 29;

/** Measured idle-strip extents per sheet — the same three numbers `enemyMetrics` is fed. Duplicated
 *  here on purpose: if the art changes, both the source and this table must be re-measured, and the
 *  test fails loudly in between rather than silently agreeing with a stale value. */
const IDLE_BODY: Record<string, { top: number; bottom: number }> = {
  spear_goblin: { top: 48, bottom: 176 },
  torch_goblin: { top: 65, bottom: 133 },
  gnoll_marauder: { top: 60, bottom: 135 },
  skull_guard: { top: 57, bottom: 130 },
  skull_crusader: { top: 57, bottom: 130 },
  skull_warden: { top: 57, bottom: 130 },
  minotaur_brute: { top: 85, bottom: 214 },
  mire_troll: { top: 86, bottom: 297 },
  gate_troll: { top: 86, bottom: 297 },
  hex_shaman: { top: 53, bottom: 137 },
  war_pig: { top: 83, bottom: 134 },
  pig_rider: { top: 21, bottom: 166 },
};

describe("enemy render metrics", () => {
  it("draws every enemy at its sheet's native frame size", () => {
    for (const species of SPECIES) {
      const metrics: EnemyRenderMetrics = ENEMY_RENDER_METRICS[species];
      // The idle sheet's `frame` IS the scale system. Anything else is a downscale, and a downscale
      // applied to one class of sprite is what breaks a self-consistent pack.
      expect(metrics.spriteSize, `${species} must render at native scale`).toBe(
        TINY_SWORDS_ENEMIES[species].idle.frame,
      );
    }
  });

  it("stands every enemy's feet on the shared ground line", () => {
    for (const species of SPECIES) {
      const { spriteY, spriteSize } = ENEMY_RENDER_METRICS[species];
      const body = IDLE_BODY[species];
      expect(body, `${species} needs a measured idle body`).toBeDefined();
      if (!body) continue;
      // The sprite is anchored bottom-centre at `spriteY`, so its visible feet land that far up by
      // however much transparent padding sits under them. At native scale the padding is unscaled.
      const feetY = spriteY - (spriteSize - body.bottom);
      expect(feetY, `${species} feet must meet the ground line`).toBe(GROUND_Y);
    }
  });

  it("hangs label, HP bar and alert off the sprite's own head", () => {
    for (const species of SPECIES) {
      const { spriteY, spriteSize, labelY, hpY, alertY } = ENEMY_RENDER_METRICS[species];
      const body = IDLE_BODY[species];
      if (!body) continue;
      const headY = spriteY - (spriteSize - body.top);
      // One rule for the whole bestiary, so a taller enemy carries its chrome up with it rather than
      // wearing a name tag across its chest.
      expect(labelY, `${species} label`).toBe(headY - 12);
      expect(hpY, `${species} HP bar`).toBe(headY - 8);
      expect(hpY + 6, `${species} HP bar bottom`).toBeLessThanOrEqual(headY);
      expect(alertY, `${species} alert`).toBe(headY - 31);
      expect(alertY).toBeLessThan(labelY);
    }
  });

  it("keeps the troll a giant and the goblins hero-scale", () => {
    // The proportions the pack authored, stated as an ordering rather than as pixel counts: a spear
    // goblin off a 256 sheet, a minotaur off 320, a troll off 384. If a future edit flattens these
    // to one number, the bestiary loses its silhouette hierarchy and this fails.
    const size = (s: keyof typeof ENEMY_RENDER_METRICS) => ENEMY_RENDER_METRICS[s].spriteSize;
    expect(size("mire_troll")).toBeGreaterThan(size("minotaur_brute"));
    expect(size("minotaur_brute")).toBeGreaterThan(size("spear_goblin"));
    expect(size("spear_goblin")).toBeGreaterThan(size("gnoll_marauder"));
    expect(size("mire_troll")).toBe(size("gate_troll"));
    expect(size("skull_guard")).toBe(size("skull_warden"));
  });
});
