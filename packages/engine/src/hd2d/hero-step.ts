// The hero's movement rule — horizontal AND vertical —, pure. No `three`, no audio, no billboard:
// it reads a state, advances it by one step, and NARRATES what happened (see `HeroEvent`). The
// adapter (the lab's `hero.ts`) plays those events — an audio call slipped in here would silently
// break this purity, and nothing in the typecheck or the tests would see it.
//
// It mutates `state` in place: this step runs at 60 Hz and nothing keeps the previous state
// around, so a copy per frame would be an allocation for nothing — the same reason the lab's
// recycled billboard batches exist.
//
// MOVED from the lab's `hero.ts` (the old horizontal section of `update()`, and `canEnter`/
// `centreOk`, before the movement model got extracted; the jump/gravity/coyote/landing before the
// friction model landed; water entry/exit, drowning and swim-stroke cadence before swimming was
// added; thin ice — `tomber()` and cell crack/break tracking — before thin ice was added; visible
// breath and footprints — their CADENCE only, never their rendering — before those were added):
// the rules did not change shape, only file — see each originating task's report for the accepted
// divergences (`facing`'s update, which stayed in `hero.ts` — see below —, the landing-impact
// clamp, written by hand since `three` cannot be imported here, and the respawn-on-drowning
// teleport, which stayed in `hero.ts` — see `drown`'s docstring below).

import type {
  HeroEvent,
  HeroInput,
  HeroSettings,
  HeroState,
  StepDeps,
  WorldSettings,
} from "./hero-state.js";
import { derapage, frictionPour, pasAmorti, sePropulse, vitesseMaxPour } from "./locomotion.js";
import { compteCommeEau, tombeEnArrivant } from "./thin-ice.js";

/** Center of the collision footprint, offset under the sprite's body — MOVED from the lab's
 *  `hero.ts`, where an identical local helper used to live before this rule was extracted;
 *  `hero.ts` keeps no copy of its own anymore (it has no rule left in it at all, see
 *  `apps/lab/AGENTS.md`). Kept as its own function here, not exported and reimported, because
 *  `hero-step.ts` must import NO lab setting, not even through a shared module that would carry
 *  it along at the move into `engine`. */
function empreinte(z: number, hero: HeroSettings): number {
  return z - hero.offset;
}

/**
 * Can a foot land at `(x, z)` — ported as is from the lab's `hero.ts` (`canEnter` and its nested
 * `centreOk`), which used to read `pos`/`piece`/`airborne`/`swimming`/`groundY` from a closure;
 * here those are `state`'s fields and `deps`'s settings. Called one axis at a time by `stepHero`:
 * this is what makes the hero slide along a wall taken diagonally rather than stick to it flat
 * (see its test in `hero-step-horizontal.test.ts`).
 */
function canEnter(state: HeroState, x: number, z: number, deps: StepDeps): boolean {
  const { query, colliders, hero, world } = deps;
  const climb = world.levelHeight * hero.swim.climb;
  const maxStep = world.maxStep * world.levelHeight + 1e-3;
  const surfaceAt = (xx: number, zz: number) => query.heightAt(xx, zz) ?? world.waterLevel;

  // Indoors, terrain relief and props no longer apply: the room is a plain rectangle, sitting
  // outside the terrain grid.
  if (state.room) {
    const p = state.room;
    if (!(x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1)) return false;
    // Furniture is avoided, with the same escape hatch as outdoors: if already overlapping one,
    // it must still be possible to step out of it.
    const dans = (px: number, pz: number) =>
      p.obstacles.some((o) => (o.x - px) ** 2 + (o.z - pz) ** 2 < (o.r + hero.radius) ** 2);
    return !dans(x, z) || dans(state.x, state.z);
  }

  // The ground under the CENTER decides where a foot can land. A hard rule: never relaxed, or the
  // hero would climb a cliff by leaning into it.
  const centreOk = (xx: number, zz: number): boolean => {
    const h = surfaceAt(xx, empreinte(zz, hero));
    if (state.swimming) return h - world.waterLevel <= climb;
    return state.airborne ? h <= state.y + 0.02 : h - state.groundY <= maxStep;
  };
  if (!centreOk(x, z)) return false;

  // Relief is tested against the hero's disc, not its center: otherwise it sinks half its body
  // into a wall before being stopped.
  const h = query.maxHeightAround(x, empreinte(z, hero), hero.radius);
  const plafond = state.swimming
    ? world.waterLevel + climb
    : state.airborne
      ? state.y + 0.02
      : state.groundY + maxStep;
  if (h > plafond) {
    // Already overlapping something too tall — the case right after falling at the foot of a
    // cliff, the disc still biting into the cell above. Without this escape hatch, NO movement at
    // all is allowed, not even to move away from it, and the hero stays cemented in place.
    const ici = query.maxHeightAround(state.x, empreinte(state.z, hero), hero.radius);
    if (!(ici > plafond && h <= ici)) return false;
  }

  if (!colliders.blocked(x, empreinte(z, hero), hero.radius)) return true;
  // Same escape hatch against props (an unlucky spawn, a prop added underneath).
  return colliders.blocked(state.x, empreinte(state.z, hero), hero.radius);
}

