/**
 * The hero's movement, owned by the client.
 *
 * This is `apps/lab/src/world/hero.ts` minus its billboards: it holds the single `HeroState`, feeds
 * it to `stepHero` (`@lindocara/engine/hd2d/hero-step.js`) once per frame, and hands the resulting
 * `HeroEvent`s back to whoever plays them. The lab proved the rule at 60 Hz against its own island;
 * nothing about the rule changes here, only who owns the state and what happens to the events.
 *
 * **The server no longer decides where this hero is** (see the S3 spec, decision 4): it stores the
 * position this controller reports and relays it to the rest of the party. Everything else — damage,
 * loot, XP, quests, resurrection — stays server-decided, so this file must never grow an outcome.
 *
 * The one addition to that, and the spec's second and last exception (decision 6): a **granted**
 * mobility skill's displacement is performed here (`setMobility`). The grant itself is not — the
 * server spent the cooldown and the resource and can withdraw it at any beat; this only spends
 * what it was handed. Drowning is the counter-example on the same boundary: the rule below decides
 * that the hero ran out of breath, and the server alone decides what that costs.
 *
 * Two obligations `stepHero` cannot enforce and that live here:
 *
 * - **`stepHero` mutates `HeroState` in place** and returns events. It is not `next = step(prev)`.
 *   The state exposed below is the live object, typed `Readonly` so a caller cannot write through it.
 * - **`ThinIce.update(dt)` is the caller's job**, unconditionally, once per frame, before the step
 *   (see `StepDeps.glace`): the rule loads and releases cells but has no clock to refreeze one with.
 */

import { orientationFromMovement } from "@lindocara/engine/directional-combat.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import { groundDistance } from "@lindocara/engine/ground.js";
import {
  createHeroState,
  type HeroEvent,
  type HeroInput,
  type HeroSettings,
  type HeroState,
  type StepDeps,
  type WorldSettings,
} from "@lindocara/engine/hd2d/hero-state.js";
import { stepHero } from "@lindocara/engine/hd2d/hero-step.js";
import { createThinIce, type ThinIceOptions } from "@lindocara/engine/hd2d/thin-ice.js";
import {
  BODY_RADIUS,
  canStand,
  clampToGrid,
  groundUnder,
  MAX_STEP,
  nearestStandableCell,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";

/**
 * The game's own physics, everything `HeroSettings` carries except `speed` — which is per class,
 * per map and per life state, and therefore an argument rather than a constant.
 *
 * The numbers are the lab's `HERO` (`apps/lab/src/settings.ts`), which is where they were tuned and
 * played, with two deliberate substitutions:
 *
 * - `radius` is `BODY_RADIUS`, the one collision disc the server already tests every other body
 *   with. The lab's own 0.3 would put the client's hero and the server's monsters on two different
 *   bodies, which is exactly the kind of near-miss nothing ever fails on.
 * - `swim.depth` is absent: it is the lab's rendering offset, not a rule, and `HeroSettings` does
 *   not declare it.
 */
export const HERO_PHYSICS: Omit<HeroSettings, "speed"> = {
  radius: BODY_RADIUS,
  offset: 0.15,
  friction: { herbe: 80, neige: 130, glace: 0.35 },
  vitesseSol: { herbe: 1, neige: 0.55, glace: 1 },
  jump: { speed: 9, gravity: 30, coyote: 0.12 },
  glide: { fall: 2.2 },
  swim: { speed: 0.45, breath: 11, climb: 0.5 },
  pasTousLes: 1.2,
  brasseTousLes: 0.85,
  haleineRepos: 2.2,
  traceEcart: 0.14,
};

/** The lab's three thin-ice thresholds, unchanged. No shipped map authors `glace-fine` yet, so this
 *  is dormant rather than dead: the rule reads it every frame regardless, and a map that grows a
 *  frozen shore must find the same numbers the lab was tuned against. */
export const THIN_ICE: ThinIceOptions = { seuilCraquement: 0.5, seuilRupture: 1.4, regel: 6 };

const COLD_CLIMATE_OFFSETS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1.5, -1.5],
  [1.5, -1.5],
  [-1.5, 1.5],
  [1.5, 1.5],
  [-2, 0],
  [2, 0],
  [0, -2],
  [0, 2],
] as const;

