/**
 * The simulation's clock and the shape of a movement intent. **No movement rule any more.**
 *
 * `step()` and `PLAYER_SPEED` retired with client-side prediction: the hero's movement rule is
 * `stepHero` (`./hd2d/hero-step.ts`), it runs on the client, and the server stores the position the
 * client reports rather than computing one of its own (see the S3 spec, decision 4). The baseline
 * walking speed moved to `CLASS_STATS.warrior.movementSpeed` (`./game.ts`), beside the other four
 * classes' — it was only here because `step()` defaulted to it.
 *
 * What is left is what still has consumers — the tick and snapshot rates the server runs on, the
 * pixel-era `PLAYER_SIZE`/`WORLD_*`/`clampToWorld` the unconverted zone catalogue in `game.ts` still
 * reads, and `Input`, the keyboard/gamepad intent shape the client's own input tracker and every
 * facing helper still speak.
 *
 * `Input` is no longer a COMMAND: nothing stamps it with a sequence, sends it, queues it or replays
 * it. It never crosses the wire again.
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

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Keeps a PIXEL position inside a world rectangle anchored at the origin. It outlived `step()`
 * because the unconverted pixel geometry in `game.ts` still calls it; nothing in the tile-unit
 * world does — a tile grid is centred on the origin, so a rectangle anchored at zero would fence
 * off its whole western and northern halves (`clampToGrid`, `terrain-access.ts`, is its successor).
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

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /**
   * Jump, as a LEVEL rather than an edge — `stepHero` reads the rising edge itself
   * (`HeroState.jumpHeld`). Optional because it arrived with client-owned movement and every older
   * `{up, down, left, right}` literal must keep compiling; absent reads as not pressed.
   */
  jump?: boolean;
  /** Optional continuous stick axis values in [-1, 1]. */
  axisX?: number;
  axisY?: number;
}

export const NO_INPUT: Input = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
  jump: false,
  axisX: 0,
  axisY: 0,
});
