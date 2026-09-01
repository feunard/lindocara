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
import {
  derapage,
  entreeBornee,
  frictionPour,
  pasAmorti,
  sePropulse,
  vitesseMaxPour,
} from "./locomotion.js";
import type { TerrainLiquid, TerrainQuery } from "./terrain-query.js";

/** Center of the collision footprint, offset under the sprite's body — MOVED from the lab's
 *  `hero.ts`, where an identical local helper used to live before this rule was extracted;
 *  `hero.ts` keeps no copy of its own anymore (it has no rule left in it at all, see
 *  `apps/lab/AGENTS.md`). Kept as its own function here, not exported and reimported, because
 *  `hero-step.ts` must import NO lab setting, not even through a shared module that would carry
 *  it along at the move into `engine`. */
function empreinte(z: number, hero: HeroSettings): number {
  return z - hero.offset;
}

/** Storey-aware liquid lookup. A `null` answer means this exact elevation is dry; falling back to
 * the liquid in the same surface column would make a basement hero swim in the lake overhead. */
function liquidAtElevation(
  query: TerrainQuery,
  x: number,
  z: number,
  elevation: number,
): TerrainLiquid | null {
  return query.liquidAtElevation ? query.liquidAtElevation(x, z, elevation) : query.liquidAt(x, z);
}

/** Same compatibility rule for a liquid surface: only use the legacy lookup when the query has no
 * elevation-aware implementation, not when a storey-aware source deliberately returns its own. */
function liquidSurfaceAtElevation(
  query: TerrainQuery,
  x: number,
  z: number,
  elevation: number,
): number {
  return query.waterLevelAtElevation
    ? query.waterLevelAtElevation(x, z, elevation)
    : query.waterLevelAt(x, z);
}

/**
 * A contact jump keeps its horizontal momentum while the body is still below a one-level finite
 * obstacle. It does not grant passage through the volume: `canEnter` remains false until the feet
 * physically clear the top, so the same obstacle is solid from every approach and can be landed on.
 */
