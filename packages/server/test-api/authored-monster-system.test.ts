import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { DEFAULT_NPC_MODEL_ASSET_ID } from "@lindocara/engine/tiny-swords-catalog.js";
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
