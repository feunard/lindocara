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
// added; visible
// breath and footprints — their CADENCE only, never their rendering — before those were added):
// the rules did not change shape, only file — see each originating task's report for the accepted
// divergences (`facing`'s update, which stayed in `hero.ts` — see below —, the landing-impact
// clamp, written by hand since `three` cannot be imported here, and the respawn-on-drowning
// teleport, which stayed in `hero.ts` — see `drown`'s docstring below).

import type { HeroEvent, HeroInput, HeroSettings, HeroState, StepDeps } from "./hero-state.js";
import { derapage, frictionPour, pasAmorti, sePropulse, vitesseMaxPour } from "./locomotion.js";

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
  const surfaceAt = (xx: number, zz: number) =>
    query.surfaceAt?.(xx, zz, state.y + 0.02) ??
    query.heightAt(xx, zz) ??
    query.waterLevelAt(xx, zz);
  const footprintZ = empreinte(z, hero);
  const currentFootprintZ = empreinte(state.z, hero);
  const traversingRamp = query.canTraverseRamp(
    state.x,
    currentFootprintZ,
    x,
    footprintZ,
    hero.radius,
  );

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
    if (state.swimming) return h - query.waterLevelAt(x, z) <= climb;
    return state.airborne ? h <= state.y + 0.02 : traversingRamp || h - state.groundY <= maxStep;
  };
  if (!centreOk(x, z)) return false;

  // Relief is tested against the hero's disc, not its center: otherwise it sinks half its body
  // into a wall before being stopped.
  const h = query.maxHeightAround(x, empreinte(z, hero), hero.radius, state.y + 0.02);
  const plafond = state.swimming
    ? query.waterLevelAt(state.x, state.z) + climb
    : state.airborne
      ? state.y + 0.02
      : state.groundY + maxStep;
  if (h > plafond && !traversingRamp) {
    // Already overlapping something too tall — the case right after falling at the foot of a
    // cliff, the disc still biting into the cell above. Without this escape hatch, NO movement at
    // all is allowed, not even to move away from it, and the hero stays cemented in place.
    const ici = query.maxHeightAround(
      state.x,
      empreinte(state.z, hero),
      hero.radius,
      state.y + 0.02,
    );
    if (!(ici > plafond && h <= ici)) return false;
  }

  if (!colliders.blocked(x, empreinte(z, hero), hero.radius, state.y)) return true;
  // Same escape hatch against props (an unlucky spawn, a prop added underneath).
  return colliders.blocked(state.x, empreinte(state.z, hero), hero.radius, state.y);
}

/**
 * Enters the water: position at water level, breath full, speed cut. Zeroing `vx`/`vz` is
 * LOAD-BEARING (see the file header): without it, the hero would enter the water still carrying
 * the momentum of the shore they just left.
 *
 * The return type is the PRECISE member of the `HeroEvent` union rather than `HeroEvent` in
 * general, so a caller can read `x`/`z` off it without re-testing `t`.
 */
function enterWater(state: HeroState, deps: StepDeps): Extract<HeroEvent, { t: "entree-eau" }> {
  const { hero } = deps;
  state.swimming = true;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  const surface = deps.query.waterLevelAt(state.x, state.z);
  state.y = surface;
  state.groundY = surface;
  return { t: "entree-eau", x: state.x, y: surface, z: state.z };
}

/** Leaves the water onto a shore at `y` — never a cliff: `canEnter` (above, the `climb`
 *  constraint) has already ruled that out upstream, this function only records the exit. */
function leaveWater(state: HeroState, deps: StepDeps, y: number): HeroEvent {
  const { hero } = deps;
  state.swimming = false;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  state.y = y;
  state.groundY = y;
  return { t: "sortie-eau", x: state.x, y: deps.query.waterLevelAt(state.x, state.z), z: state.z };
}

/**
 * How far the water surface must fall away under a swimmer before he stops swimming and starts
 * falling. Generous enough that no ordinary surface wobble triggers it, small enough that the lip
 * of any real drop does.
 */
const WATER_SPILL_DROP = 0.4;

/**
 * Breath is exhausted. The event carries the DROWNING position — where the splash should appear —
 * never the respawn position: that teleport (to `spawn`, at the terrain height there) stays the
 * adapter's (`hero.ts`) job, since it ALONE knows `spawn` — `stepHero` never receives it as a
 * parameter, on purpose (see the file header).
 */
function drown(state: HeroState, deps: StepDeps): HeroEvent {
  const { hero } = deps;
  const x = state.x;
  const z = state.z;
  state.swimming = false;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.breath = hero.swim.breath;
  return { t: "noyade", x, y: deps.query.waterLevelAt(x, z), z };
}

