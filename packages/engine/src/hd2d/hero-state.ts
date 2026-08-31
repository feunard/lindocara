// The hero's state and the consequences of one simulation step, as pure data.
//
// Separate from `hero.ts` (the lab's adapter, which holds the billboards) and from `hero-step.ts`
// (the rule): this is the only one of the three with NO dependency of its own, so the only one the
// other two can import without a cycle. It moved into `@lindocara/engine` in S2, unchanged.

import type { TerrainLiquid, TerrainMaterial, TerrainQuery } from "./terrain-query.js";

/** Rectangle where the hero can walk indoors — a flat floor, no gravity, no swimming, no jumping.
 *  MOVED from the lab's `hero.ts`: `hero.ts` must RE-EXPORT it from here rather than keep a second
 *  declaration — two structurally identical `Room` types would compile without complaint and
 *  drift apart the moment a field is added to one but not the other. */
export interface Room {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  obstacles: readonly { x: number; z: number; r: number }[];
}

export interface HeroInput {
  x: number;
  z: number;
  jump: boolean;
  attack: boolean;
  /** Breath-consumption multiplier while swimming — the zone supplies it every frame (the lab's
   *  `world/zones.ts`, `Zone.souffle`): 1 normally, 2 in polar water (thin ice). A RATE read every
   *  frame rather than a constant frozen here: this is what lets it vary without coming back to
   *  touch the hero. */
  souffleTaux: number;
  /** `true` when the hero is in a zone cold enough to see their breath (the polar zone; the lab's
   *  `main.ts` compares `zone === ZONE_POLAIRE` by identity, like the rest of its zone wiring).
   *  Only cuts the EMISSION of new puffs — a puff already in flight finishes fading normally,
   *  otherwise leaving the zone would make one vanish mid-flight. Named "haleine" (breath-you-can-
   *  see) rather than "souffle" (breath-you-hold) so it isn't confused with `souffleTaux` above (the
   *  air reserve while holding your breath): same French word family, two unrelated notions. */
  haleineVisible: boolean;
}

/**
 * EVERYTHING that must survive from one frame to the next. A field forgotten here becomes a
 * closure variable in `hero.ts` instead, and the rule silently stops being pure — the main failure
 * mode of this whole chantier.
 */
export interface HeroState {
  x: number;
  y: number;
  z: number;
  /** Persistent horizontal speed (the friction model). */
  vx: number;
  vz: number;
  /**
   * External horizontal momentum, kept separate from player propulsion so ground friction cannot
   * erase a server-authored knockback on its first frame. `stepHero` moves it through the exact
   * same terrain/collider checks as ordinary velocity and damps it continuously while airborne.
   */
  impulsionX: number;
  impulsionZ: number;
  /** Vertical speed: falling and jumping. */
  vy: number;
  airborne: boolean;
  swimming: boolean;
  /** Which liquid currently drives swimming. Lava deliberately carries no oxygen countdown. */
  liquid: TerrainLiquid | null;
  breath: number;
  coyote: number;
  /** The canopy is open: a slow, steady descent instead of gravity. */
  gliding: boolean;
  /** Extra mid-air jumps still available before the next landing. */
  airJumpsRemaining: number;
  /** Was the jump key down on the PREVIOUS step. `HeroInput.jump` is a LEVEL, not an edge — the
   *  jump itself can live with that because `coyote` is zeroed on take-off, but the canopy cannot:
   *  without this latch, the very press that starts a jump would still be down on the next frame
   *  and open the canopy on every single take-off. Keeping the edge HERE rather than adding an
   *  `HeroInput.jumpPressed` leaves the input contract untouched, which matters because a server
   *  tick would consume that same contract. */
  jumpHeld: boolean;
  /** Height of the last ground stood on — the reference for `maxStep`, not `y`. */
  groundY: number;
  /** Character orientation: -1 or 1. ONE OF TWO FIELDS `stepHero` never writes (see `attaque`
   *  below for the other) — written by the adapter (`hero.ts`, in `update()`, AFTER `stepHero`'s
   *  event loop) instead. This is deliberate, for two reasons:
   *
   *  1. It follows USER INPUT (`input.x`), not speed (`state.vx`). This avoids a turnaround delay
   *     on ice: speed persists there long after input has changed, and deriving `facing` from
   *     speed would make the orientation change too slow.
   *
   *  2. `emitHaleine()` (called by `hero.ts` in the event loop, on the "haleine" event `stepHero`
   *     returns — whether the trigger is a footstep or the idle timer) reads `state.facing` BEFORE
   *     that same `update()` overwrites it further down. In the original code, this read always
   *     saw the PREVIOUS frame's `facing`. Writing it inside `stepHero` would flip this read onto
   *     the CURRENT frame instead, which would be a behavior change: the breath puff would point in
   *     the new direction before the sprite had even been drawn turned. */
  facing: number;
  /** The THIRD field `stepHero` never writes to (see `facing` and `attaque` above for the other
   *  two, and for why each is an exception) — the room transition itself belongs to the adapter
   *  (`hero.ts`'s `setRoom`), which alone knows when the hero has walked through a door or a map
   *  edge. `stepHero` only READS it, every step, to decide which physics apply (see `canEnter` and
   *  the vertical block in `hero-step.ts`). */
  room: Room | null;
  /** Distance traveled since the last footstep — the cadence is by DISTANCE, not by time. */
  distanceDepuisLePas: number;
  /** Countdown to the next swim stroke, while swimming. Unlike `distanceDepuisLePas`
   *  (distance-based), `brasse` DECREASES with `dt` every frame. */
  brasse: number;
  /** Countdown to the next idle breath puff. */
  reposHaleine: number;
  /** Time elapsed in the current attack; negative = no attack. THE OTHER FIELD `stepHero` never
   *  writes (see `facing` above for the first) — advanced and armed by the adapter (`hero.ts`, in
   *  `update()`, after `stepHero`'s event loop) instead, on its own clock. Deliberately kept out
   *  of the rule: the attack timeline is PRESENTATION timing — which animation frame to show, when
   *  to play the strike sound (`ATTAQUE_SON`, offset from `ATTAQUE_FRAPPE` to cover a sound
   *  sample's own attack curve) — not a fact a server needs to know to resolve anything. Nothing in
   *  `stepHero`'s output depends on it either: moving it into the rule would only widen the
   *  rule's surface for no gain, the same call already made for `facing`. A server driving
   *  `stepHero` directly can simply ignore this field. */
  attaque: number;
  /** Alternates left foot / right foot from one footprint to the next. */
  coteTrace: number;
}

