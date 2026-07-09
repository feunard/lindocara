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

/** Fixed timestep, in seconds. Every tick advances the world by exactly this much. */
export const TICK_DT = 1 / TICK_HZ;

export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
export const PLAYER_SIZE = 32;

/** Pixels per second at full tilt. */
export const PLAYER_SPEED = 260;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NO_INPUT: Input = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
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
export function step(position: Vec2, input: Input, dt: number): Vec2 {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  if (dx !== 0 && dy !== 0) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }

  const distance = PLAYER_SPEED * dt;
  return {
    x: clamp(position.x + dx * distance, 0, WORLD_WIDTH - PLAYER_SIZE),
    y: clamp(position.y + dy * distance, 0, WORLD_HEIGHT - PLAYER_SIZE),
  };
}
