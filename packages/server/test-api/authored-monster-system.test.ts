import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { RUNNER_PURSUER_TUNING } from "@lindocara/engine/game.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { DEFAULT_NPC_MODEL_ASSET_ID } from "@lindocara/engine/tiny-swords-catalog.js";
import { undergroundColliders, undergroundFloorHeight } from "@lindocara/engine/underground.js";
import { describe, expect, it } from "vitest";

import {
  activeAuthoredMonsterDefinitions,
  reconcileActiveMonsters,
} from "../src/world/authored-monster-system.js";
import { createMonsters } from "../src/world/world-runtime.js";

const MONSTER_EVENT_ID = "22222222-2222-4222-8222-222222222222";

function state(switches: Record<string, boolean> = {}): PartyAdventureState {
  return { switches, variables: {}, selfSwitches: {} };
}

function conditionalMonster(): MapEvent {
  const event = functionalEvent({
    id: MONSTER_EVENT_ID,
    col: 11,
    row: 6,
    ordinal: 1,
    kind: "monster",
    name: "Varkesh",
    species: "skull_warden",
    patrolRadius: 120,
    monsterTuning: { rank: "boss", maxHp: 1_400 },
  });
  const base = event.pages[0] ?? defaultEventPage();
  return {
    ...event,
    pages: [
      { ...base, condSwitchId: "0075" },
      { ...base, condSwitchId: "0076", graphicAssetId: DEFAULT_NPC_MODEL_ASSET_ID },
    ],
  };
}

const GRID_SIZE = 32;

