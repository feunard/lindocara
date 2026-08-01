import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import { type HarvestProfile, PEASANT_CARRY_DURATION_MS } from "@lindocara/engine/harvest.js";
import { functionalEvent } from "@lindocara/engine/map-events.js";
import { noColliders, tileMapFromRects } from "@lindocara/testing/tiles.js";
import { describe, expect, it } from "vitest";
import { playerSnapshot } from "../src/world/interest-system.ts";
import {
  catalogueCarcassNodeId,
  createPeasantHarvestJob,
  expirePeasantCarry,
  grantPeasantCarry,
  peasantCarryKindForReward,
  selectPeasantHarvestTarget,
} from "../src/world/peasant-harvest-system.ts";
import { type ActiveWorldEvent, createMonsters, newPlayer } from "../src/world/world-runtime.ts";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = 10_000;

const WOOD: HarvestProfile = {
  resource: "wood",
  tool: "axe",
  yieldAmount: 4,
  goldValue: 0,
  hitsRequired: 2,
  range: 54,
  harvestDurationMs: 750,
  exhaustedAssetId: null,
  exhaustionBehavior: "hide",
  respawn: "permanent",
  respawnDelayMs: 0,
  fadeDurationMs: 250,
};

function terrain(obstacles: TerrainGeometry["obstacles"] = []): TerrainGeometry {
  const tiles = tileMapFromRects(320, 192, obstacles);
  return {
    width: 320,
    height: 192,
    obstacles,
    spawnPoints: [],
    safeZone: null,
    tiles,
    colliders: noColliders(tiles),
  };
}

