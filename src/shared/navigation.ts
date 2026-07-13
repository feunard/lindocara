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
  cellSize: 48,
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
