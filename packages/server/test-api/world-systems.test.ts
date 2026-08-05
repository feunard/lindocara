import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { PLAYER_ACTIONS } from "@lindocara/engine/combat-actions.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  advanceCombatActions,
  cancelCombatAction,
  finishHeldCombatAction,
  startCombatAction,
} from "@lindocara/server/world/combat-action-system.js";
import {
  applyGuardDamage,
  guardedDamage,
  isLumenCloudInvulnerable,
} from "@lindocara/server/world/combat-system.js";
import {
  heldMovementDirection,
  movePlayerInDirection,
  nearestChargeTarget,
} from "@lindocara/server/world/skill-system.js";
import {
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/server/world/terrain-access.js";
import {
  createGuards,
  type GroundIndexUpdate,
  newPlayer,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

/** Original PIXEL geometry over `TILE_SIZE`; positions are body centres. */
const t = (pixels: number): number => pixels / TILE_SIZE;

/**
 * The one capability `movePlayerInDirection` asks of the room's index. The grid itself still
 * indexes ground `x` against ELEVATION `y` and is Task 6's to convert; recording the calls is all
 * this suite ever needed from it.
 */
function recordingIndex(): GroundIndexUpdate<PlayerRuntime> & {
  calls: { entity: PlayerRuntime; previous: GroundVector }[];
} {
  const calls: { entity: PlayerRuntime; previous: GroundVector }[] = [];
  return {
    calls,
    update(entity, previous) {
      calls.push({ entity, previous });
    },
  };
}

function heightfield(options: {
  size: number;
  water?: (i: number, j: number) => boolean;
  colliders?: readonly ColliderRect[];
}): ZoneTerrain {
  const { size } = options;
  const levels: (number | null)[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) levels.push(options.water?.(i, j) ? null : 0);
  }
  const map: MapData = {
    version: 1,
    size,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels,
    materials: new Array(size * size).fill("herbe"),
    colliders: [...(options.colliders ?? [])],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/** A wall of props at `x ∈ [1.25, 1.56)`, the tile-unit twin of the old 80 px obstacle. */
const terrain = heightfield({
  size: 16,
  colliders: [{ x: t(80), z: -8, w: t(20), h: 16 }],
});

/** Open water filling the cells `x ∈ [-7, -5)`; the hero starts on the shore west of it. */
const lumenTerrain = heightfield({ size: 16, water: (i) => i === 1 || i === 2 });

/** A prop wall the size of a whole cell — the old "building" tile, as a collider. */
const buildingWallTerrain = heightfield({
  size: 16,
  colliders: [{ x: -6, z: -8, w: 1, h: 16 }],
});

function player(): PlayerRuntime {
  return newPlayer(
    {
      id: "player-1",
      nick: "Mira",
      x: t(10),
      y: 0,
      z: t(10),
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
      direction: { x: 3, z: 0 },
      now: 1_000,
      anticipationMs: 220,
      recoveryMs: 430,
    });
    expect(action).toMatchObject({
      direction: { x: 1, z: 0 },
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
      direction: { x: 0, z: -1 },
      now: 2_000,
      anticipationMs: 180,
      recoveryMs: 480,
    });
    actor.facing = { x: 1, z: 0 };
    expect(first?.direction).toEqual({ x: 0, z: -1 });
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
      direction: { x: 1, z: 0 },
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
    const grid = recordingIndex();

    expect(movePlayerInDirection(actor, { x: 1, z: 0 }, t(120), terrain, grid)).toBe(true);
    expect(actor.x).toBeLessThan(t(80));
    // Every accepted segment tells the index where the body was, so a converted grid re-buckets it.
    expect(grid.calls.length).toBeGreaterThan(0);
    expect(grid.calls.at(-1)?.entity).toBe(actor);
  });

  it("selects the nearest visible living charge target deterministically", () => {
    const targets = [
      { id: "far", x: t(180), z: t(10), deadUntil: 0 },
      { id: "dead", x: t(20), z: t(10), deadUntil: 2_000 },
      { id: "blocked", x: t(30), z: t(10), deadUntil: 0 },
      { id: "z-near", x: t(50), z: t(10), deadUntil: 0 },
      { id: "a-near", x: t(-30), z: t(10), deadUntil: 0 },
    ];
    expect(
      nearestChargeTarget(
        { x: t(10), z: t(10) },
        targets,
        t(100),
        1_000,
        (target) => target.id !== "blocked",
      )?.id,
    ).toBe("a-near");
  });

  it("moves Lumen Step only while a direction is actively held", () => {
    expect(heldMovementDirection({ up: false, down: false, left: false, right: false })).toBeNull();
    const diagonal = heldMovementDirection({ up: true, down: false, left: false, right: true });
    expect(diagonal?.x).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal?.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it("keeps a held Lumen action active until release and then appends recovery", () => {
    const actor = player();
    const action = startCombatAction(actor, {
      kind: "skill",
      skillId: "blink",
      slot: 3,
      direction: { x: 1, z: 0 },
      now: 1_000,
      anticipationMs: 180,
      recoveryMs: 420,
      mobilityDistance: t(247.5),
      channelDurationMs: 2_500,
    });
    expect(action).toMatchObject({
      impactAt: 1_180,
      channelMaxEndsAt: 3_500,
      recoveryEndsAt: 3_920,
      mobilityDistance: t(247.5),
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
      direction: { x: 1, z: 0 },
      now: 1_000,
      anticipationMs: 180,
      recoveryMs: 420,
      mobilityDistance: t(247.5),
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

  it("centralizes the service-guard one-HP floor", () => {
    const guard = createGuards([{ id: "service-guard", x: 0, y: 0, z: 0, patrolRadius: 1 }])[0];
    if (!guard) throw new Error("guard fixture missing");
    guard.hp = 10;

    expect(applyGuardDamage(guard, 4)).toEqual({ hp: 6, killed: false });
    expect(applyGuardDamage(guard, 99)).toEqual({ hp: 1, killed: false });
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

describe("lumen mobility terrain rules", () => {
  it("moves through water when Lumen is allowed but not with regular terrain resolution", () => {
    // Cells `i = 1, 2` are water: world `x ∈ [-7, -5)`. The hero starts on the shore at x = -7.4.
    const shore = -7.4;
    const actor = player();
    actor.x = shore;
    actor.z = 0;
    const grid = recordingIndex();

    movePlayerInDirection(actor, { x: 1, z: 0 }, 3, lumenTerrain, grid, true);
    const lumenPosition = actor.x;
    expect(lumenPosition).toBeGreaterThan(-5);

    actor.x = shore;
    movePlayerInDirection(actor, { x: 1, z: 0 }, 3, lumenTerrain, grid, false);
    expect(actor.x).toBeGreaterThan(shore);
    expect(actor.x).toBeLessThan(-7);
  });

  it("phases through building obstacles during Lumen movement", () => {
    // The prop wall fills `x ∈ [-6, -5)`; both heroes start two tiles west of it.
    const start = -8;
    const blockedWithLumen = player();
    blockedWithLumen.x = start;
    blockedWithLumen.z = 0;
    movePlayerInDirection(
      blockedWithLumen,
      { x: 1, z: 0 },
      3,
      buildingWallTerrain,
      recordingIndex(),
      true,
    );

    const blockedNormally = player();
    blockedNormally.x = start;
    blockedNormally.z = 0;
    movePlayerInDirection(
      blockedNormally,
      { x: 1, z: 0 },
      3,
      buildingWallTerrain,
      recordingIndex(),
      false,
    );
    expect(blockedWithLumen.x).toBeCloseTo(start + 3, 5);
    expect(blockedWithLumen.x).toBeGreaterThan(blockedNormally.x);
  });
});
