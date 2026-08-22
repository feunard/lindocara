/**
 * Deterministic, authoritative movement for authored scripted events and free NPCs.
 *
 * The editor has always persisted XP-style movement modes on each event page. This system gives
 * those fields runtime meaning without introducing Liin-specific routes or client-owned motion.
 * It moves only between tile cells, validates every destination against baked terrain, and receives
 * every room collection explicitly.
 */

import { npcMovementIntervalTicks } from "@lindocara/engine/event-movement.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { MoveType, NpcRoutineStep } from "@lindocara/engine/map-events.js";
import { SHEEP_IDLE_SECONDS, SHEEP_SPEED, SHEEP_WALK_SECONDS } from "@lindocara/engine/sheep.js";
import { TICK_MS } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";

import type { ActiveWorldEvent, PlayerRuntime } from "./world-runtime.js";

export interface NpcMovementDefinition {
  id: string;
  homeCol: number;
  homeRow: number;
  moveType: MoveType;
  moveSpeed: number;
  moveFreq: number;
  through: boolean;
  /**
   * The leash, in TILES — which is also cells, now that the grid is the tile grid. It used to be
   * pixels and was divided by `TILE_SIZE` at every use.
   *
   * Its producer converts it: `worldEvents.ts` builds this from
   * `authoredPatrolRadius(event.patrolRadius)`, the single crossing from the authored pixel space
   * (`engine/map-events.ts`). Do NOT divide it again here.
   */
  patrolRadius: number;
  route?: readonly NpcRoutineStep[];
  /** The lab critter cadence: alternating bounded idle and walking phases instead of perpetual
   * one-cell motion. Authored sheep opt into it; ordinary random NPCs keep the legacy cadence. */
  movementStyle?: "sheep";
}

export interface NpcMovementRuntime extends NpcMovementDefinition {
  nextMoveTick: number;
  routeStep: number;
  waitUntilTick: number;
  sheepPhase?: "idle" | "walk";
  sheepStepsRemaining?: number;
}

const DIRECTIONS = [
  { col: 0, row: -1 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: -1, row: 0 },
] as const;

const CIRCUIT = [
  { col: 0, row: -2 },
  { col: 2, row: -2 },
  { col: 2, row: 0 },
  { col: 2, row: 2 },
  { col: 0, row: 2 },
  { col: -2, row: 2 },
  { col: -2, row: 0 },
  { col: -2, row: -2 },
] as const;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

const SHEEP_STEP_TICKS = Math.max(1, Math.round(1 / SHEEP_SPEED / (TICK_MS / 1_000)));

function stableBetween(id: string, phase: string, cycle: number, range: readonly [number, number]) {
  const unit = stableHash(`${id}:${phase}:${cycle}`) / 0xffffffff;
  return range[0] + (range[1] - range[0]) * unit;
}

function sheepIdleTicks(id: string, cycle: number): number {
  return Math.max(
    1,
    Math.round((stableBetween(id, "idle", cycle, SHEEP_IDLE_SECONDS) * 1_000) / TICK_MS),
  );
}

function sheepWalkSteps(id: string, cycle: number): number {
  const seconds = stableBetween(id, "walk", cycle, SHEEP_WALK_SECONDS);
  return Math.max(1, Math.round((seconds * 1_000) / (SHEEP_STEP_TICKS * TICK_MS)));
}

export function reconcileNpcMovement(
  current: ReadonlyMap<string, NpcMovementRuntime>,
  definitions: readonly NpcMovementDefinition[],
  tick: number,
): Map<string, NpcMovementRuntime> {
  const next = new Map<string, NpcMovementRuntime>();
  for (const definition of definitions) {
    const existing = current.get(definition.id);
    next.set(
      definition.id,
      existing
        ? {
            ...existing,
            ...definition,
            ...(definition.movementStyle === "sheep" && existing.sheepPhase === undefined
              ? { sheepPhase: "idle" as const, sheepStepsRemaining: 0 }
              : {}),
          }
        : {
            ...definition,
            nextMoveTick:
              tick +
              (definition.movementStyle === "sheep"
                ? sheepIdleTicks(definition.id, 0)
                : npcMovementIntervalTicks(definition.moveSpeed, definition.moveFreq)),
            routeStep: 0,
            waitUntilTick: 0,
            ...(definition.movementStyle === "sheep"
              ? { sheepPhase: "idle" as const, sheepStepsRemaining: 0 }
              : {}),
          },
    );
  }
  return next;
}

