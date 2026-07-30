import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
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
    monsterTuning: { rank: "boss", maxHp: 1_400, detectionRange: 480 },
  });
  const base = event.pages[0] ?? defaultEventPage();
  return {
    ...event,
    pages: [
      { ...base, condSwitchId: "0075" },
      { ...base, condSwitchId: "0076" },
    ],
  };
}

describe("authored monster projection", () => {
  it("keeps a narrative encounter absent until one of its conditional pages holds", () => {
    const event = conditionalMonster();

    expect(activeAuthoredMonsterDefinitions([event], state())).toEqual([]);
    expect(activeAuthoredMonsterDefinitions([event], state({ "0076": true }))).toEqual([
      expect.objectContaining({
        id: `mon-${MONSTER_EVENT_ID}`,
        name: "Varkesh",
        species: "skull_warden",
        rank: "boss",
        maxHp: 1_400,
        detectionRange: 480,
        x: 11 * TILE_SIZE + TILE_SIZE / 2,
        y: 6 * TILE_SIZE + TILE_SIZE / 2,
        patrolRadius: 120,
      }),
    ]);
  });

  it("preserves live combat state and removes encounters whose condition is withdrawn", () => {
    const retainedDefinition = activeAuthoredMonsterDefinitions(
      [conditionalMonster()],
      state({ "0075": true }),
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
      detectionRange: 480,
    });
  });

  it("removes a permanently defeated encounter from the party's active definitions", () => {
    const permanent = { ...conditionalMonster(), monsterRespawnMode: "never" as const };
    const active = state({ "0075": true });
    expect(activeAuthoredMonsterDefinitions([permanent], active)).toHaveLength(1);
    expect(
      activeAuthoredMonsterDefinitions([permanent], {
        ...active,
        defeatedMonsters: { [MONSTER_EVENT_ID]: true },
      }),
    ).toEqual([]);
  });
});
