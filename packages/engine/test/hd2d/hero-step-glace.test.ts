import type { HeroState, StepDeps } from "@lindocara/engine/hd2d/hero-state.js";
import { createHeroState } from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { createThinIce } from "@lindocara/engine/hd2d/thin-ice.js";
import { describe, expect, it } from "vitest";
import { depsPlates } from "./helpers/step-deps.js";

const immobile = { x: 0, z: 0, jump: false, attack: false, souffleTaux: 1, haleineVisible: false };

function depsGlace() {
  const glace = createThinIce({ seuilCraquement: 0.5, seuilRupture: 1.4, regel: 6 });
  return { ...depsPlates({ matiere: () => "glace-fine" }), glace };
}

/** The same formula as `caseDe`, internal to `hero-step.ts` (duplicated on purpose, as the source
 *  file itself documents) — reproduced here to derive the cell key from the hero's ACTUAL position
 *  after the step, rather than hardcoding it: it's exactly that hardcoding that let a test through
 *  that proved nothing (see the originating task's report). */
function caseAttendue(s: HeroState, deps: StepDeps): string {
  const demiGrille = deps.world.size / 2;
  const zPied = s.z - deps.hero.offset;
  return `${Math.floor(s.x + demiGrille)},${Math.floor(zPied + demiGrille)}`;
}

describe("stepHero — thin ice", () => {
  it("cracks under weight, then gives way", () => {
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const vus: string[] = [];
    for (let i = 0; i < 120; i++) {
      for (const e of stepHero(s, immobile, 1 / 60, deps)) {
        if (e.t === "glace-craque" || e.t === "glace-rompt") vus.push(e.t);
      }
    }
    expect(vus).toEqual(["glace-craque", "glace-rompt"]);
    expect(s.swimming).toBe(true);
  });

  it("loads nothing when jumping over it", () => {
    // "Under weight" is the whole mechanism: flying over it must wear nothing down. The hero must
    // be ACTUALLY airborne — a real fall from a height, `vy` set to 0 to let gravity alone decide,
    // never an `airborne = true` faked at ground level — and the cell queried must be the one it
    // ACTUALLY occupies, derived from its position after the step (`caseAttendue`, below), never
    // hardcoded. A hardcoded key can stay "intacte" for a completely different reason than a hero
    // never actually crossing it (found reviewing this test: with the `createHeroState(x, z, y, …)`
    // signature, the old version placed the hero ON THE GROUND and queried a cell it never
    // occupied).
    const deps = depsGlace();
    const s = createHeroState(0, 0, 6, 10, 2.2);
    s.airborne = true;
    // 40 frames at 60 Hz (~0.67 s): still far from the ~65 frames a continuous fall from y=6
    // would take with this gravity — a wide margin to never touch the ground during the observed
    // window, while comfortably exceeding the cracking threshold (0.5 s) IF the `!state.airborne`
    // guard were removed (see the sabotage proof in the originating task's report).
    for (let i = 0; i < 40; i++) stepHero(s, immobile, 1 / 60, deps);
    expect(s.airborne).toBe(true);
    expect(deps.glace.etat(caseAttendue(s, deps))).toBe("intacte");
  });

  it("makes someone walking back on foot onto a hole already open fall through", () => {
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    for (let i = 0; i < 120; i++) stepHero(s, immobile, 1 / 60, deps);
    // Out of the water, step back onto the SAME cell, still broken.
    s.swimming = false;
    s.y = 0;
    const evts = stepHero(s, immobile, 1 / 60, deps);
    expect(evts.some((e) => e.t === "entree-eau" && e.rupture)).toBe(true);
  });
});
