import { isWalkable, type TerrainGeometry } from "../../shared/game.js";
import type { ZoneNavigationDefinition } from "../../shared/navigation.js";
import { PLAYER_SIZE, type Vec2 } from "../../shared/simulation.js";
import { isSolidKind, kindAt, TILE_SIZE } from "../../shared/tilemap.js";
import type { MonsterRuntime } from "./world-runtime.js";

const PATH_CACHE_LIMIT = 128;

export interface NavigationGrid {
  cellSize: number;
  columns: number;
  rows: number;
  walkable: Uint8Array;
  terrain: TerrainGeometry;
}

interface PathRequest {
  monster: MonsterRuntime;
  requestId: number;
  startNode: number;
  goalNode: number;
  destination: Vec2;
  targetId: string | null;
  state: "patrol" | "chase" | "return";
  cacheKey: string;
}

interface SearchNode {
  node: number;
  score: number;
}

interface SearchWork {
  request: PathRequest;
  open: SearchNode[];
  costs: Map<number, number>;
  cameFrom: Map<number, number>;
  closed: Set<number>;
  expanded: number;
}

interface CachedPath {
  points: Vec2[];
  usedAt: number;
}

export interface NavigationMetrics {
  expandedThisTick: number;
  totalExpanded: number;
  pathsCalculated: number;
  cacheHits: number;
  failedPaths: number;
  droppedRequests: number;
  peakQueueLength: number;
}

export interface NavigationRuntime {
  grid: NavigationGrid;
  definition: ZoneNavigationDefinition;
  queue: PathRequest[];
  active: SearchWork | null;
  cache: Map<string, CachedPath>;
  metrics: NavigationMetrics;
}

/**
 * A cell is walkable exactly when the tilemap says so — no sampling, no approximation. Navigation
 * and collision reading the same grid is what makes a "clear" path always actually walkable; see
 * `hasLineOfSight` and `isWalkable`, which read the identical tiles.
 *
 * The grid's cell size is `TILE_SIZE`, always — not something a zone can configure. There used to
 * be a `ZoneNavigationDefinition.cellSize` a zone could override (that is how `mmo-test-zone` once
 * shipped with `cellSize: 40`, silently misaligning every waypoint against the collision tiles);
 * it is gone, and this function takes only the tilemap-bearing `terrain`, so there is no longer a
 * second number to disagree with it.
 */
export function createNavigationGrid(terrain: TerrainGeometry): NavigationGrid {
  const columns = terrain.tiles.cols;
  const rows = terrain.tiles.rows;
  const walkable = new Uint8Array(columns * rows);
  for (let node = 0; node < walkable.length; node++) {
    const col = node % columns;
    const row = Math.floor(node / columns);
    walkable[node] = isSolidKind(kindAt(terrain.tiles, col, row)) ? 0 : 1;
  }
  const grid: NavigationGrid = { cellSize: TILE_SIZE, columns, rows, walkable, terrain };
  // A node's own tile kind is not enough: `pointForNode` clamps a node's waypoint to stay inside
  // `terrain.width`/`height`, and the tilemap can be taller or wider than the world it was
  // generated from (a tile grid rounds up to whole tiles; the world does not). When it is, the
  // clamped waypoint of an edge row can land in a cell the tilemap disagrees is walkable — the
  // exact disagreement between "the grid" and "collision" this whole module exists to close. A
  // node only counts as walkable if a body can actually stand at the point the pathfinder would
  // ever send it to.
  for (let node = 0; node < walkable.length; node++) {
    if (walkable[node] === 1 && !isWalkable(pointForNode(grid, node), PLAYER_SIZE, terrain)) {
      walkable[node] = 0;
    }
  }
  return grid;
}

export function createNavigationRuntime(
  terrain: TerrainGeometry,
  definition: ZoneNavigationDefinition,
): NavigationRuntime {
  return {
    grid: createNavigationGrid(terrain),
    definition,
    queue: [],
    active: null,
    cache: new Map(),
    metrics: {
      expandedThisTick: 0,
      totalExpanded: 0,
      pathsCalculated: 0,
      cacheHits: 0,
      failedPaths: 0,
      droppedRequests: 0,
      peakQueueLength: 0,
    },
  };
}