/**
 * What a step CAUSED. The rule plays no sound and creates no billboard: it narrates, and the
 * adapter executes. This is what makes the rule testable without a browser — and what will let the
 * server simply ignore the purely decorative events.
 */
export type HeroEvent =
  | { t: "pas"; matiere: TerrainMaterial }
  | { t: "brasse" }
  | { t: "saut" }
  | { t: "reception"; force: number }
  | { t: "entree-eau"; liquid: TerrainLiquid; x: number; y: number; z: number }
  | { t: "sortie-eau"; liquid: TerrainLiquid; x: number; y: number; z: number }
  | { t: "noyade"; x: number; y: number; z: number }
  | { t: "trace"; x: number; z: number; cote: number }
  | { t: "haleine" }
  /** Skid intensity, 0..1 — a HELD sound, so emitted every frame, not on trigger. */
  | { t: "glisse"; intensite: number }
  /** The canopy opened / folded. Nothing about a texture or a sound: the adapter decides that. */
  | { t: "glider-open" }
  | { t: "glider-close" };

/**
 * The settings the rule reads. Passed as a parameter rather than imported from `settings.ts`:
 * this is what let `hero-step.ts` move into `engine` without carrying the LAB's settings along
 * with it. S1's review had named this coupling as the point to rewire at the move.
 */
export interface HeroSettings {
  speed: number;
  radius: number;
  /** Offset of the collision footprint under the sprite's body. */
  offset: number;
  friction: { herbe: number; neige: number; glace: number };
  vitesseSol: { herbe: number; neige: number; glace: number };
  jump: { speed: number; gravity: number; coyote: number };
  /** Extra jumps allowed between take-off and landing. Zero is the historical behaviour. */
  airJumps?: number;
  /** The glider. `fall` is the descent speed, in world units per second, POSITIVE — the rule
   *  negates it. A constant, not a terminal velocity: a glide never accelerates. */
  glide: { fall: number };
  swim: { speed: number; breath: number; climb: number };
  /** Distance traveled between two footsteps. */
  pasTousLes: number;
  /** Same, between two swim strokes. */
  brasseTousLes: number;
  /** Interval between two idle breath puffs, in seconds. */
  haleineRepos: number;
  /** Lateral offset of a footprint relative to the walking axis. */
  traceEcart: number;
}

export interface WorldSettings {
  size: number;
  levelHeight: number;
  waterLevel: number;
  maxStep: number;
}

/** What a collider knows how to answer. An interface rather than the concrete type: colliders
 *  changed implementation (circles → rectangles) without the rule ever noticing. */
export interface ColliderQuery {
  /** `true` if a disc of radius `r` centered at `(x, z)` overlaps an obstacle. */
  blocked(x: number, z: number, r: number, y?: number): boolean;
  /** Refuses a swept horizontal move that crosses a collider between two rendered frames. */
  blockedAlong?(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    r: number,
    y?: number,
  ): boolean;
  /** Allows an embedded body to move sideways or outward, never farther into an obstacle. */
  allowsEscape?(fromX: number, fromZ: number, x: number, z: number, r: number, y?: number): boolean;
  /** Finite height to clear, `Infinity` for a wall, `null` without overlap. */
  heightToClear?(x: number, z: number, r: number): number | null;
  /** Highest feet position allowed while an upward segment crosses a finite underside. */
  upwardLimit?(x: number, z: number, r: number, fromY: number, toY: number): number | null;
}

export interface StepDeps {
  query: TerrainQuery;
  colliders: ColliderQuery;
  hero: HeroSettings;
  world: WorldSettings;
}

/** The starting state, on the ground, at the given position. */
export function createHeroState(
  x: number,
  z: number,
  y: number,
  breath: number,
  reposHaleine: number,
): HeroState {
  return {
    x,
    y,
    z,
    vx: 0,
    vz: 0,
    impulsionX: 0,
    impulsionZ: 0,
    vy: 0,
    airborne: false,
    swimming: false,
    liquid: null,
    breath,
    coyote: 0,
    gliding: false,
    airJumpsRemaining: 0,
    jumpHeld: false,
    groundY: y,
    facing: 1,
    room: null,
    distanceDepuisLePas: 0,
    brasse: 0,
    reposHaleine,
    attaque: -1,
    coteTrace: 1,
  };
}