/** Key of the thin-ice cell under a world point — MOVED from the lab's `hero.ts`'s internal
 *  `caseDe` (itself aligned with `TerrainQuery`, see `terrain-query.ts`'s `toCell`); `hero.ts`
 *  keeps no copy of its own anymore, same as `empreinte` above. Kept as its own function here
 *  rather than exported and reimported: `hero-step.ts` must import NO lab setting (see the file
 *  header). */
function caseDe(x: number, z: number, world: WorldSettings): string {
  const demiGrille = world.size / 2;
  return `${Math.floor(x + demiGrille)},${Math.floor(z + demiGrille)}`;
}

/**
 * Enters the water: position at water level, breath full, speed cut. Zeroing `vx`/`vz` is
 * LOAD-BEARING (see the file header): without it, the hero would enter the water still carrying
 * the momentum of the ice they just left.
 *
 * `rupture` distinguishes an ordinary splash (edge, fall — called below with `false`) from thin
 * ice giving way under weight (`rompre`, just below, with `true`) — two callers of THIS function
 * rather than two implementations. Both have lived inside `stepHero` since thin ice was added: no
 * need to export it beyond this file anymore, the adapter (`hero.ts`) now only READS `rupture` on
 * the returned `entree-eau` event to pick the sound (an ordinary splash or the `plunge` of ice
 * giving way), and never calls this function itself anymore.
 *
 * The return type is the PRECISE member of the `HeroEvent` union, not `HeroEvent` in general:
 * `rompre` (just below) reads `x`/`z` off the returned value without re-testing `t`, which
 * `HeroEvent` alone would not allow (the union's other members don't all carry those fields).
 */
function enterWater(
  state: HeroState,
  deps: StepDeps,
  rupture: boolean,
): Extract<HeroEvent, { t: "entree-eau" }> {
  const { hero, world } = deps;
  state.swimming = true;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  state.y = world.waterLevel;
  state.groundY = world.waterLevel;
  return { t: "entree-eau", x: state.x, y: world.waterLevel, z: state.z, rupture };
}

/**
 * Thin ice: the cell `cle` gives way under weight — whether it just finished cracking, or was
 * found already broken while walking back onto it (`tombeEnArrivant`, called by `stepHero`
 * below). Weight LEAVES the cell as it gives way: released right away, by the rule itself —
 * otherwise refreezing would never get the chance to start, since `thinIce.update()` only
 * touches cells already released. `stepHero` never calls `update()` itself — see `StepDeps.glace`
 * for who must, and when. Breaking through must LEAD INTO water entry, not reimplement it, hence
 * the call to `enterWater` above rather than a second copy of the same mechanic.
 *
 * Returns BOTH events, in this order: `glace-rompt` (the final crack sound, `shatter()`) then
 * `entree-eau` with `rupture: true` (the splash and `plunge()` — already wired in `hero.ts` before
 * this rule was even extracted, see its docstring). This is the exact order the old `hero.ts`'s
 * `tomber()` used to play (`shatter()` before `plunge()`); preserving it here spares the adapter
 * from having to reconstruct an order the event array can simply carry as is.
 */
