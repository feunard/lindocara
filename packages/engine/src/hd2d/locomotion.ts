import type { HeroSettings } from "./hero-state.js";
import type { TerrainMaterial } from "./terrain-query.js";

/**
 * One movement model, three frictions.
 *
 * The old model was `speed = input · HERO.speed`: instantaneous both ways, so incapable of
 * skidding. Rather than bolting an "ice" special case on the side, input ACCELERATES and the
 * material BRAKES — ice and deep snow then fall out of the same equation, and grass is tuned to
 * stay indistinguishable from the old behavior.
 *
 * These rules moved into `@lindocara/engine` in S2 to become server-authoritative and shared with
 * network prediction. Everything here must stay PURE and bit-deterministic: no `Math.random`, no
 * clock, no `three`.
 */

/**
 * One axis, one timestep: `speed += input · acceleration · dt`, then exponential damping.
 *
 * MIND the exact formula — the task's own brief for this function proposed
 * `(v + entree*accel*dt) * Math.exp(-friction*dt)`, but its own first test ("reaches EXACTLY
 * HERO.speed at steady state") fails with THIS formula regardless of the friction chosen: its
 * steady state is `accel*dt*k/(1-k)` (k = exp(-friction·dt)), which only converges to
 * `accel/friction` at the LIMIT `dt → 0` — at a fixed dt (1/60 s here), the smallest gap
 * reachable, across every friction, is ~0.11 unit, while `toBeCloseTo(HERO.speed, 3)` demands less
 * than 0.0005 (verified by calculation, see the task's report). The brief's own comment claiming a
 * steady state "exactly accel/friction" was therefore wrong for that formula.
 *
 * The formula below is the EXACT exponential integrator of the differential equation actually
 * wanted: `dv/dt = friction · (target − v)`, where `target = input · accel / friction`. Its
 * analytical solution is `v(t) = target + (v₀ − target) · exp(−friction·t)`, and because it is the
 * exact solution (not an Euler approximation), sampling it at any step `dt` — 2 seconds in one go,
 * or 120 steps of 1/60 s — gives EXACTLY the same result, with a steady state that equals
 * `accel/friction` to machine error regardless of `dt`. This is the property that keeps
 * `HERO.speed` the reference speed no matter the material, and that keeps the model independent of
 * timestep — so replayable identically by network prediction once promoted into `engine`.
 */
export function pasAmorti(
  v: number,
  entree: number,
  accel: number,
  friction: number,
  dt: number,
): number {
  // Zero or negative friction (should never happen with the game's tables, but this module lives
  // in `engine`, where a future caller could pass anything): no division by zero, fall back to a
  // plain acceleration add, without damping.
  if (friction <= 0) return v + entree * accel * dt;
  const cible = (entree * accel) / friction;
  return cible + (v - cible) * Math.exp(-friction * dt);
}

/**
 * The movement input, never longer than 1.
 *
 * `pasAmorti` integrates each axis independently and converges it to `accel / friction`, which IS
 * the hero's full speed. Two axes held at once therefore reached that speed on both, and the
 * resulting velocity had magnitude `speed · √2`: a hero moving about 41% faster on the diagonal
 * than in any cardinal direction, for free, by holding two keys.
 *
 * CLAMPED, not normalised, and the difference is the whole reason this is a function. Normalising
 * to length 1 would push a gentle analog stick to full speed, which is the same bug pointing the
 * other way. A short vector already states its own magnitude and is returned untouched; only an
 * over-long one is scaled back onto the unit circle.
 */
export function entreeBornee(x: number, z: number): { x: number; z: number } {
  const longueur = Math.hypot(x, z);
  // Written as `!(longueur > 1)` rather than `longueur <= 1` so a NaN axis falls through unchanged
  // instead of being divided by NaN: this module never silently invents a direction.
  if (!(longueur > 1)) return { x, z };
  return { x: x / longueur, z: z / longueur };
}

/** `null` = off the map or in the water: swimming there, ground friction does not apply, but the
 *  function must still return something finite rather than force every caller to test for it.
 *  `"sable"` (sand) has no rule of its own yet: it falls back to `"herbe"` (grass).
 *
 *  `hero` as a parameter rather than `HERO` imported from `settings.ts`: this is what let this
 *  module move into `@lindocara/engine` without carrying the lab's settings along with it — see
 *  `hero-state.ts`, `HeroSettings`. */
