import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { describe, expect, it } from "vitest";

describe("createHeroState", () => {
  it("starts still, on the ground, with a full breath", () => {
    const s = createHeroState(3, -4, 1.8, 12, 2.2);
    expect([s.x, s.y, s.z]).toEqual([3, 1.8, -4]);
    expect([s.vx, s.vz, s.vy]).toEqual([0, 0, 0]);
    expect(s.airborne).toBe(false);
    expect(s.swimming).toBe(false);
    expect(s.breath).toBe(12);
    // `groundY` MUST equal `y` at the start: it's `maxStep`'s reference, and leaving it at 0
    // would make the first step think it's dropping off a cliff the moment it starts at height.
    expect(s.groundY).toBe(1.8);
    // `reposHaleine` decides when the first breath puff fires: it must be initialized to the
    // passed parameter, otherwise a hero created at spawn would puff almost immediately instead
    // of waiting for the authored interval.
    expect(s.reposHaleine).toBe(2.2);

    // Assertion on EVERY remaining field, not on a handful: this is the test that keeps
    // `HeroState` complete, and a field left unasserted is a field whose starting value could
    // drift from `hero.ts`'s original without anything here signaling it.
    expect(s.facing).toBe(1);
    expect(s.room).toBeNull();
    expect(s.glaceCase).toBeNull();
    expect(s.glaceEtat).toBe("intacte");
    // `attaque` must start NEGATIVE, not 0: zero reads as "already mid-attack", which would put a
    // freshly spawned hero into strike animation on their very first frame.
    expect(s.attaque).toBe(-1);
    // `coteTrace` must start non-zero: `stepHero` alternates footprints by negating it
    // (`coteTrace = -coteTrace`), and 0 is a fixed point of that negation — every footprint would
    // then collapse onto the walking axis instead of alternating sides. `expect(-0).not.toBe(0)`
    // PASSES in JS, so a naive non-zero check wouldn't catch a `-0` starting value either — assert
    // the exact expected value instead.
    expect(s.coteTrace).toBe(1);
    expect(s.distanceDepuisLePas).toBe(0);
    expect(s.brasse).toBe(0);
    expect(s.coyote).toBe(0);
  });

  it("shares no structure between two states", () => {
    // A `createHeroState` that returned a shared frozen object would make two heroes drift apart
    // silently. Cheap to check, very expensive to discover later.
    const a = createHeroState(0, 0, 0, 10, 2.2);
    const b = createHeroState(0, 0, 0, 10, 2.2);
    a.vx = 5;
    expect(b.vx).toBe(0);
  });
});
