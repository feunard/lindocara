import { describe, expect, it, vi } from "vitest";
import { advanceMonsters, type MonsterSystemContext } from "../src/server/world/monster-system.js";
import { createNavigationRuntime } from "../src/server/world/navigation-system.js";
import { SpatialGrid } from "../src/server/world/spatial-grid.js";
import {
  createMonsters,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
} from "../src/server/world/world-runtime.js";
import { starterEquipmentFor } from "../src/shared/character.js";
import { MONSTER_ATTACK_RANGE, pointDistance, type TerrainGeometry } from "../src/shared/game.js";
import { DEFAULT_ZONE_NAVIGATION } from "../src/shared/navigation.js";
import { TICK_DT } from "../src/shared/simulation.js";
import type { ZoneDefinition } from "../src/shared/zones.js";
import { tileMapFromRects } from "./support/tiles.js";

/**
 * A single small rect, thinner than one tile, that the rasteriser (any-overlap; conservative in
 * the direction production's 50%-coverage rule also leans) coarsens to a whole solid 64px tile —
 * exactly the shape of the hazard on `forest-goblin-1` and `gate-troll`'s patrol rings: a wall
 * the tile grid draws fatter than the rectangle it came from.
 */
const OBSTACLE = { x: 300, y: 300, width: 8, height: 8 };

const terrain: TerrainGeometry = {
  width: 640,
  height: 640,
  obstacles: [OBSTACLE],
  spawnPoints: [{ x: 20, y: 20 }],
  safeZone: { x: 600, y: 600, width: 20, height: 20 },
  tiles: tileMapFromRects(640, 640, [OBSTACLE]),
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
      species: "goblin_scout",
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
      damagePlayer: vi.fn(),
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
      tiles: tileMapFromRects(320, 192, [{ x: 64, y: 0, width: 64, height: 128 }]),
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
        species: "goblin_scout",
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
      damagePlayer: vi.fn(),
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
});