/**
 * The cell a body stands in. This is `TerrainQuery`'s own `toCell` (`floor(w + size / 2)`) and must
 * stay that arithmetic: an NPC deciding it stands in one cell while collision says another is the
 * silent half-cell drift the grid-centred origin exists to make impossible.
 */
function cellOf(terrain: ZoneTerrain, x: number, z: number): { col: number; row: number } {
  const half = terrain.size / 2;
  return { col: Math.floor(x + half), row: Math.floor(z + half) };
}

function playerCell(
  terrain: ZoneTerrain,
  player: Pick<PlayerRuntime, "x" | "z">,
): { col: number; row: number } {
  return cellOf(terrain, player.x, player.z);
}

function stepToward(
  current: { col: number; row: number },
  target: { col: number; row: number },
): { col: number; row: number } {
  const dc = target.col - current.col;
  const dr = target.row - current.row;
  if (Math.abs(dc) >= Math.abs(dr) && dc !== 0) {
    return { col: current.col + Math.sign(dc), row: current.row };
  }
  if (dr !== 0) return { col: current.col, row: current.row + Math.sign(dr) };
  return current;
}

function candidateFor(
  event: ActiveWorldEvent,
  runtime: NpcMovementRuntime,
  players: readonly Pick<PlayerRuntime, "x" | "z" | "authorized" | "life">[],
  terrain: ZoneTerrain,
  tick: number,
): { cell: { col: number; row: number }; routeStep: number } {
  const current = { col: event.col, row: event.row };
  if (runtime.moveType === "fixed") return { cell: current, routeStep: runtime.routeStep };

  if (runtime.moveType === "approach") {
    const nearest = players
      .filter((player) => player.authorized && player.life === "alive")
      .map((player) => playerCell(terrain, player))
      .sort(
        (left, right) =>
          Math.abs(left.col - current.col) +
          Math.abs(left.row - current.row) -
          (Math.abs(right.col - current.col) + Math.abs(right.row - current.row)),
      )[0];
    const target =
      nearest &&
      Math.abs(nearest.col - runtime.homeCol) + Math.abs(nearest.row - runtime.homeRow) <= 8
        ? nearest
        : { col: runtime.homeCol, row: runtime.homeRow };
    return { cell: stepToward(current, target), routeStep: runtime.routeStep };
  }

  if (runtime.moveType === "custom") {
    const authoredRoute = runtime.route ?? [];
    if (authoredRoute.length > 0) {
      const routeStep = runtime.routeStep % authoredRoute.length;
      const step = authoredRoute[routeStep] as NpcRoutineStep;
      const target = {
        col: runtime.homeCol + step.offsetCol,
        row: runtime.homeRow + step.offsetRow,
      };
      if (current.col === target.col && current.row === target.row) {
        if (runtime.waitUntilTick === 0 && step.waitMs > 0) {
          runtime.waitUntilTick = tick + Math.ceil(step.waitMs / TICK_MS);
          return { cell: current, routeStep };
        }
        if (tick < runtime.waitUntilTick) return { cell: current, routeStep };
        runtime.waitUntilTick = 0;
        const nextRouteStep = (routeStep + 1) % authoredRoute.length;
        const next = authoredRoute[nextRouteStep] as NpcRoutineStep;
        return {
          cell: stepToward(current, {
            col: runtime.homeCol + next.offsetCol,
            row: runtime.homeRow + next.offsetRow,
          }),
          routeStep: nextRouteStep,
        };
      }
      runtime.waitUntilTick = 0;
      return { cell: stepToward(current, target), routeStep };
    }
    const offset = CIRCUIT[runtime.routeStep % CIRCUIT.length] ?? CIRCUIT[0];
    const target = {
      col: runtime.homeCol + offset.col,
      row: runtime.homeRow + offset.row,
    };
    const reached = current.col === target.col && current.row === target.row;
    const routeStep = reached ? (runtime.routeStep + 1) % CIRCUIT.length : runtime.routeStep;
    const nextOffset = CIRCUIT[routeStep] ?? CIRCUIT[0];
    return {
      cell: stepToward(current, {
        col: runtime.homeCol + nextOffset.col,
        row: runtime.homeRow + nextOffset.row,
      }),
      routeStep,
    };
  }

  const direction =
    DIRECTIONS[stableHash(`${runtime.id}:${runtime.routeStep}`) % DIRECTIONS.length] ??
    DIRECTIONS[0];
  const radius = Math.max(1, Math.floor(runtime.patrolRadius));
  const candidate = {
    col: current.col + direction.col,
    row: current.row + direction.row,
  };
  const insideLeash =
    Math.abs(candidate.col - runtime.homeCol) <= radius &&
    Math.abs(candidate.row - runtime.homeRow) <= radius;
  return {
    cell: insideLeash
      ? candidate
      : stepToward(current, { col: runtime.homeCol, row: runtime.homeRow }),
    routeStep: runtime.routeStep + 1,
  };
}

