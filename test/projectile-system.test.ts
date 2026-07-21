import { starterEquipmentFor } from "@lindocara/engine/character.js";
import {
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
} from "@lindocara/engine/combat-actions.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import type { ProjectileKind } from "@lindocara/engine/protocol.js";
import { describe, expect, it, vi } from "vitest";
import {
  advanceProjectiles,
  type ProjectileSystemContext,
  removeProjectilesByOwner,
  spawnProjectile,
} from "../src/server/world/projectile-system.js";
import { SpatialGrid } from "../src/server/world/spatial-grid.js";
import {
  createMonsters,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "../src/server/world/world-runtime.js";
import { noColliders, tileMapFromRects } from "./support/tiles.js";

function terrain(obstacles: TerrainGeometry["obstacles"] = []): TerrainGeometry {
  const tiles = tileMapFromRects(500, 300, obstacles);
  return {
    width: 500,
    height: 300,
    spawnPoints: [{ x: 0, y: 0 }],
    obstacles,
    safeZone: null,
    tiles,
    colliders: noColliders(tiles),
  };
}

function player(id: string, x: number, hp = 100, partyId = "party-a"): PlayerRuntime {
  const result = newPlayer(
    {
      id,
      nick: id,
      x,
      y: 0,
      level: 1,
      xp: 0,
      hp,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "ranger",
      equipment: starterEquipmentFor("ranger"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "map-a",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `connection-${id}`,
    `${partyId}:map-a`,
  );
  result.identityKind = "hero";
  result.partyId = partyId;
  return result;
}

function monster(id: string, x: number): MonsterRuntime {
  const result = createMonsters([
    {
      id,
      kind: "goblin",
      species: "spear_goblin",
      zone: "route",
      x,
      y: 0,
      patrolRadius: 20,
    },
  ])[0];
  if (!result) throw new Error("monster fixture missing");
  return result;
}

function definition(kind: ProjectileKind, pierce = 0) {
  return { kind, speed: 2_000, radius: 5, pierce };
}

function context(options: {
  owner: PlayerRuntime;
  projectiles: ProjectileRuntime[];
  monsters?: MonsterRuntime[];
  allies?: PlayerRuntime[];
  world?: TerrainGeometry;
}) {
  const monsters = options.monsters ?? [];
  const players = [options.owner, ...(options.allies ?? [])];
  const sockets = players.map(
    (entry) => [{ id: `socket-${entry.id}` } as unknown as WebSocket, entry] as const,
  );
  const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
  const playerGrid = new SpatialGrid<PlayerRuntime>(64);
  for (const entry of monsters) monsterGrid.insert(entry);
  for (const entry of players) playerGrid.insert(entry);
  const damageMonster = vi.fn();
  const healPlayer = vi.fn();
  const blocked = vi.fn();
  const value: ProjectileSystemContext = {
    projectiles: options.projectiles,
    terrain: options.world ?? terrain(),
    monsters,
    players: new Map(sockets),
    monsterGrid,
    playerGrid,
    canHeal: (owner, target) => owner.partyId !== null && owner.partyId === target.partyId,
    damageMonster,
    healPlayer,
    blocked,
  };
  return { value, damageMonster, healPlayer, blocked };
}

function launch(
  projectiles: ProjectileRuntime[],
  owner: PlayerRuntime,
  kind: ProjectileKind,
  options: { pierce?: number; range?: number; targetFilter?: "monsters" | "wounded_allies" } = {},
): ProjectileRuntime {
  const projectile = spawnProjectile(projectiles, {
    actionId: "11111111-1111-4111-8111-111111111111",
    owner,
    roomKey: owner.roomKey,
    origin: { x: 20, y: 16 },
    direction: { x: 1, y: 0 },
    definition: definition(kind, options.pierce),
    range: options.range ?? 300,
    power: 29,
    targetFilter: options.targetFilter ?? "monsters",
    sourceSkillId: kind,
    basic: kind === "arrow",
    now: 1_000,
  });
  if (!projectile) throw new Error("projectile fixture rejected");
  return projectile;
}

describe("authoritative projectile system", () => {
  it("lets a straight projectile miss and expire at its maximum range", () => {
    const owner = player("owner", 0);
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "arrow", { range: 80 });
    const harness = context({ owner, projectiles });
    advanceProjectiles(harness.value, 1_050);
    expect(harness.damageMonster).not.toHaveBeenCalled();
    expect(projectiles).toHaveLength(0);
  });

  it("stops at terrain before an entity and reports the authoritative block", () => {
    const owner = player("owner", 0);
    const target = monster("behind-wall", 130);
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "arrow");
    const wall = [{ x: 80, y: 0, width: 64, height: 64 }];
    const harness = context({ owner, projectiles, monsters: [target], world: terrain(wall) });
    advanceProjectiles(harness.value, 1_050);
    expect(harness.blocked).toHaveBeenCalledTimes(1);
    expect(harness.damageMonster).not.toHaveBeenCalled();
    expect(projectiles).toHaveLength(0);
  });

  it("pierces several monsters without hitting either one twice", () => {
    const owner = player("owner", 0);
    const first = monster("first", 50);
    const second = monster("second", 100);
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "piercing_arrow", { pierce: 7 });
    const harness = context({ owner, projectiles, monsters: [first, second] });
    advanceProjectiles(harness.value, 1_050);
    advanceProjectiles(harness.value, 1_100);
    expect(harness.damageMonster.mock.calls.map((call) => call[1].id)).toEqual(["first", "second"]);
  });

  it("heals the first wounded party ally while ignoring full-health and foreign heroes", () => {
    const owner = player("owner", 0);
    const full = player("full", 35, 100);
    const foreign = player("foreign", 60, 40, "party-b");
    const wounded = player("wounded", 90, 40);
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "healing_light", {
      targetFilter: "wounded_allies",
      range: 160,
    });
    const harness = context({ owner, projectiles, allies: [full, foreign, wounded] });
    advanceProjectiles(harness.value, 1_050);
    expect(harness.healPlayer).toHaveBeenCalledTimes(1);
    expect(harness.healPlayer.mock.calls[0]?.[2].id).toBe("wounded");
    expect(projectiles).toHaveLength(0);
  });

  it("bounds projectile creation per player", () => {
    const owner = player("owner", 0);
    const projectiles: ProjectileRuntime[] = [];
    for (let index = 0; index < MAX_PROJECTILES_PER_PLAYER; index++) {
      launch(projectiles, owner, "arrow");
    }
    expect(
      spawnProjectile(projectiles, {
        actionId: "22222222-2222-4222-8222-222222222222",
        owner,
        roomKey: owner.roomKey,
        origin: { x: 20, y: 16 },
        direction: { x: 1, y: 0 },
        definition: definition("arrow"),
        range: 100,
        power: 10,
        targetFilter: "monsters",
        sourceSkillId: "quick_shot",
        basic: true,
        now: 1_000,
      }),
    ).toBeNull();
  });

  it("bounds a room and removes only the transitioning owner's projectiles", () => {
    const projectiles: ProjectileRuntime[] = [];
    const owners = [0, 1, 2, 3].map((index) => player(`owner-${index}`, 0));
    for (const owner of owners) {
      for (let index = 0; index < MAX_PROJECTILES_PER_PLAYER; index++) {
        launch(projectiles, owner, "arrow");
      }
    }
    expect(projectiles).toHaveLength(MAX_PROJECTILES_PER_ROOM);
    expect(
      spawnProjectile(projectiles, {
        actionId: "22222222-2222-4222-8222-222222222222",
        owner: player("overflow", 0),
        roomKey: "party-a:map-a",
        origin: { x: 20, y: 16 },
        direction: { x: 1, y: 0 },
        definition: definition("arrow"),
        range: 100,
        power: 10,
        targetFilter: "monsters",
        sourceSkillId: "quick_shot",
        basic: true,
        now: 1_000,
      }),
    ).toBeNull();

    const removedOwner = owners[0];
    if (!removedOwner) throw new Error("owner fixture missing");
    removeProjectilesByOwner(projectiles, removedOwner.id);
    expect(projectiles).toHaveLength(MAX_PROJECTILES_PER_ROOM - MAX_PROJECTILES_PER_PLAYER);
    expect(projectiles.some((projectile) => projectile.ownerId === removedOwner.id)).toBe(false);
  });
});
