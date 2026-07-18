import { describe, expect, it, vi } from "vitest";
import {
  advanceCombatActions,
  cancelCombatAction,
  startCombatAction,
} from "../src/server/world/combat-action-system.js";
import { guardedDamage } from "../src/server/world/combat-system.js";
import { movePlayerInDirection } from "../src/server/world/skill-system.js";
import { SpatialGrid } from "../src/server/world/spatial-grid.js";
import { newPlayer, type PlayerRuntime } from "../src/server/world/world-runtime.js";
import { starterEquipmentFor } from "../src/shared/character.js";
import type { TerrainGeometry } from "../src/shared/game.js";
import { tileMapFromRects } from "./support/tiles.js";

const OBSTACLES = [{ x: 80, y: 0, width: 20, height: 120 }];

const terrain: TerrainGeometry = {
  width: 400,
  height: 300,
  spawnPoints: [{ x: 10, y: 10 }],
  safeZone: { x: 0, y: 200, width: 100, height: 100 },
  obstacles: OBSTACLES,
  tiles: tileMapFromRects(400, 300, OBSTACLES),
};

function player(): PlayerRuntime {
  return newPlayer(
    {
      id: "player-1",
      nick: "Mira",
      x: 10,
      y: 10,
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

describe("isolated directional combat systems", () => {
  it("starts an action without an entity and resolves exactly once at its active frame", () => {
    const actor = player();
    const action = startCombatAction(actor, {
      kind: "basic",
      skillId: "cleave",
      slot: 1,
      direction: { x: 3, y: 0 },
      now: 1_000,
      anticipationMs: 220,
      recoveryMs: 430,
    });
    expect(action).toMatchObject({
      direction: { x: 1, y: 0 },
      impactAt: 1_220,
      recoveryEndsAt: 1_650,
      resolved: false,
    });

    const resolve = vi.fn();
    advanceCombatActions([actor], 1_219, resolve);
    expect(resolve).not.toHaveBeenCalled();
    advanceCombatActions([actor], 1_220, resolve);
    advanceCombatActions([actor], 1_400, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(actor.action?.resolved).toBe(true);
    advanceCombatActions([actor], 1_650, resolve);
    expect(actor.action).toBeNull();
  });

  it("keeps direction frozen, rejects overlap, and supports explicit cancellation", () => {
    const actor = player();
    const first = startCombatAction(actor, {
      kind: "skill",
      skillId: "shield_bash",
      slot: 3,
      direction: { x: 0, y: -1 },
      now: 2_000,
      anticipationMs: 180,
      recoveryMs: 480,
    });
    actor.facing = { x: 1, y: 0 };
    expect(first?.direction).toEqual({ x: 0, y: -1 });
    expect(
      startCombatAction(actor, {
        kind: "basic",
        skillId: "cleave",
        slot: 1,
        direction: actor.facing,
        now: 2_100,
        anticipationMs: 220,
        recoveryMs: 430,
      }),
    ).toBeNull();
    cancelCombatAction(actor);
    expect(actor.action).toBeNull();
  });

  it("resolves mobility in segments and does not cross a wall", () => {
    const actor = player();
    const grid = new SpatialGrid<PlayerRuntime>(64);
    grid.insert(actor);

    expect(movePlayerInDirection(actor, { x: 1, y: 0 }, 120, terrain, grid)).toBe(true);
    expect(actor.x).toBeLessThan(80);
    expect(grid.queryRadius(actor, 1)).toContain(actor);
  });

  it("preserves Iron Guard damage reduction", () => {
    const actor = player();
    actor.guardUntil = 5_000;
    actor.guardReduction = 0.5;
    expect(guardedDamage(actor, 25, 4_000)).toMatchObject({ amount: 13 });
    expect(guardedDamage(actor, 25, 5_000)).toMatchObject({ amount: 25 });
  });
});
