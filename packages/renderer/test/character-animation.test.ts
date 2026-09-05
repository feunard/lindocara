import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

import { CharacterAnimationTracker } from "../src/character-animation.js";
import { directionalFrame } from "../src/hd2d/billboards.js";
import { PRIEST_MANIFEST } from "../src/priest-art.js";

const player = {
  id: "priest",
  x: 0,
  y: 0,
  z: 0,
  hp: 100,
  airborne: false,
  swimming: false,
  gliding: false,
  action: null,
  life: "alive",
} as PlayerSnapshot;
const stride = PRIEST_MANIFEST.strideDistance;

describe("distance-clocked character animation", () => {
  it("spends exactly one cycle per stride at 30, 60 and 144 Hz, at walking and normal speeds", () => {
    for (const hz of [30, 60, 144])
      for (const speed of [1, PRIEST_MANIFEST.referenceSpeed]) {
        const tracker = new CharacterAnimationTracker();
        tracker.sample(player, 0, stride);
        let sample;
        for (let tick = 1; tick <= hz; tick++)
          sample = tracker.sample(
            { ...player, x: (speed * tick) / hz },
            (tick * 1000) / hz,
            stride,
          );
        expect(sample?.phase).toBeCloseTo((speed / stride) % 1, 10);
      }
  });

  it("keeps its phase through a turn, a stop and a restarted walk", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, stride);
    const first = tracker.sample({ ...player, x: 0.25 }, 100, stride);
    const turned = tracker.sample({ ...player, x: 0.25, z: 0.25 }, 200, stride);
    expect(turned.phase).toBeCloseTo(first.phase * 2);
    tracker.sample({ ...player, x: 0.25, z: 0.25 }, 300, stride);
    const resumed = tracker.sample({ ...player, x: 0.5, z: 0.25 }, 400, stride);
    expect(resumed.phase).toBeCloseTo(0.75 / stride);
  });

  it("ignores teleports, clock reversal, duplicate timestamps and a suspended tab", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, stride);
    const first = tracker.sample({ ...player, x: 0.2 }, 100, stride);
    expect(tracker.sample({ ...player, x: 99 }, 100, stride)).toBe(first);
    expect(tracker.sample({ ...player, x: 99 }, 200, stride).motion).toBe("idle");
    tracker.sample({ ...player, x: 100 }, 5000, stride);
    tracker.sample({ ...player, x: 100 }, 4990, stride);
    expect(tracker.sample({ ...player, x: 100.2 }, 5090, stride).phase).toBeCloseTo(0.4 / stride);
  });

  it("uses the real vertical state and completes a stationary landing once", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, stride);
    expect(tracker.sample({ ...player, airborne: true, vy: 9 }, 16, stride)).toMatchObject({
      motion: "jump",
      phase: 0,
    });
    expect(tracker.sample({ ...player, airborne: true, vy: 0 }, 300, stride)).toMatchObject({
      motion: "fall",
      phase: 0,
    });
    expect(tracker.sample({ ...player, airborne: true, vy: -9 }, 600, stride)).toMatchObject({
      motion: "fall",
      phase: 1,
    });
    expect(tracker.sample(player, 616, stride).motion).toBe("land");
    expect(tracker.sample(player, 700, stride).elapsedMs).toBe(84);
    expect(tracker.sample(player, 800, stride).motion).toBe("idle");
    expect(tracker.sample({ ...player, swimming: true }, 816, stride).motion).toBe("swim");
    expect(
      tracker.sample({ ...player, airborne: true, gliding: true, vy: -1 }, 832, stride).motion,
    ).toBe("glide");
  });

  it("never restarts an idle or hit clip on every update, or interrupts a server cast on damage", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, stride);
    expect(tracker.sample(player, 100, stride).elapsedMs).toBe(100);
    expect(tracker.sample({ ...player, hp: 90 }, 116, stride).motion).toBe("hurt");
    expect(tracker.sample({ ...player, hp: 90 }, 200, stride).elapsedMs).toBe(84);
    expect(
      tracker.sample({ ...player, hp: 80, action: { id: "cast" } } as PlayerSnapshot, 216, stride)
        .motion,
    ).toBe("attack");
  });
});

describe("full directional atlas", () => {
  it("covers eight real views and never mirrors the staff into the other hand", () => {
    for (let index = 0; index < 8; index++) {
      const angle = (index * Math.PI) / 4;
      expect(directionalFrame({ x: Math.sin(angle), z: Math.cos(angle) }, 0, 8, "full")).toEqual({
        row: index,
        flipped: false,
      });
      expect(
        directionalFrame({ x: Math.sin(angle + 0.7), z: Math.cos(angle + 0.7) }, 0.7, 8, "full"),
      ).toEqual({ row: index, flipped: false });
    }
  });
});