export function stepHero(
  state: HeroState,
  input: HeroInput,
  dt: number,
  deps: StepDeps,
): HeroEvent[] {
  const events: HeroEvent[] = [];
  const { query, hero } = deps;

  // The jump input is a LEVEL. Read the rising edge ONCE, here, before any branch: the latch has
  // to advance on every step — indoors, swimming, anywhere — or a key held across a doorway would
  // read as a fresh press on the way out.
  const jumpPressed = input.jump && !state.jumpHeld;
  state.jumpHeld = input.jump;

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
  // what still lives there in closure over audio and billboards (swimming, water entry)
  // — a second pure call, not a replayed resolution.
  if (state.room) {
    // Flat floor: no gravity, no swimming, no jumping. Footsteps are kept.
    state.y = state.room.y;
    state.airborne = false;
    state.swimming = false;
    state.vy = 0;
  }
  const sol = state.room
    ? state.room.y
    : (query.surfaceAt?.(state.x, empreinteZ(state.z), state.y + 0.02) ??
      query.heightAt(state.x, empreinteZ(state.z)));

  // Indoors, the floor is flat: no gravity, no swimming, no jumping. The whole vertical block is
  // guarded by `!state.room` so none of these mechanics run indoors.
  if (!state.room) {
    if (!state.swimming) {
      const ground = sol ?? query.waterLevelAt(state.x, state.z);
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
      let justJumped = false;
      if (input.jump && state.coyote > 0) {
        state.vy = hero.jump.speed;
        state.airborne = true;
        state.coyote = 0;
        justJumped = true;
        events.push({ t: "saut" });
      }

      // The canopy: a fresh press while ALREADY in the air opens it, another folds it. Two guards,
      // both load-bearing. `!justJumped` — the same press that just started the jump is still a
      // rising edge on this very frame, and without it every take-off would pop the canopy.
      // `state.airborne` — there is nothing to glide from on the ground. Not swimming and not
      // indoors come for free: this whole block is nested inside those two branches.
      if (jumpPressed && !justJumped && state.airborne) {
        if (state.gliding) {
          state.gliding = false;
          events.push({ t: "glider-close" });
        } else {
          state.gliding = true;
          // Drop straight into the slow descent rather than letting the jump arc finish: opening
          // at the top of a jump should feel like catching the air, not like a delay.
          state.vy = -hero.glide.fall;
          events.push({ t: "glider-open" });
        }
      }

      if (state.airborne) {
        // Gliding stops gravity ACCUMULATING, it does not merely cap it: a glide descends at one
        // constant speed and never gains altitude. Nothing else in the block changes — the landing
        // test below reads `vy` exactly as before, and a canopy landing is simply a soft one.
        if (state.gliding) state.vy = -hero.glide.fall;
        else state.vy -= hero.jump.gravity * dt;
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

      // --- water entry ------------------------------------------------------------------------
      // An edge or a fall. Evaluated HERE, at the end of the vertical resolution, so
      // `state.swimming` is already up to date for the footstep/stroke cadence just below, on this
      // SAME frame. `!state.room` is already guaranteed by the enclosing branch: redundant but kept
      // out of caution, as a reminder that a room's virtual coordinates must never be read as if
      // they were real terrain.
      const eau = !state.room && sol === null;
      if (eau && !state.airborne) events.push(enterWater(state, deps));
    } else {
      // --- swim resolution -----------------------------------------------------------------------
      // Ported as is from the lab's `hero.ts`: exiting onto a shore, or progressive drowning.
      if (sol !== null) {
        events.push(leaveWater(state, deps, sol));
      } else {
        const surface = query.waterLevelAt(state.x, state.z);
        if (surface < state.y - WATER_SPILL_DROP) {
          // The water has fallen away beneath: carried over a lip, which is what the top of a
          // waterfall IS. Without this the swimmer's Y snaps to the new surface and he TELEPORTS
          // down the drop — the rule pins a swimmer to the water every frame, and that is right
          // everywhere except an edge. Horizontal speed is kept: he is carried over, not stopped.
          state.swimming = false;
          state.airborne = true;
          state.vy = 0;
          events.push({ t: "sortie-eau", x: state.x, y: state.y, z: state.z });
        } else {
          state.y = surface;
          // The rate comes from the zone (see `HeroInput.souffleTaux`): the hero no longer needs
          // to know WHICH water drains faster, only to read what it's given.
          state.breath -= dt * input.souffleTaux;
          if (state.breath <= 0) events.push(drown(state, deps));
        }
      }
    }
  }

  // --- the canopy cannot outlive the fall ------------------------------------------------------
  // ONE invariant rather than a fold written into landing, water entry, drowning and walking
  // into a room separately: all four already clear `airborne` or set `swimming`, and a rule spread
  // over four call sites is a rule with a fifth path waiting to be forgotten.
  if (state.gliding && (!state.airborne || state.swimming || state.room)) {
    state.gliding = false;
    events.push({ t: "glider-close" });
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
