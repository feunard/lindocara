import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { SeaGuardianSnapshot } from "@lindocara/engine/protocol.js";
import {
  SEA_GUARDIAN_ATTACK_DURATION_MS,
  SEA_GUARDIAN_CHASE_SPEED,
  SEA_GUARDIAN_DEVOUR_RANGE,
  SEA_GUARDIAN_ID,
  SEA_GUARDIAN_PATH_REFRESH_MS,
  SEA_GUARDIAN_PATROL_SPEED,
  type SeaGuardianState,
} from "@lindocara/engine/sea-guardian.js";
import type { PlayerRuntime } from "./world-runtime.js";

interface WaterCell extends GroundVector {
  index: number;
  component: number;
}

interface WaterTopology {
  map: MapData;
  cells: readonly WaterCell[];
  byIndex: ReadonlyMap<number, WaterCell>;
  components: readonly (readonly WaterCell[])[];
}

export interface SeaGuardianRuntimeEntity extends GroundVector {
  id: string;
  y: number;
  facing: GroundVector;
  state: SeaGuardianState;
  animationStartedAt: number;
  animationEndsAt: number | null;
  component: number;
  targetId: string | null;
  path: readonly WaterCell[];
  pathIndex: number;
  nextPathAt: number;
}

export interface SeaGuardianRuntime {
  topology: WaterTopology | null;
  guardian: SeaGuardianRuntimeEntity | null;
}

export interface SeaGuardianAdvanceOptions {
  now: number;
  dt: number;
  players: Iterable<PlayerRuntime>;
  devour(player: PlayerRuntime, guardian: SeaGuardianRuntimeEntity): void;
}

function buildWaterTopology(map: MapData | null): WaterTopology | null {
  if (!map?.levels.some((level) => level === null)) return null;
  const componentByIndex = new Int32Array(map.levels.length).fill(-1);
  const components: WaterCell[][] = [];
  const half = map.size / 2;
  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let start = 0; start < map.levels.length; start += 1) {
    if (map.levels[start] !== null || componentByIndex[start] !== -1) continue;
    const component = components.length;
    const queue: number[] = [start];
    componentByIndex[start] = component;
    const cells: WaterCell[] = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index: number | undefined = queue[cursor];
      if (index === undefined) continue;
      const i: number = index % map.size;
      const j: number = Math.floor(index / map.size);
      cells.push({ index, component, x: i + 0.5 - half, z: j + 0.5 - half });
      for (const [di, dj] of neighbours) {
        const ni: number = i + di;
        const nj: number = j + dj;
        const next = nj * map.size + ni;
        if (
          ni < 0 ||
          nj < 0 ||
          ni >= map.size ||
          nj >= map.size ||
          map.levels[next] !== null ||
          componentByIndex[next] !== -1
        )
          continue;
        componentByIndex[next] = component;
        queue.push(next);
      }
    }
    components.push(cells);
  }
  const cells = components.flat();
  const byIndex = new Map(cells.map((cell) => [cell.index, cell]));
  return { map, cells, byIndex, components };
}

export function createSeaGuardianRuntime(
  map: MapData | null,
  anchor: GroundVector | null,
  now = Date.now(),
): SeaGuardianRuntime {
  const topology = anchor ? buildWaterTopology(map) : null;
  const runtime: SeaGuardianRuntime = { topology, guardian: null };
  if (!topology || !anchor) return runtime;
  const start = cellAt(topology, anchor);
  if (!start) return { topology: null, guardian: null };
  spawn(runtime, start.component, start, now, null);
  return runtime;
}

function cellAt(topology: WaterTopology, point: GroundVector): WaterCell | null {
  const half = topology.map.size / 2;
  const i = Math.floor(point.x + half);
  const j = Math.floor(point.z + half);
  if (i < 0 || j < 0 || i >= topology.map.size || j >= topology.map.size) return null;
  return topology.byIndex.get(j * topology.map.size + i) ?? null;
}

function farthest(cells: readonly WaterCell[], from: GroundVector): WaterCell | null {
  let result: WaterCell | null = null;
  let best = -1;
  for (const cell of cells) {
    const distance = (cell.x - from.x) ** 2 + (cell.z - from.z) ** 2;
    if (distance <= best) continue;
    best = distance;
    result = cell;
  }
  return result;
}

