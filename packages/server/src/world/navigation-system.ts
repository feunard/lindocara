import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { ZoneNavigationDefinition } from "@lindocara/engine/navigation.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  standingCeiling,
  type ZoneTerrain,
} from "./terrain-access.js";
import type { MonsterRuntime } from "./world-runtime.js";

const PATH_CACHE_LIMIT = 128;

export interface NavigationGrid {
  /**
   * Cell edge in TILE UNITS, and therefore always 1: a navigation node is exactly one heightfield
   * cell. It was `TILE_SIZE` for the same reason — one node per collision cell — and survives as a
   * named constant only so the arithmetic below reads as arithmetic rather than as magic ones.
   */
  cellSize: number;
  columns: number;
  rows: number;
  walkable: Uint8Array;
  /**
   * The ground height under each node's cell centre. This is the elevation half of walkability and
   * the reason it is baked rather than sampled: an edge test that re-read the terrain under the
   * CANDIDATE would be the self-satisfying `canStand(dest, groundUnder(dest))` that has already
   * shipped a cliff-climbing bug three times over. `neighbors` reads the CURRENT node's height, so
   * every edge is grounded on where the body is.
   */
  height: Float64Array;
  terrain: ZoneTerrain;
}

interface PathRequest {
  monster: MonsterRuntime;
  requestId: number;
  startNode: number;
  goalNode: number;
  destination: GroundVector;
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
  points: GroundVector[];
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
 * A node is walkable exactly when `canStand` says a body could stand at its cell centre, and the
 * height it stands at is baked beside it. Navigation and collision asking the SAME function is
 * what makes a "clear" path always actually walkable — this used to be "the tilemap says so", and
 * every disagreement between the two rules had to be patched back out by hand.
 *
 * One node per heightfield cell, always — not something a zone can configure. There used to be a
 * `ZoneNavigationDefinition.cellSize` a zone could override (that is how `mmo-test-zone` once
 * shipped with `cellSize: 40`, silently misaligning every waypoint against the collision tiles);
 * it is gone, and this function takes only the terrain, so there is no second number to disagree
 * with it.
 *
 * Two passes became one. The pixel grid needed a second sweep re-checking each node through
 * `isWalkable` at its CLAMPED waypoint, because a tilemap rounds up to whole tiles while the world
 * it was generated from does not, so an edge row's waypoint could be dragged into a neighbouring
 * cell the tilemap disagreed about. A heightfield has no world rectangle separate from its grid
 * and `pointForNode` returns an exact cell centre, so the waypoint a node promises is the point
 * this pass tested — there is nothing left for a second pass to catch. Sub-cell colliders come
 * along for free either way: `canStand` queries `terrain.colliders` beside the relief, so a cell a
 * tree trunk only partially covers is walkable exactly when a `BODY_RADIUS` disc fits at the
 * waypoint the pathfinder would send a monster to.
 *
 * Grounding each node on its OWN ground is right here and only here: nobody is stepping anywhere
 * yet, the question is "could a body be standing at this cell", and the ground under it is by
 * definition the ground it stands on (the same reading `restoreStandablePosition` takes). The
 * question "may a body WALK from this cell to that one" is `neighbors`', and it is grounded
 * differently on purpose.
 */
export function createNavigationGrid(terrain: ZoneTerrain): NavigationGrid {
  const columns = terrain.size;
  const rows = terrain.size;
  const walkable = new Uint8Array(columns * rows);
  const height = new Float64Array(columns * rows);
  for (let node = 0; node < walkable.length; node++) {
    const column = node % columns;
    const row = Math.floor(node / columns);
    const [x, z] = terrain.query.cellCenter(column, row);
    const ground = groundUnder(terrain, x, z);
    height[node] = ground;
    walkable[node] = canStand(terrain, x, z, BODY_RADIUS, ground) ? 1 : 0;
  }
  return { cellSize: 1, columns, rows, walkable, height, terrain };
}

export function createNavigationRuntime(
  terrain: ZoneTerrain,
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
  destination: GroundVector,
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
    groundDistance(requested, destination) >= runtime.definition.targetMoveThreshold;
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
  navigation.requestedDestination = { x: destination.x, z: destination.z };
  navigation.destination = { x: destination.x, z: destination.z };
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
    destination: { x: destination.x, z: destination.z },
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

/**
 * Recovery for a path-following waypoint move that real (box) collision refused even though the
 * navigation grid called the node walkable — `createNavigationGrid`'s docs cover why that gap
 * isn't fully closed. `invalidateMonsterPath` alone does not make this recover: `requestedDestination`
 * and `lastPathRequestAt` survive it, so `requestMonsterPath`'s `minimumRepathMs` gate defers the
 * very re-plan this exists to trigger — for up to 650ms, since neither the monster nor the
 * destination has moved. And once the gate does open, the same `cacheKey` (start/goal unchanged)
 * hands back the *identical* cached path with the identical failing first waypoint, which gets
 * invalidated again in the same tick it was applied: from the outside, nothing ever looks like it
 * changed.
 *
 * Clearing `requestedDestination` lets the very next request through both of `requestMonsterPath`'s
 * gates (each keys off it being non-null), and evicting the cache entry for this start/goal forces
 * a real search instead of a rubber-stamped repeat.
 *
 * This does not make a genuinely wedged monster escape — if nothing about the world has changed, a
 * fresh search is deterministic and finds the identical doomed path. It only removes the parts of
 * the old "recovery" that did nothing: the up-to-650ms wait and the guaranteed-stale cache hit.
 */
export function invalidateBlockedWaypoint(
  runtime: NavigationRuntime,
  monster: MonsterRuntime,
  destination: GroundVector,
): void {
  invalidateMonsterPath(monster, "waypoint_blocked");
  monster.navigation.requestedDestination = null;
  const startNode = nearestWalkableNode(runtime.grid, nodeForPoint(runtime.grid, monster));
  const goalNode = nearestWalkableNode(runtime.grid, nodeForPoint(runtime.grid, destination));
  if (startNode !== null && goalNode !== null) {
    runtime.cache.delete(`${startNode}:${goalNode}`);
  }
}

export function currentWaypoint(monster: MonsterRuntime): GroundVector | null {
  return monster.navigation.path[monster.navigation.pathIndex] ?? null;
}

export function advanceWaypoint(monster: MonsterRuntime, tolerance: number): GroundVector | null {
  let waypoint = currentWaypoint(monster);
  while (waypoint && groundDistance(monster, waypoint) <= tolerance) {
    monster.navigation.pathIndex += 1;
    waypoint = currentWaypoint(monster);
  }
  return waypoint;
}

export function navigationDebug(monster: MonsterRuntime): {
  state: MonsterRuntime["navigation"]["state"];
  path: GroundVector[];
  destination: GroundVector | null;
  reason: string | null;
} {
  return {
    state: monster.navigation.state,
    path: monster.navigation.path
      .slice(monster.navigation.pathIndex)
      .map((point) => ({ x: point.x, z: point.z })),
    destination: monster.navigation.destination
      ? { x: monster.navigation.destination.x, z: monster.navigation.destination.z }
      : null,
    reason: monster.navigation.abandonReason,
  };
}

function applyPath(
  monster: MonsterRuntime,
  points: readonly GroundVector[],
  destination: GroundVector,
  targetId: string | null,
  state: "patrol" | "chase" | "return",
): void {
  monster.navigation.path = points.map((point) => ({ x: point.x, z: point.z }));
  monster.navigation.pathIndex = 0;
  monster.navigation.destination = { x: destination.x, z: destination.z };
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

function rememberPath(
  runtime: NavigationRuntime,
  key: string,
  path: GroundVector[],
  now: number,
): void {
  if (runtime.cache.size >= PATH_CACHE_LIMIT) {
    const oldest = [...runtime.cache.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
    if (oldest) runtime.cache.delete(oldest[0]);
  }
  runtime.cache.set(key, {
    points: path.map((point) => ({ x: point.x, z: point.z })),
    usedAt: now,
  });
}

function reconstructPath(grid: NavigationGrid, work: SearchWork, goal: number): GroundVector[] {
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

/**
 * **This is where the A* grid became elevation-aware, and the change is one comparison.** An edge
 * exists when the candidate is standable AND its ground is no higher than a body standing on the
 * CURRENT node could step onto. `MAX_STEP` is 0, so that means: a monster walks along its own tier
 * and down off it, never up. A hero on a plateau is visible, in range and genuinely unreachable,
 * and `monster-system.ts`'s abandonment path is what turns that into a monster giving up rather
 * than one grinding against a cliff.
 *
 * `standingCeiling(terrain, height[node])` — the current node — is the whole discipline. Passing
 * `height[candidate]` would make the comparison `h <= h + ε`, true for every pair of cells in the
 * world, and the search would climb anything; that is `canStand(dest, groundUnder(dest))`, the
 * self-satisfying shape that has already been fixed three times elsewhere in this increment.
 *
 * Edges are therefore DIRECTED: down is an edge, up is not. That is correct rather than an
 * oversight — a monster really can drop off a ledge it cannot climb back up — and it costs the
 * search nothing, because A* only ever expands forward from the start.
 *
 * Still no test of the segment BETWEEN the two cell centres: a neighbour is the adjacent cell in
 * one axis, exactly one tile away, and a `BODY_RADIUS` (0.25 tile) disc centred in one cell can
 * never reach far enough to touch a third cell while crossing to the next — if both endpoints are
 * standable, the straight line between them necessarily is too. That reasoning survived the units
 * unchanged; only the numbers it quotes shrank by `TILE_SIZE`.
 */
function neighbors(grid: NavigationGrid, node: number): number[] {
  const column = node % grid.columns;
  const row = Math.floor(node / grid.columns);
  const result: number[] = [];
  if (column > 0) result.push(node - 1);
  if (column + 1 < grid.columns) result.push(node + 1);
  if (row > 0) result.push(node - grid.columns);
  if (row + 1 < grid.rows) result.push(node + grid.columns);
  const ceiling = standingCeiling(grid.terrain, grid.height[node] ?? 0);
  return result.filter(
    (candidate) => grid.walkable[candidate] === 1 && (grid.height[candidate] ?? 0) <= ceiling,
  );
}

function heuristic(grid: NavigationGrid, from: number, to: number): number {
  const fromColumn = from % grid.columns;
  const fromRow = Math.floor(from / grid.columns);
  const toColumn = to % grid.columns;
  const toRow = Math.floor(to / grid.columns);
  return Math.abs(fromColumn - toColumn) + Math.abs(fromRow - toRow);
}

/**
 * The pixel version added half a body to each axis before dividing, because a pixel position was a
 * body's TOP-LEFT CORNER and the grid needed its centre. A tile-unit position already IS the body's
 * centre, and the grid is centred on the origin, so the whole correction collapses into the origin
 * shift `TerrainQuery` uses everywhere: cell `i` covers `x ∈ [i - size/2, i + 1 - size/2)`.
 */
function nodeForPoint(grid: NavigationGrid, point: GroundVector): number {
  const half = grid.terrain.size / 2;
  const column = Math.max(
    0,
    Math.min(grid.columns - 1, Math.floor((point.x + half) / grid.cellSize)),
  );
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor((point.z + half) / grid.cellSize)));
  return row * grid.columns + column;
}

/**
 * The exact cell centre — `TerrainQuery`'s own answer, so a waypoint and the height baked for its
 * node can never be read from two different points. The pixel version clamped against
 * `terrain.width`/`height`, a rectangle that could be smaller than the tilemap covering it; a
 * heightfield has no such second extent, and a cell centre is inside the grid by construction.
 */
function pointForNode(grid: NavigationGrid, node: number): GroundVector {
  const column = node % grid.columns;
  const row = Math.floor(node / grid.columns);
  const [x, z] = grid.terrain.query.cellCenter(column, row);
  return { x, z };
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
