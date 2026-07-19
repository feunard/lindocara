import { describe, expect, it, vi } from "vitest";
import {
  advanceCombatActions,
  cancelCombatAction,
  finishHeldCombatAction,
  startCombatAction,
} from "../src/server/world/combat-action-system.js";
import { guardedDamage, isLumenCloudInvulnerable } from "../src/server/world/combat-system.js";
import {
  heldMovementDirection,
  movePlayerInDirection,
  nearestChargeTarget,
} from "../src/server/world/skill-system.js";
import { SpatialGrid } from "../src/server/world/spatial-grid.js";
import { newPlayer, type PlayerRuntime } from "../src/server/world/world-runtime.js";
import { starterEquipmentFor } from "../src/shared/character.js";
import { PLAYER_ACTIONS } from "../src/shared/combat-actions.js";
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

  it("accepts Radiant Bolt exactly when its 325 ms action timeline ends", () => {
    const actor = player();
    const definition = PLAYER_ACTIONS.priest[0];
    if (!definition) throw new Error("missing Radiant Bolt action");
    const options = {
      kind: "basic" as const,
      skillId: definition.skillId,
      slot: 1,
      direction: { x: 1, y: 0 },
      anticipationMs: definition.anticipationMs,
      recoveryMs: definition.recoveryMs,
    };
    const first = startCombatAction(actor, { ...options, now: 1_000 });
    expect(first?.impactAt).toBe(1_140);
    expect(first?.recoveryEndsAt).toBe(1_325);

    advanceCombatActions([actor], 1_324, () => undefined);
    expect(startCombatAction(actor, { ...options, now: 1_324 })).toBeNull();

    advanceCombatActions([actor], 1_325, () => undefined);
    expect(startCombatAction(actor, { ...options, now: 1_325 })).not.toBeNull();
  });

  it("resolves mobility in segments and does not cross a wall", () => {
    const actor = player();
    const grid = new SpatialGrid<PlayerRuntime>(64);
    grid.insert(actor);

    expect(movePlayerInDirection(actor, { x: 1, y: 0 }, 120, terrain, grid)).toBe(true);
    expect(actor.x).toBeLessThan(80);
    expect(grid.queryRadius(actor, 1)).toContain(actor);
  });

  it("selects the nearest visible living charge target deterministically", () => {
    const targets = [
      { id: "far", x: 180, y: 10, deadUntil: 0 },
      { id: "dead", x: 20, y: 10, deadUntil: 2_000 },
      { id: "blocked", x: 30, y: 10, deadUntil: 0 },
      { id: "z-near", x: 50, y: 10, deadUntil: 0 },
      { id: "a-near", x: -30, y: 10, deadUntil: 0 },
    ];
    expect(
      nearestChargeTarget(
        { x: 10, y: 10 },
        targets,
        100,
        1_000,
        (target) => target.id !== "blocked",
      )?.id,
    ).toBe("a-near");
  });

  it("moves Lumen Step only while a direction is actively held", () => {
    expect(heldMovementDirection({ up: false, down: false, left: false, right: false })).toBeNull();
    const diagonal = heldMovementDirection({ up: true, down: false, left: false, right: true });
    expect(diagonal?.x).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal?.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("keeps a held Lumen action active until release and then appends recovery", () => {
    const actor = player();
    const action = startCombatAction(actor, {
      kind: "skill",
      skillId: "blink",
      slot: 3,
      direction: { x: 1, y: 0 },
      now: 1_000,
      anticipationMs: 180,
      recoveryMs: 420,
      mobilityDistance: 247.5,
      channelDurationMs: 2_500,
    });
    expect(action).toMatchObject({
      impactAt: 1_180,
      channelMaxEndsAt: 3_500,
      recoveryEndsAt: 3_920,
      mobilityDistance: 247.5,
    });
    expect(finishHeldCombatAction(actor, 1_600, 2)).toBe(false);
    expect(finishHeldCombatAction(actor, 1_600, 3)).toBe(true);
    expect(action).toMatchObject({ channelEndsAt: 1_600, recoveryEndsAt: 2_020 });
    expect(finishHeldCombatAction(actor, 1_700, 3)).toBe(false);
  });

  it("makes only the active Lumen cloud invulnerable", () => {
    const actor = player();
    actor.class = "priest";
    const action = startCombatAction(actor, {
      kind: "skill",
      skillId: "blink",
      slot: 3,
      direction: { x: 1, y: 0 },
      now: 1_000,
      anticipationMs: 180,
      recoveryMs: 420,
      mobilityDistance: 247.5,
      channelDurationMs: 2_500,
    });
    expect(action).not.toBeNull();
    expect(isLumenCloudInvulnerable(actor, 1_179)).toBe(false);
    expect(isLumenCloudInvulnerable(actor, 1_180)).toBe(true);
    expect(isLumenCloudInvulnerable(actor, 2_000)).toBe(true);
    expect(finishHeldCombatAction(actor, 2_000, 3)).toBe(true);
    expect(isLumenCloudInvulnerable(actor, 2_000)).toBe(false);
    expect(isLumenCloudInvulnerable(actor, 2_200)).toBe(false);
  });

  it("preserves Iron Guard damage reduction", () => {
    const actor = player();
    actor.guarding = true;
    actor.guardReduction = 0.5;
    expect(guardedDamage(actor, 25)).toMatchObject({ amount: 13 });
    actor.guarding = false;
    expect(guardedDamage(actor, 25)).toMatchObject({ amount: 25 });
  });

  it("makes a talented Iron Guard activation a frame-perfect zero-damage parry", () => {
    const actor = player();
    actor.level = 10;
    actor.guarding = true;
    actor.guardReduction = 0.6;
    actor.guardActivatedAt = 1_000;
    actor.talents = [
      "warrior.iron_guard.fortified",
      "warrior.iron_guard.perfect",
      "warrior.iron_guard.readiness",
      "warrior.iron_guard.riposte",
    ];

    expect(guardedDamage(actor, 40, 1_220)).toMatchObject({
      amount: 0,
      parried: true,
      retaliationRatio: 1,
    });
    expect(guardedDamage(actor, 40, 1_221)).toMatchObject({
      amount: 16,
      parried: false,
    });
  });
});
