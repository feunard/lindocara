import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import {
  type HarvestProfile,
  harvestColliderAt,
  PEASANT_CARRY_DURATION_MS,
} from "@lindocara/engine/harvest.js";
import { functionalEvent } from "@lindocara/engine/map-events.js";
import { noColliders, tileMapFromRects } from "@lindocara/testing/tiles.js";
import { describe, expect, it } from "vitest";
import { playerSnapshot } from "../src/world/interest-system.ts";
import {
  catalogueCarcassNodeId,
  createPeasantHarvestJob,
  expirePeasantCarry,
  grantPeasantCarry,
  hasPeasantHarvestLineOfSight,
  peasantCarryKindForReward,
  revalidatePeasantHarvestTarget,
  selectPeasantHarvestTarget,
  selectPeasantHarvestTargets,
} from "../src/world/peasant-harvest-system.ts";
import { type ActiveWorldEvent, createMonsters, newPlayer } from "../src/world/world-runtime.ts";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = 10_000;
const TREE_ASSET_ID = "resource.terrain-resources-wood-trees.tree1";

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

function activeEvent(
  id = EVENT_ID,
  col = 1,
  row = 0,
  profile: HarvestProfile = WOOD,
): ActiveWorldEvent {
  const collider = harvestColliderAt(profile, col, row, "intact");
  if (!collider) throw new Error("intact harvest collider missing");
  return {
    id,
    col,
    row,
    graphicAssetId: TREE_ASSET_ID,
    onTop: false,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
    harvest: {
      state: "intact",
      generation: 0,
      hits: 0,
      hitsRequired: profile.hitsRequired,
      lastHitAt: null,
      depletedAt: null,
      respawnAt: null,
      exhaustionBehavior: profile.exhaustionBehavior,
      exhaustedAssetId: profile.exhaustedAssetId,
      fadeDurationMs: profile.fadeDurationMs,
      collider: [collider.x, collider.y, collider.width, collider.height],
    },
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
    graphicAssetId: TREE_ASSET_ID,
  });
  return {
    zoneId: "verdant-reach",
    events: [event],
    activeEvents: [activeEvent(EVENT_ID, 1, 0, profile)],
    adventureState: EMPTY_ADVENTURE_STATE,
    monsters: [],
    terrain: worldTerrain,
    staticColliderIndex: worldTerrain.colliders,
  };
}

