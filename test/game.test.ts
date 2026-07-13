import { describe, expect, it } from "vitest";
import {
  isEquipmentForClass,
  isValidAppearance,
  STARTER_EQUIPMENT,
  starterEquipmentFor,
} from "../src/shared/character.js";
import {
  CORPSE_RECLAIM_RANGE,
  canAct,
  canBeResurrected,
  canMove,
  canReclaim,
  RESURRECT_HP_RATIO,
  resurrectHp,
  speedForLife,
} from "../src/shared/death.js";
import {
  applyDamage,
  applyExperience,
  attackDamageFor,
  BOUNDARY_OBSTACLES,
  CEMETERIES,
  CITY_GUARDS,
  CLASS_STATS,
  clampRestoredPosition,
  hasLineOfSight,
  healAmountFor,
  INTERACTION_RANGE,
  isValidClass,
  isWalkable,
  MONSTER_AGGRO_RANGE,
  MONSTER_SPAWNS,
  MONSTER_STATS,
  maxHpForLevel,
  nearestCemetery,
  OBSTACLES,
  PLAYER_CLASSES,
  pointDistance,
  QUEST_DEFINITIONS,
  QUEST_NPC,
  QUEST_SITES,
  type Rect,
  resolveTerrain,
  SAFE_ZONE,
  SPAWN_POINTS,
  spawnPosition,
  TERRAIN_BLOCKERS,
  WORLD_BOUNDARY_DEPTH,
  WORLD_LANDMARKS,
  withinRange,
  xpForNextLevel,
} from "../src/shared/game.js";
import {
  PLAYER_SIZE,
  PLAYER_SPEED,
  TICK_DT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../src/shared/simulation.js";
import { isSkillUnlocked, SKILL_UNLOCK_LEVEL } from "../src/shared/skills.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import { tileMapFromRects } from "./support/tiles.js";

function expectValidRect(rect: Rect): void {
  expect(Number.isFinite(rect.x)).toBe(true);
  expect(Number.isFinite(rect.y)).toBe(true);
  expect(Number.isFinite(rect.width)).toBe(true);
  expect(Number.isFinite(rect.height)).toBe(true);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(WORLD_WIDTH);
  expect(rect.y + rect.height).toBeLessThanOrEqual(WORLD_HEIGHT);
}

function blocker(id: string): Rect {
  const match = TERRAIN_BLOCKERS.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`missing terrain blocker ${id}`);
  return match.rect;
}