function canPreserveVaultMomentum(state: HeroState, x: number, z: number, deps: StepDeps): boolean {
  const { colliders, hero, world } = deps;
  if (!state.airborne || state.vy <= 0) return false;
  const clearance = colliders.heightToClear?.(x, empreinte(z, hero), hero.radius) ?? null;
  if (clearance === null || !Number.isFinite(clearance)) return false;
  const jumpApex = state.y + (state.vy * state.vy) / (2 * hero.jump.gravity);
  return clearance <= state.groundY + world.levelHeight + 1e-3 && jumpApex >= clearance + 0.02;
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
  const footprintZ = empreinte(z, hero);
  const currentFootprintZ = empreinte(state.z, hero);
  const traversingRamp = query.canTraverseRamp(
    state.x,
    currentFootprintZ,
    x,
    footprintZ,
    hero.radius,
  );
  const platformHeight = state.airborne
    ? null
    : (query.platformHeightAlong?.(
        state.x,
        currentFootprintZ,
        x,
        footprintZ,
        hero.radius,
        state.groundY,
      ) ?? null);
  // How high a ramp may lift a body that is on one: its own top, and not a step further.
  //
  // `traversingSurface` used to switch the height tests OFF entirely, which made a ramp cell a
  // hole in the rule rather than an exception to it: while the corridor test keeps the disc inside
  // the ramp ACROSS the slope, nothing kept it out of whatever stands at the head of the stairs,
  // so a hero could finish a climb with its body inside the plateau's edge. Raising the ceiling to
  // the ramp's top keeps every climb (the ground a ramp delivers you onto is at its top, by
  // construction) and refuses anything above it. Roofs keep the old behaviour: `platformHeight` is
  // the height the body is being carried at, and its own tests live in `platformHeightAlong`.
  const rampSample = traversingRamp
    ? (query.rampAt(x, footprintZ) ?? query.rampAt(state.x, currentFootprintZ))
    : null;
  const rampCeiling = rampSample === null ? null : rampSample.highHeight + 1e-3;
  const currentTerrain = query.heightAt(state.x, currentFootprintZ);
  const standingOnSurfaceTerrain =
    !state.airborne &&
    !state.swimming &&
    currentTerrain !== null &&
    currentTerrain <= state.groundY + maxStep;
  const reachableSurfaceAt = (xx: number, zz: number): number => {
    const ceiling = rampSample?.height ?? state.y + 0.02;
    const surface = query.surfaceAt
      ? query.surfaceAt(xx, zz, ceiling + 0.02)
      : query.heightAt(xx, zz);
    return surface ?? liquidSurfaceAtElevation(query, xx, zz, state.y);
  };

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
    const foot = empreinte(zz, hero);
    // A lower platform in the same X/Z column is not a passage under raised surface terrain. Once
    // the disc already grazed a cliff, the relief escape hatch below compared only maximum HEIGHT,
    // so it could keep accepting equal-height candidates until the centre crossed the boundary.
    // `surfaceAt` then selected a basement ceiling below the feet and the hero fell onto it. Keep
    // the topmost terrain as the hard centre barrier while the hero is still on the surface; a real
    // underground body has surface terrain above its current ground and therefore skips this test.
    const destinationTerrain = query.heightAt(xx, foot);
    if (
      standingOnSurfaceTerrain &&
      platformHeight === null &&
      rampCeiling === null &&
      destinationTerrain !== null &&
      destinationTerrain > state.groundY + maxStep
    ) {
      return false;
    }
    const h = platformHeight ?? reachableSurfaceAt(xx, foot);
    // Measured against the surface the swimmer is FLOATING ON — `state.y` — not against a water
    // level sampled somewhere else. "How far must I climb to get out" is a question about the
    // water under the hero, and the only place that is reliably known is the hero.
    //
    // Sampling it at the destination instead looks equivalent and is not, in both directions.
    // At the destination CENTRE, the lip of a fall reads as a cliff the height of the drop and the
    // swimmer cannot go over it. At the destination FOOTPRINT, a bank reads the same way — the
    // footprint is over LAND, which has no water, so the lookup answers the distant sea and the
    // swimmer cannot climb out. Both were live bugs; with one global water level neither could
    // happen, because every lookup returned the same number.
    if (state.swimming) {
      // A higher lava surface is not a shore the body can mantle onto. Treating every swimmer as
      // water-capable let a hero rise straight through a vertical lava step (and snap upward to
      // its surface) whenever the height happened to fit the ordinary bank-climb allowance.
      const destinationLiquid = liquidAtElevation(query, xx, foot, state.y);
      if (
        state.liquid === "lava" &&
        destinationLiquid === "lava" &&
        liquidSurfaceAtElevation(query, xx, foot, state.y) > state.y + 1e-3
      ) {
        return false;
      }
      return h - state.y <= climb;
    }
    if (state.airborne) return h <= state.y + 0.02;
    if (platformHeight !== null) return true;
    if (rampCeiling !== null && h <= rampCeiling) return true;
    return h - state.groundY <= maxStep;
  };
  if (!centreOk(x, z)) return false;

  // Relief is tested against the hero's disc, not its center: otherwise it sinks half its body
  // into a wall before being stopped.
  const h = query.maxHeightAround(x, empreinte(z, hero), hero.radius, state.y + 0.02);
  const plafond = state.swimming
    ? state.y + climb
    : state.airborne
      ? state.y + 0.02
      : state.groundY + maxStep;
  const reach =
    platformHeight !== null
      ? Number.POSITIVE_INFINITY
      : rampCeiling === null
        ? plafond
        : Math.max(plafond, rampCeiling);
  if (h > reach) {
    // Already overlapping something too tall — the case right after falling at the foot of a
    // cliff, the disc still biting into the cell above. Without this escape hatch, NO movement at
    // all is allowed, not even to move away from it, and the hero stays cemented in place.
    const ici = query.maxHeightAround(
      state.x,
      empreinte(state.z, hero),
      hero.radius,
      state.y + 0.02,
    );
    if (!(ici > reach && h <= ici)) return false;
  }

  const collisionY = platformHeight ?? state.y;
  const travel = Math.hypot(x - state.x, footprintZ - currentFootprintZ);
  if (
    travel > hero.radius * 2 &&
    deps.colliders.blockedAlong?.(
      state.x,
      currentFootprintZ,
      x,
      footprintZ,
      hero.radius,
      collisionY,
    )
  ) {
    return false;
  }
  if (!colliders.blocked(x, empreinte(z, hero), hero.radius, collisionY)) return true;

  // Same escape hatch against props (an unlucky spawn, a prop added underneath). The concrete
  // index makes it monotone: a touching body may slide or move out, never walk farther inside and
  // let the vertical resolver snap it onto a roof. Minimal test doubles keep the historical
  // boolean fallback because they cannot measure overlap depth.
  return (
    colliders.allowsEscape?.(
      state.x,
      empreinte(state.z, hero),
      x,
      empreinte(z, hero),
      hero.radius,
      state.y,
    ) ?? colliders.blocked(state.x, empreinte(state.z, hero), hero.radius, state.y)
  );
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
  const footprintZ = empreinte(state.z, hero);
  const liquid = liquidAtElevation(deps.query, state.x, footprintZ, state.y) ?? "water";
  state.swimming = true;
  state.liquid = liquid;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.impulsionX = 0;
  state.impulsionZ = 0;
  state.breath = hero.swim.breath;
  const surface = liquidSurfaceAtElevation(deps.query, state.x, footprintZ, state.y);
  state.y = surface;
  state.groundY = surface;
  return { t: "entree-eau", liquid, x: state.x, y: surface, z: state.z };
}

