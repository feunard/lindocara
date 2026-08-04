import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { describe, expect, it } from "vitest";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

describe("stepHero — swimming", () => {
  it("enters the water falling off an edge, and announces it exactly once", () => {
    const deps = depsPlates({ hauteur: (x) => (x < 0 ? 0 : null) });
    const s = createHeroState(-0.05, 0, 0, 10, 2.2);
    let entrees = 0;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s, { ...immobile, x: 1 }, 1 / 60, deps);
      entrees += evts.filter((e) => e.t === "entree-eau").length;
    }
    expect(s.swimming).toBe(true);
    expect(entrees).toBe(1);
  });

  it("drains breath at the rate the zone supplies, then drowns", () => {
    const deps = depsPlates({ hauteur: () => null });
    const s = createHeroState(0, 0, 0, 2, 2.2);
    s.swimming = true;
    // Rate 2: polar water drains twice as fast. A 2 s breath must therefore last 1 s.
    let noyades = 0;
    for (let i = 0; i < 90; i++) {
      noyades += stepHero(s, { ...immobile, souffleTaux: 2 }, 1 / 60, deps).filter(
        (e) => e.t === "noyade",
      ).length;
    }
    expect(noyades).toBe(1);
  });

  it("climbs onto a level shore, never a cliff", () => {
    const hauteM = depsPlates({ hauteur: (x) => (x > 0 ? 5 : null) });
    const s = createHeroState(-0.01, 0, 0, 10, 2.2);
    s.swimming = true;
    for (let i = 0; i < 60; i++) stepHero(s, { ...immobile, x: 1 }, 1 / 60, hauteM);
    expect(s.swimming).toBe(true);
  });

  // The trap the snow island uncovered (see `thin-ice.ts`'s `compteCommeEau` docstring): a BROKEN
  // thin-ice cell keeps the real, non-zero height of the terrain it covers — only its MATERIAL
  // changes (`kindAt`), never its height field (`heightAt`). Without the `compteCommeEau` guard,
  // `sol !== null` alone would be enough to surface the hero back out of the water one frame after
  // falling through the ice, before breath even had time to drop. The fix (the guard `&&`-ed with
  // `sol !== null`) is already in the ported code — this test covers it, which no code reading had.
  it("doesn't surface on its own on a broken ice cell sitting on terrain of non-zero height", () => {
    const rompue = {
      charge: () => "rompue" as const,
      relache: () => {},
      update: () => {},
      etat: () => "rompue" as const,
      taille: () => 0,
    };
    // Non-zero height EVERYWHERE: reproduces a thin-ice cell sitting on raised terrain — the hole
    // it left keeps the same terrain height as the rest of the island.
    const deps = { ...depsPlates({ hauteur: () => 5 }), glace: rompue };
    const s = createHeroState(0, 0, 0, 10, 2.2);
    s.swimming = true;
    const evts = stepHero(s, immobile, 1 / 60, deps);
    expect(s.swimming).toBe(true);
    expect(evts.some((e) => e.t === "sortie-eau")).toBe(false);
  });

  // The cadence debt this rule closed (see its originating task's report): the footstep gate is
  // evaluated INSIDE `stepHero`, AFTER the swim resolution — never before. Before that fix, the
  // gate still read `swimming === false` (the value from the START of the tick) right on the frame
  // water was just reached, and a footstep sound could fire on that same frame. Nothing pinned
  // this closure: this test does, in both directions (entry AND exit).
  it("never announces a footstep on the exact frame of a water entry or exit", () => {
    // Entry: land to the left (height 0), water to the right (null height) — an ordinary edge.
    const entreeDeps = depsPlates({ hauteur: (x) => (x < 0 ? 0 : null) });
    const s1 = createHeroState(-0.05, 0, 0, 10, 2.2);
    let vuEntree = false;
    for (let i = 0; i < 120; i++) {
      const evts = stepHero(s1, { ...immobile, x: 1 }, 1 / 60, entreeDeps);
      if (evts.some((e) => e.t === "entree-eau")) {
        vuEntree = true;
        expect(evts.some((e) => e.t === "pas")).toBe(false);
      }
    }
    expect(vuEntree).toBe(true);

    // Exit: level shore on both sides (height 0 everywhere, never null) — `sortie-eau` fires on
    // the very first frame; `input.x` propels the hero so the cadence has something to count if
    // it picked the wrong branch (footstep instead of stroke).
    const sortieDeps = depsPlates({ hauteur: () => 0 });
    const s2 = createHeroState(0, 0, 0, 10, 2.2);
    s2.swimming = true;
    const evts2 = stepHero(s2, { ...immobile, x: 1 }, 1 / 60, sortieDeps);
    expect(evts2.some((e) => e.t === "sortie-eau")).toBe(true);
    expect(evts2.some((e) => e.t === "pas")).toBe(false);
  });
});
