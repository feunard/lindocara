export interface ZoneNavigationDefinition {
  minimumRepathMs: number;
  targetMoveThreshold: number;
  nodeBudgetPerTick: number;
  maximumSearchNodes: number;
  maximumQueuedRequests: number;
  unreachableRetryMs: number;
  waypointTolerance: number;
}

// There is deliberately no `cellSize` here: the navigation grid's cell size is `TILE_SIZE`,
// hard-coded in `createNavigationGrid`. A zone-configurable cell size is what let `mmo-test-zone`
// ship with `cellSize: 40`, silently misaligning every waypoint against the collision tiles the
// rest of the game reads — the same disagreement `stuckTicks` used to paper over.
export const DEFAULT_ZONE_NAVIGATION: ZoneNavigationDefinition = {
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
