import { starterEquipmentFor } from "@lindocara/engine/character.js";
import {
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
} from "@lindocara/engine/combat-actions.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import type { ProjectileKind } from "@lindocara/engine/protocol.js";
import {
  advanceProjectiles,
  type ProjectileSystemContext,
  removeProjectilesByOwner,
  spawnProjectile,
} from "@lindocara/server/world/projectile-system.js";
import { SpatialGrid } from "@lindocara/server/world/spatial-grid.js";
import {
  createGuards,
  createMonsters,
  type GuardRuntime,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { noColliders, tileMapFromRects } from "@lindocara/testing/tiles.js";
import { describe, expect, it, vi } from "vitest";

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

function guard(id: string, x: number): GuardRuntime {
  const result = createGuards([{ id, x, y: 0, patrolRadius: 64 }])[0];
  if (!result) throw new Error("guard fixture missing");
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
  guards?: GuardRuntime[];
  world?: TerrainGeometry;
  hostile?: boolean;
}) {
  const monsters = options.monsters ?? [];
  const players = options.hostile
    ? (options.allies ?? [])
    : [options.owner, ...(options.allies ?? [])];
  const sockets = players.map(
    (entry) => [{ id: `socket-${entry.id}` } as unknown as WebSocket, entry] as const,
  );
  const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
  const playerGrid = new SpatialGrid<PlayerRuntime>(64);
  for (const entry of monsters) monsterGrid.insert(entry);
  for (const entry of players) playerGrid.insert(entry);
  const damageMonster = vi.fn();
  const healPlayer = vi.fn();
  const damagePlayer = vi.fn();
  const damageGuard = vi.fn();
  const blocked = vi.fn();
  const value: ProjectileSystemContext = {
    projectiles: options.projectiles,
    terrain: options.world ?? terrain(),
    monsters,
    players: new Map(sockets),
    guards: options.guards ?? [],
    monsterGrid,
    playerGrid,
    canHeal: (owner, target) => owner.partyId !== null && owner.partyId === target.partyId,
    damageMonster,
    healPlayer,
    damagePlayer,
    damageGuard,
    blocked,
  };
  return { value, damageMonster, healPlayer, damagePlayer, damageGuard, blocked };
}

