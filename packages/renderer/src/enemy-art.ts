/**
 * The Tiny Swords Enemy Pack — the same artist, the same 64px world, and the same pack that already
 * draws the terrain, the buildings, the player classes and the UI. It replaces three unrelated vendor
 * packs whose only thing in common was that none of them matched anything else.
 *
 * Every enemy has its own frame size. They are single-row horizontal strips, so `frame` is the
 * sheet's height and `frames` is its width divided by that. Measure; do not guess.
 *
 * **An enemy is drawn at its sheet's native frame size**, exactly like a player (192, see
 * `UNIT_OFFSET_X` in `renderer.ts`) and a guard. The differing frame sizes ARE the pack's scale
 * system: 192 for a gnoll or a skull, 256 for a spear goblin, 320 for a minotaur, 384 for a troll.
 * Draw each at its own frame and the whole bestiary is in proportion with itself and with the heroes.
 *
 * This used to be a per-species hand-tuned `spriteSize` — 98 for a spear goblin off a 256 sheet, so
 * 38% scale, while the hero beside it was at 100%. That is the same bug the player sprite had when
 * it was pinned to 96, and the same one the guard had at 102: shrinking one class of sprite is what
 * breaks a pack that was already in proportion. A goblin looked knee-high; a troll was not a giant.
 *
 * Note this is APPEARANCE only. Every monster's collision and attack reach come from `PLAYER_SIZE`
 * server-side regardless of species, so drawing a troll at its true size does not give it a bigger
 * body — see `MONSTER_ATTACK_RANGE` in `engine/game.ts`.
 */
import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { TINY_SWORDS_ROOT } from "./tiny-swords-art.js";

const ROOT = `${TINY_SWORDS_ROOT}/enemies`;

export interface EnemySheet {
  readonly source: string;
  /** Width and height of one frame, in pixels. Differs per enemy. */
  readonly frame: number;
  readonly frames: number;
}

export interface EnemyArt {
  readonly idle: EnemySheet;
  readonly run: EnemySheet;
  readonly attack: EnemySheet;
}

/** Where a monster's feet meet the ground, in actor space — the monster twin of the player's y=31.
 *  One number for every species: the pack draws each enemy standing on its own frame's baseline, so
 *  the ground line is a property of the world, not of the enemy. */
const MONSTER_GROUND_Y = 29;

export interface EnemyRenderMetrics {
  /** The size the square frame is drawn at. Always the sheet's OWN `frame`, i.e. native scale — see
   *  the module header. The transparent padding is not waste to be squeezed out; it is how the pack
   *  keeps a goblin and a troll in proportion inside sheets of different sizes. */
  readonly spriteSize: number;
  /** Frame-bottom anchor adjusted so the visible feet meet `MONSTER_GROUND_Y`. */
  readonly spriteY: number;
  readonly labelY: number;
  readonly hpY: number;
  readonly alertY: number;
}

/**
 * Derive a species' metrics from two measurements of its IDLE frames — the top and bottom of the
 * visible pixels, unioned over the strip — instead of hand-tuning six numbers per enemy.
 *
 * `bodyBottom` sets the standing position: the padding under the feet (`frame - bodyBottom`) is
 * pushed below the ground line so the enemy stands on it rather than hanging off it. `bodyTop` sets
 * the chrome: the label sits just under the sprite's top, the HP bar 8px below it, the alert `!`
 * 14px above it — the same three offsets the old hand-tuned table already encoded, now stated once.
 *
 * Idle drives it because idle is the resting pose. A run or attack frame may reach lower (a lunge, a
 * crouch); letting those move the ground line would make an enemy sink as it swung.
 */
function enemyMetrics(frame: number, bodyTop: number, bodyBottom: number): EnemyRenderMetrics {
  const spriteY = MONSTER_GROUND_Y + (frame - bodyBottom);
  const headY = spriteY - (frame - bodyTop);
  return { spriteSize: frame, spriteY, labelY: headY + 3, hpY: headY + 11, alertY: headY - 14 };
}

