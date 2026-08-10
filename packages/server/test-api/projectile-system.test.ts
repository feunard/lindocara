import { starterEquipmentFor } from "@lindocara/engine/character.js";
import {
  MAX_PROJECTILES_PER_PLAYER,
  MAX_PROJECTILES_PER_ROOM,
} from "@lindocara/engine/combat-actions.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { ProjectileKind } from "@lindocara/engine/protocol.js";
import { type ZoneTerrain, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  advanceProjectiles,
  nearestProjectileMonster,
  type ProjectileSystemContext,
  removeProjectilesByOwner,
  spawnProjectile,
} from "@lindocara/server/world/projectile-system.js";
import {
  createGuards,
  createMonsters,
  type GroundIndexQuery,
  type GuardRuntime,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

/**
 * Every coordinate in this suite is written as its original PIXEL value over `TILE_SIZE`, so the
 * geometry each case was designed around stays readable while the numbers the system reads are
 * tile units.
 */
const t = (pixels: number): number => pixels / TILE_SIZE;

/**
 * A flat 32x32 heightfield — 2048 px of the old world, wider than any shot here — plus whatever
 * walls a case needs, as authored sub-cell colliders. Walls are colliders rather than raised cells
 * because that is what the old `obstacles` rectangles were: props standing on flat ground, not
 * relief.
 */
function terrain(walls: readonly ColliderRect[] = []): ZoneTerrain {
  const size = 32;
  const map: MapData = {
    version: 1,
    size,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels: new Array(size * size).fill(0),
    materials: new Array(size * size).fill("herbe"),
    colliders: [...walls],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/** A pixel wall rectangle, in tile units and on the ground plane. */
function wall(x: number, z: number, width: number, height: number): ColliderRect {
  return { x: t(x), z: t(z), w: t(width), h: t(height) };
}

/**
 * The broad phase the projectile system asks for, done exactly rather than through the room's
 * spatial grid: the grid still indexes ground `x` against ELEVATION `y` and is Task 6's to
 * convert, and a suite about projectile GEOMETRY must not be measuring the wrong plane while it
 * waits. `queryRadius` is the whole capability the system uses.
 */
function groundIndex<T extends { id: string; x: number; z: number }>(
  entities: readonly T[],
): GroundIndexQuery<T> {
  return {
    queryRadius(position: GroundVector, radius: number) {
      return entities.filter(
        (entity) => Math.hypot(entity.x - position.x, entity.z - position.z) <= radius,
      );
    },
  };
}

function player(id: string, x: number, hp = 100, partyId = "party-a"): PlayerRuntime {
  const result = newPlayer(
    {
      id,
      nick: id,
      x,
      y: 0,
      z: 0,
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
      z: 0,
      patrolRadius: t(20),
    },
  ])[0];
  if (!result) throw new Error("monster fixture missing");
  return result;
}

function guard(id: string, x: number): GuardRuntime {
  const result = createGuards([{ id, x, y: 0, z: 0, patrolRadius: t(64) }])[0];
  if (!result) throw new Error("guard fixture missing");
  return result;
}

function definition(kind: ProjectileKind, pierce = 0) {
  return { kind, speed: t(2_000), radius: t(5), pierce };
}

function context(options: {
  owner: PlayerRuntime;
  projectiles: ProjectileRuntime[];
  monsters?: MonsterRuntime[];
  allies?: PlayerRuntime[];
  guards?: GuardRuntime[];
  world?: ZoneTerrain;
  hostile?: boolean;
}) {
  const monsters = options.monsters ?? [];
  const players = options.hostile
    ? (options.allies ?? [])
    : [options.owner, ...(options.allies ?? [])];
  const sockets = players.map(
    (entry) => [{ id: `socket-${entry.id}` } as unknown as WebSocket, entry] as const,
  );
  const monsterGrid = groundIndex(monsters);
  const playerGrid = groundIndex(players);
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
    origin: { x: t(20), y: 0, z: t(16) },
    direction: { x: 1, z: 0 },
    definition: definition(kind, options.pierce),
    range: options.range ?? t(300),
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
  it("targets the nearest living monster in range on the same elevation", () => {
    const owner = player("owner", t(0));
    const raised = monster("raised", t(30));
    raised.y = 0.5;
    const dead = monster("dead", t(40));
    dead.deadUntil = 2_000;
    const expected = monster("expected", t(80));
    expected.z = t(20);
    const outOfRange = monster("out-of-range", t(220));

    expect(
      nearestProjectileMonster(owner, [raised, dead, outOfRange, expected], t(160), 1_000, 0.5),
    ).toBe(expected);
  });

  it("lets a straight projectile miss and expire at its maximum range", () => {
    const owner = player("owner", t(0));
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "arrow", { range: t(80) });
    const harness = context({ owner, projectiles });
    advanceProjectiles(harness.value, 1_050);
    expect(harness.damageMonster).not.toHaveBeenCalled();
    expect(projectiles).toHaveLength(0);
  });

  it("does not hit a monster standing on another elevation level", () => {
    const owner = player("owner", t(0));
    const target = monster("raised-target", t(90));
    target.y = 0.5;
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "arrow", { range: t(300) });
    const harness = context({ owner, projectiles, monsters: [target] });

    advanceProjectiles(harness.value, 1_050);

    expect(harness.damageMonster).not.toHaveBeenCalled();
  });

  it("hits the visible upper body of a tall monster above its navigation square", () => {
    const owner = player("owner", t(0));
    const target = monster("tall-target", t(100));
    target.species = "mire_troll";
    target.kind = "troll";
    target.z = t(180);
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "77777777-7777-4777-8777-777777777777",
      owner,
      roomKey: owner.roomKey,
      origin: { x: t(20), y: 0, z: t(100) },
      direction: { x: 1, z: 0 },
      definition: definition("arrow"),
      range: t(300),
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
    const owner = player("owner", t(0));
    // 300 px away, not the 130 px this case used in the pixel world. A monster's combat disc is
    // now centred on the monster itself instead of on its drawn silhouette 50 px to the north (see
    // MONSTER_BODY_HITBOX), so a goblin's 87 px radius reaches the shooting line squarely and a
    // goblin standing 130 px behind a wall now overlaps that wall with its own body. Moving it
    // back restores the case this test is about: a wall BETWEEN the shot and the target.
    const target = monster("behind-wall", t(300));
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "arrow");
    const walls = [wall(80, 0, 64, 64)];
    const harness = context({ owner, projectiles, monsters: [target], world: terrain(walls) });
    advanceProjectiles(harness.value, 1_050);
    expect(harness.blocked).toHaveBeenCalledTimes(1);
    expect(harness.damageMonster).not.toHaveBeenCalled();
    expect(projectiles).toHaveLength(0);
  });

  it("cannot tunnel through a thin wall in one tick, however fast it flies", () => {
    const owner = player("owner", t(0));
    const projectiles: ProjectileRuntime[] = [];
    // A 6 px fence post, far narrower than one tick of travel: at 2000 px/s the projectile covers
    // 100 px per 50 ms tick, so an endpoint test — or any walk of samples coarser than the post —
    // steps straight over it and the shot arrives on the far side untouched.
    const post = wall(500, 0, 6, 200);
    const harness = context({ owner, projectiles, world: terrain([post]) });
    // `MAX_PROJECTILE_RANGE` caps the shot at 8.4 tiles; the post sits inside that.
    const projectile = launch(projectiles, owner, "arrow", { range: t(1_200) });
    const removed = vi.fn();
    harness.value.removed = removed;

    // The whole flight, tick by tick. Nothing may get past the post.
    for (let tick = 0; tick < 12; tick++) advanceProjectiles(harness.value, 1_050 + tick * 50);

    expect(harness.blocked).toHaveBeenCalledOnce();
    expect(removed.mock.calls[0]?.[2]).toBe("terrain");
    // Stopped AT the post's near face, not beyond it.
    expect(projectile.x).toBeCloseTo(t(500) - projectile.radius, 5);
    expect(projectiles).toEqual([]);
  });

  it("reports one terminal terrain point for a homemade bomb without piercing the obstacle", () => {
    const owner = player("bomb-owner", t(0));
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "homemade_bomb", { range: t(240) });
    const world = terrain([wall(60, 0, 24, 96)]);
    // Moved back for the same reason as the case above.
    const target = monster("behind-bomb-wall", t(300));
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
    const caster = monster("archer", t(0));
    const target = player("target", t(90));
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "77777777-7777-4777-8777-777777777777",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("arrow"),
      range: t(300),
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
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("hex_orb"),
      range: t(300),
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    const walls = [wall(55, 0, 20, 64)];
    const blocked = context({
      owner: target,
      projectiles: blockedProjectiles,
      allies: [target],
      hostile: true,
      world: terrain(walls),
    });
    advanceProjectiles(blocked.value, 1_050);
    expect(blocked.damagePlayer).not.toHaveBeenCalled();
    expect(blocked.blocked).toHaveBeenCalledTimes(1);
  });

  it("hits a vanished Rogue's decoy without exposing or damaging the hidden hero", () => {
    const caster = monster("decoy-archer", t(0));
    const rogue = player("hidden-rogue", t(90));
    rogue.class = "rogue";
    rogue.rogueStealthUntil = 9_000;
    rogue.rogueSilhouette = { x: t(90), y: 0, z: 0, hp: 45, expiresAt: 6_000 };
    const projectiles: ProjectileRuntime[] = [];
    spawnProjectile(projectiles, {
      actionId: "66666666-6666-4666-8666-666666666666",
      owner: caster,
      roomKey: rogue.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("arrow"),
      range: t(300),
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
    const caster = monster("blocked-caster", t(0));
    const target = player("observer", t(300));
    const protectedGuard = guard("behind-wall", t(90));
    const projectiles: ProjectileRuntime[] = [];
    spawnProjectile(projectiles, {
      actionId: "99999999-9999-4999-8999-999999999999",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("arrow"),
      range: t(300),
      power: 17,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now: 1_000,
    });
    const walls = [wall(55, 0, 20, 64)];
    const harness = context({
      owner: target,
      projectiles,
      guards: [protectedGuard],
      hostile: true,
      world: terrain(walls),
    });

    advanceProjectiles(harness.value, 1_050);

    expect(harness.damageGuard).not.toHaveBeenCalled();
    expect(harness.blocked).toHaveBeenCalledTimes(1);
  });

  it("pierces guards in order without damaging either one twice", () => {
    const caster = monster("piercing-caster", t(0));
    const target = player("observer", t(300));
    const first = guard("first-guard", t(50));
    const second = guard("second-guard", t(100));
    const projectiles: ProjectileRuntime[] = [];
    spawnProjectile(projectiles, {
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      owner: caster,
      roomKey: target.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("enemy_harpoon", 1),
      range: t(300),
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
    const owner = player("owner", t(0));
    const first = monster("first", t(50));
    const second = monster("second", t(100));
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "piercing_arrow", { pierce: 7 });
    const harness = context({ owner, projectiles, monsters: [first, second] });
    advanceProjectiles(harness.value, 1_050);
    advanceProjectiles(harness.value, 1_100);
    expect(harness.damageMonster.mock.calls.map((call) => call[1].id)).toEqual(["first", "second"]);
  });

  it("turns a piercing arrow back at maximum range without repeating outward hits", () => {
    const owner = player("owner", t(0));
    const first = monster("first", t(50));
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "44444444-4444-4444-8444-444444444444",
      owner,
      roomKey: owner.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("piercing_arrow", 7),
      range: t(80),
      returnRange: t(80),
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
    const owner = player("owner", t(0));
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "55555555-5555-4555-8555-555555555555",
      owner,
      roomKey: owner.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("piercing_arrow", 7),
      range: t(200),
      returnRange: t(200),
      power: 29,
      targetFilter: "monsters",
      sourceSkillId: "piercing_arrow",
      basic: false,
      now: 1_000,
    });
    if (!projectile) throw new Error("returning projectile rejected");
    const walls = [wall(80, 0, 64, 64)];
    const harness = context({ owner, projectiles, world: terrain(walls) });
    advanceProjectiles(harness.value, 1_050);
    expect(projectile.returningToOwner).toBe(true);
    expect(harness.blocked).not.toHaveBeenCalled();
  });

  it("curves Heartseeker gradually while leaving the first interceptor authoritative", () => {
    const owner = player("owner", t(0));
    const interceptor = monster("interceptor", t(70));
    const target = monster("target", t(150));
    target.z = t(100);
    const projectiles: ProjectileRuntime[] = [];
    const projectile = spawnProjectile(projectiles, {
      actionId: "66666666-6666-4666-8666-666666666666",
      owner,
      roomKey: owner.roomKey,
      origin: { x: t(20), y: 0, z: t(16) },
      direction: { x: 1, z: 0 },
      definition: definition("heartseeker"),
      range: t(300),
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
    expect(projectile.direction.z).toBeGreaterThan(0);
    expect(projectile.direction.z).toBeLessThan(0.2);
    expect(harness.damageMonster.mock.calls[0]?.[1].id).toBe("interceptor");
  });

  it("lets focused-volley arrows share a bounded per-target impact count", () => {
    const owner = player("owner", t(0));
    const target = monster("large-target", t(50));
    const projectiles: ProjectileRuntime[] = [];
    const activationHitCounts = new Map<string, number>();
    for (let index = 0; index < 2; index++) {
      const spawned = spawnProjectile(projectiles, {
        actionId: "33333333-3333-4333-8333-333333333333",
        owner,
        roomKey: owner.roomKey,
        origin: { x: t(20), y: 0, z: t(16) },
        direction: { x: 1, z: 0 },
        definition: definition("volley_arrow"),
        range: t(300),
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
    const owner = player("owner", t(0));
    const full = player("full", t(35), 100);
    const foreign = player("foreign", t(60), 40, "party-b");
    const wounded = player("wounded", t(90), 40);
    const projectiles: ProjectileRuntime[] = [];
    launch(projectiles, owner, "healing_light", {
      targetFilter: "wounded_allies",
      range: t(160),
    });
    const harness = context({ owner, projectiles, allies: [full, foreign, wounded] });
    advanceProjectiles(harness.value, 1_050);
    expect(harness.healPlayer).toHaveBeenCalledTimes(1);
    expect(harness.healPlayer.mock.calls[0]?.[2].id).toBe("wounded");
    expect(projectiles).toHaveLength(0);
  });

  it("bounds projectile creation per player", () => {
    const owner = player("owner", t(0));
    const projectiles: ProjectileRuntime[] = [];
    for (let index = 0; index < MAX_PROJECTILES_PER_PLAYER; index++) {
      launch(projectiles, owner, "arrow");
    }
    expect(
      spawnProjectile(projectiles, {
        actionId: "22222222-2222-4222-8222-222222222222",
        owner,
        roomKey: owner.roomKey,
        origin: { x: t(20), y: 0, z: t(16) },
        direction: { x: 1, z: 0 },
        definition: definition("arrow"),
        range: t(100),
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
        owner: player("overflow", t(0)),
        roomKey: "party-a:map-a",
        origin: { x: t(20), y: 0, z: t(16) },
        direction: { x: 1, z: 0 },
        definition: definition("arrow"),
        range: t(100),
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
