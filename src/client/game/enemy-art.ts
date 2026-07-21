/**
 * The Tiny Swords Enemy Pack — the same artist, the same 64px world, and the same pack that already
 * draws the terrain, the buildings, the player classes and the UI. It replaces three unrelated vendor
 * packs whose only thing in common was that none of them matched anything else.
 *
 * Every enemy has its own frame size. They are single-row horizontal strips, so `frame` is the
 * sheet's height and `frames` is its width divided by that. Measure; do not guess.
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

export interface EnemyRenderMetrics {
  /** Size of the full square frame. The source sheets contain substantial transparent padding. */
  readonly spriteSize: number;
  /** Frame-bottom anchor adjusted so the visible feet meet the shared ground line. */
  readonly spriteY: number;
  readonly shadowWidth: number;
  readonly shadowHeight: number;
  readonly labelY: number;
  readonly hpY: number;
  readonly alertY: number;
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

const SPEAR_GOBLIN_METRICS: EnemyRenderMetrics = {
  spriteSize: 98,
  spriteY: 59,
  shadowWidth: 16,
  shadowHeight: 6,
  labelY: -17,
  hpY: -9,
  alertY: -34,
};

const TORCH_GOBLIN_METRICS: EnemyRenderMetrics = {
  spriteSize: 119,
  spriteY: 65,
  shadowWidth: 17,
  shadowHeight: 6,
  labelY: -11,
  hpY: -3,
  alertY: -28,
};

const GNOLL_METRICS: EnemyRenderMetrics = {
  spriteSize: 128,
  spriteY: 67,
  shadowWidth: 22,
  shadowHeight: 7,
  labelY: -18,
  hpY: -10,
  alertY: -35,
};

const SKULL_METRICS: EnemyRenderMetrics = {
  spriteSize: 124,
  spriteY: 69,
  shadowWidth: 17,
  shadowHeight: 6,
  labelY: -15,
  hpY: -7,
  alertY: -32,
};

const MINOTAUR_METRICS: EnemyRenderMetrics = {
  spriteSize: 186,
  spriteY: 90,
  shadowWidth: 30,
  shadowHeight: 10,
  labelY: -44,
  hpY: -36,
  alertY: -61,
};

const TROLL_METRICS: EnemyRenderMetrics = {
  spriteSize: 168,
  spriteY: 67,
  shadowWidth: 29,
  shadowHeight: 11,
  labelY: -61,
  hpY: -53,
  alertY: -78,
};

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
