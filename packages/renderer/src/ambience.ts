/**
 * Ambience: everything that makes a map feel alive without changing a single authored cell.
 *
 * The rule this module exists to respect is the one the whole codebase turns on — **appearance is
 * not truth**. Nothing here is in `MapData`, nothing here is baked into `tiles`/`colliders`, and
 * nothing here can be collided with, walked on, or seen by the server. A hero walks straight through
 * a drifting cloud and straight over a grass tuft, because neither exists anywhere but on screen.
 * That is what makes it safe to scatter thousands of them from a hash instead of authoring them:
 * an author's map is unchanged, and two clients that disagree about a tuft disagree about nothing.
 *
 * Everything is derived from `(col, row)` or from the clock, never from `Math.random`, so the same
 * map looks the same on every machine and across a reload. That is not a network requirement — none
 * of this is networked — it is so a visual reference shot is reproducible and a diff means something.
 */

/** Which ambience passes are drawn. Each is independent and individually free to turn off. */
export interface AmbienceConfig {
  /** Grass tufts scattered over open ground, swaying on a shared wind phase. */
  tufts: boolean;
  /** The pack's own cloud sheets drifting across the sky, with their shadow on the world below. */
  clouds: boolean;
  /** A moving sea surface: crest streaks over the flat fill, instead of an unbroken slab of teal. */
  water: boolean;
}

export const AMBIENCE_NONE: AmbienceConfig = { tufts: false, clouds: false, water: false };
export const AMBIENCE_FULL: AmbienceConfig = { tufts: true, clouds: true, water: true };

/**
 * A 32-bit hash of a cell. The avalanche matters more than the speed: neighbouring cells must not
 * produce neighbouring values, or the scatter lands in visible diagonal stripes.
 */
