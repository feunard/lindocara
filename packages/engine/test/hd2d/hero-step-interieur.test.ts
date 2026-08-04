import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };
const piece = { x0: -2, x1: 2, z0: -2, z1: 2, y: 5, obstacles: [{ x: 0, z: 1, r: 0.5 }] };

describe("stepHero — indoors", () => {
  it("keeps the floor flat: no gravity, no swimming, no jumping", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.room = piece;
    // Non-zero starting speeds, to test they aren't crushed to zero by leaveWater.
    s.vx = 2;
    s.vz = 2;
    const evts = stepHero(s, { ...immobile, jump: true }, 1 / 60, deps);
    expect(s.y).toBe(5);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(evts.some((e) => e.t === "saut")).toBe(false);
    // Extra assertions: no water exit should be emitted indoors, and speeds must not be crushed to
    // zero (which is what leaveWater would have done had the swimming block run).
    expect(evts.some((e) => e.t === "sortie-eau")).toBe(false);
    expect(s.vx).not.toBe(0);
    expect(s.vz).not.toBe(0);
  });

  it("doesn't leave the rectangle and goes around furniture", () => {
    const deps = depsPlates();
    // (x, z, y, breath, reposHaleine) — NOT (x, y, z). The original brief for this test gave
    // `createHeroState(0, 5, 0, …)`, which actually places the hero at z=5, outside the rectangle
    // (z1=2): the test would stay green even with the bounding rule fully removed, since
    // `canEnter` would then refuse ALL movement (z always outside the room), not just the part
    // that crosses x1. The hero is placed inside here, at floor level (y=5, `piece`'s height), so
    // the test actually proves what it claims.
    const s = createHeroState(0, 0, 5, 10, 2.2);
    s.room = piece;
    for (let i = 0; i < 300; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
    // Asserted on the state rather than assumed (see above): the room floor must stay active the
    // whole way through, not just on the first step.
    expect(s.airborne).toBe(false);
    expect(s.x).toBeLessThan(2);
  });

  it("lets someone already overlapping a piece of furniture step back out", () => {
    // The escape hatch: without it, a hero standing on furniture is cemented in place.
    const deps = depsPlates();
    // Same ordering fix as above: z=1 places the hero RIGHT ON `piece`'s obstacle (x:0, z:1,
    // r:0.5), y=5 at floor level.
    const s = createHeroState(0, 1, 5, 10, 2.2);
    s.room = piece;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, z: -1 }, 1 / 60, deps);
    expect(s.z).toBeLessThan(1);
  });
});