/** World centre of a cell — `TerrainQuery.cellCenter`, written out because this module needs the
 *  point and not the query object. */
function cellCentre(terrain: ZoneTerrain, cell: { col: number; row: number }): GroundVector {
  const half = terrain.size / 2;
  return { x: cell.col + 0.5 - half, z: cell.row + 0.5 - half };
}

/**
 * An NPC steps between whole cells, so its destination is tested at the cell's CENTRE.
 *
 * `groundY` is the ground under the NPC RIGHT NOW, not under the destination. Passing the
 * destination's own ground would self-satisfy `canStand`'s ceiling and let an NPC walk up a cliff
 * one cell at a time — an authored villager climbing a plateau the hero has to jump onto. NPCs
 * obey the same rule as monsters: they walk on terrain height and do not jump.
 *
 * `through` NPCs (the authored "walk through anything" flag) still bypass collision, and still
 * cannot leave the grid.
 */
function cellWalkable(
  cell: { col: number; row: number },
  terrain: ZoneTerrain,
  through: boolean,
  groundY: number,
): boolean {
  if (cell.col < 0 || cell.row < 0 || cell.col >= terrain.size || cell.row >= terrain.size) {
    return false;
  }
  if (through) return true;
  const centre = cellCentre(terrain, cell);
  return canStand(terrain, centre.x, centre.z, BODY_RADIUS, groundY);
}

export function advanceNpcEvents(params: {
  events: readonly ActiveWorldEvent[];
  movement: Map<string, NpcMovementRuntime>;
  players: readonly Pick<PlayerRuntime, "x" | "z" | "authorized" | "life">[];
  terrain: ZoneTerrain;
  tick: number;
  pausedEventIds: ReadonlySet<string>;
}): ActiveWorldEvent[] {
  const occupied = new Set(params.events.map((event) => `${event.col}:${event.row}`));
  return params.events.map((event) => {
    const runtime = params.movement.get(event.id);
    if (
      !runtime ||
      runtime.moveType === "fixed" ||
      params.pausedEventIds.has(event.id) ||
      params.tick < runtime.nextMoveTick
    ) {
      return event;
    }
    if (runtime.movementStyle === "sheep") {
      if (runtime.sheepPhase !== "walk") {
        runtime.sheepPhase = "walk";
        runtime.sheepStepsRemaining = sheepWalkSteps(runtime.id, runtime.routeStep);
      }
      runtime.nextMoveTick = params.tick + SHEEP_STEP_TICKS;
    } else {
      runtime.nextMoveTick =
        params.tick + npcMovementIntervalTicks(runtime.moveSpeed, runtime.moveFreq);
    }
    const proposed = candidateFor(event, runtime, params.players, params.terrain, params.tick);
    const distanceFromHome = Math.hypot(
      proposed.cell.col - runtime.homeCol,
      proposed.cell.row - runtime.homeRow,
    );
    const radiusInCells = Math.max(1, runtime.patrolRadius);
    const candidate =
      distanceFromHome <= radiusInCells
        ? proposed
        : {
            cell: stepToward(
              { col: event.col, row: event.row },
              { col: runtime.homeCol, row: runtime.homeRow },
            ),
            routeStep: proposed.routeStep,
          };
    runtime.routeStep = candidate.routeStep;
    const here = cellCentre(params.terrain, event);
    let nextEvent = event;
    if (
      (candidate.cell.col === event.col && candidate.cell.row === event.row) ||
      occupied.has(`${candidate.cell.col}:${candidate.cell.row}`) ||
      !cellWalkable(
        candidate.cell,
        params.terrain,
        runtime.through,
        groundUnder(params.terrain, here.x, here.z),
      )
    ) {
      nextEvent = event;
    } else {
      occupied.delete(`${event.col}:${event.row}`);
      occupied.add(`${candidate.cell.col}:${candidate.cell.row}`);
      nextEvent = { ...event, ...candidate.cell };
    }
    if (runtime.movementStyle === "sheep") {
      runtime.sheepStepsRemaining = Math.max(0, (runtime.sheepStepsRemaining ?? 1) - 1);
      if (runtime.sheepStepsRemaining === 0) {
        runtime.sheepPhase = "idle";
        runtime.nextMoveTick = params.tick + sheepIdleTicks(runtime.id, runtime.routeStep);
      }
    }
    return nextEvent;
  });
}