function rompre(state: HeroState, deps: StepDeps, cle: string): HeroEvent[] {
  const x = state.x;
  const z = state.z;
  deps.glace.relache(cle);
  state.glaceCase = null;
  const entree = enterWater(state, deps, true);
  return [{ t: "glace-rompt", cle, x, z }, entree];
}

/** Leaves the water onto a shore at `y` — never a cliff: `canEnter` (above, the `climb`
 *  constraint) has already ruled that out upstream, this function only records the exit. */
function leaveWater(state: HeroState, deps: StepDeps, y: number): HeroEvent {
  const { hero, world } = deps;
  state.swimming = false;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  state.y = y;
  state.groundY = y;
  return { t: "sortie-eau", x: state.x, y: world.waterLevel, z: state.z };
}

/**
 * Breath is exhausted. The event carries the DROWNING position — where the splash should appear —
 * never the respawn position: that teleport (to `spawn`, at the terrain height there) stays the
 * adapter's (`hero.ts`) job, since it ALONE knows `spawn` — `stepHero` never receives it as a
 * parameter, on purpose (see the file header).
 */
function drown(state: HeroState, deps: StepDeps): HeroEvent {
  const { hero, world } = deps;
  const x = state.x;
  const z = state.z;
  state.swimming = false;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  return { t: "noyade", x, y: world.waterLevel, z };
}