export function requestMonsterPath(
  runtime: NavigationRuntime,
  monster: MonsterRuntime,
  destination: Vec2,
  targetId: string | null,
  state: "patrol" | "chase" | "return",
  now: number,
  force = false,
): "queued" | "cached" | "deferred" | "dropped" {
  const navigation = monster.navigation;
  const targetChanged = navigation.targetId !== targetId;
  const requested = navigation.requestedDestination;
  const destinationMoved =
    requested === null ||
    distance(requested, destination) >= runtime.definition.targetMoveThreshold;
  if (
    !force &&
    !targetChanged &&
    !destinationMoved &&
    (navigation.requestPending || navigation.pathIndex < navigation.path.length)
  )
    return "deferred";
  if (
    !force &&
    requested !== null &&
    !targetChanged &&
    now - navigation.lastPathRequestAt < runtime.definition.minimumRepathMs
  )
    return "deferred";

  const startNode = nearestWalkableNode(runtime.grid, nodeForPoint(runtime.grid, monster));
  const goalNode = nearestWalkableNode(runtime.grid, nodeForPoint(runtime.grid, destination));
  if (startNode === null || goalNode === null) {
    failRequest(monster, targetId, now, runtime.definition.unreachableRetryMs, "no_walkable_node");
    return "dropped";
  }

  navigation.requestId += 1;
  navigation.requestPending = true;
  navigation.requestedDestination = { ...destination };
  navigation.destination = { ...destination };
  navigation.targetId = targetId;
  navigation.lastPathRequestAt = now;
  navigation.state = "waiting_path";
  navigation.abandonReason = null;
  const cacheKey = `${startNode}:${goalNode}`;
  const cached = runtime.cache.get(cacheKey);
  if (cached) {
    cached.usedAt = now;
    applyPath(monster, cached.points, destination, targetId, state);
    runtime.metrics.cacheHits += 1;
    return "cached";
  }

  for (let index = runtime.queue.length - 1; index >= 0; index--) {
    if (runtime.queue[index]?.monster === monster) runtime.queue.splice(index, 1);
  }
  if (runtime.queue.length >= runtime.definition.maximumQueuedRequests) {
    navigation.requestPending = false;
    navigation.state = state;
    navigation.abandonReason = "queue_full";
    runtime.metrics.droppedRequests += 1;
    return "dropped";
  }
  runtime.queue.push({
    monster,
    requestId: navigation.requestId,
    startNode,
    goalNode,
    destination: { ...destination },
    targetId,
    state,
    cacheKey,
  });
  runtime.metrics.peakQueueLength = Math.max(runtime.metrics.peakQueueLength, runtime.queue.length);
  return "queued";
}

export function processNavigationBudget(runtime: NavigationRuntime, now: number): number {
  let remaining = runtime.definition.nodeBudgetPerTick;
  runtime.metrics.expandedThisTick = 0;
  while (remaining > 0) {
    if (!runtime.active) {
      const request = nextValidRequest(runtime.queue);
      if (!request) break;
      runtime.active = {
        request,
        open: [
          {
            node: request.startNode,
            score: heuristic(runtime.grid, request.startNode, request.goalNode),
          },
        ],
        costs: new Map([[request.startNode, 0]]),
        cameFrom: new Map(),
        closed: new Set(),
        expanded: 0,
      };
    }
    const work = runtime.active;
    if (!work) break;
    if (work.request.monster.navigation.requestId !== work.request.requestId) {
      runtime.active = null;
      continue;
    }
    const current = takeLowest(work.open);
    if (!current) {
      completeFailure(runtime, work.request, now, "unreachable");
      continue;
    }
    if (work.closed.has(current.node)) continue;
    work.closed.add(current.node);
    work.expanded += 1;
    remaining -= 1;
    runtime.metrics.expandedThisTick += 1;
    runtime.metrics.totalExpanded += 1;
    if (current.node === work.request.goalNode) {
      const path = reconstructPath(runtime.grid, work, current.node);
      rememberPath(runtime, work.request.cacheKey, path, now);
      applyPath(
        work.request.monster,
        path,
        work.request.destination,
        work.request.targetId,
        work.request.state,
      );
      runtime.metrics.pathsCalculated += 1;
      runtime.active = null;
      continue;
    }
    if (work.expanded >= runtime.definition.maximumSearchNodes) {
      completeFailure(runtime, work.request, now, "search_limit");
      continue;
    }
    const currentCost = work.costs.get(current.node) ?? Number.POSITIVE_INFINITY;
    for (const neighbor of neighbors(runtime.grid, current.node)) {
      if (work.closed.has(neighbor)) continue;
      const nextCost = currentCost + 1;
      if (nextCost >= (work.costs.get(neighbor) ?? Number.POSITIVE_INFINITY)) continue;
      work.costs.set(neighbor, nextCost);
      work.cameFrom.set(neighbor, current.node);
      work.open.push({
        node: neighbor,
        score: nextCost + heuristic(runtime.grid, neighbor, work.request.goalNode),
      });
    }
  }
  return runtime.metrics.expandedThisTick;
}

