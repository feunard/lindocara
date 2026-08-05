export interface ZoneNavigationDefinition {
  minimumRepathMs: number;
  /** How far a target must move before a re-plan is worth it. TILE UNITS. */
  targetMoveThreshold: number;
  nodeBudgetPerTick: number;
  maximumSearchNodes: number;
  maximumQueuedRequests: number;
  unreachableRetryMs: number;
  /** How close counts as arrived, at a waypoint or at a destination. TILE UNITS. */
  waypointTolerance: number;
}

// There is deliberately no `cellSize` here: the navigation grid's cell size is `TILE_SIZE`,
// hard-coded in `createNavigationGrid`. A zone-configurable cell size is what let `mmo-test-zone`
// ship with `cellSize: 40`, silently misaligning every waypoint against the collision tiles the
// rest of the game reads — the same disagreement `stuckTicks` used to paper over.
// The two GEOMETRIC values here are tile units — exact quotients of the former 72 px and 10 px.
// They are compared against ground distances by `monster-system.ts`, so leaving them in pixels
// meant a ten-TILE arrival tolerance: every destination read as already reached and no monster
// moved at all. The budgets, counts and durations beside them are unitless or milliseconds and are
// untouched. The A* grid's own pixel arithmetic (`navigation-system.ts`'s `nodeForPoint`,
// `pointForNode`, its `distance` helper) is a separate conversion and is not done here.
export const DEFAULT_ZONE_NAVIGATION: ZoneNavigationDefinition = {
  minimumRepathMs: 650,
  targetMoveThreshold: 72 / 64,
  nodeBudgetPerTick: 180,
  maximumSearchNodes: 2_400,
  maximumQueuedRequests: 48,
  unreachableRetryMs: 5_000,
  waypointTolerance: 10 / 64,
};

export type MonsterNavigationState =
  | "idle"
  | "patrol"
  | "chase"
  | "return"
  | "waiting_path"
  | "unreachable";
