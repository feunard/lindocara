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
    // 40 frames at 60 Hz (~0.67 s): still far from the ~49 frames a continuous fall from y=6
    // would take with this gravity (semi-implicit Euler: y - g·dt²·n(n+1)/2 <= 0 first holds at
    // n=49) — a wide margin to never touch the ground during the observed window, while
    // comfortably exceeding the cracking threshold (0.5 s) IF the `!state.airborne` guard were
    // removed (see the sabotage proof in the originating task's report).
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

  it("releases a loaded cell on entering a room, so it can refreeze instead of staying loaded forever", () => {
    // Latent on the shipped map (the lab's only room sits on the tropical island, thin ice is up
    // north), so nothing under `apps/lab/test/` exercises this — this test is the only thing that
    // does. Before this fix, the whole vertical/thin-ice block lived nested inside
    // `if (!state.room) { … }`: entering a room skipped it ENTIRELY, so a cell loaded right before
    // stepping indoors stayed loaded forever — never released, so never refrozen, growing
    // `ThinIce`'s table without bound (exactly what `taille()` exists to prove doesn't happen).
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const cle = caseAttendue(s, deps);

    // Load the cell just enough to crack it, not break it: 35 frames at 60 Hz is ~0.58 s, past the
    // 0.5 s cracking threshold but comfortably under the 1.4 s breaking one.
    for (let i = 0; i < 35; i++) stepHero(s, immobile, 1 / 60, deps);
    expect(s.glaceCase).toBe(cle);
    expect(deps.glace.etat(cle)).toBe("craquelee");
    expect(deps.glace.taille()).toBe(1);

    // Walk into a room. The vertical/thin-ice block above never runs again while `state.room` is
    // set — the release must therefore happen somewhere `stepHero` reaches regardless.
    s.room = { x0: -5, x1: 5, z0: -5, z1: 5, y: 0, obstacles: [] };
    stepHero(s, immobile, 1 / 60, deps);

    // The cell must have been let go, not left loaded under a hero who is no longer anywhere near
    // it: `HeroState.glaceCase` no longer points to it, and its refreeze countdown has started
    // rather than the load staying frozen in place.
    expect(s.glaceCase).toBeNull();
    expect(s.glaceEtat).toBe("intacte");
    deps.glace.update(6.1); // `depsGlace()`'s `regel` is 6 — comfortably past it
    expect(deps.glace.etat(cle)).toBe("intacte");
    expect(deps.glace.taille()).toBe(0);
  });

  it("refreezes and can be crossed again, once the adapter's job of advancing update() every frame is done", () => {
    // `stepHero` never calls `deps.glace.update()` itself (see `StepDeps.glace`'s docstring) — the
    // caller must, every frame, regardless of what the hero is doing. This test reproduces that
    // loop by hand, end to end: crack, break, swim away, wait out the refreeze, and prove the cell
    // is crossable again rather than a permanent hole.
    const deps = depsGlace();
    const s = createHeroState(0, 0, 0, 10, 2.2);
    const cle = caseAttendue(s, deps);
    const dt = 1 / 60;

    let cassee = false;
    for (let i = 0; i < 120 && !cassee; i++) {
      deps.glace.update(dt);
      for (const e of stepHero(s, immobile, dt, deps)) {
        if (e.t === "glace-rompt") cassee = true;
      }
    }
    expect(cassee).toBe(true);
    expect(s.swimming).toBe(true);

    // `rompre` already released the cell the instant it gave way, so its refreeze countdown is
    // already running: advancing `update()` alone, with nobody standing on it, is enough — no need
    // to keep calling `stepHero`.
    for (let i = 0; i < 400; i++) deps.glace.update(dt);
    expect(deps.glace.etat(cle)).toBe("intacte");
    expect(deps.glace.taille()).toBe(0);

    // Walking back onto it now must NOT fall through immediately: it's intact again, so crossing
    // it must crack and break all over, exactly like the very first crossing.
    s.swimming = false;
    s.x = 0;
    s.y = 0;
    s.z = 0;
    const evts = stepHero(s, immobile, dt, deps);
    expect(evts.some((e) => e.t === "entree-eau" && e.rupture)).toBe(false);
  });
});
