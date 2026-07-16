import { describe, expect, it } from "vitest";
import {
  attemptBasicAttack,
  resolveAttackTarget,
  resolveFriendlyTarget,
} from "../src/server/world/combat-system.js";
import { movePlayerInDirection } from "../src/server/world/skill-system.js";
import { SpatialGrid } from "../src/server/world/spatial-grid.js";
import {
  createGuards,
  createMonsters,
  newPlayer,
  type PlayerRuntime,
} from "../src/server/world/world-runtime.js";
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

describe("isolated world systems", () => {
  it("consumes the basic-attack cooldown only after accepting a living visible target", () => {
    const actor = player();
    const monsters = createMonsters([
      {
        id: "visible",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 40,
        y: 10,
        patrolRadius: 20,
      },
    ]);
    expect(attemptBasicAttack(actor, monsters, "visible", 80, 1_000, terrain)).toMatchObject({
      kind: "accepted",
      target: { id: "visible" },
    });
    expect(actor.lastAttackAt).toBe(1_000);
    expect(attemptBasicAttack(actor, monsters, "visible", 80, 1_001, terrain)).toEqual({
      kind: "unavailable",
    });
  });

  it("does not consume cooldown for far, blocked, dead or unknown targets", () => {
    const actor = player();
    const monsters = createMonsters([
      {
        id: "blocked",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 100,
        y: 10,
        patrolRadius: 20,
      },
      {
        id: "far",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 250,
        y: 10,
        patrolRadius: 20,
      },
      {
        id: "dead",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 40,
        y: 10,
        patrolRadius: 20,
      },
    ]);
    const dead = monsters.find((monster) => monster.id === "dead");
    if (!dead) throw new Error("dead fixture missing");
    dead.deadUntil = 2_000;

    expect(attemptBasicAttack(actor, monsters, "far", 120, 1_000, terrain)).toEqual({
      kind: "rejected",
      blockedInRange: false,
    });
    expect(attemptBasicAttack(actor, monsters, "blocked", 120, 1_000, terrain)).toEqual({
      kind: "rejected",
      blockedInRange: true,
    });
    expect(attemptBasicAttack(actor, monsters, "dead", 120, 1_000, terrain)).toEqual({
      kind: "rejected",
      blockedInRange: false,
    });
    expect(attemptBasicAttack(actor, monsters, "unknown", 120, 1_000, terrain)).toEqual({
      kind: "rejected",
      blockedInRange: false,
    });
    expect(actor.lastAttackAt).toBe(0);
  });

  it("accepts a valid attack immediately after a rejected one", () => {
    const actor = player();
    const monsters = createMonsters([
      {
        id: "visible-after-failure",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 40,
        y: 10,
        patrolRadius: 20,
      },
    ]);
    expect(attemptBasicAttack(actor, monsters, "missing", 80, 1_000, terrain).kind).toBe(
      "rejected",
    );
    expect(
      attemptBasicAttack(actor, monsters, "visible-after-failure", 80, 1_000, terrain).kind,
    ).toBe("accepted");
  });

  it("reports a line-of-sight-blocked attack without selecting the monster", () => {
    const actor = player();
    const monsters = createMonsters([
      {
        id: "goblin-1",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 80,
        y: 10,
        patrolRadius: 20,
      },
    ]);

    expect(resolveAttackTarget(actor, monsters, "goblin-1", 120, 1, terrain)).toEqual({
      target: undefined,
      blockedInRange: true,
    });
  });

  it("never substitutes a nearby monster for the requested target", () => {
    const actor = player();
    const monsters = createMonsters([
      {
        id: "nearby",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 40,
        y: 10,
        patrolRadius: 20,
      },
      {
        id: "requested-but-far",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 250,
        y: 10,
        patrolRadius: 20,
      },
    ]);

    expect(resolveAttackTarget(actor, monsters, "requested-but-far", 80, 1, terrain)).toEqual({
      target: undefined,
      blockedInRange: false,
    });
  });

  it("resolves mobility skills in segments and does not cross a wall", () => {
    const actor = player();
    const grid = new SpatialGrid<PlayerRuntime>(64);
    grid.insert(actor);

    expect(movePlayerInDirection(actor, { x: 1, y: 0 }, 120, terrain, grid)).toBe(true);
    expect(actor.x).toBeLessThan(80);
    expect(grid.queryRadius(actor, 1)).toContain(actor);
  });

  it("resolves guards as authoritative friendly heal targets with their own health", () => {
    const guards = createGuards([{ id: "guard-west", x: 30, y: 30, patrolRadius: 100 }]);
    const selection = resolveFriendlyTarget(new Map(), new Map(), guards, "guard-west");

    expect(selection).toMatchObject({ kind: "guard", maxHp: 220 });
    expect(selection?.target.hp).toBe(220);
    if (selection) selection.target.hp -= 35;
    expect(guards[0]?.hp).toBe(185);
  });
});