describe("authored monster projection", () => {
  it("keeps a narrative encounter absent until one of its conditional pages holds", () => {
    const event = conditionalMonster();

    expect(activeAuthoredMonsterDefinitions([event], state(), GRID_SIZE)).toEqual([]);
    expect(activeAuthoredMonsterDefinitions([event], state({ "0076": true }), GRID_SIZE)).toEqual([
      expect.objectContaining({
        id: `mon-${MONSTER_EVENT_ID}`,
        name: "Varkesh",
        species: "skull_warden",
        rank: "boss",
        maxHp: 1_400,
        x: 11.5 - GRID_SIZE / 2,
        y: 0,
        z: 6.5 - GRID_SIZE / 2,
        // Authored in PIXELS on the event, read in TILE UNITS by the runtime.
        patrolRadius: 120 / TILE_SIZE,
        graphicAssetId: DEFAULT_NPC_MODEL_ASSET_ID,
      }),
    ]);
  });

  it("keeps the active page appearance on the runtime monster", () => {
    const definition = activeAuthoredMonsterDefinitions(
      [conditionalMonster()],
      state({ "0076": true }),
      GRID_SIZE,
    )[0];
    if (!definition) throw new Error("monster definition missing");
    const monster = createMonsters([definition])[0];
    expect(monster?.graphicAssetId).toBe(DEFAULT_NPC_MODEL_ASSET_ID);
    expect(monster?.attackProfile).toBe("melee");
  });

  it("keeps an underground encounter on its authored storey", () => {
    const underground = { ...conditionalMonster(), undergroundDepth: 2 };
    const definition = activeAuthoredMonsterDefinitions(
      [underground],
      state({ "0075": true }),
      GRID_SIZE,
    )[0];
    if (!definition) throw new Error("monster definition missing");

    expect(definition.y).toBeLessThan(0);
    expect(createMonsters([definition])[0]).toMatchObject({
      y: definition.y,
      spawnY: definition.y,
    });
  });

  it("spawns on raised terrain painted inside its underground storey", () => {
    const underground = {
      levels: [
        {
          depth: 2,
          style: "cave" as const,
          cells: [{ col: 11, row: 6, length: 2 }],
          terrain: [
            { col: 11, row: 6, length: 2, material: "grotte" as const, elevation: 1 as const },
          ],
        },
      ],
      stairs: [],
      shafts: [],
    };
    const terrain = zoneTerrainFromHeightfield({
      version: 1,
      size: GRID_SIZE,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: new Array<number | null>(GRID_SIZE * GRID_SIZE).fill(0),
      materials: new Array(GRID_SIZE * GRID_SIZE).fill("herbe"),
      colliders: undergroundColliders(underground, GRID_SIZE),
      spawns: [],
      elements: [],
      events: [],
      underground,
    });
    const event = { ...conditionalMonster(), undergroundDepth: 2 };

    const definition = activeAuthoredMonsterDefinitions(
      [event],
      state({ "0075": true }),
      terrain,
    )[0];

    expect(definition?.y).toBeCloseTo(undergroundFloorHeight(2) + terrain.levelHeight);
    expect(createMonsters(definition ? [definition] : [])[0]?.spawnY).toBeCloseTo(
      undergroundFloorHeight(2) + terrain.levelHeight,
    );
  });

  it("keeps appearance visual while projecting an explicit attack profile", () => {
    const visualOnly = conditionalMonster();
    const explicitArcher = { ...visualOnly, monsterAttackProfile: "arrow" as const };
    const natural = activeAuthoredMonsterDefinitions(
      [visualOnly],
      state({ "0076": true }),
      GRID_SIZE,
    )[0];
    const archer = activeAuthoredMonsterDefinitions(
      [explicitArcher],
      state({ "0076": true }),
      GRID_SIZE,
    )[0];
    if (!natural || !archer) throw new Error("monster definition missing");

    expect(natural.graphicAssetId).toBe(archer.graphicAssetId);
    expect(createMonsters([natural])[0]?.attackProfile).toBe("melee");
    expect(createMonsters([archer])[0]?.attackProfile).toBe("arrow");
  });

  it("projects the reusable relentless one-hit pursuer settings", () => {
    const runner = {
      ...conditionalMonster(),
      monsterPursuitMode: "relentless" as const,
      monsterAcceleration: 0.8,
      monsterMaxSpeed: 5.5,
      monsterOneHitKill: true,
    };
    const definition = activeAuthoredMonsterDefinitions(
      [runner],
      state({ "0075": true }),
      GRID_SIZE,
    )[0];
    if (!definition) throw new Error("monster definition missing");
    expect(definition).toMatchObject({
      pursuitMode: "relentless",
      acceleration: 0.8,
      maxSpeed: 5.5,
      oneHitKill: true,
    });
    expect(createMonsters([definition])[0]).toMatchObject({
      pursuitMode: "relentless",
      acceleration: 0.8,
      maxSpeed: 5.5,
      oneHitKill: true,
    });
  });

  it("upgrades one-hit war pigs from older maps to current runner pursuit tuning", () => {
    const legacyRunner = {
      ...conditionalMonster(),
      species: "war_pig" as const,
      monsterSpeed: 2,
      monsterPursuitMode: "standard" as const,
      monsterAcceleration: 0,
      monsterMaxSpeed: 2.5,
      monsterOneHitKill: true,
    };
    const definition = activeAuthoredMonsterDefinitions(
      [legacyRunner],
      state({ "0075": true }),
      GRID_SIZE,
    )[0];

    expect(definition).toMatchObject({
      species: "war_pig",
      speed: RUNNER_PURSUER_TUNING.speed,
      pursuitMode: "relentless",
      acceleration: RUNNER_PURSUER_TUNING.acceleration,
      maxSpeed: RUNNER_PURSUER_TUNING.maxSpeed,
      oneHitKill: true,
    });
  });

  it("migrates the former generated runner ceiling even when pursuit was already relentless", () => {
    const legacyRunner = {
      ...conditionalMonster(),
      species: "war_pig" as const,
      monsterSpeed: 5.44,
      monsterPursuitMode: "relentless" as const,
      monsterAcceleration: 0.48,
      monsterMaxSpeed: 7.31,
      monsterOneHitKill: true,
    };
    const definition = activeAuthoredMonsterDefinitions(
      [legacyRunner],
      state({ "0075": true }),
      GRID_SIZE,
    )[0];

    expect(definition).toMatchObject({
      speed: RUNNER_PURSUER_TUNING.speed,
      acceleration: RUNNER_PURSUER_TUNING.acceleration,
      maxSpeed: RUNNER_PURSUER_TUNING.maxSpeed,
    });
  });

  it("preserves an explicitly authored relentless runner profile", () => {
    const customRunner = {
      ...conditionalMonster(),
      species: "war_pig" as const,
      monsterSpeed: 4.2,
      monsterPursuitMode: "relentless" as const,
      monsterAcceleration: 1.1,
      monsterMaxSpeed: 6.8,
      monsterOneHitKill: true,
    };
    const definition = activeAuthoredMonsterDefinitions(
      [customRunner],
      state({ "0075": true }),
      GRID_SIZE,
    )[0];

    expect(definition).toMatchObject({
      speed: 4.2,
      pursuitMode: "relentless",
      acceleration: 1.1,
      maxSpeed: 6.8,
      oneHitKill: true,
    });
  });

  it("preserves live combat state and removes encounters whose condition is withdrawn", () => {
    const retainedDefinition = activeAuthoredMonsterDefinitions(
      [conditionalMonster()],
      state({ "0075": true }),
      GRID_SIZE,
    )[0];
    if (!retainedDefinition) throw new Error("monster fixture creation failed");
    const retained = createMonsters([retainedDefinition])[0];
    const withdrawn = createMonsters([
      {
        ...retainedDefinition,
        id: "withdrawn",
        x: 64,
        y: 64,
      },
    ])[0];
    if (!retained || !withdrawn) throw new Error("monster runtime creation failed");
    retained.hp = 713;
    retained.x += 24;

    const next = reconcileActiveMonsters([retained, withdrawn], [retainedDefinition]);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: `mon-${MONSTER_EVENT_ID}`,
      hp: 713,
      x: retained.x,
      spawnX: retainedDefinition.x,
      spawnY: retainedDefinition.y,
      spawnZ: retainedDefinition.z,
      respawnDelayMs: 6_000,
    });
  });

  it("removes a permanently defeated encounter from the party's active definitions", () => {
    const permanent = { ...conditionalMonster(), monsterRespawnMode: "never" as const };
    const active = state({ "0075": true });
    expect(activeAuthoredMonsterDefinitions([permanent], active, GRID_SIZE)).toHaveLength(1);
    expect(
      activeAuthoredMonsterDefinitions(
        [permanent],
        { ...active, defeatedMonsters: { [MONSTER_EVENT_ID]: true } },
        GRID_SIZE,
      ),
    ).toEqual([]);
  });
});