/** Authored cold ground replaces the lab's hard-coded polar circle. Sampling the nearby shore is
 * what keeps frozen water cold after `kindAt` correctly returns null under a swimmer. */
export function coldClimateAt(query: StepDeps["query"], x: number, z: number): boolean {
  return COLD_CLIMATE_OFFSETS.some(([dx, dz]) => {
    const material = query.kindAt(x + dx, z + dz);
    return material === "neige" || material === "glace" || material === "glace-fine";
  });
}

/**
 * The half of `HeroInput` the player actually drives. The rest is supplied by this module:
 * `attack` because combat is a server intent here and never the movement rule's business, and the
 * two climate values derived from the authored terrain around the hero.
 */
export interface HeroControllerInput {
  /** Ground axis 1, -1..1. */
  x: number;
  /** Ground axis 2, -1..1. NOT elevation. */
  z: number;
  /** A LEVEL, not an edge — `stepHero` reads the rising edge itself. */
  jump: boolean;
}

/**
 * A live mobility grant, as this controller consumes it. `SelfState.mobility` is its wire form; the
 * only difference is the window, which arrives as a server deadline and is converted by the caller
 * into a duration in SECONDS — this controller has no clock, and reading one here would be the same
 * mistake `@lindocara/engine/hd2d/`'s purity rule forbids one import away.
 */
export interface HeroMobilityGrant {
  /** The granting action. Identity, not decoration: the same id is applied exactly once. */
  actionId: string;
  /** Ground distance the grant is worth, in TILES. */
  distance: number;
  /** How long it stays live, in SECONDS, spent against the same `dt` the movement rule reads. */
  duration: number;
}

export interface HeroControllerOptions {
  terrain: ZoneTerrain;
  /** Where the hero enters, all three axes; `y` is ELEVATION. */
  spawn: WorldPosition;
  /** Full-tilt speed in TILES per second: the class/map stat, already resolved for the life state. */
  speed: number;
  /** Starting heading. Must be a unit ground vector; defaults to the engine's own default facing. */
  facing?: GroundVector;
}

export interface HeroController {
  /** The live state `stepHero` mutates. Read-only to callers: writing through it would put a second
   *  author on the one thing this controller owns. */
  readonly state: Readonly<HeroState>;
  /**
   * The ground heading reported on the wire, ALWAYS unit length. `MoveMessage`'s parser
   * (`isDirection`, `protocol.ts`) refuses anything else and drops the whole frame silently, so a
   * raw or zero-length heading would stop the hero moving for everyone else with no error on either
   * end. `orientationFromMovement` normalises, and preserves the previous heading when the player
   * lets go rather than collapsing to `{x: 0, z: 0}`.
   */
  readonly facing: Readonly<GroundVector>;
  /** Full breath reserve for this map/class tuning. The live remainder is `state.breath`. */
  readonly maxBreath: number;
  /** Advances one frame and returns what happened, in the order the rule emitted it. */
  step(input: HeroControllerInput, dt: number): HeroEvent[];
  /** Re-resolves the full-tilt speed (a class change, a life transition, a new map's hero rules). */
  setSpeed(speed: number): void;
  /** Replaces live collision/query data without resetting any hero-owned movement state. */
  setTerrain(terrain: ZoneTerrain): void;
  /**
   * Adopts a position this controller did not compute — a spawn, an authored teleport, a
   * resurrection. Momentum is cut, exactly as the lab cuts it entering or leaving a room: the elan
   * carried into a teleport means nothing on the other side.
   */
  teleport(position: WorldPosition): void;
  /**
   * Installs, keeps or withdraws the server's mobility grant (the S3 spec, decision 6).
   *
   * Three rules, each of which the skill stops being bounded without:
   *
   * - **A grant is armed once per `actionId`.** Every `state` frame during a hold carries the live
   *   grant again, and re-arming on each would make a 2.5-second channel an unlimited one.
   * - **`null` ends it**, which is how the server withdraws one: `selfState` derives the field from
   *   the live action, so the first frame after the action ends simply has no grant in it.
   * - **Ending resolves a landing.** A phased hero can be standing inside a cliff or a tree, where
   *   the ordinary rule refuses every direction and cements it there — the same landing search the
   *   server runs (`safeLumenLanding`) runs here, off the same terrain.
   */
  setMobility(grant: HeroMobilityGrant | null): void;
}

