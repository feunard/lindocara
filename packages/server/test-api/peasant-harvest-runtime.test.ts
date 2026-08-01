import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import { type HarvestProfile, PEASANT_CARRY_DURATION_MS } from "@lindocara/engine/harvest.js";
import { functionalEvent } from "@lindocara/engine/map-events.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { zoneDefinition } from "@lindocara/engine/zones.js";
import { noColliders, tileMapFromRects } from "@lindocara/testing/tiles.js";
import { describe, expect, it } from "vitest";
import { evaluateActiveEvents } from "../src/api/realtime/worldEvents.ts";
import { createWorldRoomState } from "../src/api/realtime/worldState.ts";
import {
  advancePeasantHarvestJobs,
  pruneInvalidPeasantHarvestJobs,
  resolvePlayerAction,
  type WorldGlue,
  type WorldTickDeps,
} from "../src/api/realtime/worldTick.ts";
import { cancelPeasantHarvestJob } from "../src/world/peasant-harvest-system.ts";
import { newPlayer } from "../src/world/world-runtime.ts";

const PARTY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HERO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = 10_000;

function terrain(): TerrainGeometry {
  const tiles = tileMapFromRects(320, 192, []);
  return {
    width: 320,
    height: 192,
    obstacles: [],
    spawnPoints: [{ x: 48, y: 32 }],
    safeZone: null,
    tiles,
    colliders: noColliders(tiles),
  };
}

function profile(duration = 750): HarvestProfile {
  return {
    resource: "wood",
    tool: "axe",
    yieldAmount: 4,
    goldValue: 0,
    hitsRequired: 2,
    range: 54,
    harvestDurationMs: duration,
    exhaustedAssetId: null,
    exhaustionBehavior: "hide",
    respawn: "permanent",
    respawnDelayMs: 0,
    fadeDurationMs: 250,
  };
}

function runtime(duration = 750) {
  const event = functionalEvent({
    id: EVENT_ID,
    kind: "harvestable",
    col: 1,
    row: 0,
    ordinal: 0,
    harvestProfile: profile(duration),
  });
  const base = zoneDefinition("verdant-reach");
  const definition = {
    ...base,
    id: MAP_ID,
    terrain: terrain(),
    monsters: [],
    guards: [],
    events: [event],
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
      x: 48,
      y: 32,
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
    },
    "connection",
    `${PARTY_ID}:${MAP_ID}`,
    0,
    0,
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
  const calls = { reserve: 0, hit: 0, cancel: 0, gold: 0 };
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
    reserveHarvestNode: async () => {
      calls.reserve += 1;
      return {
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
      };
    },
    hitHarvestNode: async () => {
      calls.hit += 1;
      return {
        ok: true,
        node: {
          eventId: EVENT_ID,
          generation: 0,
          hits: 1,
          lastHitAt: NOW,
          depleted: false,
          depletedAt: null,
          respawnAt: null,
        },
        materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
        rewarded: false,
        goldValue: 0,
      };
    },
    cancelHarvestNode: async () => {
      calls.cancel += 1;
      return true;
    },
    claimHarvestGold: async () => {
      calls.gold += 1;
      return true;
    },
    consumePotion: async () => null,
  };
  return { w: { state, deps } satisfies WorldGlue, player, pending, calls };
}

function resolveAxe(w: WorldGlue, now = NOW): void {
  const player = [...w.state.players.values()][0];
  const skill = CLASS_SKILLS.peasant[0];
  if (!player || !skill) throw new Error("Peasant axe fixture is incomplete");
  resolvePlayerAction(
    w,
    player,
    {
      id: crypto.randomUUID(),
      kind: "basic",
      skillId: skill.id,
      slot: 1,
      direction: { x: 1, y: 0 },
      startedAt: now,
      impactAt: now,
      recoveryEndsAt: now + 300,
      resolved: true,
    },
    now,
  );
}

describe("tick-driven Peasant harvest jobs", () => {
  it("keeps one job per hero and commits only at harvestDurationMs (including zero)", async () => {
    const delayed = runtime();
    resolveAxe(delayed.w);
    const first = delayed.w.state.harvestJobs.get(HERO_ID);
    expect(first).toMatchObject({ completesAt: NOW + 750, committing: false });
    resolveAxe(delayed.w, NOW + 100);
    const replacement = delayed.w.state.harvestJobs.get(HERO_ID);
    expect(delayed.w.state.harvestJobs.size).toBe(1);
    expect(replacement?.id).not.toBe(first?.id);
    advancePeasantHarvestJobs(delayed.w, NOW + 849);
    expect(delayed.calls.reserve).toBe(0);
    advancePeasantHarvestJobs(delayed.w, NOW + 850);
    await Promise.all(delayed.pending);
    expect(delayed.calls).toMatchObject({ reserve: 1, hit: 1 });
    expect(delayed.player.peasantCarry).toBeNull();

    const instant = runtime(0);
    resolveAxe(instant.w);
    advancePeasantHarvestJobs(instant.w, NOW);
    await Promise.all(instant.pending);
    expect(instant.calls).toMatchObject({ reserve: 1, hit: 1 });
  });

  it("revalidates range and page state at completion and leaves no residual job", () => {
    const moved = runtime();
    resolveAxe(moved.w);
    moved.player.x = 250;
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
    value.player.x += 1;
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
    expect(value.calls).toMatchObject({ hit: 0, cancel: 1, gold: 0 });
    expect(value.w.state.harvestJobs.size).toBe(0);
  });

  it("finishes an already exhausted gold claim with the captured epoch after disconnect", async () => {
    const value = runtime(0);
    let releaseHit!: (result: Awaited<ReturnType<WorldTickDeps["hitHarvestNode"]>>) => void;
    let creditedActor: unknown = null;
    value.w.deps.hitHarvestNode = () =>
      new Promise((resolve) => {
        value.calls.hit += 1;
        releaseHit = resolve;
      });
    value.w.deps.claimHarvestGold = async (actor) => {
      value.calls.gold += 1;
      creditedActor = actor;
      return true;
    };

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
      goldValue: 25,
    });
    await Promise.all(value.pending);

    expect(value.calls).toMatchObject({ reserve: 1, hit: 1, cancel: 0, gold: 1 });
    expect(creditedActor).toBe(value.player);
    expect(value.player.peasantCarry).toEqual({
      kind: "gold",
      until: NOW + PEASANT_CARRY_DURATION_MS,
    });
    expect(value.w.state.harvestJobs.size).toBe(0);
  });
});