function launch(
  projectiles: ProjectileRuntime[],
  owner: PlayerRuntime,
  kind: ProjectileKind,
  options: {
    pierce?: number;
    range?: number;
    targetFilter?: "monsters" | "wounded_allies" | "players_and_guards";
  } = {},
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

  it("hits the visible upper body of a tall monster above its navigation square", () => {
    const owner = player("owner", 0);
    const target = monster("tall-target", 100);
    target.species = "mire_troll";
    target.kind = "troll";
    target.y = 180;
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "77777777-7777-4777-8777-777777777777",
      owner,
      roomKey: owner.roomKey,
      origin: { x: 20, y: 100 },
      direction: { x: 1, y: 0 },
      definition: definition("arrow"),
      range: 300,
      power: 10,
      targetFilter: "monsters",
      sourceSkillId: "quick_shot",
      basic: true,
      now: 1_000,
    });
    expect(projectile).not.toBeNull();

    const harness = context({ owner, projectiles, monsters: [target] });
    advanceProjectiles(harness.value, 1_050);

    expect(harness.damageMonster).toHaveBeenCalledOnce();
    expect(harness.damageMonster.mock.calls[0]?.[1].id).toBe(target.id);
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

  it("reports one terminal terrain point for a homemade bomb without piercing the obstacle", () => {
    const owner = player("bomb-owner", 0);
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "homemade_bomb", { range: 240 });
    const world = terrain([{ x: 60, y: 0, width: 24, height: 96 }]);
    const target = monster("behind-bomb-wall", 100);
    const harness = context({ owner, projectiles, monsters: [target], world });
    const removed = vi.fn();
    harness.value.removed = removed;

    advanceProjectiles(harness.value, 1_050);

    expect(harness.damageMonster).not.toHaveBeenCalled();
    expect(harness.blocked).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledOnce();
    expect(removed.mock.calls[0]?.[2]).toBe("terrain");
    expect(projectiles).toEqual([]);
  });

  it("lets an enemy projectile hit a living hero and never pass through terrain", () => {
    const caster = monster("archer", 0);
    const target = player("target", 90);
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "77777777-7777-4777-8777-777777777777",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("arrow"),
      range: 300,
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    expect(projectile).not.toBeNull();
    const open = context({ owner: target, projectiles, allies: [target], hostile: true });
    advanceProjectiles(open.value, 1_050);
    expect(open.damagePlayer).toHaveBeenCalledTimes(1);

    const blockedProjectiles: ProjectileRuntime[] = [];
    spawnProjectile(blockedProjectiles, {
      actionId: "88888888-8888-4888-8888-888888888888",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("hex_orb"),
      range: 300,
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    const wall = [{ x: 55, y: 0, width: 20, height: 64 }];
    const blocked = context({
      owner: target,
      projectiles: blockedProjectiles,
      allies: [target],
      hostile: true,
      world: terrain(wall),
    });
    advanceProjectiles(blocked.value, 1_050);
    expect(blocked.damagePlayer).not.toHaveBeenCalled();
    expect(blocked.blocked).toHaveBeenCalledTimes(1);
  });

  it("hits a vanished Rogue's decoy without exposing or damaging the hidden hero", () => {
    const caster = monster("decoy-archer", 0);
    const rogue = player("hidden-rogue", 90);
    rogue.class = "rogue";
    rogue.rogueStealthUntil = 9_000;
    rogue.rogueSilhouette = { x: 90, y: 0, hp: 45, expiresAt: 6_000 };
    const projectiles: ProjectileRuntime[] = [];
    spawnProjectile(projectiles, {
      actionId: "66666666-6666-4666-8666-666666666666",
      owner: caster,
      roomKey: rogue.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("arrow"),
      range: 300,
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    const harness = context({ owner: rogue, projectiles, allies: [rogue], hostile: true });
    const damageRogueSilhouette = vi.fn();
    harness.value.damageRogueSilhouette = damageRogueSilhouette;

    advanceProjectiles(harness.value, 1_050);

    expect(harness.damagePlayer).not.toHaveBeenCalled();
    expect(damageRogueSilhouette).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: caster.id }),
      rogue,
      1_050,
    );
    expect(projectiles).toEqual([]);
  });

  it("blocks an enemy projectile before a guard behind terrain", () => {
    const caster = monster("blocked-caster", 0);
    const target = player("observer", 300);
    const protectedGuard = guard("behind-wall", 90);
    const projectiles: ProjectileRuntime[] = [];
    spawnProjectile(projectiles, {
      actionId: "99999999-9999-4999-8999-999999999999",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("arrow"),
      range: 300,
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    const wall = [{ x: 55, y: 0, width: 20, height: 64 }];
    const harness = context({
      owner: target,
      projectiles,
      guards: [protectedGuard],
      hostile: true,
      world: terrain(wall),
    });

    advanceProjectiles(harness.value, 1_050);

    expect(harness.damageGuard).not.toHaveBeenCalled();
    expect(harness.blocked).toHaveBeenCalledTimes(1);
  });

  it("pierces guards in order without damaging either one twice", () => {
    const caster = monster("piercing-caster", 0);
    const target = player("observer", 300);
    const first = guard("first-guard", 50);
    const second = guard("second-guard", 100);
    const projectiles: ProjectileRuntime[] = [];
    spawnProjectile(projectiles, {
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("enemy_harpoon", 1),
      range: 300,
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    const harness = context({
      owner: target,
      projectiles,
      guards: [first, second],
      hostile: true,
    });

    advanceProjectiles(harness.value, 1_050);
    advanceProjectiles(harness.value, 1_100);

    expect(harness.damageGuard.mock.calls.map((call) => call[1].id)).toEqual([
      "first-guard",
      "second-guard",
    ]);
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

  it("turns a piercing arrow back at maximum range without repeating outward hits", () => {
    const owner = player("owner", 0);
    const first = monster("first", 50);
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "44444444-4444-4444-8444-444444444444",
      owner,
      roomKey: owner.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("piercing_arrow", 7),
      range: 80,
      returnRange: 80,
      power: 29,
      targetFilter: "monsters",
      sourceSkillId: "piercing_arrow",
      basic: false,
      now: 1_000,
    });
    if (!projectile) throw new Error("returning projectile rejected");
    const harness = context({ owner, projectiles, monsters: [first] });
    advanceProjectiles(harness.value, 1_050);
    expect(projectile.returningToOwner).toBe(true);
    expect(projectile.direction.x).toBeLessThan(0);
    advanceProjectiles(harness.value, 1_100);
    expect(harness.damageMonster.mock.calls.map((call) => call[1].id)).toEqual(["first"]);
    expect(projectiles).toHaveLength(0);
  });

  it("returns from terrain instead of reporting the first obstacle as a failed shot", () => {
    const owner = player("owner", 0);
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "55555555-5555-4555-8555-555555555555",
      owner,
      roomKey: owner.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("piercing_arrow", 7),
      range: 200,
      returnRange: 200,
      power: 29,
      targetFilter: "monsters",
      sourceSkillId: "piercing_arrow",
      basic: false,
      now: 1_000,
    });
    if (!projectile) throw new Error("returning projectile rejected");
    const wall = [{ x: 80, y: 0, width: 64, height: 64 }];
    const harness = context({ owner, projectiles, world: terrain(wall) });
    advanceProjectiles(harness.value, 1_050);
    expect(projectile.returningToOwner).toBe(true);
    expect(harness.blocked).not.toHaveBeenCalled();
  });

  it("curves Heartseeker gradually while leaving the first interceptor authoritative", () => {
    const owner = player("owner", 0);
    const interceptor = monster("interceptor", 70);
    const target = monster("target", 150);
    target.y = 100;
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "66666666-6666-4666-8666-666666666666",
      owner,
      roomKey: owner.roomKey,
      origin: { x: 20, y: 16 },
      direction: { x: 1, y: 0 },
      definition: definition("heartseeker"),
      range: 300,
      power: 29,
      targetFilter: "monsters",
      sourceSkillId: "heartseeker",
      basic: false,
      now: 1_000,
      homingTargetId: target.id,
      homingTurnRateRadians: Math.PI / 24,
    });
    if (!projectile) throw new Error("guided projectile rejected");
    const harness = context({ owner, projectiles, monsters: [interceptor, target] });
    advanceProjectiles(harness.value, 1_050);
    expect(projectile.direction.y).toBeGreaterThan(0);
    expect(projectile.direction.y).toBeLessThan(0.2);
    expect(harness.damageMonster.mock.calls[0]?.[1].id).toBe("interceptor");
  });

  it("lets focused-volley arrows share a bounded per-target impact count", () => {
    const owner = player("owner", 0);
    const target = monster("large-target", 50);
    const projectiles: ProjectileRuntime[] = [];
    const activationHitCounts = new Map<string, number>();
    for (let index = 0; index < 2; index++) {
      const spawned = spawnProjectile(projectiles, {
        actionId: "33333333-3333-4333-8333-333333333333",
        owner,
        roomKey: owner.roomKey,
        origin: { x: 20, y: 16 },
        direction: { x: 1, y: 0 },
        definition: definition("volley_arrow"),
        range: 300,
        power: 17,
        targetFilter: "monsters",
        sourceSkillId: "volley",
        basic: false,
        now: 1_000,
        activationHitCounts,
      });
      expect(spawned).not.toBeNull();
    }
    const harness = context({ owner, projectiles, monsters: [target] });
    advanceProjectiles(harness.value, 1_050);

    expect(harness.damageMonster).toHaveBeenCalledTimes(2);
    expect(activationHitCounts.get(target.id)).toBe(2);
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
