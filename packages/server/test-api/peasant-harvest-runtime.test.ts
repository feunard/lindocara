import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import {
  HARVEST_PROFILE_LIMITS,
  type HarvestProfile,
  harvestColliderAt,
  PEASANT_CARRY_DURATION_MS,
} from "@lindocara/engine/harvest.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { functionalEvent } from "@lindocara/engine/map-events.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { type ZoneTerrain, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { zoneDefinition } from "@lindocara/engine/zones.js";
import { describe, expect, it } from "vitest";
import { evaluateActiveEvents } from "../src/api/realtime/worldEvents.ts";
import { createWorldRoomState } from "../src/api/realtime/worldState.ts";
import {
  advancePeasantHarvestJobs,
  pruneInvalidPeasantHarvestJobs,
  resolvePlayerAction,
  startPlayerAction,
  type WorldGlue,
  type WorldTickDeps,
} from "../src/api/realtime/worldTick.ts";
import { cancelPeasantHarvestJob } from "../src/world/peasant-harvest-system.ts";
import { newPlayer } from "../src/world/world-runtime.ts";

const PARTY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HERO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EVENT_B = "11111111-1111-4111-8111-111111111111";
const EVENT_C = "22222222-2222-4222-8222-222222222222";
const NOW = 10_000;
const TREE_ASSET_ID = "resource.terrain-resources-wood-trees.tree1";
const AREA_SECONDARY_COLLISION = {
  intact: { offsetX: 0, offsetY: -44, width: 32, height: 32 },
  depleted: null,
} as const;
const AREA_TERTIARY_COLLISION = {
  intact: { offsetX: -32, offsetY: -32, width: 32, height: 32 },
  depleted: null,
} as const;

/**
 * The grid this suite runs on, and the frame its fixtures are written in.
 *
 * Authored map content — a harvest event's cell, its collider tuple and its `HarvestProfile.range` —
 * is still written in the editor's PIXEL, top-left-origin space, and `peasant-harvest-system` is the
 * single place that shifts it onto the grid-centred tile plane (`authoredRect`/`authoredCellFoot`/
 * `authoredReach`, see its header). `a()` applies exactly that shift, so every position this suite
 * authors in pixels lands where the system expects cell (1, 0) to be. `SIZE` must stay the terrain's
 * own size: the shift is `- size / 2`, so a fixture built against a different grid would be offset
 * against the system by half the difference and every range clause would quietly stop rejecting.
 */
const SIZE = 16;
const a = (pixels: number): number => pixels / TILE_SIZE - SIZE / 2;

/** Half a 32 px body: an authored pixel top-left plus this is the tile-unit CENTRE the runtime uses. */
const BODY_HALF = 16;

/** The smallest movement that is still a movement — one pixel's worth of a tile. */
const ONE_PIXEL = 1 / TILE_SIZE;

/**
 * The map-authored basic reach the axe-reach test runs against, in TILE units — `MapHeroClassStats`
 * reads the same units `CLASS_STATS` does now.
 *
 * It has to sit BELOW the node's nearest edge and the reach talent has to lift it above: the
 * effective range is `min(skillRange, authoredReach(profile.range))`, so a reach wider than the
 * node's own 120 px would make both runs take the node's cap and the talent would stop being
 * observable at all.
 */
const BASIC_REACH = 80 / TILE_SIZE;

function terrain(obstacles: readonly ColliderRect[] = []): ZoneTerrain {
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels: new Array(SIZE * SIZE).fill(0),
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [...obstacles],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function profile(overrides: Partial<HarvestProfile> = {}): HarvestProfile {
  return {
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
    ...overrides,
  };
}

interface HarvestFixtureNode {
  id: string;
  col: number;
  row: number;
  profile: HarvestProfile;
}

interface RuntimeOptions {
  talents?: readonly string[];
  nodes?: readonly HarvestFixtureNode[];
  obstacles?: readonly ColliderRect[];
  /** In the AUTHORED pixel frame, like the node cells beside it — `runtime` applies `a()` itself. */
  playerX?: number;
  peasantAttackRange?: number;
}

function runtime(duration = 750, options: RuntimeOptions = {}) {
  const nodes =
    options.nodes ??
    ([
      { id: EVENT_ID, col: 1, row: 0, profile: profile({ harvestDurationMs: duration }) },
    ] as const);
  const events = nodes.map((node, ordinal) =>
    functionalEvent({
      id: node.id,
      kind: "harvestable",
      col: node.col,
      row: node.row,
      ordinal,
      harvestProfile: node.profile,
      graphicAssetId: TREE_ASSET_ID,
    }),
  );
  const base = zoneDefinition("verdant-reach");
  const heroSettings = defaultMapHeroSettings();
  if (options.peasantAttackRange !== undefined) {
    heroSettings.classes.peasant.stats.attackRange = options.peasantAttackRange;
  }
  const definition = {
    ...base,
    id: MAP_ID,
    terrain: terrain(options.obstacles),
    monsters: [],
    guards: [],
    events,
    heroSettings,
  };
  const state = createWorldRoomState(
    `${PARTY_ID}:${MAP_ID}`,
    { partyId: PARTY_ID, mapId: MAP_ID },
    { zoneId: MAP_ID, instanceId: "main", roomKey: `${PARTY_ID}:${MAP_ID}`, definition },
  );
  state.adventureState = { state: EMPTY_ADVENTURE_STATE, version: 0 };
  evaluateActiveEvents(state, NOW);
  const player = newPlayer(
    {
      id: HERO_ID,
      nick: "Mira",
      // The old pixel top-left plus half a body: a tile-unit position IS the body's centre.
      x: a((options.playerX ?? 48) + BODY_HALF),
      y: 0,
      z: a(32 + BODY_HALF),
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "peasant",
      equipment: starterEquipmentFor("peasant"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: MAP_ID,
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
      ...(options.talents ? { talents: options.talents } : {}),
    },
    "connection",
    `${PARTY_ID}:${MAP_ID}`,
    undefined,
    undefined,
    NOW,
  );
  player.identityKind = "hero";
  player.partyId = PARTY_ID;
  state.players.set("connection", player);
  state.connectionIdByHeroId.set(HERO_ID, "connection");
  state.playerGrid.insert(player);

  const pending: Promise<unknown>[] = [];
  type ReserveRequest = Parameters<WorldTickDeps["reserveHarvestNode"]>[0];
  type HitRequest = Parameters<WorldTickDeps["hitHarvestNode"]>[0];
  const calls = {
    reserve: 0,
    hit: 0,
    cancel: 0,
    reserveRequests: [] as ReserveRequest[],
    hitRequests: [] as HitRequest[],
  };
  const reservations = new Map<string, ReserveRequest>();
  const hits = new Map<string, number>();
  const deps: WorldTickDeps = {
    now: () => NOW,
    send: () => {},
    waitUntil: (promise) => pending.push(promise),
    renewPresence: async () => {},
    savePlayer: async () => true,
    presenceHeartbeatMs: 10_000,
    navigationDebugAvailable: false,
    markPermanentMonsterDefeated: () => {},
    recordQuestEvent: () => {},
    broadcastToParty: () => {},
    applyStateChanges: async () => {},
    acceptAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    abandonAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAdventure: async () => {},
    cheatsEnabled: false,
    transitionAdventureExit: () => {},
    teleportCrossMap: () => {},
    claimQuestReward: async () => false,
    reserveHarvestNode: async (request) => {
      calls.reserve += 1;
      calls.reserveRequests.push(request);
      const reservationId = crypto.randomUUID();
      reservations.set(reservationId, request);
      return {
        ok: true,
        reservationId,
        node: {
          eventId: request.eventId,
          generation: request.generation,
          hits: hits.get(request.eventId) ?? 0,
          lastHitAt: null,
          depleted: false,
          depletedAt: null,
          respawnAt: null,
        },
        materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
      };
    },
    hitHarvestNode: async (request) => {
      calls.hit += 1;
      calls.hitRequests.push(request);
      const reservation = reservations.get(request.reservationId);
      if (!reservation) return { ok: false, reason: "reservation" };
      reservations.delete(request.reservationId);
      const hitCount = (hits.get(request.eventId) ?? 0) + 1;
      hits.set(request.eventId, hitCount);
      const rewarded = hitCount >= reservation.requiredHits;
      return {
        ok: true,
        node: {
          eventId: request.eventId,
          generation: reservation.generation,
          hits: hitCount,
          lastHitAt: NOW,
          depleted: rewarded,
          depletedAt: rewarded ? NOW : null,
          respawnAt: null,
        },
        materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
        rewarded,
        reward: rewarded ? reservation.reward : {},
        goldValue: rewarded ? reservation.goldValue : 0,
      };
    },
    cancelHarvestNode: async (request) => {
      calls.cancel += 1;
      return reservations.delete(request.reservationId);
    },
    consumePotion: async () => null,
  };
  return { w: { state, deps } satisfies WorldGlue, player, pending, calls };
}

function resolveTool(
  w: WorldGlue,
  slot: 1 | 2 | 3,
  now = NOW,
  player = [...w.state.players.values()][0],
): void {
  const skill = CLASS_SKILLS.peasant[slot - 1];
  if (!player || !skill) throw new Error("Peasant tool fixture is incomplete");
  resolvePlayerAction(
    w,
    player,
    {
      id: crypto.randomUUID(),
      kind: slot === 1 ? "basic" : "skill",
      skillId: skill.id,
      slot,
      direction: { x: 1, z: 0 },
      startedAt: now,
      impactAt: now,
      recoveryEndsAt: now + 300,
      resolved: true,
    },
    now,
  );
}

function resolveAxe(w: WorldGlue, now = NOW): void {
  resolveTool(w, 1, now);
}

function installDepletedNode(w: WorldGlue, eventId: string, generation = 0): void {
  w.state.adventureState = {
    ...w.state.adventureState,
    state: {
      ...w.state.adventureState.state,
      harvestNodes: {
        ...(w.state.adventureState.state.harvestNodes ?? {}),
        [eventId]: {
          eventId,
          generation,
          hits: 1,
          lastHitAt: NOW,
          depleted: true,
          depletedAt: NOW,
          respawnAt: null,
        },
      },
    },
  };
}

describe("tick-driven Peasant harvest jobs", () => {
  it.each([
    ["wood", "axe", 1, 4, 0],
    ["stone", "pickaxe", 1, 4, 0],
    ["iron", "pickaxe", 1, 4, 0],
    ["gold", "pickaxe", 1, 0, 25],
    ["meat", "knife", 1, 4, 0],
  ] as const)(
    "maps %s only to the %s tool and anchors its target at the visible foot",
    (resource, tool, expectedSlot, yieldAmount, goldValue) => {
      const authoredProfile = profile({
        resource,
        tool,
        yieldAmount,
        goldValue,
        harvestDurationMs: 0,
      });
      const value = runtime(0, {
        nodes: [
          {
            id: EVENT_ID,
            col: 1,
            row: 0,
            profile: authoredProfile,
          },
        ],
      });
      resolveTool(value.w, 2);
      expect(value.w.state.harvestJobs.has(HERO_ID)).toBe(false);

      value.player.action = null;
      resolveTool(value.w, expectedSlot);
      const collider = harvestColliderAt(authoredProfile, 1, 0, "intact");
      if (!collider) throw new Error("tool fixture collider missing");
      expect(value.w.state.harvestJobs.get(HERO_ID)).toMatchObject({
        slot: expectedSlot,
        tool,
        // The authored pixel rectangle's centre, shifted onto the grid-centred tile plane exactly
        // as `authoredRect` shifts it: `a()` on the corner (an origin moves), a plain divide on the
        // extent (a length carries no origin).
        areaCenter: {
          x: a(collider.x) + collider.width / TILE_SIZE / 2,
          z: a(collider.y) + collider.height / TILE_SIZE / 2,
        },
      });
    },
  );

  it("keeps the first job per hero and commits only at harvestDurationMs (including zero)", async () => {
    const delayed = runtime();
    resolveAxe(delayed.w);
    const first = delayed.w.state.harvestJobs.get(HERO_ID);
    expect(first).toMatchObject({ completesAt: NOW + 750, committing: false });
    resolveAxe(delayed.w, NOW + 100);
    const retained = delayed.w.state.harvestJobs.get(HERO_ID);
    expect(delayed.w.state.harvestJobs.size).toBe(1);
    expect(retained?.id).toBe(first?.id);
    advancePeasantHarvestJobs(delayed.w, NOW + 749);
    expect(delayed.calls.reserve).toBe(0);
    advancePeasantHarvestJobs(delayed.w, NOW + 750);
    await Promise.all(delayed.pending);
    expect(delayed.calls).toMatchObject({ reserve: 1, hit: 1 });
    expect(delayed.player.peasantCarry).toBeNull();

    const instant = runtime(0);
    resolveAxe(instant.w);
    advancePeasantHarvestJobs(instant.w, NOW);
    await Promise.all(instant.pending);
    expect(instant.calls).toMatchObject({ reserve: 1, hit: 1 });
  });

  it("rejects a newly ready tool without cancelling its longer harvest channel", async () => {
    const delayed = runtime(900);
    resolveAxe(delayed.w);
    const channel = delayed.w.state.harvestJobs.get(HERO_ID);
    expect(channel).toMatchObject({ completesAt: NOW + 900, committing: false });

    delayed.player.action = null;
    delayed.player.lastAttackAt = NOW - 850;
    expect(startPlayerAction(delayed.w, "connection", delayed.player, 1)).toBe(false);
    expect(delayed.w.state.harvestJobs.get(HERO_ID)?.id).toBe(channel?.id);
    expect(delayed.player.lastAttackAt).toBe(NOW - 850);
    expect(delayed.player.action).toBeNull();

    advancePeasantHarvestJobs(delayed.w, NOW + 900);
    await Promise.all(delayed.pending);
    expect(delayed.calls).toMatchObject({ reserve: 1, hit: 1 });
    expect(delayed.w.state.harvestJobs.size).toBe(0);
  });

  it("revalidates range and page state at completion and leaves no residual job", () => {
    const moved = runtime();
    resolveAxe(moved.w);
    moved.player.x = a(250 + BODY_HALF);
    advancePeasantHarvestJobs(moved.w, NOW + 750);
    expect(moved.w.state.harvestJobs.size).toBe(0);
    expect(moved.calls.reserve).toBe(0);

    const pageChanged = runtime();
    resolveAxe(pageChanged.w);
    pageChanged.w.state.activeEvents = [];
    pruneInvalidPeasantHarvestJobs(pageChanged.w, NOW + 1);
    expect(pageChanged.w.state.harvestJobs.size).toBe(0);
  });

  it("cancels a reserved hit when movement/disconnect wins the coordinator await", async () => {
    const value = runtime();
    let release!: (result: Awaited<ReturnType<WorldTickDeps["reserveHarvestNode"]>>) => void;
    value.w.deps.reserveHarvestNode = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    resolveAxe(value.w);
    advancePeasantHarvestJobs(value.w, NOW + 750);
    expect(value.w.state.harvestJobs.get(HERO_ID)?.committing).toBe(true);
    value.player.x += ONE_PIXEL;
    expect(cancelPeasantHarvestJob(value.w.state.harvestJobs, HERO_ID)).toBe(true);
    release({
      ok: true,
      reservationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      node: {
        eventId: EVENT_ID,
        generation: 0,
        hits: 0,
        lastHitAt: null,
        depleted: false,
        depletedAt: null,
        respawnAt: null,
      },
      materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
    });
    await Promise.all(value.pending);
    expect(value.calls).toMatchObject({ hit: 0, cancel: 1 });
    expect(value.w.state.harvestJobs.size).toBe(0);
  });

  it("finishes an already settled gold hit with the captured epoch after disconnect", async () => {
    const value = runtime(0);
    let releaseHit!: (result: Awaited<ReturnType<WorldTickDeps["hitHarvestNode"]>>) => void;
    value.w.deps.hitHarvestNode = () =>
      new Promise((resolve) => {
        value.calls.hit += 1;
        releaseHit = resolve;
      });

    resolveAxe(value.w);
    advancePeasantHarvestJobs(value.w, NOW);
    await Promise.resolve();
    await Promise.resolve();
    expect(value.calls.hit).toBe(1);

    value.w.state.players.delete("connection");
    value.w.state.connectionIdByHeroId.delete(HERO_ID);
    expect(cancelPeasantHarvestJob(value.w.state.harvestJobs, HERO_ID)).toBe(true);
    releaseHit({
      ok: true,
      node: {
        eventId: EVENT_ID,
        generation: 0,
        hits: 2,
        lastHitAt: NOW,
        depleted: true,
        depletedAt: NOW,
        respawnAt: null,
      },
      materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
      rewarded: true,
      reward: {},
      goldValue: 25,
    });
    await Promise.all(value.pending);

    expect(value.calls).toMatchObject({ reserve: 1, hit: 1, cancel: 0 });
    expect(value.calls.reserveRequests[0]?.sessionEpoch).toBe(value.player.sessionEpoch);
    expect(value.player.peasantCarry).toEqual({
      kind: "gold",
      until: NOW + PEASANT_CARRY_DURATION_MS,
    });
    expect(value.w.state.harvestJobs.size).toBe(0);
  });

  it("applies axe yield, hit and duration talents to the coordinator request", async () => {
    const talents = [
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.readiness",
      "peasant.woodcutters_swing.reach",
      "peasant.woodcutters_swing.clean_cut",
      "peasant.woodcutters_swing.great_felling",
    ];
    const value = runtime(750, { talents });

    resolveAxe(value.w);
    const job = value.w.state.harvestJobs.get(HERO_ID);
    expect(job).toMatchObject({
      completesAt: NOW + 638,
      // Tile units: the talent's own radius is `128 / TILE_SIZE` since the balance tables converted.
      areaRadius: 128 / TILE_SIZE,
      targets: [
        {
          plan: {
            yieldAmount: 8,
            materialReward: { wood: 8 },
            hitsRequired: 1,
            harvestDurationMs: 638,
            maximumTargets: 6,
          },
        },
      ],
    });
    advancePeasantHarvestJobs(value.w, NOW + 637);
    expect(value.calls.reserve).toBe(0);
    advancePeasantHarvestJobs(value.w, NOW + 638);
    await Promise.all(value.pending);

    expect(value.calls.reserveRequests).toMatchObject([
      {
        eventId: EVENT_ID,
        requiredHits: 1,
        reward: { wood: 8 },
        goldValue: 0,
      },
    ]);
    expect(value.player.peasantCarry?.kind).toBe("wood");
  });

  it("applies axe reach talents on top of the map-authored basic range", () => {
    const node = {
      id: EVENT_ID,
      col: 2,
      row: 0,
      profile: profile({ range: 120 }),
    } as const;
    const withoutReach = runtime(750, {
      nodes: [node],
      playerX: 32,
      peasantAttackRange: BASIC_REACH,
    });
    resolveAxe(withoutReach.w);
    expect(withoutReach.w.state.harvestJobs.size).toBe(0);

    const withReach = runtime(750, {
      talents: [
        "peasant.woodcutters_swing.bounty",
        "peasant.woodcutters_swing.readiness",
        "peasant.woodcutters_swing.reach",
      ],
      nodes: [node],
      playerX: 32,
      peasantAttackRange: BASIC_REACH,
    });
    resolveAxe(withReach.w);
    expect(withReach.w.state.harvestJobs.get(HERO_ID)?.targets).toHaveLength(1);
  });

  it("commits rich-vein area targets separately, keeps its own committing job and aggregates carry", async () => {
    const talents = [
      "peasant.prospectors_pick.ore_share",
      "peasant.prospectors_pick.readiness",
      "peasant.prospectors_pick.force",
      "peasant.prospectors_pick.rich_vein",
      "peasant.prospectors_pick.mother_lode",
    ];
    const nodes = [
      {
        id: EVENT_ID,
        col: 1,
        row: 0,
        profile: profile({
          resource: "stone",
          tool: "pickaxe",
          yieldAmount: 4,
          hitsRequired: 1,
          harvestDurationMs: 0,
        }),
      },
      {
        id: EVENT_B,
        col: 0,
        row: 1,
        profile: profile({
          resource: "gold",
          tool: "pickaxe",
          yieldAmount: 0,
          goldValue: 50,
          hitsRequired: 1,
          harvestDurationMs: 0,
          collision: AREA_SECONDARY_COLLISION,
        }),
      },
      {
        id: EVENT_C,
        col: 1,
        row: 1,
        profile: profile({
          resource: "gold",
          tool: "pickaxe",
          yieldAmount: 0,
          goldValue: HARVEST_PROFILE_LIMITS.goldValue.max,
          hitsRequired: 1,
          harvestDurationMs: 0,
          collision: AREA_TERTIARY_COLLISION,
        }),
      },
    ];
    const value = runtime(0, { talents, nodes });
    const originalHit = value.w.deps.hitHarvestNode;
    let committingPushesKeptJob = true;
    value.w.deps.hitHarvestNode = async (request, resource) => {
      const result = await originalHit(request, resource);
      if (result.ok && result.rewarded) {
        installDepletedNode(value.w, request.eventId, result.node.generation);
        pruneInvalidPeasantHarvestJobs(value.w, NOW);
        committingPushesKeptJob &&= value.w.state.harvestJobs.has(HERO_ID);
      }
      return result;
    };

    resolveTool(value.w, 1);
    expect(value.w.state.harvestJobs.get(HERO_ID)?.targets.map((target) => target.nodeId)).toEqual([
      EVENT_ID,
      EVENT_C,
      EVENT_B,
    ]);
    advancePeasantHarvestJobs(value.w, NOW);
    await Promise.all(value.pending);

    expect(committingPushesKeptJob).toBe(true);
    expect(value.calls.reserveRequests).toMatchObject([
      {
        eventId: EVENT_ID,
        requiredHits: 1,
        reward: { stone: 8, iron: 3 },
        goldValue: 0,
      },
      {
        eventId: EVENT_C,
        reward: {},
        goldValue: HARVEST_PROFILE_LIMITS.goldValue.max,
      },
      { eventId: EVENT_B, reward: {}, goldValue: 120 },
    ]);
    expect(new Set(value.calls.reserveRequests.map((request) => request.eventId)).size).toBe(3);
    expect(
      value.calls.reserveRequests.slice(1).map(({ eventId, goldValue }) => ({
        eventId,
        goldValue,
      })),
    ).toEqual([
      { eventId: EVENT_C, goldValue: HARVEST_PROFILE_LIMITS.goldValue.max },
      { eventId: EVENT_B, goldValue: 120 },
    ]);
    expect(value.player.peasantCarry).toEqual({
      kind: "gold",
      until: NOW + PEASANT_CARRY_DURATION_MS,
    });
    expect(value.w.state.harvestJobs.size).toBe(0);
  });

  it.each(["movement", "disconnect"] as const)(
    "stops remaining area targets after %s",
    async (interruption) => {
      const talents = [
        "peasant.woodcutters_swing.bounty",
        "peasant.woodcutters_swing.readiness",
        "peasant.woodcutters_swing.reach",
        "peasant.woodcutters_swing.sweeping_fell",
      ];
      const nodes = [
        {
          id: EVENT_ID,
          col: 1,
          row: 0,
          profile: profile({ hitsRequired: 1, harvestDurationMs: 0 }),
        },
        {
          id: EVENT_B,
          col: 0,
          row: 1,
          profile: profile({
            hitsRequired: 1,
            harvestDurationMs: 0,
            collision: AREA_SECONDARY_COLLISION,
          }),
        },
      ];
      const value = runtime(0, { talents, nodes });
      const originalHit = value.w.deps.hitHarvestNode;
      let interrupted = false;
      value.w.deps.hitHarvestNode = async (request, resource) => {
        const result = await originalHit(request, resource);
        if (!interrupted) {
          interrupted = true;
          if (interruption === "movement") value.player.x += ONE_PIXEL;
          else {
            value.w.state.players.delete("connection");
            value.w.state.connectionIdByHeroId.delete(HERO_ID);
          }
          cancelPeasantHarvestJob(value.w.state.harvestJobs, HERO_ID);
        }
        return result;
      };

      resolveAxe(value.w);
      expect(value.w.state.harvestJobs.get(HERO_ID)?.targets).toHaveLength(2);
      advancePeasantHarvestJobs(value.w, NOW);
      await Promise.all(value.pending);

      expect(value.calls.reserveRequests.map((request) => request.eventId)).toEqual([EVENT_ID]);
      expect(value.calls.hitRequests.map((request) => request.eventId)).toEqual([EVENT_ID]);
      expect(value.w.state.harvestJobs.size).toBe(0);
    },
  );

  it("serializes two Peasants across separate target reservations without double credit", async () => {
    const talents = [
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.readiness",
      "peasant.woodcutters_swing.reach",
      "peasant.woodcutters_swing.sweeping_fell",
    ];
    const value = runtime(0, {
      talents,
      nodes: [
        {
          id: EVENT_ID,
          col: 1,
          row: 0,
          profile: profile({ hitsRequired: 1, harvestDurationMs: 0 }),
        },
        {
          id: EVENT_B,
          col: 0,
          row: 1,
          profile: profile({
            hitsRequired: 1,
            harvestDurationMs: 0,
            collision: AREA_SECONDARY_COLLISION,
          }),
        },
      ],
    });
    const secondHeroId = "33333333-3333-4333-8333-333333333333";
    const secondConnection = "connection-2";
    const second = newPlayer(
      {
        ...value.player,
        id: secondHeroId,
        nick: "Robin",
        talents,
        sessionEpoch: 2,
      },
      secondConnection,
      `${PARTY_ID}:${MAP_ID}`,
      undefined,
      undefined,
      NOW,
    );
    second.identityKind = "hero";
    second.partyId = PARTY_ID;
    value.w.state.players.set(secondConnection, second);
    value.w.state.connectionIdByHeroId.set(secondHeroId, secondConnection);
    value.w.state.playerGrid.insert(second);

    type ReserveRequest = Parameters<WorldTickDeps["reserveHarvestNode"]>[0];
    const locks = new Map<string, { id: string; request: ReserveRequest }>();
    const depleted = new Set<string>();
    const creditedByNode = new Map<string, string>();
    value.w.deps.reserveHarvestNode = async (request) => {
      value.calls.reserve += 1;
      value.calls.reserveRequests.push(request);
      if (depleted.has(request.eventId)) return { ok: false, reason: "depleted" };
      if (locks.has(request.eventId)) return { ok: false, reason: "busy" };
      const id = crypto.randomUUID();
      locks.set(request.eventId, { id, request });
      return {
        ok: true,
        reservationId: id,
        node: {
          eventId: request.eventId,
          generation: request.generation,
          hits: 0,
          lastHitAt: null,
          depleted: false,
          depletedAt: null,
          respawnAt: null,
        },
        materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
      };
    };
    value.w.deps.hitHarvestNode = async (request) => {
      value.calls.hit += 1;
      value.calls.hitRequests.push(request);
      const lock = locks.get(request.eventId);
      if (!lock || lock.id !== request.reservationId) {
        return { ok: false, reason: "reservation" };
      }
      locks.delete(request.eventId);
      if (depleted.has(request.eventId)) return { ok: false, reason: "depleted" };
      depleted.add(request.eventId);
      creditedByNode.set(request.eventId, lock.request.heroId);
      installDepletedNode(value.w, request.eventId, lock.request.generation);
      pruneInvalidPeasantHarvestJobs(value.w, NOW);
      return {
        ok: true,
        node: {
          eventId: request.eventId,
          generation: lock.request.generation,
          hits: 1,
          lastHitAt: NOW,
          depleted: true,
          depletedAt: NOW,
          respawnAt: null,
        },
        materials: { wood: 7, stone: 0, iron: 0, meat: 0 },
        rewarded: true,
        reward: { wood: 7 },
        goldValue: 0,
      };
    };
    value.w.deps.cancelHarvestNode = async (request) => {
      value.calls.cancel += 1;
      const lock = locks.get(request.eventId);
      if (!lock || lock.id !== request.reservationId) return false;
      locks.delete(request.eventId);
      return true;
    };

    resolveTool(value.w, 1, NOW, value.player);
    resolveTool(value.w, 1, NOW, second);
    expect(value.w.state.harvestJobs.size).toBe(2);
    advancePeasantHarvestJobs(value.w, NOW);
    await Promise.all(value.pending);

    expect(creditedByNode.size).toBe(2);
    expect([...creditedByNode.keys()].sort()).toEqual([EVENT_ID, EVENT_B].sort());
    expect(new Set(creditedByNode.values())).toEqual(new Set([HERO_ID, secondHeroId]));
    expect(value.calls.hitRequests).toHaveLength(2);
    expect(value.player.peasantCarry?.kind).toBe("wood");
    expect(second.peasantCarry?.kind).toBe("wood");
    expect(value.w.state.harvestJobs.size).toBe(0);
  });
});