export function invalidateMonsterPath(monster: MonsterRuntime, reason: string): void {
  monster.navigation.requestId += 1;
  monster.navigation.requestPending = false;
  monster.navigation.path = [];
  monster.navigation.pathIndex = 0;
  monster.navigation.abandonReason = reason;
}

export function currentWaypoint(monster: MonsterRuntime): Vec2 | null {
  return monster.navigation.path[monster.navigation.pathIndex] ?? null;
}

export function advanceWaypoint(monster: MonsterRuntime, tolerance: number): Vec2 | null {
  let waypoint = currentWaypoint(monster);
  while (waypoint && distance(monster, waypoint) <= tolerance) {
    monster.navigation.pathIndex += 1;
    waypoint = currentWaypoint(monster);
  }
  return waypoint;
}

export function navigationDebug(monster: MonsterRuntime): {
  state: MonsterRuntime["navigation"]["state"];
  path: Vec2[];
  destination: Vec2 | null;
  reason: string | null;
} {
  return {
    state: monster.navigation.state,
    path: monster.navigation.path
      .slice(monster.navigation.pathIndex)
      .map((point) => ({ ...point })),
    destination: monster.navigation.destination ? { ...monster.navigation.destination } : null,
    reason: monster.navigation.abandonReason,
  };
}

function applyPath(
  monster: MonsterRuntime,
  points: readonly Vec2[],
  destination: Vec2,
  targetId: string | null,
  state: "patrol" | "chase" | "return",
): void {
  monster.navigation.path = points.map((point) => ({ ...point }));
  monster.navigation.pathIndex = 0;
  monster.navigation.destination = { ...destination };
  monster.navigation.targetId = targetId;
  monster.navigation.requestPending = false;
  monster.navigation.state = state;
  monster.navigation.abandonReason = null;
}

function completeFailure(
  runtime: NavigationRuntime,
  request: PathRequest,
  now: number,
  reason: string,
): void {
  failRequest(
    request.monster,
    request.targetId,
    now,
    runtime.definition.unreachableRetryMs,
    reason,
  );
  runtime.metrics.failedPaths += 1;
  runtime.active = null;
}

function failRequest(
  monster: MonsterRuntime,
  targetId: string | null,
  now: number,
  retryMs: number,
  reason: string,
): void {
  monster.navigation.requestPending = false;
  monster.navigation.path = [];
  monster.navigation.pathIndex = 0;
  monster.navigation.state = "unreachable";
  monster.navigation.abandonReason = reason;
  if (targetId) {
    monster.threat.delete(targetId);
    monster.navigation.unreachableTargetId = targetId;
    monster.navigation.unreachableUntil = now + retryMs;
  }
}

function nextValidRequest(queue: PathRequest[]): PathRequest | undefined {
  while (queue.length > 0) {
    const request = queue.shift();
    if (request && request.monster.navigation.requestId === request.requestId) return request;
  }
  return undefined;
}

