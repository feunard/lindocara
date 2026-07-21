import { starterEquipmentFor } from "@lindocara/engine/character.js";
import {
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_ATTACK_RANGE,
  pointDistance,
  SAFE_ZONE,
  safeZoneShelters,
  type TerrainGeometry,
} from "@lindocara/engine/game.js";
import { EMPTY_MARKERS, type MapData, terrainFromMap } from "@lindocara/engine/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { PLAYER_SIZE, TICK_DT } from "@lindocara/engine/simulation.js";
import { type ZoneDefinition, zoneDefinition } from "@lindocara/engine/zones.js";
import {
  advanceGuards,
  advanceMonsters,
  type MonsterSystemContext,
} from "@lindocara/server/world/monster-system.js";
import { createNavigationRuntime } from "@lindocara/server/world/navigation-system.js";
import { SpatialGrid } from "@lindocara/server/world/spatial-grid.js";
import {
  createGuards,
  createMonsters,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";
import { mapDataFromBlocks } from "./support/map-fixtures.js";
import { noColliders, tileMapFromRects } from "./support/tiles.js";

/**
 * A single small rect, thinner than one tile, that the rasteriser (any-overlap; conservative in
 * the direction production's 50%-coverage rule also leans) coarsens to a whole solid 64px tile —
 * exactly the shape of the hazard `forest-goblin-1` and `gate-troll`'s patrol rings had before
 * their spawns were nudged clear of it: a wall the tile grid draws fatter than the rectangle it
 * came from.
 */
const OBSTACLE = { x: 300, y: 300, width: 8, height: 8 };

const TERRAIN_TILES = tileMapFromRects(640, 640, [OBSTACLE]);
const WALL_TILES = tileMapFromRects(320, 192, [{ x: 64, y: 0, width: 64, height: 128 }]);

const terrain: TerrainGeometry = {
  width: 640,
  height: 640,
  obstacles: [OBSTACLE],
  spawnPoints: [{ x: 20, y: 20 }],
  safeZone: { x: 600, y: 600, width: 20, height: 20 },
  tiles: TERRAIN_TILES,
  colliders: noColliders(TERRAIN_TILES),
};

const zone: ZoneDefinition = {
  id: "verdant-reach",
  nameKey: "zone.verdant_reach.name",
  type: "open_world",
  defaultInstanceId: "main",
  maxPlayers: 48,
  terrain,
  quests: [],
  questSites: [],
  monsters: [],
  guards: [],
  portals: [],
  navigation: { ...DEFAULT_ZONE_NAVIGATION, nodeBudgetPerTick: 200 },
};

function targetPlayer(x: number, y: number): PlayerRuntime {
  return newPlayer(
    {
      id: "chase-target",
      nick: "Target",
      x,
      y,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "warrior",
      equipment: starterEquipmentFor("warrior"),
      inventory: { potions: 2, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    "connection-1",
    "verdant-reach:main",
  );
}

function chasingMonster(): MonsterRuntime {
  const monster = createMonsters([
    {
      id: "test-goblin",
      kind: "goblin",
      species: "spear_goblin",
      zone: "route",
      x: 250,
      y: 220,
      patrolRadius: 40,
    },
  ])[0];
  if (!monster) throw new Error("missing monster");
  return monster;
}

describe("monster navigation on the tile grid", () => {
  it("telegraphs a monster attack before the guard defeats it", () => {
    const combatTerrain: TerrainGeometry = {
      ...terrain,
      safeZone: { x: 0, y: 0, width: 640, height: 640 },
    };
    const combatZone: ZoneDefinition = { ...zone, terrain: combatTerrain };
    const monster = chasingMonster();
    monster.x = 100;
    monster.y = 100;
    const guards = createGuards([{ id: "guard", x: 110, y: 100, patrolRadius: 100 }]);
    const guard = guards[0];
    if (!guard) throw new Error("missing guard");
    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map(),
      monsters: [monster],
      guards,
      monsterGrid,
      zone: combatZone,
      tick: 0,
      navigation: createNavigationRuntime(combatTerrain, combatZone.navigation),
      startAttack,
    };

    advanceGuards(context, MONSTER_ATTACK_COOLDOWN_MS + 1);

    expect(startAttack).toHaveBeenCalledWith(monster, guard, MONSTER_ATTACK_COOLDOWN_MS + 1);
    expect(guard.hp).toBe(guard.maxHp);
    expect(monster.hp).toBe(0);
  });

  it("paths around a coarsened tile wall instead of grinding into it", () => {
    // The straight line from the monster to its target passes through column 4 / row 4 — the
    // single tile the 8x8 rect above coarsens to solid — even though that continuous segment
    // never touches the rect itself (it runs at x ≈ 266, the rect sits at x 300-308). A
    // rectangle-based line-of-sight check would call this clear; the tile grid must not.
    const monster = chasingMonster();
    const player = targetPlayer(250, 400);
    const socket = { id: "socket-1" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monster);

    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone,
      tick: 0,
      navigation: createNavigationRuntime(terrain, zone.navigation),
      startAttack: vi.fn(),
    };

    let reachedAtTick = -1;
    let maxXDeviation = 0;
    const startX = monster.x;
    const tickMs = TICK_DT * 1000;
    for (let tick = 0; tick < 200; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      maxXDeviation = Math.max(maxXDeviation, Math.abs(monster.x - startX));
      if (pointDistance(monster, player) <= MONSTER_ATTACK_RANGE) {
        reachedAtTick = tick;
        break;
      }
    }

    // A monster grinding into the fattened wall never leaves the tile's edge and never reaches
    // its target — this is the exact way `stuckTicks` used to paper over the disagreement between
    // line-of-sight and collision. With both reading the same grid, it must actually arrive.
    expect(reachedAtTick).toBeGreaterThan(-1);
    // It must have gone sideways to get around the tile, not merely slid along the wall's face.
    expect(maxXDeviation).toBeGreaterThan(20);
  });

  it("re-plans instead of freezing when a waypoint move is fully blocked", () => {
    // A single-column wall spanning rows 0-1, open only at row 2 — the monster must detour down
    // and back up to cross it. Column 0 (monster) and column 4 (player) sit on either side, all in
    // row 0, so the straight line between them runs directly through the solid column: the
    // direct-move branch never applies here, only the path-following one.
    const wallTerrain: TerrainGeometry = {
      width: 320,
      height: 192,
      obstacles: [{ x: 64, y: 0, width: 64, height: 128 }],
      spawnPoints: [{ x: 20, y: 20 }],
      safeZone: { x: 0, y: 0, width: 1, height: 1 },
      tiles: WALL_TILES,
      colliders: noColliders(WALL_TILES),
    };
    const wallZone: ZoneDefinition = {
      ...zone,
      terrain: wallTerrain,
      navigation: { ...DEFAULT_ZONE_NAVIGATION, nodeBudgetPerTick: 200 },
    };

    const monster = createMonsters([
      {
        id: "blocked-goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 32,
        y: 32,
        patrolRadius: 40,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    const player = targetPlayer(280, 32);
    const socket = { id: "socket-2" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    // Sabotage: hand the monster a "path" whose one waypoint jumps straight across the wall, as
    // if a stale plan had survived past the point collision actually refuses it. Monster x=32 is
    // one pixel shy of the tile boundary at x=64, so a body 32px wide moving even slightly east
    // immediately overlaps the solid column — the very first `moveMonsterDirect` call fails.
    monster.navigation.state = "chase";
    monster.navigation.targetId = player.id;
    monster.navigation.requestedDestination = { x: player.x, y: player.y };
    monster.navigation.destination = { x: player.x, y: player.y };
    monster.navigation.path = [{ x: player.x, y: player.y }];
    monster.navigation.pathIndex = 0;
    monster.navigation.requestPending = false;
    monster.navigation.lastPathRequestAt = 0;

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monster);
    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone: wallZone,
      tick: 0,
      navigation: createNavigationRuntime(wallTerrain, wallZone.navigation),
      startAttack: vi.fn(),
    };

    const startX = monster.x;
    advanceMonsters(context, 0);
    // The blocked waypoint move must not have moved the monster at all...
    expect(monster.x).toBe(startX);
    // ...but it must have invalidated the stale path rather than leaving it in place forever —
    // this is the recovery the direct-move branch already had (`directBlockedDestination`) and the
    // path-following branch did not, before this fix.
    expect(monster.navigation.path.length).toBe(0);
    expect(monster.navigation.abandonReason).toBe("waypoint_blocked");

    // Recovery must be real, not just internal bookkeeping: given ticks to re-plan around the
    // wall (through the row-2 gap), the monster must actually arrive. Before this fix, the stale
    // one-waypoint path was never replaced, and the monster sat at x=32 forever.
    let reachedAtTick = -1;
    const tickMs = TICK_DT * 1000;
    for (let tick = 1; tick < 300; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      if (pointDistance(monster, player) <= MONSTER_ATTACK_RANGE) {
        reachedAtTick = tick;
        break;
      }
    }
    expect(reachedAtTick).toBeGreaterThan(-1);
  });

  it("re-plans within a tick and does not reuse the stale cached path when a waypoint move is refused", () => {
    // Same wedge shape as the test above (a single-column wall spanning rows 0-1, open only at
    // row 2), but this time the stale path is also sitting in the navigation cache under the
    // exact key a re-plan for this start/goal would use — the situation a *legitimate* earlier
    // `requestMonsterPath` call would actually leave behind, not just a hand-injected path. If the
    // recovery does not evict that entry, the very re-plan it triggers hands back the identical
    // one-waypoint path that just failed.
    const wallTerrain: TerrainGeometry = {
      width: 320,
      height: 192,
      obstacles: [{ x: 64, y: 0, width: 64, height: 128 }],
      spawnPoints: [{ x: 20, y: 20 }],
      safeZone: { x: 0, y: 0, width: 1, height: 1 },
      tiles: WALL_TILES,
      colliders: noColliders(WALL_TILES),
    };
    const wallZone: ZoneDefinition = {
      ...zone,
      terrain: wallTerrain,
      navigation: { ...DEFAULT_ZONE_NAVIGATION, nodeBudgetPerTick: 200 },
    };

    const monster = createMonsters([
      {
        id: "blocked-goblin-2",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 32,
        y: 32,
        patrolRadius: 40,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    const player = targetPlayer(280, 32);
    const socket = { id: "socket-3" } as unknown as WebSocket;
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    monster.navigation.state = "chase";
    monster.navigation.targetId = player.id;
    monster.navigation.requestedDestination = { x: player.x, y: player.y };
    monster.navigation.destination = { x: player.x, y: player.y };
    const staleBlockedPath = [{ x: player.x, y: player.y }];
    monster.navigation.path = staleBlockedPath.map((point) => ({ ...point }));
    monster.navigation.pathIndex = 0;
    monster.navigation.requestPending = false;
    monster.navigation.lastPathRequestAt = 0;

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monster);
    const navigation = createNavigationRuntime(wallTerrain, wallZone.navigation);
    // Columns = ceil(320 / 64) = 5. Monster (32,32) centers in column 0 / row 0 -> node 0; the
    // player (280,32) centers in column 4 / row 0 -> node 4 -- the identical math
    // `requestMonsterPath` uses to build its cache key.
    navigation.cache.set("0:4", {
      points: staleBlockedPath.map((point) => ({ ...point })),
      usedAt: 0,
    });

    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone: wallZone,
      tick: 0,
      navigation,
      startAttack: vi.fn(),
    };

    advanceMonsters(context, 0);
    expect(monster.navigation.path.length).toBe(0);
    expect(monster.navigation.abandonReason).toBe("waypoint_blocked");

    let replannedAtTick = -1;
    let firstPathAfterBlock: { x: number; y: number }[] | null = null;
    const tickMs = TICK_DT * 1000;
    for (let tick = 1; tick <= 5; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      if (replannedAtTick === -1 && monster.navigation.path.length > 0) {
        replannedAtTick = tick;
        firstPathAfterBlock = monster.navigation.path.map((point) => ({ ...point }));
      }
    }

    // Recovery must happen almost immediately -- not 13 ticks (650ms) later, which is what
    // `minimumRepathMs` would otherwise impose since neither the monster nor the destination has
    // moved.
    expect(replannedAtTick).toBeGreaterThan(0);
    expect(replannedAtTick).toBeLessThanOrEqual(2);
    // And the recovered path must not be the identical blocked one served straight back out of
    // the cache -- it must be a genuine, different (multi-waypoint) route around the wall.
    expect(firstPathAfterBlock).not.toEqual(staleBlockedPath);
    expect(firstPathAfterBlock?.length ?? 0).toBeGreaterThan(1);

    let reachedAtTick = -1;
    for (let tick = 6; tick < 300; tick++) {
      context.tick = tick;
      advanceMonsters(context, tick * tickMs);
      if (pointDistance(monster, player) <= MONSTER_ATTACK_RANGE) {
        reachedAtTick = tick;
        break;
      }
    }
    expect(reachedAtTick).toBeGreaterThan(-1);
  });
});

/**
 * The unit layer used to hand-roll every `TerrainGeometry`, so it could not see what
 * `terrainFromMap` actually produced. These build their terrain the way a room does — through the
 * real map baker — so the two can no longer drift apart.
 */
describe("authored-map geometry", () => {
  const authoredMap: MapData = mapDataFromBlocks({
    blocks: Array.from({ length: 15 }, () => ".".repeat(20)),
    elements: [],
    spawn: { col: 2, row: 2 },
    markers: EMPTY_MARKERS,
  });

  function authoredZone(): ZoneDefinition {
    const authoredTerrain = terrainFromMap(authoredMap);
    return { ...zone, id: "map-id", terrain: authoredTerrain };
  }

  it("leaves no rect an authored map's entities can hide in", () => {
    const terrainOfMap = terrainFromMap(authoredMap);
    // Every cell centre, plus the four corners a clamped entity can actually reach. If any of
    // these reads as "safe", monsters go back to being decorative on that map.
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 20; col++) {
        const point = { x: col * 64 + 32, y: row * 64 + 32 };
        expect(safeZoneShelters(point, terrainOfMap)).toBe(false);
      }
    }
    const maxX = terrainOfMap.width - PLAYER_SIZE;
    const maxY = terrainOfMap.height - PLAYER_SIZE;
    for (const corner of [
      { x: 0, y: 0 },
      { x: maxX, y: 0 },
      { x: 0, y: maxY },
      { x: maxX, y: maxY },
    ]) {
      expect(safeZoneShelters(corner, terrainOfMap)).toBe(false);
    }
  });

  it("lets a monster acquire threat and attack a player standing on a bare authored map", () => {
    const combatZone = authoredZone();
    const player = targetPlayer(300, 300);
    const socket = { id: "socket-authored" } as unknown as WebSocket;
    const monster = createMonsters([
      {
        id: "authored-goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 300 + MONSTER_ATTACK_RANGE - 4,
        y: 300,
        patrolRadius: 40,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone: combatZone,
      tick: 0,
      navigation: createNavigationRuntime(combatZone.terrain, combatZone.navigation),
      startAttack,
    };

    advanceMonsters(context, MONSTER_ATTACK_COOLDOWN_MS + 100);

    expect(monster.threat.has(player.id)).toBe(true);
    expect(startAttack).toHaveBeenCalledTimes(1);
    expect(startAttack.mock.calls[0]?.[0]).toBe(monster);
    expect(startAttack.mock.calls[0]?.[1]).toBe(player);
  });

  it("still lets the catalogue's safe city disarm a monster standing right on top of a player", () => {
    // The other half of the same rule: fixing authored maps must not disarm Heartroot, where the
    // guards — not invulnerability — are the reason a monster inside the walls is a problem.
    const cityZone = zoneDefinition("verdant-reach");
    const shelter = { x: SAFE_ZONE.x + 100, y: SAFE_ZONE.y + 100 };
    expect(safeZoneShelters(shelter, cityZone.terrain)).toBe(true);

    const player = targetPlayer(shelter.x, shelter.y);
    const socket = { id: "socket-city" } as unknown as WebSocket;
    const monster = createMonsters([
      {
        id: "city-goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: shelter.x + 8,
        y: shelter.y,
        patrolRadius: 40,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    // Even threat that somehow already exists must be pruned while the player is sheltered.
    monster.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monster);
    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monster],
      guards: [],
      monsterGrid,
      zone: cityZone,
      tick: 0,
      navigation: createNavigationRuntime(cityZone.terrain, cityZone.navigation),
      startAttack,
    };

    advanceMonsters(context, MONSTER_ATTACK_COOLDOWN_MS + 100);

    expect(monster.threat.has(player.id)).toBe(false);
    expect(startAttack).not.toHaveBeenCalled();
  });
});

describe("monster action attacker identity", () => {
  it("starts each attacking monster's own action, not a same-species neighbour's", () => {
    // Mirrors the real hazard next to the safe zone: road-goblin-scout and city-edge-prowler are
    // both spear_goblin, close enough together that a client guessing the attacker from
    // distance-to-victim alone cannot reliably tell them apart. Placed symmetrically around the
    // player here for the same reason — equidistant is the worst case for that guess. The server
    // must not make the client guess: it must name which monster it resolved as the attacker.
    const player = targetPlayer(300, 500);
    const socket = { id: "socket-hurt" } as unknown as WebSocket;

    const monsters = createMonsters([
      {
        id: "goblin-a",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 270,
        y: 500,
        patrolRadius: 40,
      },
      {
        id: "goblin-b",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 330,
        y: 500,
        patrolRadius: 40,
      },
    ]);
    const [monsterA, monsterB] = monsters;
    if (!monsterA || !monsterB) throw new Error("missing monsters");
    monsterA.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });
    monsterB.threat.set(player.id, { playerId: player.id, amount: 999, updatedAt: 0 });

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(monsterA);
    monsterGrid.insert(monsterB);

    const startAttack = vi.fn();
    const context: MonsterSystemContext = {
      players: new Map([[socket, player]]),
      monsters: [monsterA, monsterB],
      guards: [],
      monsterGrid,
      zone,
      tick: 0,
      navigation: createNavigationRuntime(terrain, zone.navigation),
      startAttack,
    };

    advanceMonsters(context, MONSTER_ATTACK_COOLDOWN_MS + 100);

    expect(startAttack).toHaveBeenCalledTimes(2);
    const attackerIds = startAttack.mock.calls.map((call) => call[0]?.id);
    expect(attackerIds.sort()).toEqual(["goblin-a", "goblin-b"]);
  });
});
