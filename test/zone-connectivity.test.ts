import { describe, expect, it } from "vitest";
import { CEMETERIES } from "../src/shared/game.js";
import { PLAYER_SIZE, type Vec2 } from "../src/shared/simulation.js";
import { isPathWalkable, isWalkableBox, type TileMap } from "../src/shared/tilemap.js";
import { ZONES, type ZoneDefinition, zoneDefinition } from "../src/shared/zones.js";

const STEP = PLAYER_SIZE;

interface ConnectivityTarget extends Vec2 {
  label: string;
}

function cellKey(col: number, row: number): number {
  return row * 10_000 + col;
}

function nearbyCells(point: Vec2): Array<{ col: number; row: number }> {
  const centerCol = Math.round(point.x / STEP);
  const centerRow = Math.round(point.y / STEP);
  const cells: Array<{ col: number; row: number }> = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
    for (let colOffset = -1; colOffset <= 1; colOffset++) {
      cells.push({ col: centerCol + colOffset, row: centerRow + rowOffset });
    }
  }
  return cells;
}

function reachableGrid(
  tiles: TileMap,
  width: number,
  height: number,
  origin: Vec2,
): ReadonlySet<number> {
  if (!isWalkableBox(tiles, origin, PLAYER_SIZE)) return new Set();
  const maxCol = Math.floor((width - PLAYER_SIZE) / STEP);
  const maxRow = Math.floor((height - PLAYER_SIZE) / STEP);
  const visited = new Set<number>();
  const queue: Array<{ col: number; row: number }> = [];

  for (const cell of nearbyCells(origin)) {
    if (cell.col < 0 || cell.row < 0 || cell.col > maxCol || cell.row > maxRow) continue;
    const position = { x: cell.col * STEP, y: cell.row * STEP };
    if (!isPathWalkable(tiles, origin, position, PLAYER_SIZE)) continue;
    visited.add(cellKey(cell.col, cell.row));
    queue.push(cell);
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (!current) continue;
    for (const [colOffset, rowOffset] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { col: current.col + colOffset, row: current.row + rowOffset };
      if (next.col < 0 || next.row < 0 || next.col > maxCol || next.row > maxRow) continue;
      const key = cellKey(next.col, next.row);
      if (visited.has(key)) continue;
      const currentPosition = { x: current.col * STEP, y: current.row * STEP };
      const position = { x: next.col * STEP, y: next.row * STEP };
      if (!isPathWalkable(tiles, currentPosition, position, PLAYER_SIZE)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return visited;
}

function targetIsReachable(tiles: TileMap, visited: ReadonlySet<number>, target: Vec2): boolean {
  if (!isWalkableBox(tiles, target, PLAYER_SIZE)) return false;
  return nearbyCells(target).some((cell) => {
    if (!visited.has(cellKey(cell.col, cell.row))) return false;
    return isPathWalkable(tiles, { x: cell.col * STEP, y: cell.row * STEP }, target, PLAYER_SIZE);
  });
}

function targetsFor(zone: ZoneDefinition): ConnectivityTarget[] {
  const arrivals = Object.values(ZONES).flatMap((source) =>
    source.portals.flatMap((portal): ConnectivityTarget[] =>
      portal.destination.zoneId === zone.id
        ? [
            {
              ...portal.destination.spawn,
              label: `portal arrival from ${source.id}/${portal.id}`,
            },
          ]
        : [],
    ),
  );
  return [
    ...zone.terrain.spawnPoints.map((spawn, index) => ({ ...spawn, label: `spawn ${index}` })),
    ...zone.quests.map((quest) => ({ ...quest.giver, label: `quest NPC ${quest.giver.id}` })),
    ...zone.questSites.map((site) => ({ ...site, label: `quest site ${site.id}` })),
    ...zone.monsters.map((monster) => ({ ...monster, label: `monster spawn ${monster.id}` })),
    ...zone.guards.map((guard) => ({ ...guard, label: `guard ${guard.id}` })),
    ...(zone.id === "verdant-reach"
      ? CEMETERIES.map((cemetery) => ({ ...cemetery, label: `cemetery ${cemetery.id}` }))
      : []),
    ...zone.portals.map((portal) => ({ ...portal, label: `portal ${portal.id}` })),
    ...arrivals,
  ];
}

function expectConnected(zone: ZoneDefinition): void {
  const targets = targetsFor(zone);
  expect(zone.terrain.spawnPoints.length, `${zone.id} needs a connectivity origin`).toBeGreaterThan(
    0,
  );
  expect(targets.length, `${zone.id} connectivity targets must not be empty`).toBeGreaterThan(0);

  let best: { spawnIndex: number; isolated: ConnectivityTarget[] } | undefined;
  for (const [spawnIndex, spawn] of zone.terrain.spawnPoints.entries()) {
    const visited = reachableGrid(
      zone.terrain.tiles,
      zone.terrain.width,
      zone.terrain.height,
      spawn,
    );
    expect(
      visited.size,
      `${zone.id} spawn ${spawnIndex} has no walkable flood-fill seed`,
    ).toBeGreaterThan(0);
    const isolated = targets.filter(
      (target) => !targetIsReachable(zone.terrain.tiles, visited, target),
    );
    if (isolated.length === 0) return;
    if (!best || isolated.length < best.isolated.length) best = { spawnIndex, isolated };
  }

  const details = best?.isolated
    .map((target) => `${target.label} at (${target.x}, ${target.y})`)
    .join(", ");
  throw new Error(
    `${zone.id}: no spawn reaches every required point with a ${PLAYER_SIZE}px body; ` +
      `spawn ${best?.spawnIndex ?? "?"} is closest but cannot reach: ${details ?? "unknown"}`,
  );
}

describe("generated zone connectivity", () => {
  it("connects every Verdant Reach gameplay point to at least one spawn", () => {
    expectConnected(zoneDefinition("verdant-reach"));
  });

  it("keeps mmo-test-zone spawns, portal and arrival connected", () => {
    const zone = zoneDefinition("mmo-test-zone");
    expect(targetsFor(zone).length).toBeGreaterThan(zone.terrain.spawnPoints.length);
    expectConnected(zone);
  });

  // The Sunken Isles are lobes welded together by overlapping rects. Widen a channel by a cell too
  // many and a lobe floats free: the zone still loads, still looks right, and its castle is simply
  // somewhere no player can ever stand. There are no bridges to rescue it with.
  it("keeps every Sunken Isles lobe welded to the spawn", () => {
    expectConnected(zoneDefinition("sunken-isles"));
  });
});
