/**
 * The authoritative movement rules, shared verbatim by the server and the client.
 *
 * Nothing in here may touch the DOM, Workers APIs, timers, or randomness: the server
 * runs it to decide where players actually are, and one day the client will run the
 * identical code to predict its own square before the server confirms. Two copies of
 * this logic that drift apart is precisely the bug class client-side prediction exists
 * to expose, so there is only ever one copy.
 */

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Simulation remains at 20 Hz; network state is emitted every second simulation tick. */
export const NETWORK_SNAPSHOT_HZ = 10;
export const NETWORK_TICKS_PER_SNAPSHOT = TICK_HZ / NETWORK_SNAPSHOT_HZ;
export const NETWORK_SNAPSHOT_MS = 1000 / NETWORK_SNAPSHOT_HZ;

/** Fixed timestep, in seconds. Every tick advances the world by exactly this much. */
export const TICK_DT = 1 / TICK_HZ;

export const WORLD_WIDTH = 4800;
export const WORLD_HEIGHT = 2700;
export const PLAYER_SIZE = 32;

/**
 * Warrior/default speed at full tilt, in **tiles per second** — the exact quotient of the former
 * 260 px/s by `TILE_SIZE`, so a hero covers the same ground; only the ruler changed. Per-class
 * values live in `CLASS_STATS`.
 *
 * Written as a literal division rather than an import so `simulation.ts` keeps its place at the
 * bottom of the import graph (`tilemap.ts`, which owns `TILE_SIZE`, is above it).
 */
export const PLAYER_SPEED = 260 / 64;

export interface Vec2 {
  x: number;
  y: number;
}

export interface WorldBounds {
  width: number;
  height: number;
}

export const VERDANT_REACH_BOUNDS: WorldBounds = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
};

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Optional continuous stick axis values in [-1, 1]. */
  axisX?: number;
  axisY?: number;
}

export const NO_INPUT: Input = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
  axisX: 0,
  axisY: 0,
});

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Advance one player by `dt` seconds. Pure: same inputs, same output, no side effects.
 *
 * Diagonal movement is normalised, otherwise holding two keys would be ~41% faster than
 * holding one.
 */
export function clampToWorld(
  position: Vec2,
  bounds: WorldBounds | null = VERDANT_REACH_BOUNDS,
): Vec2 {
  if (bounds === null) return { x: position.x, y: position.y };
  return {
    x: clamp(position.x, 0, bounds.width - PLAYER_SIZE),
    y: clamp(position.y, 0, bounds.height - PLAYER_SIZE),
  };
}

/**
 * `bounds` accepts an explicit `null` — "this world is not a rectangle anchored at the origin".
 * A tile-unit grid is centred on the origin and runs `-size/2`..`+size/2`, so the pixel clamp
 * above would fence off its whole western and northern halves. The heightfield's own walkability
 * question (`canStand`, server-side) already refuses ground off the grid, which is a better
 * boundary than a rectangle: it also refuses the sea. Callers that still live in the pixel world
 * keep the default and are unaffected.
 */
export function step(
  position: Vec2,
  input: Input,
  dt: number,
  speed: number = PLAYER_SPEED,
  bounds: WorldBounds | null = VERDANT_REACH_BOUNDS,
): Vec2 {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }

  const distance = speed * dt;
  return clampToWorld(
    {
      x: position.x + dx * distance,
      y: position.y + dy * distance,
    },
    bounds,
  );
}
