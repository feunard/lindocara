import {
  CameraShake,
  HERO_LANDING_SHAKE,
  heroLandingImpulse,
  MAX_CAMERA_SHAKE_OFFSET,
} from "@lindocara/renderer/camera-shake.js";
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

/** The rule clamps its landing weight to this band (`hero-step.ts`), so it is the only range the
 *  curve below is ever asked about. */
const SOFTEST_LANDING = 0.35;
const HARDEST_LANDING = 1.4;

describe("the hero's own landing shake", () => {
  it("is accepted by the shake at full strength, having no distance to lose any to", () => {
    const shake = new CameraShake();
    const impulse = heroLandingImpulse(HARDEST_LANDING, 1_000);
    expect(impulse).not.toBeNull();
    if (!impulse) return;
    expect(shake.trigger(impulse)).toBe(true);
    expect(Math.hypot(...Object.values(shake.offset(1_050)))).toBeGreaterThan(0);
  });

  it("stays linear in the fall's weight across the rule's whole band", () => {
    const soft = heroLandingImpulse(SOFTEST_LANDING, 0);
    const hard = heroLandingImpulse(HARDEST_LANDING, 0);
    expect(soft?.intensity).toBeCloseTo(SOFTEST_LANDING * HERO_LANDING_SHAKE.intensityPerForce, 8);
    expect(hard?.intensity).toBeCloseTo(HARDEST_LANDING * HERO_LANDING_SHAKE.intensityPerForce, 8);
    // The point of scaling by fall speed at all: stepping off a ledge must not feel like a plunge.
    expect((hard?.intensity ?? 0) / (soft?.intensity ?? 1)).toBeCloseTo(
      HARDEST_LANDING / SOFTEST_LANDING,
      8,
    );
  });

  it("stays well under the shakes reserved for authoritative heavy impacts", () => {
    // A landing is the player's own footwork, not a boss slam. If it ever rivalled one, the camera
    // would read every jump as an explosion — which is exactly the calibration the lab tuned away.
    expect(heroLandingImpulse(HARDEST_LANDING, 0)?.intensity).toBeLessThan(5.5);
  });

  it("shakes along a different axis for each landing, having no authoritative id to share", () => {
    const first = heroLandingImpulse(HARDEST_LANDING, 1_000);
    const second = heroLandingImpulse(HARDEST_LANDING, 1_050);
    expect(first?.id).not.toEqual(second?.id);
    const a = new CameraShake();
    const b = new CameraShake();
    if (first) a.trigger(first);
    if (second) b.trigger(second);
    expect(a.offset(1_060)).not.toEqual(b.offset(1_060));
  });

  it("refuses a landing the rule reported no weight for", () => {
    expect(heroLandingImpulse(0, 0)).toBeNull();
    expect(heroLandingImpulse(Number.NaN, 0)).toBeNull();
    expect(heroLandingImpulse(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });
});