export function frictionPour(m: TerrainMaterial | null, hero: HeroSettings): number {
  switch (m) {
    case "glace":
      return hero.friction.glace;
    case "neige":
      return hero.friction.neige;
    case "sable":
    case "herbe":
    case "grotte":
    case "montagne":
    case "volcan":
    case "lave":
    case "parquet":
    case "lino-gris":
    case "lino-jaune":
    case "carrelage-beige":
    case null:
      return hero.friction.herbe;
  }
}

/** Top speed (= equilibrium speed, `accel/friction` when `accel` derives from it) on this
 *  material. It is the `vitesseSol` multiplier that makes the CAP lower in snow, on top of the
 *  higher friction that already makes it hard to REACH. */
export function vitesseMaxPour(m: TerrainMaterial | null, hero: HeroSettings): number {
  switch (m) {
    case "glace":
      return hero.speed * hero.vitesseSol.glace;
    case "neige":
      return hero.speed * hero.vitesseSol.neige;
    case "sable":
    case "herbe":
    case "grotte":
    case "montagne":
    case "volcan":
    case "lave":
    case "parquet":
    case "lino-gris":
    case "lino-jaune":
    case "carrelage-beige":
    case null:
      return hero.speed * hero.vitesseSol.herbe;
  }
}

/**
 * The DIRECTION mismatch alone between speed and input, 0 (aligned) to 1 (opposed, or input
 * released) — WITHOUT the speed weighting `derapage` applies just below. That weighting is
 * correct for the SOUND (a residual drift at near-zero speed should not blare), but wrong for
 * deciding "are we propelling or skidding" (`sePropulse`, below): weighted, a skid with no input
 * at all but still slow — the very START of a launch on ice, before speed has caught up to
 * `HERO.speed` — fell under the threshold and let footsteps through, found by replaying the scene
 * under real conditions (see the report): no purely analytical test on `derapage` alone could have
 * caught it, since the chosen threshold (0.5) was only crossed by combining total disagreement
 * with a random speed around half the reference — exactly the window where skidding on momentum
 * begins.
 */
function desaccord(vx: number, vz: number, ix: number, iz: number): number {
  const vitesse = Math.hypot(vx, vz);
  if (vitesse < 1e-3) return 0;
  const entree = Math.hypot(ix, iz);
  return entree > 1e-3 ? (1 - (vx * ix + vz * iz) / (vitesse * entree)) / 2 : 1;
}

/**
 * Skid intensity (the sound of the slide): 0 when speed follows input, 1 when they oppose —
 * weighted by speed, so a residual drift at near-zero speed (the very end of a stop) does not
 * sound at full intensity. Zero input but non-zero speed is the MAXIMUM disagreement: skidding on
 * momentum with no direction requested is exactly stopping on ice, not the absence of a skid.
 *
 * WITHOUT ever looking at the ground material, by construction — it is the same computation that
 * makes ice slide (input accelerates, the material brakes, see above) that makes this intensity
 * fall back near zero everywhere else: on grass/sand/snow, speed catches up with input within a
 * frame or two, well before `setSkid` (`core/audio.ts`, in the lab) has time to make it audible.
 * Pure and deterministic like the rest of the module: this is a SOUND effect, not a game rule that
 * needed promoting into `engine` on its own, but it is kept just as testable regardless.
 */
export function derapage(
  vx: number,
  vz: number,
  ix: number,
  iz: number,
  vitesseRef: number,
): number {
  const vitesse = Math.hypot(vx, vz);
  if (vitesse < 1e-3) return 0;
  return desaccord(vx, vz, ix, iz) * Math.min(1, vitesse / vitesseRef);
}

/**
 * `desaccord`'s pivot (0.5 = exactly perpendicular) thresholded into a boolean: below it, the hero
 * IS PROPELLING (input pushes in the direction of speed); at or past it, the hero IS SKIDDING —
 * carried by momentum (input released or zero) or skidding through a hard turn (input squarely
 * outside the direction of speed). Deliberately WITHOUT `vitesseRef`, unlike `derapage`: current
 * speed must change nothing about THIS decision (see `desaccord`).
 *
 * This is the signal the footstep cadence (`hero.ts`, `PAS_TOUS_LES`) was missing: it is counted
 * by distance traveled, so it used to fire while skidding too, where the hero advances without any
 * foot leaving the ground. The criterion is deliberately NOT the material — the same ice can be
 * walked carefully (pushing in the direction of travel, propelling) or skidded on (momentum with
 * no input, or too sharp a turn) — it is the direction mismatch that decides, never a material or
 * a speed.
 */
export function sePropulse(vx: number, vz: number, ix: number, iz: number): boolean {
  return desaccord(vx, vz, ix, iz) < 0.5;
}
