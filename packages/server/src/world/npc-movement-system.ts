/**
 * Deterministic, authoritative movement for authored normal events.
 *
 * The editor has always persisted XP-style movement modes on each event page. This system gives
 * those fields runtime meaning without introducing Liin-specific routes or client-owned motion.
 * It moves only between tile cells, validates every destination against baked terrain, and receives
 * every room collection explicitly.
 */

import { npcMovementIntervalTicks } from "@lindocara/engine/event-movement.js";
import { isWalkable, type TerrainGeometry } from "@lindocara/engine/game.js";
import type { MoveType } from "@lindocara/engine/map-events.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ActiveWorldEvent, PlayerRuntime } from "./world-runtime.js";

export interface NpcMovementDefinition {
  id: string;
  homeCol: number;
  homeRow: number;
  moveType: MoveType;
  moveSpeed: number;
  moveFreq: number;
  through: boolean;
}

export interface NpcMovementRuntime extends NpcMovementDefinition {
  nextMoveTick: number;
  routeStep: number;
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
        ? { ...existing, ...definition }
        : {
            ...definition,
            nextMoveTick:
              tick + npcMovementIntervalTicks(definition.moveSpeed, definition.moveFreq),
            routeStep: 0,
          },
    );
  }
  return next;
}

function playerCell(player: Pick<PlayerRuntime, "x" | "y">): { col: number; row: number } {
  return {
    col: Math.floor((player.x + PLAYER_SIZE / 2) / TILE_SIZE),
    row: Math.floor((player.y + PLAYER_SIZE / 2) / TILE_SIZE),
  };
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
  players: readonly Pick<PlayerRuntime, "x" | "y" | "authorized" | "life">[],
): { cell: { col: number; row: number }; routeStep: number } {
  const current = { col: event.col, row: event.row };
  if (runtime.moveType === "fixed") return { cell: current, routeStep: runtime.routeStep };

  if (runtime.moveType === "approach") {
    const nearest = players
      .filter((player) => player.authorized && player.life === "alive")
      .map((player) => playerCell(player))
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
  const radius = runtime.moveSpeed >= 4 ? 2 : 1;
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

function cellWalkable(
  cell: { col: number; row: number },
  terrain: TerrainGeometry,
  through: boolean,
): boolean {
  if (
    cell.col < 0 ||
    cell.row < 0 ||
    cell.col >= terrain.tiles.cols ||
    cell.row >= terrain.tiles.rows
  ) {
    return false;
  }
  if (through) return true;
  const inset = (TILE_SIZE - PLAYER_SIZE) / 2;
  return isWalkable(
    {
      x: cell.col * TILE_SIZE + inset,
      y: cell.row * TILE_SIZE + inset,
    },
    PLAYER_SIZE,
    terrain,
  );
}

export function advanceNpcEvents(params: {
  events: readonly ActiveWorldEvent[];
  movement: Map<string, NpcMovementRuntime>;
  players: readonly Pick<PlayerRuntime, "x" | "y" | "authorized" | "life">[];
  terrain: TerrainGeometry;
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
    runtime.nextMoveTick =
      params.tick + npcMovementIntervalTicks(runtime.moveSpeed, runtime.moveFreq);
    const candidate = candidateFor(event, runtime, params.players);
    runtime.routeStep = candidate.routeStep;
    if (
      (candidate.cell.col === event.col && candidate.cell.row === event.row) ||
      occupied.has(`${candidate.cell.col}:${candidate.cell.row}`) ||
      !cellWalkable(candidate.cell, params.terrain, runtime.through)
    ) {
      return event;
    }
    occupied.delete(`${event.col}:${event.row}`);
    occupied.add(`${candidate.cell.col}:${candidate.cell.row}`);
    return { ...event, ...candidate.cell };
  });
}