export function createHeroController(options: HeroControllerOptions): HeroController {
  let { terrain } = options;
  const { spawn } = options;
  const hero: HeroSettings = { ...HERO_PHYSICS, speed: options.speed };
  const world: WorldSettings = {
    size: terrain.size,
    levelHeight: terrain.levelHeight,
    waterLevel: terrain.waterLevel,
    // Zero: there is no grounded climbing at all, and high ground is reached by jumping. The same
    // constant the server's `canStand` uses, so the two agree on what a cliff is.
    maxStep: MAX_STEP,
  };
  const glace = createThinIce(THIN_ICE);
  const deps: StepDeps = { query: terrain.query, colliders: terrain.colliders, hero, world, glace };

  const state = createHeroState(
    spawn.x,
    spawn.z,
    groundUnder(terrain, spawn.x, spawn.z, spawn.y),
    hero.swim.breath,
    hero.haleineRepos,
  );
  // Seeded before the first step, and through the same normaliser every later heading goes through:
  // the very first `move` frame carries a valid unit heading rather than a zero the parser drops.
  let facing: GroundVector = orientationFromMovement(options.facing ?? { x: 1, z: 0 });

  /** What is left of the live grant. `null` whenever the hero moves by its own rule. */
  let mobility: { remaining: number; window: number } | null = null;
  /** The last action a grant was armed from, live or spent. See `setMobility`'s once-per-id rule. */
  let armedActionId: string | null = null;

  function place(position: WorldPosition): void {
    state.x = position.x;
    state.z = position.z;
    state.y = groundUnder(terrain, position.x, position.z, position.y);
    state.groundY = state.y;
    state.vx = 0;
    state.vz = 0;
    state.vy = 0;
    state.airborne = false;
    state.swimming = false;
    state.gliding = false;
    state.breath = hero.swim.breath;
  }

  /**
   * Ends a phased traversal on ground a body could actually be standing on.
   *
   * This is `safeLumenLanding` (`worldTick.ts`) minus the live bodies it also avoids, run off the
   * same terrain with the same helpers, so the two agree about where the skill ends without either
   * having to tell the other. Grounded on where the body IS — after phasing, that is the landing —
   * which is what "could a body be standing here" means and what `nearestStandableCell`'s own
   * candidates ask of themselves.
   */
  function land(): void {
    const groundY = groundUnder(terrain, state.x, state.z, state.y);
    if (canStand(terrain, state.x, state.z, hero.radius, groundY)) {
      state.y = groundY;
      state.groundY = groundY;
      return;
    }
    const landing = nearestStandableCell(terrain, state, hero.radius, groundY);
    // No standable cell at all is a map with no ground on the hero's level; leaving the body where
    // it is beats teleporting it somewhere invented.
    if (landing) place(landing);
  }

  function endMobility(): void {
    if (!mobility) return;
    mobility = null;
    land();
  }

  /**
   * One frame of a granted traversal, in place of the ordinary rule.
   *
   * Relief, water and props are all ignored — that IS Pas de Lumen, and it is what the retired
   * server branch did (`movement-system.ts`'s `clampToGrid` arm). The grid's edge is the one bound
   * that survives, because off it there is no ground to rematerialise onto.
   */
  function phase(input: HeroControllerInput, dt: number): void {
    const grant = mobility;
    if (!grant) return;
    grant.window -= dt;
    const length = Math.hypot(input.x, input.z);
    if (length > 0 && grant.remaining > 0) {
      const travel = Math.min(hero.speed * dt, grant.remaining);
      const desired = clampToGrid(terrain, {
        x: state.x + (input.x / length) * travel,
        z: state.z + (input.z / length) * travel,
      });
      // What the grid actually allowed, not what was asked for: a traversal held against the
      // eastern edge would otherwise spend its whole budget standing still.
      grant.remaining -= groundDistance(desired, state);
      state.x = desired.x;
      state.z = desired.z;
      // Elevation is re-read from the ground under the body, exactly as the retired server branch
      // did after every accepted segment: `y` is elevation, never a second ground axis.
      state.y = groundUnder(terrain, state.x, state.z, state.y);
      state.groundY = state.y;
    }
    // The traversal owns the body: nothing falls, swims or glides through a Pas de Lumen, and the
    // elan it started with means nothing on the other side.
    state.vx = 0;
    state.vz = 0;
    state.vy = 0;
    state.airborne = false;
    state.swimming = false;
    state.gliding = false;
    if (grant.remaining <= 0 || grant.window <= 0) endMobility();
  }

  return {
    state,
    get facing() {
      return facing;
    },
    get maxBreath() {
      return hero.swim.breath;
    },
    setSpeed(speed) {
      hero.speed = speed;
    },
    setTerrain(nextTerrain) {
      terrain = nextTerrain;
      deps.query = nextTerrain.query;
      deps.colliders = nextTerrain.colliders;
      world.size = nextTerrain.size;
      world.levelHeight = nextTerrain.levelHeight;
      world.waterLevel = nextTerrain.waterLevel;
    },
    teleport(position) {
      // A server-authored position ends any traversal in flight: whatever the grant was for, the
      // hero is no longer where it was being spent.
      mobility = null;
      place(position);
    },
    setMobility(grant) {
      if (!grant) {
        endMobility();
        return;
      }
      if (grant.actionId === armedActionId) return;
      armedActionId = grant.actionId;
      // A grant with nothing left to spend is not one. It reaches here when a `state` frame is
      // built in the same millisecond its channel lapses, and arming it would end a traversal that
      // never started — which, through `land()`, could move a hero standing inside geometry for
      // reasons that have nothing to do with this skill.
      if (grant.distance <= 0 || grant.duration <= 0) return;
      mobility = { remaining: grant.distance, window: grant.duration };
    },
    step(input, dt) {
      // Unconditional, before the step and independent of where the hero is: a released cell only
      // refreezes on real elapsed time (see `StepDeps.glace`).
      glace.update(dt);
      if (mobility) {
        phase(input, dt);
        // Same two heading writes as below, from the same input: a phased hero still faces where
        // it is going, and a heading that stopped updating would freeze the sprite mid-traversal.
        facing = orientationFromMovement({ x: input.x, z: input.z }, facing);
        if (input.x !== 0) state.facing = input.x > 0 ? 1 : -1;
        // The traversal is not the movement rule; it narrates nothing (no footstep, no splash).
        return [];
      }
      const coldClimate = coldClimateAt(deps.query, state.x, state.z);
      const heroInput: HeroInput = {
        x: input.x,
        z: input.z,
        jump: input.jump,
        attack: false,
        souffleTaux: coldClimate ? 2 : 1,
        haleineVisible: coldClimate,
      };
      const events = stepHero(state, heroInput, dt, deps);
      // **Nothing happens here on `noyade`, and that is the decision.** The lab answers it with
      // `place(spawn)`, where `spawn` is a debug reset. In the game it is where the welcome
      // admitted this hero, so the same line lets a player swim out, hold under for the breath's
      // eleven seconds and ride home past cliffs and monsters, at no cost and with no server event
      // — and the landing is in bounds, so `applyReportedMove` accepts it as a legitimate move.
      // Drowning is an OUTCOME, so it is the server's: the event is reported (`net.ts` sends
      // `{t:"drowned"}`) and the room decides what it costs, exactly as it does for every other way
      // a hero dies. Deciding here that the hero died would be a third authority exception, and the
      // spec allows exactly two.
      // Driven by the INPUT rather than by `state.vx`/`vz`: on ice, speed keeps its sign long after
      // the player has turned, and a heading derived from it would turn late. Same call the server
      // used to make on a dequeued command, so the facing rule itself did not change owner.
      facing = orientationFromMovement({ x: input.x, z: input.z }, facing);
      // The sprite flip the lab keeps on `HeroState`, driven from the same input for the same reason.
      if (input.x !== 0) state.facing = input.x > 0 ? 1 : -1;
      return events;
    },
  };
}