export function stepHero(
  state: HeroState,
  input: HeroInput,
  dt: number,
  deps: StepDeps,
): HeroEvent[] {
  const events: HeroEvent[] = [];
  const { query, hero, world } = deps;

  const empreinteZ = (z: number) => empreinte(z, hero);
  const avantX = state.x;
  const avantZ = state.z;

  // The material UNDER THE FEET, before moving, picks the friction and speed cap. Swimming or
  // indoors, the real seabed / virtual-coordinate material has no physical meaning: fall back to
  // `null` (= grass).
  const matiere = state.swimming || state.room ? null : query.kindAt(state.x, empreinteZ(state.z));
  const friction = frictionPour(matiere, hero);
  const vmax = state.swimming ? hero.speed * hero.swim.speed : vitesseMaxPour(matiere, hero);
  const accel = vmax * friction;

  state.vx = pasAmorti(state.vx, input.x, accel, friction, dt);
  state.vz = pasAmorti(state.vz, input.z, accel, friction, dt);

  // Skid (a held sound): `derapage` never looks at the material — cut here only in the air and
  // while swimming, where a ground skid means nothing. Emitted every FRAME, never only on
  // trigger: it's a held sound, not a click.
  events.push({
    t: "glisse",
    intensite:
      state.airborne || state.swimming
        ? 0
        : derapage(state.vx, state.vz, input.x, input.z, hero.speed),
  });
  // Same signal, thresholded into a boolean: only count a footstep if the hero is actually
  // propelling, not if carried by momentum (ice) — see the footstep cadence below.
  const propulsion = sePropulse(state.vx, state.vz, input.x, input.z);

  // One axis at a time: hitting an obstacle diagonally slides along it. On the refused axis, speed
  // drops to zero, otherwise the hero would stay stuck to the wall at full speed and shoot off the
  // instant they move away from it.
  const nx = state.x + state.vx * dt;
  if (canEnter(state, nx, state.z, deps)) state.x = nx;
  else state.vx = 0;
  const nz = state.z + state.vz * dt;
  if (canEnter(state, state.x, nz, deps)) state.z = nz;
  else state.vz = 0;

  // --- vertical: room floor, ground, jump, gravity, coyote, landing --------------------------
  // Ported as is from the lab's `hero.ts` — plus the room floor and the `sol` (ground) computation
  // that preceded it: the latter must be read AFTER the horizontal resolution above (the cell
  // under the feet may have changed this very step — otherwise jumping right at a cliff's edge
  // would detect the void one frame late), so the rule must recompute it itself rather than
  // receive it as a parameter. `hero.ts` recomputes `sol`/`eau` (ground/water) a second time, for
  // what still lives there in closure over audio and billboards (swimming, thin ice, water entry)
  // — a second pure call, not a replayed resolution.
  if (state.room) {
    // Flat floor: no gravity, no swimming, no jumping. Footsteps are kept.
    state.y = state.room.y;
    state.airborne = false;
    state.swimming = false;
    state.vy = 0;
  }
  const sol = state.room ? state.room.y : query.heightAt(state.x, empreinteZ(state.z));

  // Indoors, the floor is flat: no gravity, no swimming, no jumping. The whole vertical block is
  // guarded by `!state.room` so none of these mechanics run indoors.
  if (!state.room) {
    if (!state.swimming) {
      const ground = sol ?? world.waterLevel;
      if (state.airborne) {
        state.coyote -= dt;
      } else if (ground < state.y - 1e-3) {
        state.airborne = true; // the ground gave way: falling, not sliding
        state.vy = 0;
      } else {
        state.y = ground;
        state.groundY = ground;
        state.coyote = hero.jump.coyote;
      }

      // No jumping from the water, and coyote time: a few frames are forgiven after leaving an
      // edge.
      if (input.jump && state.coyote > 0) {
        state.vy = hero.jump.speed;
        state.airborne = true;
        state.coyote = 0;
        events.push({ t: "saut" });
      }

      if (state.airborne) {
        state.vy -= hero.jump.gravity * dt;
        state.y += state.vy * dt;
        if (state.vy <= 0 && state.y <= ground) {
          state.y = ground;
          state.groundY = ground;
          // Landing weight follows fall speed — for the sound as much as for the camera shake.
          // `Math.min(Math.max(...))` rather than `THREE.MathUtils.clamp`: this rule does not
          // import `three` (see the file header).
          const impact = Math.min(1.4, Math.max(0.35, -state.vy / hero.jump.speed));
          events.push({ t: "reception", force: impact });
          state.vy = 0;
          state.airborne = false;
          state.distanceDepuisLePas = 0;
        }
      }

      // --- thin ice: load / break ---------------------------------------------------------------
      // Ported as is from the lab's `hero.ts` (`tomber()` and `update()`'s `surGlaceFine` block) —
      // WITHOUT an explicit `!state.swimming` guard: this section deliberately lives BEFORE the
      // ordinary water-entry check just below, inside the `if (!state.swimming)` branch opened
      // above. `state.swimming` there still reflects the START of this branch (nothing on THIS
      // branch has mutated it yet — the only earlier write in `stepHero`, the room branch above,
      // cannot have run in the same call: `state.room` is constant for the whole of one
      // `stepHero` invocation, so the two branches are mutually exclusive) — exactly what the old
      // `hero.ts` achieved by snapshotting `swimming` BEFORE calling `stepHero`
      // (`nageaitDejaCeTick`, now unnecessary: this block now lives at the right SPOT in the
      // sequence instead of needing a value set aside). Breaking through HERE flips
      // `state.swimming` to `true` (see `rompre`), but the ordinary-water check right after has no
      // effect on a thin-ice cell: `sol` there is a real number (the ice sheet has full relief),
      // never `null`.
      //
      // ONLY the load/break path lives here, scoped to where loading makes sense: outdoors,
      // grounded (`!state.airborne` — only under WEIGHT, jumping over it loads nothing, that's the
      // whole mechanism, see the spec), not swimming. The RELEASE path — a loaded cell letting go
      // the instant the weight is gone, for ANY reason — runs unconditionally after the whole
      // `!state.room` block below, see the comment there for why it can't stay nested in here.
      // `!state.room` is already guaranteed by the enclosing branch (line above), so this guard is
      // redundant but kept out of caution: it's a reminder that a room's virtual coordinates must
      // never query the real terrain.
      const surGlaceFine =
        !state.airborne &&
        !state.room &&
        query.kindAt(state.x, empreinteZ(state.z)) === "glace-fine";
      if (surGlaceFine) {
        const cle = caseDe(state.x, empreinteZ(state.z), world);
        if (cle !== state.glaceCase) {
          // A different cell than the previous one (or the first cell of the crossing): the old
          // one is no longer under weight, and this one resumes its state wherever it was — maybe
          // already cracked by an earlier crossing that hasn't had time to refreeze yet.
          if (state.glaceCase) deps.glace.relache(state.glaceCase);
          state.glaceCase = cle;
          state.glaceEtat = deps.glace.etat(cle);
        }
        if (tombeEnArrivant(state.glaceEtat)) {
          // Arriving (on foot) directly onto a hole already open (not yet refrozen): nothing to
          // load, `tombeEnArrivant` (`thin-ice.ts`) says so without delay — see its docstring. This
          // was the second bug the snow island found (found by playing, not by reading): without
          // this question asked separately, walking back on foot onto a hole already open
          // triggered nothing, since the original logic only reacted to TRANSITIONS while a cell
          // was loading.
          events.push(...rompre(state, deps, cle));
        } else {
          const etatSuivant = deps.glace.charge(cle, dt);
          if (etatSuivant !== state.glaceEtat) {
            state.glaceEtat = etatSuivant;
            if (etatSuivant === "craquelee") {
              events.push({ t: "glace-craque", cle, x: state.x, z: state.z });
            } else if (tombeEnArrivant(etatSuivant)) {
              events.push(...rompre(state, deps, cle));
            }
          }
        }
      }

      // --- ordinary water entry -----------------------------------------------------------------
      // Edge or fall — thin ice above already handled its own water entry (`rompre`), so `eau`
      // (water) can only be true on a cell that isn't one. Evaluated HERE, at the end of the
      // vertical resolution: `state.swimming` is therefore already up to date for the
      // footstep/stroke cadence just below, on this SAME frame — breaking through thin ice also
      // mutates `state.swimming` before the cadence is evaluated further down, which was not the
      // case while `tomber()` still lived in `hero.ts`, AFTER `stepHero` returned. `!state.room`
      // is already guaranteed by the enclosing branch, same as `surGlaceFine`'s above: redundant
      // but kept out of caution, as the same reminder that a room's virtual coordinates must never
      // be read as if they were real terrain.
      const eau = !state.room && sol === null;
      if (eau && !state.airborne) events.push(enterWater(state, deps, false));
    } else {
      // --- swim resolution -----------------------------------------------------------------------
      // Ported as is from the lab's `hero.ts`: exiting onto a shore, or progressive drowning.
      // `dansUnTrou` reproduces the `compteCommeEau` guard already present in the original code
      // (see its docstring, `thin-ice.ts`) — WITHOUT it, a broken thin-ice cell sitting on terrain
      // of NON-ZERO height would surface the hero back out of the water one frame after falling
      // in: `sol` there stays a real number, `kindAt` changing a cell's material, never its
      // height. This is the trap the snow island uncovered by playing — covered by
      // `hero-step-nage.test.ts`.
      const dansUnTrou = compteCommeEau(
        deps.glace.etat(caseDe(state.x, empreinteZ(state.z), world)),
      );
      if (sol !== null && !dansUnTrou) {
        events.push(leaveWater(state, deps, sol));
      } else {
        state.y = world.waterLevel;
        // The rate comes from the zone (see `HeroInput.souffleTaux`): the hero no longer needs to
        // know WHICH water drains faster, only to read what it's given.
        state.breath -= dt * input.souffleTaux;
        if (state.breath <= 0) events.push(drown(state, deps));
      }
    }
  }

  // --- thin ice: release, unconditionally ------------------------------------------------------
  // A cell loaded under the hero's weight must let go the instant that weight is gone — for ANY
  // reason: a jump, swimming off it, stepping to a different cell, or (the bug this guards
  // against) walking into a room. The load/break path above lives nested inside
  // `!state.room && !state.swimming`, because loading only makes sense there; this release does
  // NOT live nested the same way, on purpose — the whole `if (!state.room) { … }` block above
  // never runs at all while indoors, so a cleanup nested inside it would never fire for a cell
  // loaded right before stepping through a door. Before this fix, that was exactly the bug: the
  // cell stayed loaded FOREVER once indoors — it never refroze (see `taille()`, which exists to
  // prove `ThinIce`'s table never grows without bound) and the crack decal kept following the hero
  // inside the house. Evaluated here, once, regardless of room/swimming/airborne, is what makes
  // the release actually unconditional in `stepHero` rather than in some outer caller.
  //
  // `state.room ||` is checked FIRST and short-circuits the rest: a room's virtual coordinates
  // must never reach `query.kindAt` (see the load/break comment above for the same rule).
  if (
    state.glaceCase !== null &&
    (state.room ||
      state.swimming ||
      state.airborne ||
      query.kindAt(state.x, empreinteZ(state.z)) !== "glace-fine")
  ) {
    deps.glace.relache(state.glaceCase);
    state.glaceCase = null;
    state.glaceEtat = "intacte";
  }

  // Footstep/stroke cadence is by DISTANCE traveled — footsteps only count when actually
  // propelling (skidding advances without any foot leaving the ground), strokes on every advance
  // while swimming. Evaluated HERE, after both the vertical AND swim resolution above:
  // `airborne`/`swimming` are therefore up to date for the CURRENT frame, not the previous one —
  // closing the bounded parity gap left at landing and ordinary-water-transition frames by the
  // original extraction (see its report), since the old code evaluated the equivalent condition
  // after this very ground/water resolution. `facing` (the sprite's orientation) is NOT updated
  // here, on purpose: `hero.ts` drives it from `input.x` as is, not from `state.vx` — see that
  // report for the divergence from the original brief (driving from `vx` would delay the flip on
  // ice, where speed takes time to change sign after a U-turn, which the game never did before
  // that extraction).
  const avance = Math.hypot(state.x - avantX, state.z - avantZ);
  if (state.swimming) {
    state.brasse -= dt;
    if (avance > 1e-4 && state.brasse <= 0) {
      events.push({ t: "brasse" });
      state.brasse = hero.brasseTousLes;
    }
  } else if (!state.airborne && propulsion) {
    state.distanceDepuisLePas += avance;
    if (state.distanceDepuisLePas >= hero.pasTousLes) {
      state.distanceDepuisLePas = 0;
      const matiere = query.kindAt(state.x, empreinteZ(state.z)) ?? "herbe";
      events.push({ t: "pas", matiere });

      // Breath and footprints: MOVED from the lab's `hero.ts` (the old `e.t === "pas"` block of
      // `update()`) — their cadence is the FOOTSTEP cadence, so it lives here, in the same place as
      // the footstep itself, rather than forcing the adapter to recompute it. The idle-breath timer
      // is rearmed on EVERY footstep, whether `haleineVisible` or not — only the EMISSION depends
      // on it, exactly like the old block (`if (input.haleineVisible) emitHaleine();
      // state.reposHaleine = …`, with no guard on the second line).
      if (input.haleineVisible) events.push({ t: "haleine" });
      state.reposHaleine = hero.haleineRepos;

      // A footprint is only laid on snow, and only HERE: this branch is reached ONLY when actually
      // propelling (`propulsion`, see above) — skidding on ice advances without any foot leaving
      // the ground, so it never lays one.
      if (matiere === "neige") {
        // Alternating left/right from one footprint to the next, and its PERPENDICULAR offset
        // relative to speed (a 90° rotation of the normalized speed vector): without this offset,
        // two consecutive footsteps would overlap and read as a single blob rather than a trail.
        // Ported as is from the lab's `hero.ts` (`poserTrace`).
        state.coteTrace = -state.coteTrace;
        const norme = Math.hypot(state.vx, state.vz) || 1;
        const px = (-state.vz / norme) * hero.traceEcart * state.coteTrace;
        const pz = (state.vx / norme) * hero.traceEcart * state.coteTrace;
        events.push({ t: "trace", x: state.x + px, z: state.z + pz, cote: state.coteTrace });
      }
    }
  }

  // Idle breath: MOVED from the lab's `hero.ts` (the old block after the event loop in `update()`)
  // — outside the branching above (stopped, airborne, skidding on ice): someone breathing doesn't
  // stop breathing. `!state.swimming` alone: breathing continues while jumping or skidding, only
  // swimming (breath held, `breath` above) cuts it — and the timer doesn't count down underwater
  // either, for the same reason. Evaluated HERE, after the footstep cadence above: if a footstep
  // just rearmed `reposHaleine` to `hero.haleineRepos` on THIS frame, this block only decrements it
  // further by `dt` — never enough to drop back to zero the same tick, exactly the old code's
  // behavior (both blocks already ran in this order, one after the other).
  if (input.haleineVisible && !state.swimming) {
    state.reposHaleine -= dt;
    if (state.reposHaleine <= 0) {
      events.push({ t: "haleine" });
      state.reposHaleine = hero.haleineRepos;
    }
  }

  return events;
}
