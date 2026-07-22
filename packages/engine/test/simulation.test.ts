import {
  type Input,
  NETWORK_SNAPSHOT_HZ,
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  PLAYER_SIZE,
  PLAYER_SPEED,
  step,
  TICK_HZ,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@lindocara/engine/simulation.js";
import { describe, expect, it } from "vitest";

const input = (partial: Partial<Input>): Input => ({ ...NO_INPUT, ...partial });

describe("step", () => {
  it("simulates twice as often as it emits network world state", () => {
    expect(TICK_HZ).toBe(20);
    expect(NETWORK_SNAPSHOT_HZ).toBe(10);
    expect(NETWORK_SNAPSHOT_HZ).toBeLessThan(TICK_HZ);
    expect(NETWORK_TICKS_PER_SNAPSHOT).toBe(2);
    expect(Number.isInteger(NETWORK_TICKS_PER_SNAPSHOT)).toBe(true);
  });

  it("stays put with no input", () => {
    expect(step({ x: 100, y: 100 }, NO_INPUT, 1)).toEqual({ x: 100, y: 100 });
  });

  // Start mid-world: one second at PLAYER_SPEED covers 260px, so a start of 100 would be
  // clamped at the wall and this would measure the clamp rather than the speed.
  it("moves at PLAYER_SPEED along an axis", () => {
    expect(step({ x: 500, y: 500 }, input({ right: true }), 1)).toEqual({
      x: 500 + PLAYER_SPEED,
      y: 500,
    });
    expect(step({ x: 500, y: 500 }, input({ up: true }), 1)).toEqual({
      x: 500,
      y: 500 - PLAYER_SPEED,
    });
  });

  it("scales with dt", () => {
    const half = step({ x: 0, y: 100 }, input({ right: true }), 0.5);
    expect(half.x).toBeCloseTo(PLAYER_SPEED / 2, 6);
  });

  it("cancels opposing keys", () => {
    expect(step({ x: 100, y: 100 }, input({ left: true, right: true }), 1)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("normalises diagonals so they are not faster than axis movement", () => {
    const origin = { x: 400, y: 400 };
    const diagonal = step(origin, input({ right: true, down: true }), 1);

    const dx = diagonal.x - origin.x;
    const dy = diagonal.y - origin.y;
    const travelled = Math.hypot(dx, dy);

    expect(travelled).toBeCloseTo(PLAYER_SPEED, 6);
    expect(dx).toBeCloseTo(dy, 6);
  });

  it("clamps to the world so a square cannot leave it", () => {
    const topLeft = step({ x: 0, y: 0 }, input({ left: true, up: true }), 10);
    expect(topLeft).toEqual({ x: 0, y: 0 });

    const bottomRight = step(
      { x: WORLD_WIDTH, y: WORLD_HEIGHT },
      input({ right: true, down: true }),
      10,
    );
    expect(bottomRight).toEqual({
      x: WORLD_WIDTH - PLAYER_SIZE,
      y: WORLD_HEIGHT - PLAYER_SIZE,
    });
  });

  it("is pure — it does not mutate the position it is given", () => {
    const position = { x: 10, y: 10 };
    step(position, input({ right: true, down: true }), 1);
    expect(position).toEqual({ x: 10, y: 10 });
  });
});