/** Leaves the water onto a shore at `y` — never a cliff: `canEnter` (above, the `climb`
 *  constraint) has already ruled that out upstream, this function only records the exit. */
function leaveWater(state: HeroState, deps: StepDeps, y: number): HeroEvent {
  const { hero } = deps;
  const liquid = state.liquid ?? "water";
  state.swimming = false;
  state.liquid = null;
  state.vx = 0;
  state.vz = 0;
  state.impulsionX = 0;
  state.impulsionZ = 0;
  state.breath = hero.swim.breath;
  state.y = y;
  state.groundY = y;
  return {
    t: "sortie-eau",
    liquid,
    x: state.x,
    y: liquidSurfaceAtElevation(deps.query, state.x, state.z, state.y),
    z: state.z,
  };
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
  state.liquid = null;
  state.airborne = false;
  state.vy = 0;
  state.vx = 0;
  state.vz = 0;
  state.impulsionX = 0;
  state.impulsionZ = 0;
  state.breath = hero.swim.breath;
  return {
    t: "noyade",
    x,
    y: liquidSurfaceAtElevation(deps.query, x, z, state.y),
    z,
  };
}

export function stepHero(
  state: HeroState,
  input: HeroInput,
  dt: number,
  deps: StepDeps,
): HeroEvent[] {
  const events: HeroEvent[] = [];
  const { query, hero, world } = deps;

  // The jump input is a LEVEL. Read the rising edge ONCE, here, before any branch: the latch has
  // to advance on every step — indoors, swimming, anywhere — or a key held across a doorway would
  // read as a fresh press on the way out.
  const jumpPressed = input.jump && !state.jumpHeld;
  state.jumpHeld = input.jump;

  const empreinteZ = (z: number) => empreinte(z, hero);
  const avantX = state.x;
  const avantZ = state.z;
  const avantGroundY = state.groundY;
  const etaitAuSol = !state.airborne && !state.swimming && !state.room;

  // The material UNDER THE FEET, before moving, picks the friction and speed cap. Swimming or
  // indoors, the real seabed / virtual-coordinate material has no physical meaning: fall back to
  // `null` (= grass).
  const matiere =
    state.swimming || state.room
      ? null
      : (query.kindAtElevation?.(state.x, empreinteZ(state.z), state.y) ??
        query.kindAt(state.x, empreinteZ(state.z)));
  const friction = frictionPour(matiere, hero);
  const vmax = state.swimming ? hero.speed * hero.swim.speed : vitesseMaxPour(matiere, hero);
  const accel = vmax * friction;

  // The input is a VECTOR, and `pasAmorti` below reads it one axis at a time: without this the two
  // axes each converge to the full speed and a diagonal is √2 times too fast. Bounded once, here,
  // so the skid and the footstep signals below read the same numbers the velocity does.
  const entree = entreeBornee(input.x, input.z);

  state.vx = pasAmorti(state.vx, entree.x, accel, friction, dt);
  state.vz = pasAmorti(state.vz, entree.z, accel, friction, dt);

  // Skid (a held sound): `derapage` never looks at the material — cut here only in the air and
  // while swimming, where a ground skid means nothing. Emitted every FRAME, never only on
  // trigger: it's a held sound, not a click.
  events.push({
    t: "glisse",
    intensite:
      state.airborne || state.swimming
        ? 0
        : derapage(state.vx, state.vz, entree.x, entree.z, hero.speed),
  });
  // Same signal, thresholded into a boolean: only count a footstep if the hero is actually
  // propelling, not if carried by momentum (ice) — see the footstep cadence below.
  const propulsion = sePropulse(state.vx, state.vz, entree.x, entree.z);

  // One axis at a time: hitting an obstacle diagonally slides along it. On the refused axis, speed
  // drops to zero, otherwise the hero would stay stuck to the wall at full speed and shoot off the
  // instant they move away from it.
  const nx = state.x + (state.vx + state.impulsionX) * dt;
  if (canEnter(state, nx, state.z, deps)) state.x = nx;
  else if (!canPreserveVaultMomentum(state, nx, state.z, deps)) {
    state.vx = 0;
    state.impulsionX = 0;
  }
  const nz = state.z + (state.vz + state.impulsionZ) * dt;
  if (canEnter(state, state.x, nz, deps)) state.z = nz;
  else if (!canPreserveVaultMomentum(state, state.x, nz, deps)) {
    state.vz = 0;
    state.impulsionZ = 0;
  }

  // A knockback is an airborne ballistic impulse, not ordinary player propulsion. Its own gentle
  // drag keeps the arc readable on every terrain while leaving the existing grass/snow/ice model
  // untouched. Exact exponential damping makes the travelled distance independent of frame rate.
  if (state.airborne) {
    const damping = Math.exp(-1.5 * dt);
    state.impulsionX *= damping;
    state.impulsionZ *= damping;
    if (Math.hypot(state.impulsionX, state.impulsionZ) < 1e-3) {
      state.impulsionX = 0;
      state.impulsionZ = 0;
    }
  }

  const followsRamp =
    etaitAuSol &&
    query.canTraverseRamp(avantX, empreinteZ(avantZ), state.x, empreinteZ(state.z), hero.radius);
  const rampSurface = followsRamp
    ? (query.rampAt(state.x, empreinteZ(state.z)) ?? query.rampAt(avantX, empreinteZ(avantZ)))
    : null;
  const platformSurface = etaitAuSol
    ? (query.platformHeightAlong?.(
        avantX,
        empreinteZ(avantZ),
        state.x,
        empreinteZ(state.z),
        hero.radius,
        avantGroundY,
      ) ?? null)
    : null;
  const suitSurface = rampSurface !== null || platformSurface !== null;

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
    state.liquid = null;
    state.vy = 0;
    state.impulsionX = 0;
    state.impulsionZ = 0;
  }
  const footprintZ = empreinteZ(state.z);
  // How high a surface may be and still count as the one under the hero's FEET.
  //
  // Unbounded (`Infinity`) is what this was for every grounded hero, and a deck with an underside
  // made that wrong. While every raised surface was a solid column nothing could pass beneath,
  // "the highest surface at this point" and "the surface under the feet" were the same sentence;
  // once a bridge two levels up let the bank below it be walked (`blocksAt`'s span test) they
  // stopped being, and a hero stepping under the planking was lifted onto it on the next frame.
  //
  // `suitSurface` is what keeps a slope working, and it is the honest discriminator rather than a
  // tolerance: it says the hero SPENT this frame on one continuous surface — a ramp, or a platform
  // whose height under its previous position was already its ground. A gable roof climbed toward
  // its peak answers yes however steep it is; the bank under a bridge answers no, because the
  // planking overhead was never what the hero was standing on.
  const surfaceCeiling = state.swimming
    ? state.y + world.levelHeight * hero.swim.climb
    : state.airborne
      ? state.y + 0.02
      : rampSurface
        ? rampSurface.height + 0.02
        : platformSurface !== null
          ? platformSurface + 0.02
          : state.groundY + world.maxStep * world.levelHeight + 1e-3;
  const centreSurface = state.room
    ? state.room.y
    : query.surfaceAt
      ? query.surfaceAt(state.x, footprintZ, surfaceCeiling)
      : query.heightAt(state.x, footprintZ);
  const nearbyPlatform = state.room
    ? null
    : (query.platformSurfaceAround?.(state.x, footprintZ, hero.radius, surfaceCeiling) ?? null);
  // A finite top supports the hero's whole collision disc, not only its centre. This is essential
  // for narrow bridge rails and small rocks: horizontal collision stops the centre at the side,
  // so a descending jump could never put that centre over the top before falling through it.
  // Grounded heroes only retain a nearby surface already under their feet; a roof beside a hero
  // on the ground must never pull them upward.
  const supportedPlatform =
    nearbyPlatform !== null && (state.airborne || Math.abs(nearbyPlatform - state.groundY) <= 0.08)
      ? nearbyPlatform
      : null;
  const liquid = state.room ? null : liquidAtElevation(query, state.x, footprintZ, state.y);
  const support =
    supportedPlatform === null
      ? centreSurface
      : centreSurface === null
        ? supportedPlatform
        : Math.max(centreSurface, supportedPlatform);
  const liquidSurface =
    liquid === null ? null : liquidSurfaceAtElevation(query, state.x, footprintZ, state.y);
  const sol =
    liquid !== null &&
    (supportedPlatform === null ||
      (liquidSurface !== null && supportedPlatform <= liquidSurface + 1e-3))
      ? null
      : support;

  // Indoors, the floor is flat: no gravity, no swimming, no jumping. The whole vertical block is
  // guarded by `!state.room` so none of these mechanics run indoors.
  if (!state.room) {
    if (!state.swimming) {
      const ground = sol ?? liquidSurfaceAtElevation(query, state.x, footprintZ, state.y);
      if (state.airborne) {
        state.coyote -= dt;
      } else if (ground < state.y - 1e-3 && !suitSurface) {
        state.airborne = true; // the ground gave way: falling, not sliding
        state.vy = 0;
      } else {
        state.y = ground;
        state.groundY = ground;
        state.coyote = hero.jump.coyote;
        state.airJumpsRemaining = hero.airJumps ?? 0;
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

      // A movement pickup may grant one or more extra jumps. They are consumed before the same
      // fresh press is interpreted as the canopy toggle, so double-jump and gliding remain usable
      // together: jump, jump again, then press once more to open the glider.
      let justAirJumped = false;
      if (
        jumpPressed &&
        !justJumped &&
        state.airborne &&
        !state.gliding &&
        state.airJumpsRemaining > 0
      ) {
        state.vy = hero.jump.speed;
        state.airJumpsRemaining -= 1;
        justAirJumped = true;
        events.push({ t: "saut" });
      }

      // The canopy: a fresh press while ALREADY in the air opens it, another folds it. Two guards,
      // both load-bearing. `!justJumped` — the same press that just started the jump is still a
      // rising edge on this very frame, and without it every take-off would pop the canopy.
      // `state.airborne` — there is nothing to glide from on the ground. Not swimming and not
      // indoors come for free: this whole block is nested inside those two branches.
      if (jumpPressed && !justJumped && !justAirJumped && state.airborne) {
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
        const previousY = state.y;
        const nextY = state.y + state.vy * dt;
        const upwardLimit =
          state.vy > 0
            ? (deps.colliders.upwardLimit?.(state.x, footprintZ, hero.radius, previousY, nextY) ??
              null)
            : null;
        if (upwardLimit !== null && nextY > upwardLimit) {
          state.y = upwardLimit;
          state.vy = 0;
        } else {
          state.y = nextY;
        }
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
          state.impulsionX = 0;
          state.impulsionZ = 0;
          state.airJumpsRemaining = hero.airJumps ?? 0;
          state.distanceDepuisLePas = 0;
        }
      }

      // --- water entry ------------------------------------------------------------------------
      // An edge or a fall. Evaluated HERE, at the end of the vertical resolution, so
      // `state.swimming` is already up to date for the footstep/stroke cadence just below, on this
      // SAME frame. `!state.room` is already guaranteed by the enclosing branch: redundant but kept
      // out of caution, as a reminder that a room's virtual coordinates must never be read as if
      // they were real terrain.
      const eau = !state.room && liquid !== null && sol === null;
      if (eau && !state.airborne) events.push(enterWater(state, deps));
    } else {
      // --- swim resolution -----------------------------------------------------------------------
      // Ported as is from the lab's `hero.ts`: exiting onto a shore, or progressive drowning.
      if (sol !== null) {
        events.push(leaveWater(state, deps, sol));
      } else {
        state.liquid = liquid ?? state.liquid ?? "water";
        const surface = liquidSurfaceAtElevation(query, state.x, footprintZ, state.y);
        if (surface < state.y - WATER_SPILL_DROP) {
          // The water has fallen away beneath: carried over a lip, which is what the top of a
          // waterfall IS. Without this the swimmer's Y snaps to the new surface and he TELEPORTS
          // down the drop — the rule pins a swimmer to the water every frame, and that is right
          // everywhere except an edge. Horizontal speed is kept: he is carried over, not stopped.
          state.swimming = false;
          const departedLiquid = state.liquid ?? "water";
          state.liquid = null;
          state.airborne = true;
          state.vy = 0;
          events.push({
            t: "sortie-eau",
            liquid: departedLiquid,
            x: state.x,
            y: state.y,
            z: state.z,
          });
        } else {
          state.y = surface;
          // The rate comes from the zone (see `HeroInput.souffleTaux`): the hero no longer needs
          // to know WHICH water drains faster, only to read what it's given.
          if (state.liquid === "water") {
            state.breath -= dt * input.souffleTaux;
            if (state.breath <= 0) events.push(drown(state, deps));
          } else {
            state.breath = hero.swim.breath;
          }
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
      const matiere =
        query.kindAtElevation?.(state.x, empreinteZ(state.z), state.y) ??
        query.kindAt(state.x, empreinteZ(state.z)) ??
        "herbe";
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