function rememberPath(runtime: NavigationRuntime, key: string, path: Vec2[], now: number): void {
  if (runtime.cache.size >= PATH_CACHE_LIMIT) {
    const oldest = [...runtime.cache.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
    if (oldest) runtime.cache.delete(oldest[0]);
  }
  runtime.cache.set(key, { points: path.map((point) => ({ ...point })), usedAt: now });
}

function reconstructPath(grid: NavigationGrid, work: SearchWork, goal: number): Vec2[] {
  const nodes = [goal];
  let current = goal;
  while (current !== work.request.startNode) {
    const previous = work.cameFrom.get(current);
    if (previous === undefined) break;
    nodes.push(previous);
    current = previous;
  }
  nodes.reverse();
  return nodes.slice(1).map((node) => pointForNode(grid, node));
}

function takeLowest(open: SearchNode[]): SearchNode | undefined {
  if (open.length === 0) return undefined;
  let bestIndex = 0;
  for (let index = 1; index < open.length; index++) {
    const candidate = open[index];
    const best = open[bestIndex];
    if (
      candidate &&
      best &&
      (candidate.score < best.score ||
        (candidate.score === best.score && candidate.node < best.node))
    )
      bestIndex = index;
  }
  const [selected] = open.splice(bestIndex, 1);
  return selected;
}

// Only checks `walkable[candidate]`, not the segment between the two cell centres: a neighbour
// is always the adjacent cell in one axis, exactly `cellSize` away, and a `PLAYER_SIZE` (32px)
// body centred in one 64px cell can never reach far enough to touch a third cell while crossing
// to the next — so if both endpoints are walkable, the straight line between them necessarily is
// too. This used to be re-checked with a sampled sweep (`edgeIsWalkable`), which was load-bearing
// only because `createNavigationGrid` could mark a node walkable whose own point was not (see its
// docs) — verified dead (0 of 6,822 candidate edges rejected on verdant-reach, 0 of 264 on
// mmo-test-zone) once that root cause was fixed, and deleted.
function neighbors(grid: NavigationGrid, node: number): number[] {
  const column = node % grid.columns;
  const row = Math.floor(node / grid.columns);
  const result: number[] = [];
  if (column > 0) result.push(node - 1);
  if (column + 1 < grid.columns) result.push(node + 1);
  if (row > 0) result.push(node - grid.columns);
  if (row + 1 < grid.rows) result.push(node + grid.columns);
  return result.filter((candidate) => grid.walkable[candidate] === 1);
}

function heuristic(grid: NavigationGrid, from: number, to: number): number {
  const fromColumn = from % grid.columns;
  const fromRow = Math.floor(from / grid.columns);
  const toColumn = to % grid.columns;
  const toRow = Math.floor(to / grid.columns);
  return Math.abs(fromColumn - toColumn) + Math.abs(fromRow - toRow);
}

function nodeForPoint(grid: NavigationGrid, point: Vec2): number {
  const centerX = point.x + PLAYER_SIZE / 2;
  const centerY = point.y + PLAYER_SIZE / 2;
  const column = Math.max(0, Math.min(grid.columns - 1, Math.floor(centerX / grid.cellSize)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(centerY / grid.cellSize)));
  return row * grid.columns + column;
}

function pointForNode(grid: NavigationGrid, node: number): Vec2 {
  const column = node % grid.columns;
  const row = Math.floor(node / grid.columns);
  return {
    x: Math.min(
      grid.terrain.width - PLAYER_SIZE,
      column * grid.cellSize + (grid.cellSize - PLAYER_SIZE) / 2,
    ),
    y: Math.min(
      grid.terrain.height - PLAYER_SIZE,
      row * grid.cellSize + (grid.cellSize - PLAYER_SIZE) / 2,
    ),
  };
}

function nearestWalkableNode(grid: NavigationGrid, origin: number): number | null {
  if (grid.walkable[origin] === 1) return origin;
  const column = origin % grid.columns;
  const row = Math.floor(origin / grid.columns);
  for (let radius = 1; radius <= 4; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const candidateColumn = column + dx;
        const candidateRow = row + dy;
        if (
          candidateColumn < 0 ||
          candidateColumn >= grid.columns ||
          candidateRow < 0 ||
          candidateRow >= grid.rows
        )
          continue;
        const candidate = candidateRow * grid.columns + candidateColumn;
        if (grid.walkable[candidate] === 1) return candidate;
      }
    }
  }
  return null;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