function distanceToRect(position: { x: number; y: number }, rect: Rect): number {
  const dx = Math.max(rect.x - position.x, 0, position.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - position.y, 0, position.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * Design points (patrol rings, in particular) were tuned against pixel-exact rectangles. A 64px
 * tile cell can round a nearby wall's edge outward by up to one tile, so a point that used to
 * clear a wall by a few pixels can now sit just inside the coarsened cell. Rather than assert the
 * exact pixel is walkable, assert open ground is at most one tile-step away — the same tolerance
 * the grid itself introduced.
 */
function nearWalkable(position: { x: number; y: number }): boolean {
  if (isWalkable(position)) return true;
  const offsets = [
    { x: TILE_SIZE, y: 0 },
    { x: -TILE_SIZE, y: 0 },
    { x: 0, y: TILE_SIZE },
    { x: 0, y: -TILE_SIZE },
  ];
  return offsets.some((offset) =>
    isWalkable({ x: position.x + offset.x, y: position.y + offset.y }),
  );
}

const REACHABILITY_STEP = 64;

function sampleKey(position: { x: number; y: number }): string {
  return `${position.x},${position.y}`;
}

function reachableSamples(origin: { x: number; y: number }): Set<string> {
  const start = {
    x: Math.round(origin.x / REACHABILITY_STEP) * REACHABILITY_STEP,
    y: Math.round(origin.y / REACHABILITY_STEP) * REACHABILITY_STEP,
  };
  if (!isWalkable(start)) throw new Error("reachability origin needs a nearby walkable sample");

  const visited = new Set([sampleKey(start)]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (!current) continue;
    for (const [dx, dy] of [
      [REACHABILITY_STEP, 0],
      [-REACHABILITY_STEP, 0],
      [0, REACHABILITY_STEP],
      [0, -REACHABILITY_STEP],
    ] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = sampleKey(next);
      if (visited.has(key) || !isWalkable(next)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return visited;
}

function hasReachableSample(
  visited: ReadonlySet<string>,
  target: { x: number; y: number },
): boolean {
  const centerX = Math.round(target.x / REACHABILITY_STEP) * REACHABILITY_STEP;
  const centerY = Math.round(target.y / REACHABILITY_STEP) * REACHABILITY_STEP;
  for (let xOffset = -2; xOffset <= 2; xOffset++) {
    for (let yOffset = -2; yOffset <= 2; yOffset++) {
      const sample = {
        x: centerX + xOffset * REACHABILITY_STEP,
        y: centerY + yOffset * REACHABILITY_STEP,
      };
      if (pointDistance(sample, target) <= 128 && visited.has(sampleKey(sample))) return true;
    }
  }
  return false;
}

describe("authoritative world geometry", () => {
  it("expands the world to more than five times the original area", () => {
    expect(WORLD_WIDTH).toBe(4800);
    expect(WORLD_HEIGHT).toBe(2700);
    expect(WORLD_WIDTH * WORLD_HEIGHT).toBeGreaterThanOrEqual(5 * 1600 * 900);
  });

  it("derives collision geometry from boundaries, terrain and landmark colliders", () => {
    const landmarkColliders = WORLD_LANDMARKS.flatMap((landmark) =>
      landmark.collider === undefined ? [] : [landmark.collider],
    );
    expect(OBSTACLES).toEqual([
      ...BOUNDARY_OBSTACLES,
      ...TERRAIN_BLOCKERS.map((terrain) => terrain.rect),
      ...landmarkColliders,
    ]);

    for (const obstacle of OBSTACLES) {
      expectValidRect(obstacle);
      // Not the corner: the tile grid coarsens a wall's edge by up to one cell, and a corner
      // pixel of a small collider can land in a cell that rounds the other way. The middle of
      // every obstacle is still solidly inside the wall regardless of which way the grid rounds.
      expect(
        isWalkable({
          x: obstacle.x + obstacle.width / 2 - PLAYER_SIZE / 2,
          y: obstacle.y + obstacle.height / 2 - PLAYER_SIZE / 2,
        }),
      ).toBe(false);
      expect(Math.min(obstacle.width, obstacle.height)).toBeGreaterThan(PLAYER_SPEED * TICK_DT);
    }
  });

  it("gives every static world definition a unique id and valid extent", () => {
    const ids = [
      ...TERRAIN_BLOCKERS.map((terrain) => terrain.id),
      ...WORLD_LANDMARKS.map((landmark) => landmark.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(WORLD_LANDMARKS.map((landmark) => landmark.kind))).toEqual(
      new Set([
        "sacred_tree",
        "building",
        "farm",
        "ruin",
        "swamp_shrine",
        "dungeon_gate",
        "graveyard",
      ]),
    );
    expect(new Set(TERRAIN_BLOCKERS.map((terrain) => terrain.kind))).toEqual(
      new Set(["forest", "water", "cliff"]),
    );

    for (const landmark of WORLD_LANDMARKS) {
      expectValidRect(landmark);
      if (landmark.collider) expectValidRect(landmark.collider);
    }
    for (const terrain of TERRAIN_BLOCKERS) expectValidRect(terrain.rect);
  });

  it("uses coherent 96px collision masses on all four world limits", () => {
    expect(BOUNDARY_OBSTACLES).toEqual([
      { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_BOUNDARY_DEPTH },
      {
        x: 0,
        y: WORLD_HEIGHT - WORLD_BOUNDARY_DEPTH,
        width: WORLD_WIDTH,
        height: WORLD_BOUNDARY_DEPTH,
      },
      { x: 0, y: 0, width: WORLD_BOUNDARY_DEPTH, height: WORLD_HEIGHT },
      {
        x: WORLD_WIDTH - WORLD_BOUNDARY_DEPTH,
        y: 0,
        width: WORLD_BOUNDARY_DEPTH,
        height: WORLD_HEIGHT,
      },
    ]);
  });

  it("keeps the bridge, ford and forest meeting passage at least 160px usable", () => {
    const riverNorth = blocker("river-north-deepwater");
    const riverMiddle = blocker("river-middle-deepwater");
    const riverSouth = blocker("river-south-deepwater");
    const groveWest = blocker("clearing-south-grove-west");
    const groveEast = blocker("clearing-south-grove-east");

    const bridgeUsable = riverMiddle.y - (riverNorth.y + riverNorth.height) - PLAYER_SIZE;
    const fordUsable = riverSouth.y - (riverMiddle.y + riverMiddle.height) - PLAYER_SIZE;
    const forestPassageUsable = groveEast.x - (groveWest.x + groveWest.width) - PLAYER_SIZE;
    expect(bridgeUsable).toBeGreaterThanOrEqual(160);
    expect(fordUsable).toBeGreaterThanOrEqual(160);
    expect(forestPassageUsable).toBeGreaterThanOrEqual(160);
  });

  it("keeps every combat clearing and landmark approach connected to Heartroot", () => {
    const reachable = reachableSamples(spawnPosition("pathfinder"));
    for (const spawn of MONSTER_SPAWNS) {
      expect(hasReachableSample(reachable, spawn), `${spawn.id} should remain reachable`).toBe(
        true,
      );
    }
    for (const landmark of WORLD_LANDMARKS) {
      const approach = landmark.collider
        ? {
            x: landmark.collider.x + landmark.collider.width / 2 - PLAYER_SIZE / 2,
            y: landmark.collider.y + landmark.collider.height + 48,
          }
        : { x: landmark.x + landmark.width / 2, y: landmark.y + landmark.height / 2 };
      expect(
        hasReachableSample(reachable, approach),
        `${landmark.id} should keep a reachable approach`,
      ).toBe(true);
    }
  });

  it("provides deterministic, dispersed, walkable plaza spawns", () => {
    expect(SPAWN_POINTS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SPAWN_POINTS.map(({ x, y }) => `${x},${y}`)).size).toBe(SPAWN_POINTS.length);

    for (let index = 0; index < SPAWN_POINTS.length; index++) {
      const position = SPAWN_POINTS[index];
      if (!position) throw new Error("spawn grid unexpectedly sparse");
      expect(position.x).toBeGreaterThanOrEqual(SAFE_ZONE.x);
      expect(position.y).toBeGreaterThanOrEqual(SAFE_ZONE.y);
      expect(position.x + PLAYER_SIZE).toBeLessThanOrEqual(SAFE_ZONE.x + SAFE_ZONE.width);
      expect(position.y + PLAYER_SIZE).toBeLessThanOrEqual(SAFE_ZONE.y + SAFE_ZONE.height);
      expect(isWalkable(position)).toBe(true);

      for (let otherIndex = index + 1; otherIndex < SPAWN_POINTS.length; otherIndex++) {
        const other = SPAWN_POINTS[otherIndex];
        if (!other) throw new Error("spawn grid unexpectedly sparse");
        expect(pointDistance(position, other)).toBeGreaterThanOrEqual(96);
      }
    }

    expect(spawnPosition("same-player")).toEqual(spawnPosition("same-player"));
    expect(SPAWN_POINTS).toContainEqual(spawnPosition("same-player"));
    const distributed = new Set(
      Array.from({ length: 96 }, (_, index) => {
        const position = spawnPosition(`player-${index}`);
        return `${position.x},${position.y}`;
      }),
    );
    expect(distributed.size).toBeGreaterThanOrEqual(24);
  });

  it("keeps Elowen inside the safe hub but away from arrival stacks", () => {
    expect(isWalkable(QUEST_NPC)).toBe(true);
    expect(QUEST_NPC.x).toBeGreaterThanOrEqual(SAFE_ZONE.x);
    expect(QUEST_NPC.y).toBeGreaterThanOrEqual(SAFE_ZONE.y);
    expect(QUEST_NPC.x + PLAYER_SIZE).toBeLessThanOrEqual(SAFE_ZONE.x + SAFE_ZONE.width);
    expect(QUEST_NPC.y + PLAYER_SIZE).toBeLessThanOrEqual(SAFE_ZONE.y + SAFE_ZONE.height);
    expect(
      Math.min(...SPAWN_POINTS.map((spawn) => pointDistance(spawn, QUEST_NPC))),
    ).toBeGreaterThan(INTERACTION_RANGE);
  });

  it("places every quest giver and guard on walkable city ground", () => {
    for (const quest of QUEST_DEFINITIONS) {
      expect(isWalkable(quest.giver)).toBe(true);
      expect(distanceToRect(quest.giver, SAFE_ZONE)).toBe(0);
    }
    expect(CITY_GUARDS).toHaveLength(4);
    for (const guard of CITY_GUARDS) {
      expect(isWalkable(guard)).toBe(true);
      expect(distanceToRect(guard, SAFE_ZONE)).toBe(0);
      expect(guard.patrolRadius).toBeLessThanOrEqual(Math.min(SAFE_ZONE.width, SAFE_ZONE.height));
    }
  });

  it("places a modest, zone-balanced monster population in open patrol clearings", () => {
    expect(MONSTER_SPAWNS.length).toBeGreaterThanOrEqual(12);
    expect(MONSTER_SPAWNS.length).toBeLessThanOrEqual(16);
    expect(new Set(MONSTER_SPAWNS.map((spawn) => spawn.id)).size).toBe(MONSTER_SPAWNS.length);
    expect(new Set(MONSTER_SPAWNS.map((spawn) => spawn.zone))).toEqual(
      new Set(["route", "clearing", "forest", "farm", "ruins", "swamp", "gate"]),
    );
    expect(new Set(MONSTER_SPAWNS.map((spawn) => spawn.kind))).toEqual(
      new Set(["goblin", "orc", "ogre", "skeleton", "troll"]),
    );

    for (const spawn of MONSTER_SPAWNS) {
      expect(isWalkable(spawn)).toBe(true);
      if (spawn.mayEnterSafeZone) {
        expect(distanceToRect(spawn, SAFE_ZONE)).toBeLessThanOrEqual(spawn.patrolRadius);
      } else {
        expect(distanceToRect(spawn, SAFE_ZONE)).toBeGreaterThan(
          MONSTER_AGGRO_RANGE + spawn.patrolRadius,
        );
      }
      for (let sample = 0; sample < 16; sample++) {
        const angle = (sample / 16) * Math.PI * 2;
        const patrolSample = {
          x: spawn.x + Math.cos(angle) * spawn.patrolRadius,
          y: spawn.y + Math.sin(angle) * spawn.patrolRadius,
        };
        if (!spawn.mayEnterSafeZone) {
          expect(nearWalkable(patrolSample), `${spawn.id} patrol sample ${sample}`).toBe(true);
        }
      }
    }
  });

  it("spreads a four-chapter quest arc and ordered interactions across the world", () => {
    expect(QUEST_DEFINITIONS.map((quest) => quest.id)).toEqual([
      "three_offerings",
      "bone_choir",
      "mire_runes",
      "ward_run",
    ]);
    expect(QUEST_SITES).toHaveLength(11);
    expect(new Set(QUEST_SITES.map((site) => site.id)).size).toBe(QUEST_SITES.length);

    const reachable = reachableSamples(spawnPosition("quest-pathfinder"));
    for (const quest of QUEST_DEFINITIONS) {
      expect(quest.giver.x).toBeGreaterThanOrEqual(SAFE_ZONE.x);
      expect(quest.giver.y).toBeGreaterThanOrEqual(SAFE_ZONE.y);
      expect(quest.giver.x + PLAYER_SIZE).toBeLessThanOrEqual(SAFE_ZONE.x + SAFE_ZONE.width);
      expect(quest.giver.y + PLAYER_SIZE).toBeLessThanOrEqual(SAFE_ZONE.y + SAFE_ZONE.height);
      expect(
        hasReachableSample(reachable, quest.giver),
        `${quest.id} giver should be reachable`,
      ).toBe(true);
    }
    for (const site of QUEST_SITES) {
      expect(hasReachableSample(reachable, site), `${site.id} should be reachable`).toBe(true);
      expect(isWalkable(site), `${site.id} should be interactable from open terrain`).toBe(true);
    }

    for (const kind of ["goblin", "orc", "ogre", "skeleton", "troll"] as const) {
      expect(MONSTER_STATS[kind].maxHp).toBeGreaterThan(0);
      expect(MONSTER_STATS[kind].damage).toBeGreaterThan(0);
      expect(MONSTER_STATS[kind].xp).toBeGreaterThan(0);
    }
  });

  it("preserves legacy positions that remain walkable", () => {
    for (const legacy of [
      // x: 223.5, not 123.5 — the tile grid coarsens the left boundary wall out to the nearest
      // solid cell, past where this fractional legacy coordinate used to clear it.
      { x: 223.5, y: 456.25 },
      { x: 321, y: 432 },
      { x: 784, y: 450 },
    ]) {
      expect(isWalkable(legacy)).toBe(true);
      expect(clampRestoredPosition(legacy, "legacy-player")).toEqual(legacy);
    }
  });

  it.each([
    { x: Number.NaN, y: 500 },
    { x: 500, y: Number.NaN },
    { x: Number.POSITIVE_INFINITY, y: 500 },
    { x: 500, y: Number.NEGATIVE_INFINITY },
  ])("rejects non-finite restored coordinates", (position) => {
    expect(clampRestoredPosition(position, "corrupt-player")).toEqual(
      spawnPosition("corrupt-player"),
    );
  });

  it("falls back deterministically for blocked or out-of-world restored coordinates", () => {
    const blocked = WORLD_LANDMARKS.find((landmark) => landmark.collider)?.collider;
    if (!blocked) throw new Error("test world needs a landmark collider");
    const expected = spawnPosition("returning-player");
    expect(
      clampRestoredPosition({ x: blocked.x + 1, y: blocked.y + 1 }, "returning-player"),
    ).toEqual(expected);
    expect(clampRestoredPosition({ x: -100, y: 500 }, "returning-player")).toEqual(expected);
    expect(clampRestoredPosition({ x: WORLD_WIDTH + 100, y: 500 }, "returning-player")).toEqual(
      expected,
    );
  });

  it("blocks terrain while preserving movement on the free axis", () => {
    const wall = blocker("river-middle-deepwater");
    const y = wall.y + 60;
    // The tile grid coarsens the wall's left edge out from `wall.x` to the nearest solid cell,
    // so walk in from a safely clear distance to find the actual last walkable x, rather than
    // assuming pixel-exact rectangle math still holds.
    let x = wall.x - PLAYER_SIZE - TILE_SIZE;
    while (isWalkable({ x: x + 1, y })) x += 1;
    const from = { x, y };
    const resolved = resolveTerrain(from, { x: from.x + 10, y: from.y + 15 });
    expect(resolved.x).toBe(from.x);
    expect(resolved.y).toBeGreaterThan(from.y);
    expect(isWalkable(resolved)).toBe(true);
  });
});

describe("authoritative combat and progression rules", () => {
  it("levels across multiple thresholds and keeps leftover XP", () => {
    const gained = xpForNextLevel(1) + xpForNextLevel(2) + 17;
    expect(applyExperience(1, 0, gained)).toEqual({ level: 3, xp: 17, levelsGained: 2 });
  });

  it("increases health with level", () => {
    expect(maxHpForLevel(5)).toBeGreaterThan(maxHpForLevel(1));
  });

  it("applies combat damage without allowing healing or negative HP", () => {
    expect(applyDamage(50, 12)).toEqual({ hp: 38, killed: false });
    expect(applyDamage(10, 999)).toEqual({ hp: 0, killed: true });
    expect(applyDamage(50, -100)).toEqual({ hp: 50, killed: false });
  });

  it("validates combat and interaction range geometrically", () => {
    expect(withinRange({ x: 0, y: 0 }, { x: 30, y: 40 }, 50)).toBe(true);
    expect(withinRange({ x: 0, y: 0 }, { x: 30, y: 40 }, 49)).toBe(false);
  });

  it("checks line of sight from entity centers against blocking tiles", () => {
    // Tile-aligned so the rasteriser (any-overlap; see test/support/tiles.ts) marks exactly one
    // cell solid, at column 2 / row 2 — this isolates the row the first check crosses from the
    // row the second doesn't, rather than depending on how a non-aligned rect coarsens.
    const wall = { x: 128, y: 128, width: 64, height: 64 };
    const tiles = tileMapFromRects(320, 256, [wall]);
    expect(hasLineOfSight({ x: 20, y: 150 }, { x: 300, y: 150 }, tiles)).toBe(false);
    expect(hasLineOfSight({ x: 20, y: 10 }, { x: 300, y: 10 }, tiles)).toBe(true);
  });

  it("uses world obstacles for line-of-sight blockers", () => {
    const hall = WORLD_LANDMARKS.find((landmark) => landmark.id === "crossing-hall")?.collider;
    if (!hall) throw new Error("crossing hall collider missing");

    expect(
      hasLineOfSight({ x: hall.x - 70, y: hall.y + 40 }, { x: hall.x + 320, y: hall.y + 40 }),
    ).toBe(false);
    expect(
      hasLineOfSight({ x: hall.x - 70, y: hall.y - 80 }, { x: hall.x + 320, y: hall.y - 80 }),
    ).toBe(true);
  });
});

describe("class rules", () => {
  it("unlocks the five ability slots at the intended progression levels", () => {
    expect(SKILL_UNLOCK_LEVEL).toEqual({ 1: 1, 2: 3, 3: 5, 4: 7, 5: 10 });
    expect(isSkillUnlocked(1, 1)).toBe(true);
    expect(isSkillUnlocked(2, 2)).toBe(false);
    expect(isSkillUnlocked(3, 2)).toBe(true);
    expect(isSkillUnlocked(5, 3)).toBe(true);
    expect(isSkillUnlocked(7, 4)).toBe(true);
    expect(isSkillUnlocked(9, 5)).toBe(false);
    expect(isSkillUnlocked(10, 5)).toBe(true);
  });

  it("maps every class to one coherent starter loadout", () => {
    expect(starterEquipmentFor("warrior")).toEqual({
      mainHand: "weathered_sword",
      offHand: "oak_shield",
    });
    expect(starterEquipmentFor("ranger")).toEqual({ mainHand: "hunter_bow", offHand: null });
    expect(starterEquipmentFor("priest")).toEqual({
      mainHand: "heartwood_staff",
      offHand: null,
    });
    for (const playerClass of PLAYER_CLASSES) {
      expect(isEquipmentForClass(STARTER_EQUIPMENT[playerClass], playerClass)).toBe(true);
    }
  });

  it("validates only renderable structured appearances", () => {
    expect(isValidAppearance({ body: "wayfarer", primaryColor: "violet" })).toBe(true);
    expect(isValidAppearance({ body: "giant", primaryColor: "violet" })).toBe(false);
    expect(isValidAppearance({ body: "wayfarer", primaryColor: "plaid" })).toBe(false);
    expect(isValidAppearance("azure")).toBe(false);
  });

  it("keeps the balance table in the spec's shape", () => {
    expect(PLAYER_CLASSES).toEqual(["warrior", "ranger", "priest"]);
    expect(CLASS_STATS.warrior).toMatchObject({
      attackBase: 30,
      attackPerLevel: 4,
      attackRange: 60,
    });
    expect(CLASS_STATS.ranger).toMatchObject({
      attackBase: 16,
      attackPerLevel: 2,
      attackRange: 170,
    });
    expect(CLASS_STATS.priest).toMatchObject({
      attackBase: 14,
      attackPerLevel: 2,
      attackRange: 100,
    });
    expect(CLASS_STATS.priest.heal).toEqual({
      base: 35,
      perLevel: 3,
      range: 130,
      cooldownMs: 1500,
    });
    expect(CLASS_STATS.warrior.heal).toBeUndefined();
  });

  it("scales damage and healing by level", () => {
    expect(attackDamageFor("warrior", 1)).toBe(30);
    expect(attackDamageFor("warrior", 3)).toBe(38);
    expect(attackDamageFor("ranger", 1)).toBe(16);
    expect(attackDamageFor("priest", 5)).toBe(22);
    expect(healAmountFor(1)).toBe(35);
    expect(healAmountFor(4)).toBe(44);
  });

  it("validates class names", () => {
    expect(isValidClass("priest")).toBe(true);
    expect(isValidClass("necromancer")).toBe(false);
    expect(isValidClass(3)).toBe(false);
  });
});

describe("cemeteries", () => {
  it("plants every spirit anchor on ground a ghost can actually stand on", () => {
    // A ghost materialising inside a chapel wall would be stuck there forever.
    for (const cemetery of CEMETERIES) {
      expect(isWalkable(cemetery)).toBe(true);
    }
  });

  it("spreads them out, so no corner of the map is a long commute", () => {
    expect(CEMETERIES.length).toBeGreaterThanOrEqual(3);
    for (const a of CEMETERIES) {
      for (const b of CEMETERIES) {
        if (a.id === b.id) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(600);
      }
    }
  });

  it("sends a spirit to the nearest one, not merely to a fixed one", () => {
    for (const cemetery of CEMETERIES) {
      // Standing on a cemetery, the nearest cemetery is the one you are standing on.
      expect(nearestCemetery({ x: cemetery.x, y: cemetery.y }).id).toBe(cemetery.id);
    }
    const west = nearestCemetery({ x: 0, y: 0 });
    const east = nearestCemetery({ x: WORLD_WIDTH - PLAYER_SIZE, y: WORLD_HEIGHT - PLAYER_SIZE });
    expect(west.id).not.toBe(east.id);
  });
});

describe("the death state machine", () => {
  it("freezes a corpse and hurries a ghost", () => {
    expect(speedForLife("alive")).toBe(PLAYER_SPEED);
    expect(speedForLife("corpse")).toBe(0);
    expect(speedForLife("ghost")).toBeGreaterThan(PLAYER_SPEED);
  });

  it("lets a ghost move but never act", () => {
    expect(canMove("alive")).toBe(true);
    expect(canMove("ghost")).toBe(true);
    expect(canMove("corpse")).toBe(false);

    expect(canAct("alive")).toBe(true);
    expect(canAct("ghost")).toBe(false);
    expect(canAct("corpse")).toBe(false);
  });

  it("only a body can be raised — releasing is one-way", () => {
    expect(canBeResurrected("corpse")).toBe(true);
    expect(canBeResurrected("ghost")).toBe(false);
    expect(canBeResurrected("alive")).toBe(false);
  });

  it("charges the same toll whichever way you come back", () => {
    const hp = resurrectHp(1);
    expect(hp).toBe(Math.round(maxHpForLevel(1) * RESURRECT_HP_RATIO));
    expect(hp).toBeGreaterThan(0);
    expect(hp).toBeLessThan(maxHpForLevel(1));
  });

  it("reclaims only your own body, and only within arm's reach", () => {
    const corpse = { x: 1000, y: 1000 };
    expect(canReclaim("ghost", corpse, corpse)).toBe(true);
    expect(canReclaim("ghost", { x: 1000 + CORPSE_RECLAIM_RANGE - 1, y: 1000 }, corpse)).toBe(true);
    expect(canReclaim("ghost", { x: 1000 + CORPSE_RECLAIM_RANGE + 1, y: 1000 }, corpse)).toBe(
      false,
    );
    // The living do not reclaim, and a body with no ghost has nobody to reclaim it.
    expect(canReclaim("alive", corpse, corpse)).toBe(false);
    expect(canReclaim("corpse", corpse, corpse)).toBe(false);
    expect(canReclaim("ghost", corpse, null)).toBe(false);
  });
});