function edgeCells(topology: WaterTopology, component: number): WaterCell[] {
  return [...(topology.components[component] ?? [])].filter((cell) => {
    const i = cell.index % topology.map.size;
    const j = Math.floor(cell.index / topology.map.size);
    return i === 0 || j === 0 || i === topology.map.size - 1 || j === topology.map.size - 1;
  });
}

function route(topology: WaterTopology, start: WaterCell, goal: WaterCell): WaterCell[] {
  if (start.index === goal.index) return [goal];
  const parent = new Int32Array(topology.map.levels.length).fill(-2);
  const queue = [start.index];
  parent[start.index] = -1;
  const neighbours = [1, -1, topology.map.size, -topology.map.size] as const;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === undefined) continue;
    const currentI = current % topology.map.size;
    for (const offset of neighbours) {
      const next = current + offset;
      if (next < 0 || next >= parent.length || parent[next] !== -2) continue;
      if ((offset === 1 || offset === -1) && Math.abs((next % topology.map.size) - currentI) !== 1)
        continue;
      const cell = topology.byIndex.get(next);
      if (!cell || cell.component !== start.component) continue;
      parent[next] = current;
      if (next === goal.index) {
        const reversed: WaterCell[] = [];
        for (let at = next; at !== -1; at = parent[at] ?? -1) {
          const step = topology.byIndex.get(at);
          if (step) reversed.push(step);
        }
        return reversed.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function perimeterOrder(cell: WaterCell, size: number): number {
  const i = cell.index % size;
  const j = Math.floor(cell.index / size);
  if (j === 0) return i;
  if (i === size - 1) return size - 1 + j;
  if (j === size - 1) return 3 * (size - 1) - i;
  return 4 * (size - 1) - j;
}

/** A complete water rim is a real loop: keep the patrol on it and visit it clockwise. For a
 * partial edge component (a river reaching one or two sides), fall back to a routed crossing of
 * that component. Both branches use the same water-only cells as pursuit. */
function patrolRoute(topology: WaterTopology, component: number, start: WaterCell): WaterCell[] {
  const edges = edgeCells(topology, component).sort(
    (left, right) =>
      perimeterOrder(left, topology.map.size) - perimeterOrder(right, topology.map.size),
  );
  const adjacent = (left: WaterCell, right: WaterCell) =>
    Math.abs(left.x - right.x) + Math.abs(left.z - right.z) === 1;
  const completeLoop =
    edges.length >= 4 &&
    edges.every((cell, index) => adjacent(cell, edges[(index + 1) % edges.length] as WaterCell));
  if (completeLoop) {
    let anchorIndex = 0;
    for (let index = 1; index < edges.length; index += 1) {
      if (
        groundDistance(start, edges[index] as WaterCell) <
        groundDistance(start, edges[anchorIndex] as WaterCell)
      ) {
        anchorIndex = index;
      }
    }
    const anchor = edges[anchorIndex] as WaterCell;
    const approach = route(topology, start, anchor);
    const loop = [...edges.slice(anchorIndex + 1), ...edges.slice(0, anchorIndex + 1)];
    return [...approach, ...loop];
  }
  const pool = edges.length > 1 ? edges : (topology.components[component] ?? []);
  const destination = farthest(pool, start);
  return destination ? route(topology, start, destination) : [];
}

function spawn(
  runtime: SeaGuardianRuntime,
  component: number,
  start: WaterCell,
  now: number,
  targetId: string | null,
): SeaGuardianRuntimeEntity {
  const topology = runtime.topology;
  if (!topology) throw new Error("cannot spawn sea guardian without water");
  const guardian: SeaGuardianRuntimeEntity = {
    id: SEA_GUARDIAN_ID,
    x: start.x,
    y: topology.map.waterLevel,
    z: start.z,
    facing: { x: 1, z: 0 },
    state: targetId ? "chase" : "patrol",
    animationStartedAt: now,
    animationEndsAt: null,
    component,
    targetId,
    path: patrolRoute(topology, component, start),
    pathIndex: 1,
    nextPathAt: now,
  };
  runtime.guardian = guardian;
  return guardian;
}

function moveAlongPath(guardian: SeaGuardianRuntimeEntity, speed: number, dt: number): void {
  let remaining = Math.max(0, speed * dt);
  while (remaining > 0) {
    const waypoint = guardian.path[guardian.pathIndex];
    if (!waypoint) return;
    const dx = waypoint.x - guardian.x;
    const dz = waypoint.z - guardian.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-6) {
      guardian.pathIndex += 1;
      continue;
    }
    guardian.facing = { x: dx / distance, z: dz / distance };
    const travelled = Math.min(distance, remaining);
    guardian.x += guardian.facing.x * travelled;
    guardian.z += guardian.facing.z * travelled;
    remaining -= travelled;
    if (travelled === distance) guardian.pathIndex += 1;
  }
}

function activeSwimmers(
  runtime: SeaGuardianRuntime,
  players: Iterable<PlayerRuntime>,
): { player: PlayerRuntime; cell: WaterCell }[] {
  const topology = runtime.topology;
  if (!topology) return [];
  const result: { player: PlayerRuntime; cell: WaterCell }[] = [];
  for (const player of players) {
    if (
      !player.authorized ||
      player.transitioning ||
      player.disconnecting ||
      player.life !== "alive" ||
      !player.swimming
    )
      continue;
    const cell = cellAt(topology, player);
    if (!cell) continue;
    result.push({ player, cell });
  }
  return result;
}

export function advanceSeaGuardian(
  runtime: SeaGuardianRuntime,
  options: SeaGuardianAdvanceOptions,
): void {
  const topology = runtime.topology;
  if (!topology) return;
  const { now } = options;
  const swimmers = activeSwimmers(runtime, options.players);
  const guardian = runtime.guardian;
  if (!guardian) return;

  if (guardian.state === "attack" && (guardian.animationEndsAt ?? 0) > now) return;
  if (guardian.state === "attack") {
    guardian.state = "patrol";
    guardian.animationStartedAt = now;
    guardian.animationEndsAt = null;
  }

  const reachable = swimmers
    .filter(({ cell }) => cell.component === guardian?.component)
    .sort(
      (left, right) =>
        groundDistance(guardian as SeaGuardianRuntimeEntity, left.player) -
        groundDistance(guardian as SeaGuardianRuntimeEntity, right.player),
    );
  const target = reachable[0] ?? null;

  if (target) {
    guardian.state = "chase";
    guardian.targetId = target.player.id;
    if (now >= guardian.nextPathAt) {
      const start = cellAt(topology, guardian) ?? target.cell;
      guardian.path = route(topology, start, target.cell);
      guardian.pathIndex = guardian.path[0]?.index === start.index ? 1 : 0;
      guardian.nextPathAt = now + SEA_GUARDIAN_PATH_REFRESH_MS;
    }
    moveAlongPath(guardian, SEA_GUARDIAN_CHASE_SPEED, options.dt);
    if (groundDistance(guardian, target.player) <= SEA_GUARDIAN_DEVOUR_RANGE) {
      guardian.state = "attack";
      guardian.animationStartedAt = now;
      guardian.animationEndsAt = now + SEA_GUARDIAN_ATTACK_DURATION_MS;
      guardian.targetId = target.player.id;
      options.devour(target.player, guardian);
    }
    return;
  }

  guardian.state = "patrol";
  guardian.targetId = null;
  if (guardian.pathIndex >= guardian.path.length) {
    const start = cellAt(topology, guardian);
    guardian.path = start ? patrolRoute(topology, guardian.component, start) : [];
    guardian.pathIndex = 1;
  }
  moveAlongPath(guardian, SEA_GUARDIAN_PATROL_SPEED, options.dt);
}

export function seaGuardianSnapshots(runtime: SeaGuardianRuntime): SeaGuardianSnapshot[] {
  const guardian = runtime.guardian;
  return guardian
    ? [
        {
          id: guardian.id,
          x: Math.round(guardian.x * 6400) / 6400,
          y: guardian.y,
          z: Math.round(guardian.z * 6400) / 6400,
          facing: { ...guardian.facing },
          state: guardian.state,
          animationStartedAt: guardian.animationStartedAt,
          animationEndsAt: guardian.animationEndsAt,
        },
      ]
    : [];
}
