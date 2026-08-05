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
 * Two obligations `stepHero` cannot enforce and that live here:
 *
 * - **`stepHero` mutates `HeroState` in place** and returns events. It is not `next = step(prev)`.
 *   The state exposed below is the live object, typed `Readonly` so a caller cannot write through it.
 * - **`ThinIce.update(dt)` is the caller's job**, unconditionally, once per frame, before the step
 *   (see `StepDeps.glace`): the rule loads and releases cells but has no clock to refreeze one with.
 */

import { orientationFromMovement } from "@lindocara/engine/directional-combat.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
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
  groundUnder,
  MAX_STEP,
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

/**
 * The half of `HeroInput` the player actually drives. The rest is supplied by this module:
 * `attack` because combat is a server intent here and never the movement rule's business, and
 * `souffleTaux`/`haleineVisible` because the game has no zone that varies them yet (the lab's polar
 * zone is the only thing that ever did).
 */
export interface HeroControllerInput {
  /** Ground axis 1, -1..1. */
  x: number;
  /** Ground axis 2, -1..1. NOT elevation. */
  z: number;
  /** A LEVEL, not an edge — `stepHero` reads the rising edge itself. */
  jump: boolean;
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
  /** Advances one frame and returns what happened, in the order the rule emitted it. */
  step(input: HeroControllerInput, dt: number): HeroEvent[];
  /** Re-resolves the full-tilt speed (a class change, a life transition, a new map's hero rules). */
  setSpeed(speed: number): void;
  /**
   * Adopts a position this controller did not compute — a spawn, an authored teleport, a
   * resurrection. Momentum is cut, exactly as the lab cuts it entering or leaving a room: the elan
   * carried into a teleport means nothing on the other side.
   */
  teleport(position: WorldPosition): void;
}

export function createHeroController(options: HeroControllerOptions): HeroController {
  const { terrain, spawn } = options;
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

  return {
    state,
    get facing() {
      return facing;
    },
    setSpeed(speed) {
      hero.speed = speed;
    },
    teleport(position) {
      place(position);
    },
    step(input, dt) {
      // Unconditional, before the step and independent of where the hero is: a released cell only
      // refreezes on real elapsed time (see `StepDeps.glace`).
      glace.update(dt);
      const heroInput: HeroInput = {
        x: input.x,
        z: input.z,
        jump: input.jump,
        attack: false,
        souffleTaux: 1,
        haleineVisible: false,
      };
      const events = stepHero(state, heroInput, dt, deps);
      for (const event of events) {
        if (event.t !== "noyade") continue;
        // Drowning returns the hero to where it entered the map. `stepHero` never receives the
        // spawn (see its `drown`), so the adapter is the only thing that can answer this — the lab
        // does exactly the same, in the same place.
        place(spawn);
      }
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
