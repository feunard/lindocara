import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { actionForClassSlot } from "@lindocara/engine/combat-actions.js";
import { maxHpForLevel } from "@lindocara/engine/game.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  advancePeasantCamps,
  beginPeasantSupportRequest,
  canActivatePeasantSupportRequest,
  commitPeasantSupportRequest,
  createPeasantSupportRuntime,
  damageAfterPeasantCampProtection,
  isPeasantBombProjectile,
  peasantSupportPlans,
  placePeasantCamp,
  refundPeasantCampGold,
  resolvePeasantBombImpact,
  resolvePeasantSupportAction,
  transferPeasantCampGold,
} from "@lindocara/server/world/peasant-support-system.js";
import {
  advanceProjectiles,
  type ProjectileSystemContext,
} from "@lindocara/server/world/projectile-system.js";
import {
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/server/world/terrain-access.js";
import {
  createMonsters,
  type GroundIndexQuery,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "@lindocara/server/world/world-runtime.js";

import { describe, expect, it, vi } from "vitest";
import { createWorldRoomState } from "../src/api/realtime/worldState.ts";
import { sendPeasantCampsTo, type WorldGlue } from "../src/api/realtime/worldTick.ts";

/**
 * Coordinates here are the suite's original PIXEL values over `TILE_SIZE`, on a flat 32x32
 * heightfield. Positions are body CENTRES now, so nothing adds half a body anywhere.
 */
const t = (pixels: number): number => pixels / TILE_SIZE;

function terrain(obstacles: readonly ColliderRect[] = []): ZoneTerrain {
  const size = 32;
  const map: MapData = {
    version: 1,
    size,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels: new Array(size * size).fill(0),
    materials: new Array(size * size).fill("herbe"),
    colliders: [...obstacles],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/**
 * The broad phase these functions ask for, done exactly. The room's spatial grid still indexes
 * ground `x` against ELEVATION `y` and is Task 6's to convert; a suite about blast geometry must
 * not wait on it to measure the right plane.
 */
function groundIndex<T extends { id: string; x: number; z: number }>(
  entities: readonly T[],
): GroundIndexQuery<T> {
  return {
    queryRadius(position, radius) {
      return entities.filter(
        (entity) => Math.hypot(entity.x - position.x, entity.z - position.z) <= radius,
      );
    },
  };
}

function player(id: string, x = 0, partyId = "party-a"): PlayerRuntime {
  const result = newPlayer(
    {
      id,
      nick: id,
      x,
      y: 0,
      z: t(32),
      level: 20,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "moss" },
      class: "peasant",
      equipment: starterEquipmentFor("peasant"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "map-a",
      instanceId: "main",
      sessionEpoch: 3,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `connection-${id}`,
    `${partyId}:map-a`,
  );
  result.identityKind = "hero";
  result.partyId = partyId;
  result.facing = { x: 1, z: 0 };
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
      z: t(32),
      patrolRadius: t(20),
    },
  ])[0];
  if (!result) throw new Error("monster fixture missing");
  return result;
}

function supportSkills() {
  const camp = CLASS_SKILLS.peasant[3];
  const bomb = CLASS_SKILLS.peasant[4];
  if (!camp || !bomb) throw new Error("Peasant support skills missing");
  return { camp, bomb };
}

function supportPlans(selectedTalents: readonly string[] = []) {
  return peasantSupportPlans({ ...supportSkills(), selectedTalents });
}

describe("authoritative Peasant support", () => {
  it("invalidates a frozen request after movement, facing, disconnect or epoch changes", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const world = terrain();
    const { camp, bomb } = supportSkills();
    const plans = peasantSupportPlans({ camp, bomb, selectedTalents: [] });
    const result = beginPeasantSupportRequest({
      runtime,
      connectionId: owner.connectionId,
      player: owner,
      slot: 4,
      skill: camp,
      definition: actionForClassSlot("peasant", 4),
      plan: plans.camp,
      terrain: world,
      projectiles: [],
      now: 1_000,
    });
    if (!result.ok) throw new Error(`request rejected: ${result.reason}`);
    const valid = () =>
      canActivatePeasantSupportRequest({
        runtime,
        request: result.request,
        connectionId: owner.connectionId,
        player: owner,
        terrain: world,
        projectiles: [],
      });
    expect(valid()).toBe(true);
    owner.x += t(1);
    expect(valid()).toBe(false);
    owner.x -= t(1);
    owner.facing = { x: 0, z: 1 };
    expect(valid()).toBe(false);
    owner.facing = { x: 1, z: 0 };
    owner.authorized = false;
    expect(valid()).toBe(false);
    owner.authorized = true;
    owner.sessionEpoch += 1;
    expect(valid()).toBe(false);
  });

  it("keeps one camp per owner, pulses allies and applies only the strongest protection", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const ally = player("ally", t(48));
    const outsider = player("outsider", t(48), "party-b");
    const world = terrain();
    const plans = supportPlans();
    const first = placePeasantCamp(
      runtime,
      owner,
      "camp-a",
      { x: t(48), y: 0, z: t(48) },
      plans.camp,
      1_000,
    );
    const second = placePeasantCamp(
      runtime,
      owner,
      "camp-b",
      { x: t(52), y: 0, z: t(48) },
      {
        ...plans.camp,
        construction: { ...plans.camp.construction, protectionRatio: 0.08 },
      },
      1_100,
    );
    expect(first?.replaced).toBeNull();
    expect(second?.replaced?.id).toBe("camp-a");
    expect(runtime.camps.map((camp) => camp.id)).toEqual(["camp-b"]);

    const heal = vi.fn();
    const restoreResource = vi.fn();
    advancePeasantCamps({
      runtime,
      players: [owner, ally, outsider],
      monsters: [],
      terrain: world,
      now: 1_100,
      isOwnerActive: () => true,
      areAllies: (source, target) => source.partyId === target.partyId,
      heal,
      restoreResource,
      serveRation: vi.fn(),
      slowMonster: vi.fn(),
    });
    expect(heal.mock.calls.map((call) => (call[2] as PlayerRuntime).id)).toEqual(["owner", "ally"]);
    expect(restoreResource.mock.calls.map((call) => (call[2] as PlayerRuntime).id)).toEqual([
      "owner",
      "ally",
    ]);
    expect(damageAfterPeasantCampProtection(ally, 20, runtime.camps, world, 1_100)).toBe(16);
    expect(damageAfterPeasantCampProtection(ally, 0, runtime.camps, world, 1_100)).toBe(0);

    advancePeasantCamps({
      runtime,
      players: [owner, ally],
      monsters: [],
      terrain: world,
      now: 1_200,
      isOwnerActive: () => false,
      areAllies: () => true,
      heal,
      restoreResource: vi.fn(),
      serveRation: vi.fn(),
      slowMonster: vi.fn(),
    });
    expect(runtime.camps).toEqual([]);
  });

  it("lets any nearby ally deposit and withdraw gold without trusting a resulting balance", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const ally = player("ally", t(32));
    const outsider = player("outsider", t(32), "party-b");
    ally.inventory.gold = 80;
    outsider.inventory.gold = 80;
    const world = terrain();
    const camp = placePeasantCamp(
      runtime,
      owner,
      "camp-bank",
      { x: t(48), y: 0, z: t(48) },
      supportPlans().camp,
      1_000,
    )?.camp;
    if (!camp) throw new Error("camp fixture missing");

    expect(
      transferPeasantCampGold({
        runtime,
        player: ally,
        terrain: world,
        campId: camp.id,
        operation: "deposit",
        amount: 50,
        now: 1_001,
      }),
    ).toMatchObject({ ok: true });
    expect({ carried: ally.inventory.gold, stored: camp.storedGold }).toEqual({
      carried: 30,
      stored: 50,
    });
    expect(
      transferPeasantCampGold({
        runtime,
        player: owner,
        terrain: world,
        campId: camp.id,
        operation: "withdraw",
        amount: 20,
        now: 1_002,
      }),
    ).toMatchObject({ ok: true });
    expect({ carried: owner.inventory.gold, stored: camp.storedGold }).toEqual({
      carried: 20,
      stored: 30,
    });
    expect(
      transferPeasantCampGold({
        runtime,
        player: outsider,
        terrain: world,
        campId: camp.id,
        operation: "deposit",
        amount: 1,
        now: 1_003,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    ally.x = 300;
    expect(
      transferPeasantCampGold({
        runtime,
        player: ally,
        terrain: world,
        campId: camp.id,
        operation: "withdraw",
        amount: 1,
        now: 1_004,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(refundPeasantCampGold(camp, owner)).toBe(30);
    expect(owner.inventory.gold).toBe(50);
    expect(camp.storedGold).toBe(0);
  });

  it("maps every construction evolution and ration plan field into camp runtime", () => {
    const owner = player("owner");
    const constructionCases = [
      {
        talent: "peasant.makeshift_camp.stockade",
        expected: {
          cost: { wood: 3, stone: 2, meat: 2 },
          radius: t(96),
          durationMs: 61_250,
          protectionRatio: 0.27,
          slowRatio: 0.2,
        },
      },
      {
        talent: "peasant.makeshift_camp.campfire",
        expected: {
          cost: { wood: 4, stone: 2, meat: 2 },
          radius: t(120),
          durationMs: 43_750,
          protectionRatio: 0.2,
          slowRatio: 0,
        },
      },
      {
        talent: "peasant.makeshift_camp.complete_encampment",
        expected: {
          cost: { wood: 2, stone: 1, meat: 1 },
          radius: t(144),
          durationMs: 80_000,
          protectionRatio: 0.22,
          slowRatio: 0.2,
        },
      },
    ] as const;
    for (const value of constructionCases) {
      const plan = supportPlans([value.talent]).camp;
      const runtime = createPeasantSupportRuntime();
      const placement = placePeasantCamp(
        runtime,
        owner,
        value.talent,
        { x: t(48), y: 0, z: t(48) },
        plan,
        1_000,
      );
      expect(plan.cost).toEqual(value.expected.cost);
      expect(placement?.camp).toMatchObject({
        radius: value.expected.radius,
        expiresAt: 1_000 + value.expected.durationMs,
        protectionRatio: value.expected.protectionRatio,
        slowRatio: value.expected.slowRatio,
      });
    }

    const rationCases = [
      {
        talent: "peasant.butchers_cut.preservation",
        expected: { healing: 17, portions: 2, radius: 0, durationMs: 0, bonus: 0 },
      },
      {
        talent: "peasant.butchers_cut.field_feast",
        expected: { healing: 12, portions: 1, radius: t(120), durationMs: 6_000, bonus: 0.1 },
      },
      {
        talent: "peasant.butchers_cut.grand_feast",
        expected: { healing: 21, portions: 4, radius: t(180), durationMs: 10_000, bonus: 0.15 },
      },
    ] as const;
    for (const value of rationCases) {
      const runtime = createPeasantSupportRuntime();
      const placement = placePeasantCamp(
        runtime,
        owner,
        value.talent,
        { x: t(48), y: 0, z: t(48) },
        supportPlans([value.talent]).camp,
        1_000,
      );
      expect(placement?.camp).toMatchObject({
        rationHealing: value.expected.healing,
        rationPortionsRemaining: value.expected.portions,
        rationRadius: value.expected.radius,
        rationBuffDurationMs: value.expected.durationMs,
        rationPowerBonusRatio: value.expected.bonus,
      });
    }
  });

  it("serves finite rations deterministically and slows only monsters inside the camp", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const allies = [
      player("ally-a", t(40)),
      player("ally-b", t(56)),
      player("ally-c", t(72)),
      player("ally-d", t(88)),
    ];
    owner.hp = 90;
    allies.forEach((ally, index) => {
      ally.hp = 10 + index * 10;
    });
    const slowed = monster("slowed", t(64));
    const far = monster("far", t(360));
    const camp = placePeasantCamp(
      runtime,
      owner,
      "camp-feast",
      { x: t(48), y: 0, z: t(48) },
      supportPlans([
        "peasant.butchers_cut.grand_feast",
        "peasant.makeshift_camp.complete_encampment",
      ]).camp,
      1_000,
    )?.camp;
    if (!camp) throw new Error("camp fixture missing");
    const served: string[] = [];
    const slowedIds: string[] = [];
    const advance = (now: number) =>
      advancePeasantCamps({
        runtime,
        players: [owner, ...allies],
        monsters: [slowed, far],
        terrain: terrain(),
        now,
        isOwnerActive: () => true,
        areAllies: () => true,
        heal: vi.fn(),
        restoreResource: vi.fn(),
        serveRation: (_camp, _owner, target) => served.push(target.id),
        slowMonster: (_camp, _owner, target) => slowedIds.push(target.id),
      });

    advance(1_000);
    expect(served).toEqual(["ally-a", "ally-b", "ally-c", "ally-d"]);
    expect(camp.rationPortionsRemaining).toBe(0);
    expect(slowedIds).toEqual(["slowed"]);
    advance(3_000);
    expect(served).toHaveLength(4);
    expect(slowedIds).toEqual(["slowed", "slowed"]);
  });

  it("conserves owner-only rations until they provide healing inside the camp", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    owner.hp = maxHpForLevel(owner.level);
    const camp = placePeasantCamp(
      runtime,
      owner,
      "camp-ration",
      { x: t(48), y: 0, z: t(48) },
      supportPlans().camp,
      1_000,
    )?.camp;
    if (!camp) throw new Error("camp fixture missing");
    const served: string[] = [];
    const advance = (now: number) =>
      advancePeasantCamps({
        runtime,
        players: [owner],
        monsters: [],
        terrain: terrain(),
        now,
        isOwnerActive: () => true,
        areAllies: () => true,
        heal: vi.fn(),
        restoreResource: vi.fn(),
        serveRation: (_camp, _owner, target) => served.push(target.id),
        slowMonster: vi.fn(),
      });

    advance(1_000);
    expect(served).toEqual([]);
    expect(camp.rationPortionsRemaining).toBe(1);
    expect(camp.rationServedIds).not.toContain(owner.id);

    owner.hp -= 20;
    owner.x = 300;
    advance(3_000);
    expect(served).toEqual([]);
    expect(camp.rationPortionsRemaining).toBe(1);

    owner.x = 0;
    advance(5_000);
    expect(served).toEqual([owner.id]);
    expect(camp.rationPortionsRemaining).toBe(0);
    expect(camp.rationServedIds).toContain(owner.id);
  });

  it("serves a full-health feast only when its power buff improves the target", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    owner.hp = maxHpForLevel(owner.level);
    owner.rallyPowerMultiplier = 0.1;
    owner.rallyPowerUntil = 5_000;
    const camp = placePeasantCamp(
      runtime,
      owner,
      "camp-feast",
      { x: t(48), y: 0, z: t(48) },
      supportPlans(["peasant.butchers_cut.field_feast"]).camp,
      1_000,
    )?.camp;
    if (!camp) throw new Error("camp fixture missing");
    const served = vi.fn();
    const advance = (now: number) =>
      advancePeasantCamps({
        runtime,
        players: [owner],
        monsters: [],
        terrain: terrain(),
        now,
        isOwnerActive: () => true,
        areAllies: () => true,
        heal: vi.fn(),
        restoreResource: vi.fn(),
        serveRation: served,
        slowMonster: vi.fn(),
      });

    advance(1_000);
    expect(served).not.toHaveBeenCalled();
    expect(camp.rationPortionsRemaining).toBe(1);

    advance(5_001);
    expect(served).toHaveBeenCalledOnce();
    expect(camp.rationPortionsRemaining).toBe(0);
  });

  it("replays only active camps deterministically for admission and AOI catch-up", () => {
    const state = createWorldRoomState("party-a:map-a", null, null);
    const owner = player("owner");
    const plan = supportPlans().camp;
    const placement = placePeasantCamp(
      state.peasantSupport,
      owner,
      "camp-a",
      { x: t(48), y: 0, z: t(48) },
      plan,
      1_000,
    );
    if (!placement) throw new Error("camp fixture missing");
    const send = vi.fn();
    const glue = { state, deps: { send } } as unknown as WorldGlue;

    sendPeasantCampsTo(glue, "connection-viewer", 1_001);
    sendPeasantCampsTo(glue, "connection-viewer", 1_001);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      t: "peasant.camp",
      id: "camp-a",
      startedAt: 1_000,
      expiresAt: placement.camp.expiresAt,
    });
    sendPeasantCampsTo(glue, "connection-viewer", placement.camp.expiresAt);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("freezes every bomb evolution field into the single authoritative projectile", () => {
    const cases = [
      {
        talent: "peasant.homemade_bomb.shrapnel",
        expected: {
          cost: { iron: 2, stone: 2 },
          power: 85,
          radius: t(121),
          fragments: 4,
          fragmentPower: 21,
          slowRatio: 0,
          slowDurationMs: 0,
          knockbackDistance: 0,
        },
      },
      {
        talent: "peasant.homemade_bomb.concussion",
        expected: {
          cost: { iron: 2, stone: 2 },
          power: 77,
          radius: t(132),
          fragments: 0,
          fragmentPower: 0,
          slowRatio: 0.35,
          slowDurationMs: 3_000,
          knockbackDistance: t(48),
        },
      },
      {
        talent: "peasant.homemade_bomb.powder_keg",
        expected: {
          cost: { iron: 1, stone: 1 },
          power: 115,
          // 110 px * 1.35; tile units keep the exact product where the pixel table rounded.
          radius: 2.320313,
          fragments: 6,
          fragmentPower: 35,
          slowRatio: 0.25,
          slowDurationMs: 3_000,
          knockbackDistance: t(36),
        },
      },
    ] as const;
    for (const value of cases) {
      const runtime = createPeasantSupportRuntime();
      const owner = player(`owner-${value.talent}`);
      const { camp, bomb } = supportSkills();
      const plan = peasantSupportPlans({ camp, bomb, selectedTalents: [value.talent] }).bomb;
      const requested = beginPeasantSupportRequest({
        runtime,
        connectionId: owner.connectionId,
        player: owner,
        slot: 5,
        skill: bomb,
        definition: actionForClassSlot("peasant", 5),
        plan,
        terrain: terrain(),
        projectiles: [],
        now: 2_000,
      });
      if (!requested.ok) throw new Error(`request rejected: ${requested.reason}`);
      const action = commitPeasantSupportRequest(runtime, requested.request, owner, 2_000);
      if (!action) throw new Error("action was not committed");
      const projectiles: ProjectileRuntime[] = [];
      resolvePeasantSupportAction(runtime, projectiles, owner, action, owner.roomKey, 2_000);
      const projectile = projectiles[0];
      if (!projectile) throw new Error("bomb projectile missing");
      const { cost, ...runtimeExpected } = value.expected;
      expect(plan.cost).toEqual(cost);
      expect(projectile.expiresAt).toBe(2_650);
      expect(runtime.bombs.get(projectile.id)).toMatchObject(runtimeExpected);
    }
  });

  it("assigns one fragment per nearest visible target and never resolves the explosion twice", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const { camp, bomb } = supportSkills();
    const plan = peasantSupportPlans({
      camp,
      bomb,
      selectedTalents: ["peasant.homemade_bomb.shrapnel"],
    }).bomb;
    const requested = beginPeasantSupportRequest({
      runtime,
      connectionId: owner.connectionId,
      player: owner,
      slot: 5,
      skill: bomb,
      definition: actionForClassSlot("peasant", 5),
      plan,
      terrain: terrain(),
      projectiles: [],
      now: 2_000,
    });
    if (!requested.ok) throw new Error(`request rejected: ${requested.reason}`);
    const action = commitPeasantSupportRequest(runtime, requested.request, owner, 2_000);
    if (!action) throw new Error("action was not committed");
    const projectiles: ProjectileRuntime[] = [];
    resolvePeasantSupportAction(runtime, projectiles, owner, action, owner.roomKey, 2_000);
    const projectile = projectiles[0];
    if (!projectile) throw new Error("bomb projectile missing");
    const targets = [
      monster("target-a", t(64)),
      monster("target-b", t(72)),
      monster("target-c", t(80)),
      monster("target-d", t(88)),
      monster("target-e", t(96)),
    ];
    const monsterGrid = groundIndex(targets);
    const damage: Array<[string, number]> = [];
    const explode = () =>
      resolvePeasantBombImpact({
        runtime,
        projectile,
        // Due west of the row of targets, so "nearest first" is unambiguous. The pixel version
        // put the blast north of them and relied on each monster's combat disc sitting ~50 px
        // north of its feet; that offset left the ground plane with MONSTER_BODY_HITBOX.
        point: { x: t(0), z: t(32) },
        monsterGrid,
        terrain: terrain(),
        now: 2_100,
        damage: (target, power) => {
          damage.push([target.id, power]);
          return { killed: false };
        },
      });

    expect(explode()).not.toBeNull();
    expect(damage).toEqual([
      ["target-a", 106],
      ["target-b", 106],
      ["target-c", 106],
      ["target-d", 106],
      ["target-e", 85],
    ]);
    expect(explode()).toBeNull();
    expect(damage).toHaveLength(5);
  });

  it("creates one non-piercing bomb and resolves its authoritative AoE exactly once", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const target = monster("target", t(48));
    target.z = t(64);
    const world = terrain();
    const { camp, bomb } = supportSkills();
    const plans = peasantSupportPlans({ camp, bomb, selectedTalents: [] });
    const requested = beginPeasantSupportRequest({
      runtime,
      connectionId: owner.connectionId,
      player: owner,
      slot: 5,
      skill: bomb,
      definition: actionForClassSlot("peasant", 5),
      plan: plans.bomb,
      terrain: world,
      projectiles: [],
      now: 2_000,
      direction: { x: 0.6, z: 0.8 },
    });
    if (!requested.ok) throw new Error(`request rejected: ${requested.reason}`);
    const action = commitPeasantSupportRequest(runtime, requested.request, owner, 2_000);
    if (!action) throw new Error("action was not committed");
    const projectiles: ProjectileRuntime[] = [];
    const resolved = resolvePeasantSupportAction(
      runtime,
      projectiles,
      owner,
      action,
      owner.roomKey,
      2_000,
    );
    expect(resolved?.kind).toBe("bomb");
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0]).toMatchObject({
      kind: "homemade_bomb",
      pierceRemaining: 0,
      power: 0,
      direction: { x: 0.6, z: 0.8 },
    });

    const monsterGrid = groundIndex([target]);
    const playerGrid = groundIndex([owner]);
    const directDamage = vi.fn();
    const explosionDamage = vi.fn();
    const impacts: string[] = [];
    const context: ProjectileSystemContext<string> = {
      projectiles,
      terrain: world,
      monsters: [target],
      players: new Map([[owner.connectionId, owner]]),
      guards: [],
      monsterGrid,
      playerGrid,
      canHeal: () => false,
      damageMonster: (projectile, hit) => {
        if (!isPeasantBombProjectile(runtime, projectile)) directDamage(hit);
      },
      healPlayer: vi.fn(),
      damagePlayer: vi.fn(),
      damageGuard: vi.fn(),
      blocked: vi.fn(),
      removed: (projectile, point, _reason, now) => {
        const impact = resolvePeasantBombImpact({
          runtime,
          projectile,
          point,
          monsterGrid,
          terrain: world,
          now,
          damage: explosionDamage,
        });
        if (impact) impacts.push(impact.actionId);
      },
    };
    advanceProjectiles(context, 2_050);
    advanceProjectiles(context, 2_100);
    expect(directDamage).not.toHaveBeenCalled();
    expect(explosionDamage).toHaveBeenCalledTimes(1);
    expect(explosionDamage).toHaveBeenCalledWith(target, plans.bomb.bomb.power);
    expect(impacts).toEqual([action.id]);
    expect(projectiles).toEqual([]);
  });
});
