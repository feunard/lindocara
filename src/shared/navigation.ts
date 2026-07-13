import { TILE_SIZE } from "./tilemap.js";

export interface ZoneNavigationDefinition {
  cellSize: number;
  minimumRepathMs: number;
  targetMoveThreshold: number;
  nodeBudgetPerTick: number;
  maximumSearchNodes: number;
  maximumQueuedRequests: number;
  unreachableRetryMs: number;
  waypointTolerance: number;
}

export const DEFAULT_ZONE_NAVIGATION: ZoneNavigationDefinition = {
  /** The tilemap's cell size. Navigation and collision must be the same grid, or A* will route
   *  monsters through walls the simulation then refuses — which is what `stuckTicks` used to hide. */
  cellSize: TILE_SIZE,
  minimumRepathMs: 650,
  targetMoveThreshold: 72,
  nodeBudgetPerTick: 180,
  maximumSearchNodes: 2_400,
  maximumQueuedRequests: 48,
  unreachableRetryMs: 5_000,
  waypointTolerance: 10,
};

export type MonsterNavigationState =
  | "idle"
  | "patrol"
  | "chase"
  | "return"
  | "waiting_path"
  | "unreachable";