function hashCell(col: number, row: number, salt: number): number {
  let h = (col * 0x1f1f1f1f) ^ (row * 0x85ebca6b) ^ (salt * 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A unit float from a cell hash. */
function hashUnit(col: number, row: number, salt: number): number {
  return hashCell(col, row, salt) / 0x100000000;
}

/** One scattered tuft, in pixels relative to its cell's top-left corner. */
export interface Tuft {
  dx: number;
  dy: number;
  /** Which of the sheet's tuft cells to draw. */
  variant: 0 | 1;
  scale: number;
  /** Radians, so no two tufts sway in lockstep. */
  phase: number;
}

/**
 * How much of the open ground carries a tuft. Deliberately low: the reference art keeps its grass
 * plain and puts detail at the edges, and a lawn of clutter is exactly as unreadable as bare green.
 */
const TUFT_DENSITY = 0.17;

/**
 * The tufts on one cell — usually none, occasionally one.
 *
 * Pure and total: the caller passes any cell and gets the same answer forever. It does NOT know
 * which cells are grass; deciding that is the renderer's job, because only it holds the baked tile
 * grid and this module must not grow a second opinion about what is walkable.
 */
export function tuftsAt(col: number, row: number, tileSize: number): readonly Tuft[] {
  if (hashUnit(col, row, 1) >= TUFT_DENSITY) return [];
  const pad = tileSize * 0.16;
  return [
    {
      dx: pad + hashUnit(col, row, 2) * (tileSize - pad * 2),
      dy: pad + hashUnit(col, row, 3) * (tileSize - pad * 2),
      variant: hashUnit(col, row, 4) < 0.5 ? 0 : 1,
      scale: 0.55 + hashUnit(col, row, 5) * 0.35,
      phase: hashUnit(col, row, 6) * Math.PI * 2,
    },
  ];
}

/** Shared wind, so every tuft and every cloud on screen agrees about which way it is blowing. */
export function windSway(elapsedMs: number, phase: number): number {
  const t = elapsedMs / 1000;
  // Two incommensurate periods: a gust that never quite repeats reads as weather, one that repeats
  // on a tight loop reads as an animation.
  return Math.sin(t * 0.9 + phase) * 0.7 + Math.sin(t * 0.37 + phase * 1.7) * 0.3;
}

export interface CloudPlacement {
  x: number;
  y: number;
  scale: number;
  alpha: number;
}

/** Clouds cross the map in this many seconds, slowest first. */
const CLOUD_CROSSING_SECONDS = 90;

/**
 * Where cloud `index` of `count` is at `elapsedMs`.
 *
 * They wrap through a margin wider than the map so one never pops into existence at the edge, and
 * each drifts at its own speed — a formation moving in rigid lockstep reads as a texture sliding
 * over the screen rather than as sky.
 */
export function cloudPlacementAt(
  elapsedMs: number,
  index: number,
  count: number,
  worldWidth: number,
  worldHeight: number,
): CloudPlacement {
  const seed = index + 1;
  const speed = 0.6 + hashUnit(seed, 11, 7) * 0.8;
  const margin = worldWidth * 0.35;
  const span = worldWidth + margin * 2;
  const travelled = ((elapsedMs / 1000) * speed * span) / CLOUD_CROSSING_SECONDS;
  const start = (index / Math.max(1, count)) * span;
  return {
    x: ((((start + travelled) % span) + span) % span) - margin,
    // Spread down the map rather than banded at the top: the camera only ever sees a window of it.
    y: hashUnit(seed, 13, 8) * worldHeight,
    scale: 0.9 + hashUnit(seed, 17, 9) * 0.9,
    // Faint on purpose. A top-down camera has no sky behind a cloud, so an opaque one does not read
    // as "above" — it reads as fog lying on the grass. What sells the height is the SHADOW moving
    // with it; the cloud itself only has to hint.
    alpha: 0.13 + hashUnit(seed, 19, 10) * 0.11,
  };
}

/** How far a cloud's shadow lags behind it, as a fraction of the cloud's own size. */
export const CLOUD_SHADOW_OFFSET = { x: 0.12, y: 0.34 } as const;
export const CLOUD_SHADOW_ALPHA = 0.17;

/**
 * A seamless crest pattern for the sea, drawn once into a canvas.
 *
 * `tiny-swords-art.ts` is right that a *uniform colour* cannot scroll visibly, and right that a
 * photographic ocean is the wrong fix. This is the third option: the pack's own trick of banded
 * shapes, generated rather than authored, and applied only to the SECOND water layer — the flat fill
 * underneath is untouched, so the sea keeps its exact colour and gains only movement.
 *
 * Seamless in both axes because every term is a whole number of periods across the tile; posterised
 * to two hard steps because a smooth gradient beside this art reads as a rendering error.
 *
 * Two details are load-bearing and were both wrong on the first attempt:
 *
 *  - **Crests are long horizontal streaks, not a lattice.** Thresholding a product of two waves
 *    that both vary along x AND y leaves a regular grid of dots — the sea read as polka dots. The
 *    band has to run along one axis and be *wobbled* by the other.
 *  - **The size must match the flat water texture's**, because the renderer derives the scroll wrap
 *    period from that one (`water.width * WATER_TEXTURE_SCALE`). A wider pattern wraps out of step
 *    with its own scroll and tears a seam across the sea once per cycle.
 */
export function createWaveCanvas(size = 64): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(size, size);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      // A band running along x, its height wobbled by two whole periods of u. Whole periods only —
      // anything else and the tile seams.
      const wave = Math.sin(
        v * tau * 2 + Math.sin(u * tau * 1) * 1.15 + Math.sin(u * tau * 2) * 0.4,
      );
      // A thin crest and a thinner echo below it. Narrow thresholds: what should read is a line of
      // light on the water, not a painted stripe.
      const crest = wave > 0.93 ? 0.85 : wave > 0.84 ? 0.4 : 0;
      const offset = (y * size + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(crest * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Lighten a packed RGB towards white, for the crest layer's tint. */
export function lightenTint(tint: number, amount: number): number {
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