function player(playerClass: "peasant" | "ranger" = "peasant") {
  return newPlayer(
    {
      id: `${playerClass}-hero`,
      nick: "Mira",
      x: 48,
      y: 32,
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: playerClass,
      equipment: starterEquipmentFor(playerClass),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    "connection",
    "verdant-reach:main",
    0,
    0,
    undefined,
    undefined,
    NOW,
  );
}

function activeEvent(id = EVENT_ID): ActiveWorldEvent {
  return {
    id,
    col: 1,
    row: 0,
    graphicAssetId: null,
    onTop: false,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
  };
}

function mapView(profile: HarvestProfile = WOOD, worldTerrain = terrain()) {
  const event = functionalEvent({
    id: EVENT_ID,
    kind: "harvestable",
    col: 1,
    row: 0,
    ordinal: 0,
    harvestProfile: profile,
  });
  return {
    zoneId: "verdant-reach",
    events: [event],
    activeEvents: [activeEvent()],
    adventureState: EMPTY_ADVENTURE_STATE,
    monsters: [],
    terrain: worldTerrain,
  };
}

describe("Peasant harvest target selection", () => {
  it("requires the Peasant, matching tool, effective range, facing arc and line of sight", () => {
    const peasant = player();
    const input = {
      player: peasant,
      slot: 1 as const,
      direction: { x: 1, y: 0 },
      skillRange: 54,
      halfAngleRadians: Math.PI / 3,
      view: mapView(),
      now: NOW,
    };
    expect(selectPeasantHarvestTarget(input)?.nodeId).toBe(EVENT_ID);
    expect(selectPeasantHarvestTarget({ ...input, player: player("ranger") })).toBeNull();
    expect(
      selectPeasantHarvestTarget({
        ...input,
        slot: 2,
        view: mapView({ ...WOOD, resource: "stone", tool: "pickaxe" }),
      }),
    ).not.toBeNull();
    expect(
      selectPeasantHarvestTarget({
        ...input,
        view: mapView({ ...WOOD, resource: "stone", tool: "pickaxe" }),
      }),
    ).toBeNull();
    const distant = player();
    distant.x = 0;
    expect(selectPeasantHarvestTarget({ ...input, player: distant, skillRange: 20 })).toBeNull();
    expect(selectPeasantHarvestTarget({ ...input, direction: { x: -1, y: 0 } })).toBeNull();
    expect(
      selectPeasantHarvestTarget({
        ...input,
        view: mapView(WOOD, terrain([{ x: 64, y: 0, width: 64, height: 64 }])),
      }),
    ).toBeNull();
  });

  it("uses authored meat profiles for sheep-like map assets without inspecting their asset id", () => {
    const meat = { ...WOOD, resource: "meat" as const, tool: "knife" as const };
    const target = selectPeasantHarvestTarget({
      player: player(),
      slot: 3,
      direction: { x: 1, y: 0 },
      skillRange: 50,
      halfAngleRadians: Math.PI / 3,
      view: mapView(meat),
      now: NOW,
    });
    expect(target).toMatchObject({ kind: "map_event", profile: { resource: "meat" } });
  });

  it("allows only explicitly catalogued dead animal species as carcasses", () => {
    const monsters = createMonsters([
      {
        id: "farm-war-pig",
        kind: "boar",
        species: "war_pig",
        zone: "farm",
        patrolRadius: 20,
        x: 96,
        y: 32,
      },
      {
        id: "dead-goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "farm",
        patrolRadius: 20,
        x: 82,
        y: 32,
      },
    ]);
    for (const monster of monsters) {
      monster.hp = 0;
      monster.deadUntil = NOW + 42_000;
    }
    const target = selectPeasantHarvestTarget({
      player: player(),
      slot: 3,
      direction: { x: 1, y: 0 },
      skillRange: 50,
      halfAngleRadians: Math.PI / 3,
      view: {
        zoneId: "verdant-reach",
        events: [],
        activeEvents: [],
        adventureState: EMPTY_ADVENTURE_STATE,
        monsters,
        terrain: terrain(),
      },
      now: NOW,
    });
    expect(target).toMatchObject({ kind: "animal_carcass", runtimeId: "farm-war-pig" });
    expect(target?.nodeId).toBe("carcass:verdant-reach:farm-war-pig");
    expect(catalogueCarcassNodeId("bad zone", "farm-war-pig")).toBeNull();
  });

  it("turns harvestDurationMs into a server deadline", () => {
    const peasant = player();
    const target = selectPeasantHarvestTarget({
      player: peasant,
      slot: 1,
      direction: { x: 1, y: 0 },
      skillRange: 54,
      halfAngleRadians: Math.PI / 3,
      view: mapView(),
      now: NOW,
    });
    if (!target) throw new Error("target missing");
    expect(
      createPeasantHarvestJob({
        player: peasant,
        connectionId: "connection",
        slot: 1,
        direction: { x: 1, y: 0 },
        target,
        now: NOW,
      }),
    ).toMatchObject({ startedAt: NOW, completesAt: NOW + WOOD.harvestDurationMs });
  });

  it("projects only explicit carry sheets, with gold then meat then wood priority and expiry", () => {
    expect(peasantCarryKindForReward({ wood: 1, meat: 1 }, 5)).toBe("gold");
    expect(peasantCarryKindForReward({ wood: 1, meat: 1 }, 0)).toBe("meat");
    expect(peasantCarryKindForReward({ wood: 1 }, 0)).toBe("wood");
    expect(peasantCarryKindForReward({ stone: 1, iron: 1 }, 0)).toBeNull();

    const peasant = player();
    expect(grantPeasantCarry(peasant, { wood: 4 }, 0, NOW)).toBe("wood");
    expect(playerSnapshot(peasant, NOW).peasantCarry).toEqual({
      kind: "wood",
      until: NOW + PEASANT_CARRY_DURATION_MS,
    });
    expect(playerSnapshot(peasant, NOW + PEASANT_CARRY_DURATION_MS).peasantCarry).toBeUndefined();
    expect(expirePeasantCarry(peasant, NOW + PEASANT_CARRY_DURATION_MS - 1)).toBe(false);
    expect(expirePeasantCarry(peasant, NOW + PEASANT_CARRY_DURATION_MS)).toBe(true);
    expect(peasant.peasantCarry).toBeNull();

    grantPeasantCarry(peasant, { meat: 2 }, 0, NOW);
    expect(peasant.peasantCarry?.kind).toBe("meat");
    expect(grantPeasantCarry(peasant, { stone: 2 }, 0, NOW)).toBeNull();
    expect(peasant.peasantCarry).toBeNull();
  });
});