describe("Peasant harvest target selection", () => {
  it("ignores only the target footprint while keeping third-party sub-cell obstacles opaque", () => {
    const open = mapView();
    const target = selectPeasantHarvestTarget({
      player: player(),
      slot: 1,
      direction: { x: 1, y: 0 },
      skillRange: 54,
      halfAngleRadians: Math.PI / 3,
      view: open,
      now: NOW,
    });
    if (!target?.collider) throw new Error("authored target collider missing");
    const origin = { x: 64, y: 48 };
    expect(hasPeasantHarvestLineOfSight(origin, target, open)).toBe(true);

    const exactDuplicate = {
      ...open,
      activeEvents: [
        ...open.activeEvents,
        {
          ...activeEvent("22222222-2222-4222-8222-222222222222"),
          harvest: open.activeEvents[0]?.harvest,
        },
      ],
    };
    expect(hasPeasantHarvestLineOfSight(origin, target, exactDuplicate)).toBe(false);

    const blocker = { x: 69, y: 42, width: 4, height: 12 };
    const withThirdParty = {
      ...open,
      staticColliderIndex: colliderIndexFrom(
        [blocker],
        open.terrain.tiles.cols,
        open.terrain.tiles.rows,
      ),
    };
    expect(hasPeasantHarvestLineOfSight(origin, target, withThirdParty)).toBe(false);
  });

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
        staticColliderIndex: terrain().colliders,
      },
      now: NOW,
    });
    expect(target).toMatchObject({ kind: "animal_carcass", runtimeId: "farm-war-pig" });
    expect(target?.nodeId).toBe("carcass:verdant-reach:farm-war-pig");
    expect(catalogueCarcassNodeId("bad zone", "farm-war-pig")).toBeNull();
  });

  it("selects area harvest targets deterministically within the talent cap and line of sight", () => {
    const nodes = [
      ["11111111-1111-4111-8111-111111111111", 2, 1],
      ["22222222-2222-4222-8222-222222222222", 2, 0],
      ["33333333-3333-4333-8333-333333333333", 2, 2],
      ["44444444-4444-4444-8444-444444444444", 1, 1],
      ["55555555-5555-4555-8555-555555555555", 1, 0],
      ["66666666-6666-4666-8666-666666666666", 1, 2],
      ["77777777-7777-4777-8777-777777777777", 0, 1],
      ["88888888-8888-4888-8888-888888888888", 3, 1],
      ["99999999-9999-4999-8999-999999999999", 3, 0],
    ] as const;
    const events = nodes.map(([id, col, row], ordinal) =>
      functionalEvent({
        id,
        kind: "harvestable",
        col,
        row,
        ordinal,
        harvestProfile: WOOD,
        graphicAssetId: TREE_ASSET_ID,
      }),
    );
    const activeEvents = nodes.map(([id, col, row]) => activeEvent(id, col, row));
    const peasant = player();
    peasant.x = 112;
    peasant.y = 96;
    peasant.talents = [
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.readiness",
      "peasant.woodcutters_swing.reach",
      "peasant.woodcutters_swing.clean_cut",
      "peasant.woodcutters_swing.great_felling",
    ];
    const select = (reverse: boolean) =>
      selectPeasantHarvestTargets({
        player: peasant,
        slot: 1,
        direction: { x: 1, y: 0 },
        skillRange: 54,
        halfAngleRadians: Math.PI / 3,
        view: {
          zoneId: "verdant-reach",
          events: reverse ? events.toReversed() : events,
          activeEvents: reverse ? activeEvents.toReversed() : activeEvents,
          adventureState: EMPTY_ADVENTURE_STATE,
          monsters: [],
          terrain: terrain(),
          staticColliderIndex: terrain().colliders,
        },
        now: NOW,
      });
    const expected = nodes.slice(0, 6).map(([id]) => id);

    expect(select(false).map((target) => target.nodeId)).toEqual(expected);
    expect(select(true).map((target) => target.nodeId)).toEqual(expected);
    expect(select(false)).toHaveLength(6);
    expect(select(false)[0]).toMatchObject({
      primary: true,
      plan: { areaRadius: 128, maximumTargets: 6 },
    });
    expect(select(false).some((target) => target.nodeId === nodes[6][0])).toBe(false);
    expect(select(false).some((target) => target.nodeId === nodes[7][0])).toBe(false);
    expect(select(false).some((target) => target.nodeId === nodes[8][0])).toBe(false);
  });

  it("revalidates every captured area target against tool, generation, state and line of sight", () => {
    const secondaryId = "22222222-2222-4222-8222-222222222222";
    const view = (
      secondaryProfile: HarvestProfile = WOOD,
      adventureState = EMPTY_ADVENTURE_STATE,
      worldTerrain = terrain(),
    ) => ({
      zoneId: "verdant-reach",
      events: [
        functionalEvent({
          id: EVENT_ID,
          kind: "harvestable",
          col: 2,
          row: 1,
          ordinal: 0,
          harvestProfile: WOOD,
          graphicAssetId: TREE_ASSET_ID,
        }),
        functionalEvent({
          id: secondaryId,
          kind: "harvestable",
          col: 2,
          row: 0,
          ordinal: 1,
          harvestProfile: secondaryProfile,
          graphicAssetId: TREE_ASSET_ID,
        }),
      ],
      activeEvents: [activeEvent(EVENT_ID, 2, 1), activeEvent(secondaryId, 2, 0, secondaryProfile)],
      adventureState,
      monsters: [],
      terrain: worldTerrain,
      staticColliderIndex: worldTerrain.colliders,
    });
    const peasant = player();
    peasant.x = 112;
    peasant.y = 96;
    peasant.talents = ["peasant.woodcutters_swing.sweeping_fell"];
    const selected = selectPeasantHarvestTargets({
      player: peasant,
      slot: 1,
      direction: { x: 1, y: 0 },
      skillRange: 54,
      halfAngleRadians: Math.PI / 3,
      view: view(),
      now: NOW,
    });
    const primary = selected[0];
    const secondary = selected[1];
    if (!primary || !secondary) throw new Error("area target fixture is incomplete");
    const target = {
      primary: false,
      targetKind: secondary.kind,
      targetRuntimeId: secondary.runtimeId,
      nodeId: secondary.nodeId,
      generation: secondary.generation,
      plan: secondary.plan,
    };
    const revalidate = (
      liveView: ReturnType<typeof view>,
    ): ReturnType<typeof revalidatePeasantHarvestTarget> =>
      revalidatePeasantHarvestTarget({
        player: peasant,
        slot: 1,
        direction: { x: 1, y: 0 },
        skillRange: 54,
        halfAngleRadians: Math.PI / 3,
        areaCenter: primary.position,
        areaRadius: primary.plan.areaRadius,
        target,
        view: liveView,
        now: NOW,
      });
    const node = {
      eventId: secondaryId,
      generation: 0,
      hits: 0,
      lastHitAt: null,
      depleted: false,
      depletedAt: null,
      respawnAt: null,
    };

    expect(revalidate(view())?.nodeId).toBe(secondaryId);
    expect(
      revalidate(
        view(WOOD, {
          ...EMPTY_ADVENTURE_STATE,
          harvestNodes: { [secondaryId]: { ...node, generation: 1 } },
        }),
      ),
    ).toBeNull();
    expect(
      revalidate(
        view(WOOD, {
          ...EMPTY_ADVENTURE_STATE,
          harvestNodes: {
            [secondaryId]: { ...node, depleted: true, depletedAt: NOW },
          },
        }),
      ),
    ).toBeNull();
    expect(revalidate(view({ ...WOOD, resource: "stone", tool: "pickaxe" }))).toBeNull();
    expect(
      revalidate(
        view(WOOD, EMPTY_ADVENTURE_STATE, terrain([{ x: 128, y: 0, width: 64, height: 64 }])),
      ),
    ).toBeNull();
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
