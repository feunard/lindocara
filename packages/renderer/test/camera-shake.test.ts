import { CameraShake, MAX_CAMERA_SHAKE_OFFSET } from "@lindocara/renderer/camera-shake.js";
import { describe, expect, it } from "vitest";

describe("local heavy-impact camera shake", () => {
  it("starts nearby, scales down with distance and expires at its declared duration", () => {
    const nearby = new CameraShake();
    const distant = new CameraShake();
    expect(
      nearby.trigger({
        id: "quake-a",
        now: 1_000,
        intensity: 10,
        durationMs: 400,
        distance: 0,
        maxDistance: 500,
      }),
    ).toBe(true);
    expect(
      distant.trigger({
        id: "quake-a",
        now: 1_000,
        intensity: 10,
        durationMs: 400,
        distance: 400,
        maxDistance: 500,
      }),
    ).toBe(true);

    expect(Math.hypot(...Object.values(nearby.offset(1_100)))).toBeGreaterThan(
      Math.hypot(...Object.values(distant.offset(1_100))),
    );
    expect(nearby.offset(1_400)).toEqual({ x: 0, y: 0 });
  });

  it("does not shake a camera at or beyond the local effect radius", () => {
    const shake = new CameraShake();
    expect(
      shake.trigger({
        id: "quake-far",
        now: 0,
        intensity: 10,
        durationMs: 400,
        distance: 500,
        maxDistance: 500,
      }),
    ).toBe(false);
    expect(shake.offset(100)).toEqual({ x: 0, y: 0 });
  });

  it("combines simultaneous impacts deterministically and clamps the final magnitude", () => {
    const first = new CameraShake();
    const second = new CameraShake();
    for (const shake of [first, second]) {
      for (const id of ["quake-a", "quake-b", "quake-c"]) {
        expect(
          shake.trigger({
            id,
            now: 0,
            intensity: 100,
            durationMs: 500,
            distance: 0,
            maxDistance: 500,
          }),
        ).toBe(true);
      }
    }
    const offset = first.offset(100);
    expect(second.offset(100)).toEqual(offset);
    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(MAX_CAMERA_SHAKE_OFFSET, 8);
  });

  it("clears all active impulses on a scene transition", () => {
    const shake = new CameraShake();
    shake.trigger({
      id: "quake-a",
      now: 0,
      intensity: 10,
      durationMs: 500,
      distance: 0,
      maxDistance: 500,
    });
    shake.clear();
    expect(shake.offset(100)).toEqual({ x: 0, y: 0 });
  });
});
