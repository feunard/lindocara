import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { actionForClassSlot } from "@lindocara/engine/combat-actions.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import {
  advancePeasantCamps,
  basePeasantSupportPlans,
  beginPeasantSupportRequest,
  canActivatePeasantSupportRequest,
  commitPeasantSupportRequest,
  createPeasantSupportRuntime,
  damageAfterPeasantCampProtection,
  isPeasantBombProjectile,
  placePeasantCamp,
  resolvePeasantBombImpact,
  resolvePeasantSupportAction,
} from "@lindocara/server/world/peasant-support-system.js";
import {
  advanceProjectiles,
  type ProjectileSystemContext,
} from "@lindocara/server/world/projectile-system.js";
import { SpatialGrid } from "@lindocara/server/world/spatial-grid.js";
import {
  createMonsters,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { noColliders, tileMapFromRects } from "@lindocara/testing/tiles.js";
import { describe, expect, it, vi } from "vitest";
import { createWorldRoomState } from "../src/api/realtime/worldState.ts";
import { sendPeasantCampsTo, type WorldGlue } from "../src/api/realtime/worldTick.ts";

function terrain(obstacles: TerrainGeometry["obstacles"] = []): TerrainGeometry {
  const tiles = tileMapFromRects(400, 240, obstacles);
  return {
    width: 400,
    height: 240,
    spawnPoints: [{ x: 0, y: 0 }],
    obstacles,
    safeZone: null,
    tiles,
    colliders: noColliders(tiles),
  };
}

function player(id: string, x = 0, partyId = "party-a"): PlayerRuntime {
  const result = newPlayer(
    {
      id,
      nick: id,
      x,
      y: 32,
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
  result.facing = { x: 1, y: 0 };
  return result;
}

function monster(id: string, x: number): MonsterRuntime {
  const result = createMonsters([
    { id, kind: "goblin", species: "spear_goblin", zone: "route", x, y: 32, patrolRadius: 20 },
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

describe("authoritative Peasant support", () => {
  it("invalidates a frozen request after movement, facing, disconnect or epoch changes", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const world = terrain();
    const { camp, bomb } = supportSkills();
    const plans = basePeasantSupportPlans({ camp, bomb });
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
    owner.x += 1;
    expect(valid()).toBe(false);
    owner.x -= 1;
    owner.facing = { x: 0, y: 1 };
    expect(valid()).toBe(false);
    owner.facing = { x: 1, y: 0 };
    owner.authorized = false;
    expect(valid()).toBe(false);
    owner.authorized = true;
    owner.sessionEpoch += 1;
    expect(valid()).toBe(false);
  });

  it("keeps one camp per owner, pulses allies and applies only the strongest protection", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const ally = player("ally", 48);
    const outsider = player("outsider", 48, "party-b");
    const world = terrain();
    const plans = basePeasantSupportPlans(supportSkills());
    const first = placePeasantCamp(runtime, owner, "camp-a", { x: 48, y: 48 }, plans.camp, 1_000);
    const second = placePeasantCamp(
      runtime,
      owner,
      "camp-b",
      { x: 52, y: 48 },
      { ...plans.camp, protectionRatio: 0.2 },
      1_100,
    );
    expect(first?.replaced).toBeNull();
    expect(second?.replaced?.id).toBe("camp-a");
    expect(runtime.camps.map((camp) => camp.id)).toEqual(["camp-b"]);

    const heal = vi.fn();
    advancePeasantCamps({
      runtime,
      players: [owner, ally, outsider],
      terrain: world,
      now: 1_100,
      isOwnerActive: () => true,
      areAllies: (source, target) => source.partyId === target.partyId,
      heal,
    });
    expect(heal.mock.calls.map((call) => (call[2] as PlayerRuntime).id)).toEqual(["owner", "ally"]);
    expect(damageAfterPeasantCampProtection(ally, 20, runtime.camps, world, 1_100)).toBe(16);
    expect(damageAfterPeasantCampProtection(ally, 0, runtime.camps, world, 1_100)).toBe(0);

    advancePeasantCamps({
      runtime,
      players: [owner, ally],
      terrain: world,
      now: 1_200,
      isOwnerActive: () => false,
      areAllies: () => true,
      heal,
    });
    expect(runtime.camps).toEqual([]);
  });

  it("replays only active camps deterministically for admission and AOI catch-up", () => {
    const state = createWorldRoomState("party-a:map-a", null, null);
    const owner = player("owner");
    const plan = basePeasantSupportPlans(supportSkills()).camp;
    placePeasantCamp(state.peasantSupport, owner, "camp-a", { x: 48, y: 48 }, plan, 1_000);
    const send = vi.fn();
    const glue = { state, deps: { send } } as unknown as WorldGlue;

    sendPeasantCampsTo(glue, "connection-viewer", 1_001);
    sendPeasantCampsTo(glue, "connection-viewer", 1_001);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      t: "peasant.camp",
      id: "camp-a",
      startedAt: 1_000,
      expiresAt: 1_000 + plan.durationMs,
    });
    sendPeasantCampsTo(glue, "connection-viewer", 1_000 + plan.durationMs);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("creates one non-piercing bomb and resolves its authoritative AoE exactly once", () => {
    const runtime = createPeasantSupportRuntime();
    const owner = player("owner");
    const target = monster("target", 48);
    const world = terrain();
    const { camp, bomb } = supportSkills();
    const plans = basePeasantSupportPlans({ camp, bomb });
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
    expect(projectiles[0]).toMatchObject({ kind: "homemade_bomb", pierceRemaining: 0, power: 0 });

    const monsterGrid = new SpatialGrid<MonsterRuntime>(64);
    monsterGrid.insert(target);
    const playerGrid = new SpatialGrid<PlayerRuntime>(64);
    playerGrid.insert(owner);
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
    expect(explosionDamage).toHaveBeenCalledWith(target, plans.bomb.power);
    expect(impacts).toEqual([action.id]);
    expect(projectiles).toEqual([]);
  });
});