/** Several species share a sheet, exactly as `goblin_scout` and `goblin_raider` shared one before:
 *  the three `skull_*` species already share a stat block, so they were always one monster in three
 *  coats. */
const GOBLIN = {
  idle: { source: `${ROOT}/spear-goblin/idle.png`, frame: 256, frames: 8 },
  run: { source: `${ROOT}/spear-goblin/run.png`, frame: 256, frames: 6 },
  attack: { source: `${ROOT}/spear-goblin/attack.png`, frame: 256, frames: 7 },
} as const satisfies EnemyArt;

const TORCH = {
  idle: { source: `${ROOT}/torch-goblin/idle.png`, frame: 192, frames: 8 },
  run: { source: `${ROOT}/torch-goblin/run.png`, frame: 192, frames: 6 },
  attack: { source: `${ROOT}/torch-goblin/attack.png`, frame: 192, frames: 8 },
} as const satisfies EnemyArt;

const GNOLL = {
  idle: { source: `${ROOT}/gnoll/idle.png`, frame: 192, frames: 6 },
  run: { source: `${ROOT}/gnoll/run.png`, frame: 192, frames: 8 },
  attack: { source: `${ROOT}/gnoll/attack.png`, frame: 192, frames: 8 },
} as const satisfies EnemyArt;

const SKULL = {
  idle: { source: `${ROOT}/skull/idle.png`, frame: 192, frames: 8 },
  run: { source: `${ROOT}/skull/run.png`, frame: 192, frames: 6 },
  attack: { source: `${ROOT}/skull/attack.png`, frame: 192, frames: 7 },
} as const satisfies EnemyArt;

const MINOTAUR = {
  idle: { source: `${ROOT}/minotaur/idle.png`, frame: 320, frames: 16 },
  run: { source: `${ROOT}/minotaur/run.png`, frame: 320, frames: 8 },
  attack: { source: `${ROOT}/minotaur/attack.png`, frame: 320, frames: 12 },
} as const satisfies EnemyArt;

const TROLL = {
  idle: { source: `${ROOT}/troll/idle.png`, frame: 384, frames: 12 },
  run: { source: `${ROOT}/troll/run.png`, frame: 384, frames: 10 },
  attack: { source: `${ROOT}/troll/attack.png`, frame: 384, frames: 6 },
} as const satisfies EnemyArt;

export const TINY_SWORDS_ENEMIES: Record<MonsterSpecies, EnemyArt> = {
  spear_goblin: GOBLIN,
  torch_goblin: TORCH,
  gnoll_marauder: GNOLL,
  skull_guard: SKULL,
  skull_crusader: SKULL,
  skull_warden: SKULL,
  minotaur_brute: MINOTAUR,
  mire_troll: TROLL,
  gate_troll: TROLL,
};

// The measured idle-strip extents, per sheet: (frame, bodyTop, bodyBottom). Re-measure with any art
// update — every other number falls out of these three.
const SPEAR_GOBLIN_METRICS = enemyMetrics(256, 48, 176);
const TORCH_GOBLIN_METRICS = enemyMetrics(192, 65, 133);
const GNOLL_METRICS = enemyMetrics(192, 60, 135);
const SKULL_METRICS = enemyMetrics(192, 57, 130);
const MINOTAUR_METRICS = enemyMetrics(320, 85, 214);
const TROLL_METRICS = enemyMetrics(384, 86, 297);

export const ENEMY_RENDER_METRICS: Record<MonsterSpecies, EnemyRenderMetrics> = {
  spear_goblin: SPEAR_GOBLIN_METRICS,
  torch_goblin: TORCH_GOBLIN_METRICS,
  gnoll_marauder: GNOLL_METRICS,
  skull_guard: SKULL_METRICS,
  skull_crusader: SKULL_METRICS,
  skull_warden: SKULL_METRICS,
  minotaur_brute: MINOTAUR_METRICS,
  mire_troll: TROLL_METRICS,
  gate_troll: TROLL_METRICS,
};
