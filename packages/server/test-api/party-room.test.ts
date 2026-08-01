/**
 * `PartyRoom` — the headless party coordinator, successor to legacy `GameSession` — against real
 * party/adventure/hero rows created through the ordinary HTTP flow, same idiom as
 * `presence-room.test.ts`. Every test calls room methods the way `WorldRoom` (Task 4+) will:
 * `alepha.inject(PartyRoom).room.call(partyId, "<method>", ...)`.
 *
 * Covers, per the task brief: `applyStateChanges` bumps the version and lands in D1 immediately (no
 * clock advance); two racing `applyStateChanges` calls serialize instead of losing an update;
 * `pushToRoom` receives the committed `(state, version)` AFTER the D1 write; a throwing `pushToRoom`
 * does not lose that write; `acceptAuthoredQuest`/`completeAuthoredQuest` refuse a stale-epoch actor
 * without mutating anything; `registerRoom`/`roomEmptied` maintain the room directory and
 * `broadcastToParty` fans out only to currently registered rooms.
 */

import {
  createAuthoredQuestDefinition,
  createManualQuestObjective,
} from "@lindocara/engine/quests.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { WebSocketServerProvider } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { adventures } from "../src/api/entities/adventures.ts";
import { authoredQuestRewardClaims } from "../src/api/entities/authoredQuestRewardClaims.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { heroQuests } from "../src/api/entities/heroQuests.ts";
import { partyAdventureStates } from "../src/api/entities/partyAdventureStates.ts";
import {
  type ConsumePartyMaterialsResult,
  type HitHarvestNodeResult,
  type PartyMaterialReservationResult,
  PartyRoom,
  type ReserveHarvestNodeRequest,
  type ReserveHarvestNodeResult,
} from "../src/api/realtime/PartyRoom.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const HEALTH_POTION_ID = "health_potion";
const SUPPORT_MAP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPORT_MAP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class SeedProbe {
  adventures = $repository(adventures);
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroQuests = $repository(heroQuests);
  partyAdventureStates = $repository(partyAdventureStates);
  authoredQuestRewardClaims = $repository(authoredQuestRewardClaims);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let partyRoom: PartyRoom;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  partyRoom = alepha.inject(PartyRoom);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ token: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({ body: { intentId: intent.data.intentId } });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { token: tokens.access_token };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function newPlayableAdventureWithMap(
  token: string,
): Promise<{ adventureId: string; mapId: string }> {
  const response = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; defaultMap: { id: string } };
  return { adventureId: created.id, mapId: created.defaultMap.id };
}

async function newParty(token: string, adventureId: string): Promise<string> {
  const response = await authedFetch("/api/parties", token, {
    method: "POST",
    body: JSON.stringify({ adventureId }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Creates one fresh party (no hero) end-to-end and returns its id. */
async function newPartyOnly(prefix: string): Promise<{ partyId: string; adventureId: string }> {
  const { token } = await registerAndLogin(prefix);
  const { adventureId } = await newPlayableAdventureWithMap(token);
  const partyId = await newParty(token, adventureId);
  return { partyId, adventureId };
}

/** Creates one fresh party AND one fresh hero in it, end-to-end. */
async function newPartyWithHero(
  prefix: string,
): Promise<{ partyId: string; adventureId: string; heroId: string }> {
  const { token } = await registerAndLogin(prefix);
  const { adventureId } = await newPlayableAdventureWithMap(token);
  const partyId = await newParty(token, adventureId);
  const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: "priest" }),
  });
  expect(response.status).toBe(201);
  const hero = (await response.json()) as { id: string };
  return { partyId, adventureId, heroId: hero.id };
}

/** A minimal, personal-scope, auto-completing quest — just enough registry content to exercise
 *  `acceptAuthoredQuest`/`completeAuthoredQuest`'s epoch fencing without a full objective-progress
 *  simulation (the room's `recordQuestEvent` path is Task 7's concern, not this task's). */
function buildPersonalQuest() {
  const quest = createAuthoredQuestDefinition("0001", "Offrande");
  return {
    ...quest,
    scope: "personal" as const,
    acceptance: "manual" as const,
    completion: "automatic" as const,
    abandonable: true,
    giver: { mapId: crypto.randomUUID(), eventId: crypto.randomUUID() },
    objectives: [createManualQuestObjective("0001", "Faire l'offrande", 1)],
    rewards: {
      ...quest.rewards,
      experience: 10,
      gold: 5,
      items: [{ itemId: HEALTH_POTION_ID, quantity: 1 }],
    },
  };
}

async function seedRegistryWithQuest(
  adventureId: string,
  quest: ReturnType<typeof buildPersonalQuest>,
) {
  const registry = { switches: [], variables: [], quests: [quest] };
  await probe.adventures.updateById(adventureId, { registry: JSON.stringify(registry) });
}

/** Writes a `hero_quest` row whose progress is already `completed` — standing in for the
 *  objective-progress simulation `recordQuestEvent` (Task 7) would normally drive. */
async function seedCompletedPersonalProgress(
  heroId: string,
  quest: ReturnType<typeof buildPersonalQuest>,
) {
  await probe.heroQuests.create({
    id: crypto.randomUUID(),
    heroId,
    questId: quest.id,
    status: "completed",
    progress: 1,
    data: {
      authoredProgress: {
        status: "completed",
        objectives: { "0001": 1 },
        definitionSnapshot: quest,
        definitionVersion: 1,
        rewardClaimed: false,
        completionCount: 0,
        processedEventKeys: [],
      },
    },
  });
}

async function reserveHarvestNode(
  partyId: string,
  request: Omit<ReserveHarvestNodeRequest, "goldValue" | "sessionEpoch"> & {
    goldValue?: number;
    sessionEpoch?: number;
  },
): Promise<ReserveHarvestNodeResult> {
  return (await partyRoom.room.call(partyId, "reserveHarvestNode", {
    goldValue: 0,
    sessionEpoch: 0,
    ...request,
  })) as ReserveHarvestNodeResult;
}

async function hitHarvestNode(
  partyId: string,
  request: { heroId: string; eventId: string; reservationId: string },
): Promise<HitHarvestNodeResult> {
  return (await partyRoom.room.call(partyId, "hitHarvestNode", request)) as HitHarvestNodeResult;
}

async function reserveMaterials(
  partyId: string,
  reservationId: string,
  heroId: string,
  costs: Record<string, number>,
  mapId = SUPPORT_MAP_A,
): Promise<PartyMaterialReservationResult> {
  return (await partyRoom.room.call(partyId, "reservePartyMaterials", {
    reservationId,
    heroId,
    roomKey: `${partyId}:${mapId}`,
    costs,
  })) as PartyMaterialReservationResult;
}

function materialIdentity(
  partyId: string,
  reservationId: string,
  heroId: string,
  costs: Record<string, number>,
  mapId = SUPPORT_MAP_A,
) {
  return { reservationId, heroId, roomKey: `${partyId}:${mapId}`, costs };
}

function evictPartyRoom(partyId: string): void {
  const provider = alepha.inject(WebSocketServerProvider) as unknown as {
    roomEngines: Map<string, { dispose(): void }>;
    roomEngineTouched: Map<string, number>;
  };
  const key = `/ws/party:${partyId}`;
  provider.roomEngines.get(key)?.dispose();
  provider.roomEngines.delete(key);
  provider.roomEngineTouched.delete(key);
}

describe("applyStateChanges", () => {
  test("bumps the version and lands in D1 immediately, no clock advance", async () => {
    const { partyId } = await newPartyOnly("applybump");

    await partyRoom.room.call(partyId, "applyStateChanges", [
      { type: "setSwitch", switchId: "0001", value: true },
    ]);

    const row = await probe.partyAdventureStates.findById(partyId);
    expect(row?.version).toBe(1);
    expect(JSON.parse(row?.switches ?? "{}")).toEqual({ "0001": true });
  });

  test("two racing calls serialize: both applied, version +2, no lost update", async () => {
    const { partyId } = await newPartyOnly("applyrace");

    // Fired without awaiting in between — the room's per-party write queue must still serialize
    // the read-modify-write so neither mutation clobbers the other.
    await Promise.all([
      partyRoom.room.call(partyId, "applyStateChanges", [
        { type: "setSwitch", switchId: "0001", value: true },
      ]),
      partyRoom.room.call(partyId, "applyStateChanges", [
        { type: "setSwitch", switchId: "0002", value: true },
      ]),
    ]);

    const row = await probe.partyAdventureStates.findById(partyId);
    expect(row?.version).toBe(2);
    expect(JSON.parse(row?.switches ?? "{}")).toEqual({ "0001": true, "0002": true });
  });

  test("pushToRoom receives the committed (state, version) AFTER the D1 write", async () => {
    const { partyId } = await newPartyOnly("applypush");
    await partyRoom.room.call(partyId, "registerRoom", `${partyId}:map`);

    const calls: { roomKey: string; version: number; switches: Record<string, boolean> }[] = [];
    partyRoom.pushToRoom = async (roomKey, state, version) => {
      // Read D1 directly inside the callback: if the write hadn't landed yet, this would still
      // show the PREVIOUS version.
      const row = await probe.partyAdventureStates.findById(partyId);
      expect(row?.version).toBe(version);
      calls.push({ roomKey, version, switches: state.switches });
    };

    await partyRoom.room.call(partyId, "applyStateChanges", [
      { type: "setSwitch", switchId: "0001", value: true },
    ]);

    expect(calls).toEqual([{ roomKey: `${partyId}:map`, version: 1, switches: { "0001": true } }]);
  });

  test("a throwing pushToRoom does not lose the D1 write", async () => {
    const { partyId } = await newPartyOnly("applypushthrow");
    await partyRoom.room.call(partyId, "registerRoom", `${partyId}:map`);
    partyRoom.pushToRoom = async () => {
      throw new Error("world room unreachable");
    };

    await partyRoom.room.call(partyId, "applyStateChanges", [
      { type: "setSwitch", switchId: "0001", value: true },
    ]);

    const row = await probe.partyAdventureStates.findById(partyId);
    expect(row?.version).toBe(1);
    expect(JSON.parse(row?.switches ?? "{}")).toEqual({ "0001": true });
  });
});

describe("shared party materials and harvest nodes", () => {
  const EVENT_A = "11111111-1111-4111-8111-111111111111";
  const EVENT_B = "22222222-2222-4222-8222-222222222222";
  const OTHER_HERO = "33333333-3333-4333-8333-333333333333";

  async function grantMaterials(
    partyId: string,
    heroId: string,
    reward: Record<string, number>,
    eventId = EVENT_A,
  ): Promise<void> {
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId,
      generation: 0,
      requiredHits: 1,
      reward,
      respawnDelayMs: null,
    });
    if (!reservation.ok)
      throw new Error(`material grant reservation failed: ${reservation.reason}`);
    const hit = await hitHarvestNode(partyId, {
      heroId,
      eventId,
      reservationId: reservation.reservationId,
    });
    if (!hit.ok) throw new Error(`material grant hit failed: ${hit.reason}`);
  }

  test("old parties load empty stock and node state without creating a row", async () => {
    const { partyId } = await newPartyOnly("harvestdefault");

    const loaded = (await partyRoom.room.call(partyId, "getAdventureState")) as {
      state: { materials: unknown; harvestNodes: unknown };
      version: number;
    };

    expect(loaded).toMatchObject({
      version: 0,
      state: {
        materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
        harvestNodes: {},
      },
    });
    expect(loaded).not.toHaveProperty("supportSpends");
    expect(await probe.partyAdventureStates.findById(partyId)).toBeUndefined();
  });

  test("racing reservations and replayed hits credit one durable reward", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvestrace");
    partyRoom.now = () => 1_000;
    const base = {
      eventId: EVENT_A,
      generation: 0,
      requiredHits: 1,
      reward: { wood: 5 },
      respawnDelayMs: null,
    } as const;

    const reservations = await Promise.all([
      reserveHarvestNode(partyId, { ...base, heroId }),
      reserveHarvestNode(partyId, { ...base, heroId: OTHER_HERO }),
    ]);
    expect(reservations.filter((result) => result.ok)).toHaveLength(1);
    expect(reservations.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "busy" }]);
    const accepted = reservations.find((result) => result.ok);
    if (!accepted?.ok) throw new Error("no accepted reservation");
    const acceptedHero = reservations[0]?.ok ? heroId : OTHER_HERO;

    const hits = await Promise.all([
      hitHarvestNode(partyId, {
        heroId: acceptedHero,
        eventId: EVENT_A,
        reservationId: accepted.reservationId,
      }),
      hitHarvestNode(partyId, {
        heroId: acceptedHero,
        eventId: EVENT_A,
        reservationId: accepted.reservationId,
      }),
    ]);
    expect(hits.filter((result) => result.ok)).toHaveLength(1);
    expect(hits.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "reservation" }]);

    const row = await probe.partyAdventureStates.findById(partyId);
    expect(row?.version).toBe(1);
    expect(JSON.parse(row?.materials ?? "{}")).toEqual({ wood: 5, stone: 0, iron: 0, meat: 0 });
    expect(JSON.parse(row?.harvestNodes ?? "{}")).toEqual({
      [EVENT_A]: {
        eventId: EVENT_A,
        generation: 0,
        hits: 1,
        lastHitAt: 1_000,
        depleted: true,
        depletedAt: 1_000,
        respawnAt: null,
      },
    });

    // A fresh room engine (the reconnect/eviction case) must rebuild from D1, not from the old
    // in-memory cache.
    evictPartyRoom(partyId);
    const reloaded = (await partyRoom.room.call(partyId, "getAdventureState")) as {
      state: { materials: unknown; harvestNodes: unknown };
      version: number;
    };
    expect(reloaded).toMatchObject({
      version: 1,
      state: {
        materials: { wood: 5, stone: 0, iron: 0, meat: 0 },
        harvestNodes: { [EVENT_A]: { generation: 0, depleted: true } },
      },
    });
  });

  test("an explicitly namespaced animal carcass yields meat once", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvestcarcass");
    partyRoom.now = () => 1_500;
    const eventId = "carcass:verdant-reach:farm-war-pig";
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId,
      generation: 0,
      requiredHits: 1,
      reward: { meat: 3 },
      goldValue: 0,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("carcass reservation rejected");
    const first = await hitHarvestNode(partyId, {
      heroId,
      eventId,
      reservationId: reservation.reservationId,
    });
    expect(first).toMatchObject({
      ok: true,
      rewarded: true,
      goldValue: 0,
      materials: { wood: 0, stone: 0, iron: 0, meat: 3 },
    });
    expect(
      await hitHarvestNode(partyId, {
        heroId,
        eventId,
        reservationId: reservation.reservationId,
      }),
    ).toEqual({ ok: false, reason: "reservation" });
    const row = await probe.partyAdventureStates.findById(partyId);
    expect(JSON.parse(row?.materials ?? "{}")).toEqual({ wood: 0, stone: 0, iron: 0, meat: 3 });
    expect(JSON.parse(row?.harvestNodes ?? "{}")[eventId]).toMatchObject({
      generation: 0,
      depleted: true,
    });
  });

  test("an authored gold resource depletes once without creating parallel material currency", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvestgold");
    partyRoom.now = () => 1_600;
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: {},
      goldValue: 25,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("gold reservation rejected");
    const first = await hitHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      reservationId: reservation.reservationId,
    });
    expect(first).toMatchObject({
      ok: true,
      rewarded: true,
      goldValue: 25,
      materials: { wood: 0, stone: 0, iron: 0, meat: 0 },
    });
    expect(
      await hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_B,
        reservationId: reservation.reservationId,
      }),
    ).toEqual({ ok: false, reason: "reservation" });
    const row = await probe.partyAdventureStates.findById(partyId);
    expect(JSON.parse(row?.materials ?? "{}")).toEqual({ wood: 0, stone: 0, iron: 0, meat: 0 });
    expect(JSON.parse(row?.harvestNodes ?? "{}")[EVENT_B]).toMatchObject({
      generation: 0,
      depleted: true,
    });
    expect((await probe.heroes.findById(heroId))?.gold).toBe(0);
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(25);
  });

  test("a stale hero epoch cannot deplete a gold resource", async () => {
    const { partyId, heroId } = await newPartyWithHero("hgfen");
    await probe.heroes.updateById(heroId, { sessionEpoch: 1 });
    partyRoom.now = () => 1_700;
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      sessionEpoch: 0,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: {},
      goldValue: 25,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("gold reservation rejected");

    expect(
      await hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_B,
        reservationId: reservation.reservationId,
      }),
    ).toEqual({ ok: false, reason: "fence" });
    expect(await probe.partyAdventureStates.findById(partyId)).toBeUndefined();
    expect(await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId)).toEqual([]);
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(0);
  });

  test("reconnect reconciliation settles gold after depletion outlives its acknowledgement", async () => {
    const { partyId, heroId } = await newPartyWithHero("hgrec");
    partyRoom.now = () => 1_800;
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: {},
      goldValue: 25,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("gold reservation rejected");
    const settle = vi
      .spyOn(partyRoom.adventureStateService, "settleHarvestGoldClaim")
      .mockResolvedValueOnce(false);

    expect(
      await hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_B,
        reservationId: reservation.reservationId,
      }),
    ).toMatchObject({ ok: true, rewarded: true, goldValue: 0, goldPending: true });
    settle.mockRestore();
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(0);
    expect(
      await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId),
    ).toHaveLength(1);

    // A fresh room plus a newer presence epoch reproduces the reconnect after the response was
    // lost. The durable depleted generation is the proof that makes settlement safe.
    evictPartyRoom(partyId);
    await probe.heroes.updateById(heroId, { sessionEpoch: 1 });
    await partyRoom.room.call(partyId, "reconcileHarvestGoldClaims");
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(25);
    expect(await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId)).toEqual([]);

    // Replaying admission/reconciliation remains idempotent.
    await partyRoom.room.call(partyId, "reconcileHarvestGoldClaims");
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(25);
  });

  test("a failed depletion write is aborted only after durable reconciliation", async () => {
    const { partyId, heroId } = await newPartyWithHero("hgroll");
    partyRoom.now = () => 1_900;
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: {},
      goldValue: 25,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("gold reservation rejected");
    const save = vi
      .spyOn(partyRoom.adventureStateService, "save")
      .mockRejectedValueOnce(new Error("simulated D1 write failure"));

    await expect(
      hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_B,
        reservationId: reservation.reservationId,
      }),
    ).rejects.toThrow("simulated D1 write failure");
    save.mockRestore();
    expect(
      await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId),
    ).toHaveLength(1);
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(0);

    await partyRoom.room.call(partyId, "reconcileHarvestGoldClaims");
    expect(await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId)).toEqual([]);
    const reloaded = (await partyRoom.room.call(partyId, "getAdventureState")) as {
      state: { harvestNodes: Record<string, unknown> };
    };
    expect(reloaded.state.harvestNodes).toEqual({});
  });

  test("a committed depletion with a lost D1 acknowledgement settles instead of aborting", async () => {
    const { partyId, heroId } = await newPartyWithHero("hgack");
    partyRoom.now = () => 1_950;
    await partyRoom.room.call(partyId, "registerRoom", `${partyId}:map`);
    const pushed: Array<{ version: number; depleted: boolean | undefined }> = [];
    partyRoom.pushToRoom = async (_roomKey, state, version) => {
      pushed.push({ version, depleted: state.harvestNodes?.[EVENT_B]?.depleted });
    };
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: {},
      goldValue: 25,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("gold reservation rejected");
    const originalSave = partyRoom.adventureStateService.save.bind(partyRoom.adventureStateService);
    const save = vi
      .spyOn(partyRoom.adventureStateService, "save")
      .mockImplementationOnce(async (savedPartyId, state, version) => {
        await originalSave(savedPartyId, state, version);
        throw new Error("simulated lost D1 acknowledgement");
      });

    await expect(
      hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_B,
        reservationId: reservation.reservationId,
      }),
    ).rejects.toThrow("simulated lost D1 acknowledgement");
    save.mockRestore();
    expect(
      await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId),
    ).toHaveLength(1);
    expect(
      JSON.parse((await probe.partyAdventureStates.findById(partyId))?.harvestNodes ?? "{}"),
    ).toHaveProperty(`${EVENT_B}.depleted`, true);
    expect(pushed).toEqual([]);

    await partyRoom.room.call(partyId, "reconcileHarvestGoldClaims");
    expect(await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId)).toEqual([]);
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(25);
    expect(pushed).toEqual([{ version: 1, depleted: true }]);
  });

  test("transient strict state or registry reads leave a prepared reward retryable", async () => {
    const { partyId, heroId } = await newPartyWithHero("hgread");
    partyRoom.now = () => 1_975;
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: {},
      goldValue: 25,
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("gold reservation rejected");
    const settle = vi
      .spyOn(partyRoom.adventureStateService, "settleHarvestGoldClaim")
      .mockResolvedValueOnce(false);
    await hitHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      reservationId: reservation.reservationId,
    });
    settle.mockRestore();
    const read = vi
      .spyOn(partyRoom.adventureStateService.partyAdventureStates, "findById")
      .mockRejectedValueOnce(new Error("simulated D1 read failure"));

    await expect(partyRoom.room.call(partyId, "reconcileHarvestGoldClaims")).rejects.toThrow(
      "simulated D1 read failure",
    );
    read.mockRestore();
    expect(
      await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId),
    ).toHaveLength(1);
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(0);

    const registryRead = vi
      .spyOn(partyRoom.adventureStateService.adventures, "findById")
      .mockRejectedValueOnce(new Error("simulated registry read failure"));
    await expect(partyRoom.room.call(partyId, "reconcileHarvestGoldClaims")).rejects.toThrow(
      "simulated registry read failure",
    );
    registryRead.mockRestore();
    expect(
      await partyRoom.adventureStateService.loadPendingHarvestGoldClaims(partyId),
    ).toHaveLength(1);
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(0);

    await partyRoom.room.call(partyId, "reconcileHarvestGoldClaims");
    expect(await partyRoom.adventureStateService.harvestGoldLedgerTotal(heroId)).toBe(25);
  });

  test("a disconnected harvester loses only its volatile reservation", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvdisc");
    partyRoom.now = () => 2_000;
    const first = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 2,
      reward: { stone: 3 },
      respawnDelayMs: null,
    });
    expect(first.ok).toBe(true);

    evictPartyRoom(partyId);
    const replacement = await reserveHarvestNode(partyId, {
      heroId: OTHER_HERO,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 2,
      reward: { stone: 3 },
      respawnDelayMs: null,
    });
    expect(replacement).toMatchObject({ ok: true, node: { generation: 0, hits: 0 } });
  });

  test("concurrent consumption cannot overspend the shared stock", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvestspend");
    partyRoom.now = () => 3_000;
    const reservation = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      generation: 0,
      requiredHits: 1,
      reward: { iron: 2 },
      respawnDelayMs: null,
    });
    if (!reservation.ok) throw new Error("reservation rejected");
    expect(
      await hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_A,
        reservationId: reservation.reservationId,
      }),
    ).toMatchObject({ ok: true, rewarded: true });

    const spent = (await Promise.all([
      partyRoom.room.call(partyId, "consumePartyMaterials", { iron: 2 }),
      partyRoom.room.call(partyId, "consumePartyMaterials", { iron: 2 }),
    ])) as ConsumePartyMaterialsResult[];
    expect(spent.filter((result) => result.ok)).toEqual([
      { ok: true, materials: { wood: 0, stone: 0, iron: 0, meat: 0 } },
    ]);
    expect(spent.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "insufficient" }]);

    const row = await probe.partyAdventureStates.findById(partyId);
    expect(row?.version).toBe(2);
    expect(JSON.parse(row?.materials ?? "{}")).toEqual({ wood: 0, stone: 0, iron: 0, meat: 0 });
  });

  test("support reservations serialize shared stock and explicit abort refunds exactly once", async () => {
    const { partyId, heroId } = await newPartyWithHero("supportreserve");
    partyRoom.now = () => 4_000;
    const harvest = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      generation: 0,
      requiredHits: 1,
      reward: { wood: 4 },
      respawnDelayMs: null,
    });
    if (!harvest.ok) throw new Error("harvest reservation rejected");
    await hitHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      reservationId: harvest.reservationId,
    });
    const reservationA = "44444444-4444-4444-8444-444444444444";
    const reservationB = "55555555-5555-4555-8555-555555555555";
    const raced = await Promise.all([
      reserveMaterials(partyId, reservationA, heroId, { wood: 4 }),
      reserveMaterials(partyId, reservationB, OTHER_HERO, { wood: 4 }),
    ]);
    expect(raced.filter((result) => result.ok)).toHaveLength(1);
    expect(raced.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "insufficient" }]);
    const acceptedId = raced[0]?.ok ? reservationA : reservationB;
    const acceptedHero = raced[0]?.ok ? heroId : OTHER_HERO;
    const identity = materialIdentity(partyId, acceptedId, acceptedHero, { wood: 4 });
    expect(await partyRoom.room.call(partyId, "commitPartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "committed",
      materials: { wood: 0 },
    });
    expect(await partyRoom.room.call(partyId, "releasePartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "refunded",
      materials: { wood: 4 },
    });
    expect(await partyRoom.room.call(partyId, "releasePartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "refunded",
      materials: { wood: 4 },
    });
  });

  test("an expired hold releases stock while a committed spend waits for an explicit decision", async () => {
    const { partyId, heroId } = await newPartyWithHero("supportexpiry");
    let now = 5_000;
    partyRoom.now = () => now;
    const harvest = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      generation: 0,
      requiredHits: 1,
      reward: { stone: 2 },
      respawnDelayMs: null,
    });
    if (!harvest.ok) throw new Error("harvest reservation rejected");
    await hitHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      reservationId: harvest.reservationId,
    });
    const heldId = "66666666-6666-4666-8666-666666666666";
    expect(await reserveMaterials(partyId, heldId, heroId, { stone: 2 })).toMatchObject({
      ok: true,
      status: "held",
    });
    now += 10_001;
    const committedId = "77777777-7777-4777-8777-777777777777";
    expect(await reserveMaterials(partyId, committedId, heroId, { stone: 2 })).toMatchObject({
      ok: true,
      status: "held",
    });
    const identity = materialIdentity(partyId, committedId, heroId, { stone: 2 });
    expect(await partyRoom.room.call(partyId, "commitPartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "committed",
      materials: { stone: 0 },
    });
    now += 60_001;
    expect(
      await reserveMaterials(partyId, "88888888-8888-4888-8888-888888888888", heroId, { stone: 1 }),
    ).toEqual({ ok: false, reason: "insufficient" });
    expect(await partyRoom.room.call(partyId, "releasePartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "refunded",
      materials: { stone: 2 },
    });
  });

  test("a committed spend survives coordinator eviction and is refunded when its room never activated", async () => {
    const { partyId, heroId } = await newPartyWithHero("supcrash");
    partyRoom.now = () => 20_000;
    await grantMaterials(partyId, heroId, { wood: 4 });
    const reservationId = "99999999-9999-4999-8999-999999999999";
    const identity = materialIdentity(partyId, reservationId, heroId, { wood: 4 });
    expect(await reserveMaterials(partyId, reservationId, heroId, { wood: 4 })).toMatchObject({
      ok: true,
      status: "held",
    });
    expect(await partyRoom.room.call(partyId, "commitPartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "committed",
      materials: { wood: 0 },
    });

    evictPartyRoom(partyId);
    const reconciled = await partyRoom.room.call(partyId, "reconcilePartyMaterialSpends", {
      roomKey: `${partyId}:${SUPPORT_MAP_A}`,
      activatedIds: [],
    });
    expect(reconciled).toMatchObject({ ok: true, materials: { wood: 4 } });
    const row = await probe.partyAdventureStates.findById(partyId);
    expect(JSON.parse(row?.supportSpends ?? "{}")[reservationId]).toMatchObject({
      status: "refunded",
      roomKey: `${partyId}:${SUPPORT_MAP_A}`,
    });
  });

  test("a lost settlement acknowledgement reloads as settled after coordinator eviction", async () => {
    const { partyId, heroId } = await newPartyWithHero("supsetack");
    partyRoom.now = () => 21_000;
    await grantMaterials(partyId, heroId, { iron: 2 });
    const reservationId = "aaaaaaaa-1111-4111-8111-111111111111";
    const identity = materialIdentity(partyId, reservationId, heroId, { iron: 2 });
    await reserveMaterials(partyId, reservationId, heroId, { iron: 2 });
    await partyRoom.room.call(partyId, "commitPartyMaterials", identity);

    const service = partyRoom.adventureStateService;
    const save = service.saveWithSupportSpends.bind(service);
    const write = vi
      .spyOn(service, "saveWithSupportSpends")
      .mockImplementationOnce(async (...args) => {
        await save(...args);
        throw new Error("settlement acknowledgement lost");
      });
    await expect(partyRoom.room.call(partyId, "settlePartyMaterials", identity)).rejects.toThrow(
      "settlement acknowledgement lost",
    );
    write.mockRestore();

    evictPartyRoom(partyId);
    expect(
      await partyRoom.room.call(partyId, "reconcilePartyMaterialSpends", {
        roomKey: `${partyId}:${SUPPORT_MAP_A}`,
        activatedIds: [reservationId],
      }),
    ).toMatchObject({ ok: true, materials: { iron: 0 } });
    const row = await probe.partyAdventureStates.findById(partyId);
    expect(JSON.parse(row?.supportSpends ?? "{}")[reservationId]).toMatchObject({
      status: "settled",
    });
  });

  test("an ambiguous commit invalidates the cache and an idempotent release reloads and refunds", async () => {
    const { partyId, heroId } = await newPartyWithHero("supcomack");
    partyRoom.now = () => 22_000;
    await grantMaterials(partyId, heroId, { stone: 2 });
    const reservationId = "aaaaaaaa-2222-4222-8222-222222222222";
    const identity = materialIdentity(partyId, reservationId, heroId, { stone: 2 });
    await reserveMaterials(partyId, reservationId, heroId, { stone: 2 });

    const service = partyRoom.adventureStateService;
    const save = service.saveWithSupportSpends.bind(service);
    const write = vi
      .spyOn(service, "saveWithSupportSpends")
      .mockImplementationOnce(async (...args) => {
        await save(...args);
        throw new Error("commit acknowledgement lost");
      });
    await expect(partyRoom.room.call(partyId, "commitPartyMaterials", identity)).rejects.toThrow(
      "commit acknowledgement lost",
    );
    write.mockRestore();

    expect(await partyRoom.room.call(partyId, "releasePartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "refunded",
      materials: { stone: 2 },
    });
    expect(await partyRoom.room.call(partyId, "releasePartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "refunded",
      materials: { stone: 2 },
    });
  });

  test("settlement and release acknowledgements are idempotent tombstone reads", async () => {
    const { partyId, heroId } = await newPartyWithHero("supidem");
    partyRoom.now = () => 23_000;
    await grantMaterials(partyId, heroId, { wood: 8 });
    const settledId = "aaaaaaaa-3333-4333-8333-333333333333";
    const settledIdentity = materialIdentity(partyId, settledId, heroId, { wood: 4 });
    await reserveMaterials(partyId, settledId, heroId, { wood: 4 });
    await partyRoom.room.call(partyId, "commitPartyMaterials", settledIdentity);
    expect(
      await partyRoom.room.call(partyId, "settlePartyMaterials", settledIdentity),
    ).toMatchObject({
      ok: true,
      status: "settled",
      materials: { wood: 4 },
    });
    expect(
      await partyRoom.room.call(partyId, "settlePartyMaterials", settledIdentity),
    ).toMatchObject({
      ok: true,
      status: "settled",
      materials: { wood: 4 },
    });

    const releasedId = "aaaaaaaa-4444-4444-8444-444444444444";
    const releasedIdentity = materialIdentity(partyId, releasedId, heroId, { wood: 4 });
    await reserveMaterials(partyId, releasedId, heroId, { wood: 4 });
    expect(
      await partyRoom.room.call(partyId, "releasePartyMaterials", releasedIdentity),
    ).toMatchObject({
      ok: true,
      status: "released",
      materials: { wood: 4 },
    });
    expect(
      await partyRoom.room.call(partyId, "releasePartyMaterials", releasedIdentity),
    ).toMatchObject({
      ok: true,
      status: "released",
      materials: { wood: 4 },
    });
  });

  test("durable committed refunds reserve harvest capacity at the material ceiling", async () => {
    const { partyId, heroId } = await newPartyWithHero("supover");
    partyRoom.now = () => 24_000;
    await grantMaterials(partyId, heroId, { wood: 999_999 });
    const reservationId = "aaaaaaaa-5555-4555-8555-555555555555";
    const identity = materialIdentity(partyId, reservationId, heroId, { wood: 1 });
    await reserveMaterials(partyId, reservationId, heroId, { wood: 1 });
    await partyRoom.room.call(partyId, "commitPartyMaterials", identity);

    const reward = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_B,
      generation: 0,
      requiredHits: 1,
      reward: { wood: 1 },
      respawnDelayMs: null,
    });
    if (!reward.ok) throw new Error("overflow harvest reservation rejected unexpectedly");
    expect(
      await hitHarvestNode(partyId, {
        heroId,
        eventId: EVENT_B,
        reservationId: reward.reservationId,
      }),
    ).toEqual({ ok: false, reason: "overflow" });
    expect(await partyRoom.room.call(partyId, "releasePartyMaterials", identity)).toMatchObject({
      ok: true,
      status: "refunded",
      materials: { wood: 999_999 },
    });
  });

  test("room reconciliation never decides another room's committed spend", async () => {
    const { partyId, heroId } = await newPartyWithHero("supiso");
    partyRoom.now = () => 25_000;
    await grantMaterials(partyId, heroId, { wood: 8 });
    const idA = "aaaaaaaa-6666-4666-8666-666666666666";
    const idB = "aaaaaaaa-7777-4777-8777-777777777777";
    const identityA = materialIdentity(partyId, idA, heroId, { wood: 4 }, SUPPORT_MAP_A);
    const identityB = materialIdentity(partyId, idB, heroId, { wood: 4 }, SUPPORT_MAP_B);
    await reserveMaterials(partyId, idA, heroId, { wood: 4 }, SUPPORT_MAP_A);
    await partyRoom.room.call(partyId, "commitPartyMaterials", identityA);
    await reserveMaterials(partyId, idB, heroId, { wood: 4 }, SUPPORT_MAP_B);
    await partyRoom.room.call(partyId, "commitPartyMaterials", identityB);

    expect(
      await partyRoom.room.call(partyId, "reconcilePartyMaterialSpends", {
        roomKey: `${partyId}:${SUPPORT_MAP_A}`,
        activatedIds: [],
      }),
    ).toMatchObject({ ok: true, materials: { wood: 4 } });
    let row = await probe.partyAdventureStates.findById(partyId);
    let journal = JSON.parse(row?.supportSpends ?? "{}") as Record<string, { status: string }>;
    expect(journal[idA]?.status).toBe("refunded");
    expect(journal[idB]?.status).toBe("committed");

    expect(
      await partyRoom.room.call(partyId, "reconcilePartyMaterialSpends", {
        roomKey: `${partyId}:${SUPPORT_MAP_B}`,
        activatedIds: [idB],
      }),
    ).toMatchObject({ ok: true, materials: { wood: 4 } });
    row = await probe.partyAdventureStates.findById(partyId);
    journal = JSON.parse(row?.supportSpends ?? "{}") as Record<string, { status: string }>;
    expect(journal[idB]?.status).toBe("settled");
  });

  test("ordinary state saves preserve the private support-spend journal", async () => {
    const { partyId, heroId } = await newPartyWithHero("supsave");
    partyRoom.now = () => 26_000;
    await grantMaterials(partyId, heroId, { meat: 2 });
    const reservationId = "aaaaaaaa-8888-4888-8888-888888888888";
    const identity = materialIdentity(partyId, reservationId, heroId, { meat: 2 });
    await reserveMaterials(partyId, reservationId, heroId, { meat: 2 });
    await partyRoom.room.call(partyId, "commitPartyMaterials", identity);
    const before = await probe.partyAdventureStates.findById(partyId);

    const held = (await partyRoom.room.call(partyId, "getAdventureState")) as {
      state: Parameters<typeof partyRoom.adventureStateService.save>[1];
      version: number;
    };
    await partyRoom.adventureStateService.save(partyId, held.state, held.version + 1);
    const after = await probe.partyAdventureStates.findById(partyId);
    expect(after?.supportSpends).toBe(before?.supportSpends);
  });

  test("malformed public or private coordinator JSON fails closed without changing stock", async () => {
    const { partyId, heroId } = await newPartyWithHero("supbad");
    partyRoom.now = () => 27_000;
    await grantMaterials(partyId, heroId, { iron: 2 });
    const reservationId = "aaaaaaaa-9999-4999-8999-999999999999";
    const identity = materialIdentity(partyId, reservationId, heroId, { iron: 2 });
    await reserveMaterials(partyId, reservationId, heroId, { iron: 2 });
    await partyRoom.room.call(partyId, "commitPartyMaterials", identity);
    await probe.partyAdventureStates.updateById(partyId, { switches: "[" });
    evictPartyRoom(partyId);
    await expect(
      partyRoom.room.call(partyId, "reconcilePartyMaterialSpends", {
        roomKey: `${partyId}:${SUPPORT_MAP_A}`,
        activatedIds: [],
      }),
    ).rejects.toThrow("cannot load coordinator from invalid_json party state");
    let row = await probe.partyAdventureStates.findById(partyId);
    expect(JSON.parse(row?.materials ?? "{}").iron).toBe(0);
    expect(JSON.parse(row?.supportSpends ?? "{}")[reservationId].status).toBe("committed");

    await probe.partyAdventureStates.updateById(partyId, { switches: "{}", supportSpends: "[" });
    evictPartyRoom(partyId);
    await expect(
      reserveMaterials(partyId, "bbbbbbbb-1111-4111-8111-111111111111", heroId, { iron: 1 }),
    ).rejects.toThrow("cannot load invalid support-spend JSON");
    row = await probe.partyAdventureStates.findById(partyId);
    expect(JSON.parse(row?.materials ?? "{}").iron).toBe(0);
  });

  test("timed respawn advances generation before accepting another hit", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvestrespawn");
    let now = 10_000;
    partyRoom.now = () => now;
    const first = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      generation: 0,
      requiredHits: 1,
      reward: { meat: 2 },
      respawnDelayMs: 100,
    });
    if (!first.ok) throw new Error("reservation rejected");
    await hitHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      reservationId: first.reservationId,
    });

    now = 10_099;
    expect(
      await reserveHarvestNode(partyId, {
        heroId,
        eventId: EVENT_A,
        generation: 0,
        requiredHits: 1,
        reward: { meat: 2 },
        respawnDelayMs: 100,
      }),
    ).toEqual({ ok: false, reason: "depleted" });

    now = 10_100;
    expect(
      await reserveHarvestNode(partyId, {
        heroId,
        eventId: EVENT_A,
        generation: 0,
        requiredHits: 1,
        reward: { meat: 2 },
        respawnDelayMs: 100,
      }),
    ).toEqual({ ok: false, reason: "generation" });
    const second = await reserveHarvestNode(partyId, {
      heroId,
      eventId: EVENT_A,
      generation: 1,
      requiredHits: 1,
      reward: { meat: 2 },
      respawnDelayMs: 100,
    });
    expect(second).toMatchObject({ ok: true, node: { generation: 1, hits: 0, depleted: false } });
  });

  test("invalid material and node inputs mutate nothing", async () => {
    const { partyId, heroId } = await newPartyWithHero("harvestinvalid");

    expect(
      await partyRoom.room.call(partyId, "reserveHarvestNode", {
        heroId,
        eventId: EVENT_A,
        generation: 0,
        requiredHits: 1,
        reward: { gold: 100 },
        respawnDelayMs: null,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await partyRoom.room.call(partyId, "reserveHarvestNode", {
        heroId,
        eventId: EVENT_A,
        generation: -1,
        requiredHits: 1,
        reward: { wood: 1 },
        respawnDelayMs: null,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await partyRoom.room.call(partyId, "consumePartyMaterials", { wood: -1 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await partyRoom.room.call(partyId, "consumePartyMaterials", { gold: 1 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await probe.partyAdventureStates.findById(partyId)).toBeUndefined();
  });
});

describe("registerRoom / roomEmptied / broadcastToParty", () => {
  test("the directory tracks registered rooms; broadcast fans out only to those", async () => {
    const partyId = crypto.randomUUID();
    const roomA = `${partyId}:map-a`;
    const roomB = `${partyId}:map-b`;
    const delivered: string[] = [];
    partyRoom.sendToRoom = async (roomKey) => {
      delivered.push(roomKey);
    };

    await partyRoom.room.call(partyId, "registerRoom", roomA);
    await partyRoom.room.call(partyId, "registerRoom", roomB);
    await partyRoom.room.call(partyId, "broadcastToParty", {
      t: "event",
      code: "test",
      params: {},
    });
    expect(delivered.sort()).toEqual([roomA, roomB]);

    delivered.length = 0;
    await partyRoom.room.call(partyId, "roomEmptied", roomA);
    await partyRoom.room.call(partyId, "broadcastToParty", {
      t: "event",
      code: "test",
      params: {},
    });
    expect(delivered).toEqual([roomB]);
  });
});

describe("acceptAuthoredQuest", () => {
  test("a stale-epoch actor mutates nothing", async () => {
    const { partyId, adventureId, heroId } = await newPartyWithHero("acceptstale");
    const quest = buildPersonalQuest();
    await seedRegistryWithQuest(adventureId, quest);
    const before = await probe.heroQuests.findMany({ where: { heroId: { eq: heroId } } });

    // Every synchronous check (target, availability, prerequisites) passes — the fenced personal-
    // progress write is the only thing standing between this actor and a written row, and a stale
    // epoch must refuse it, mutating nothing.
    const result = await partyRoom.room.call(
      partyId,
      "acceptAuthoredQuest",
      { heroId, sessionEpoch: 999, level: 1 },
      quest.id,
      quest.giver,
      {},
    );

    expect(result).toEqual({ ok: false, reason: "fence" });
    const after = await probe.heroQuests.findMany({ where: { heroId: { eq: heroId } } });
    expect(after).toEqual(before);
  });

  test("the correct epoch accepts and persists personal progress", async () => {
    const { partyId, adventureId, heroId } = await newPartyWithHero("acceptok");
    const quest = buildPersonalQuest();
    await seedRegistryWithQuest(adventureId, quest);
    const hero = await probe.heroes.findById(heroId);

    const result = await partyRoom.room.call(
      partyId,
      "acceptAuthoredQuest",
      { heroId, sessionEpoch: hero?.sessionEpoch ?? 0, level: 1 },
      quest.id,
      quest.giver,
      {},
    );

    expect(result).toMatchObject({ ok: true });
    // `HeroService.createHero` also seeds a default "three_offerings" row, so filter to this quest.
    const rows = await probe.heroQuests.findMany({
      where: { heroId: { eq: heroId }, questId: { eq: quest.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("active");
  });
});

describe("completeAuthoredQuest", () => {
  test("a stale-epoch actor mutates nothing (no reward claim, no gold, no item)", async () => {
    const { partyId, adventureId, heroId } = await newPartyWithHero("completestale");
    const quest = buildPersonalQuest();
    await seedRegistryWithQuest(adventureId, quest);
    await seedCompletedPersonalProgress(heroId, quest);
    const heroBefore = await probe.heroes.findById(heroId);
    const itemsBefore = await probe.heroItems.findMany({ where: { heroId: { eq: heroId } } });

    const result = await partyRoom.room.call(
      partyId,
      "completeAuthoredQuest",
      { heroId, sessionEpoch: (heroBefore?.sessionEpoch ?? 0) + 1, level: 1 },
      quest.id,
      null,
      undefined,
      { level: 1, xp: 0, hp: 100, inventory: {} },
    );

    expect(result).toEqual({ ok: false, reason: "fence" });
    const heroAfter = await probe.heroes.findById(heroId);
    expect(heroAfter).toEqual(heroBefore);
    const itemsAfter = await probe.heroItems.findMany({ where: { heroId: { eq: heroId } } });
    expect(itemsAfter).toEqual(itemsBefore);
    // Nothing changed means the reward-claim idempotency row was never written either — a stale
    // caller must not even register a future idempotency slot.
    const claims = await probe.authoredQuestRewardClaims.findMany({
      where: { ownerId: { eq: heroId }, questId: { eq: quest.id } },
    });
    expect(claims).toHaveLength(0);
  });

  test("the correct epoch claims the reward exactly once (gold, xp and item granted)", async () => {
    const { partyId, adventureId, heroId } = await newPartyWithHero("completeok");
    const quest = buildPersonalQuest();
    await seedRegistryWithQuest(adventureId, quest);
    await seedCompletedPersonalProgress(heroId, quest);
    const hero = await probe.heroes.findById(heroId);
    const goldBefore = hero?.gold ?? 0;

    const result = await partyRoom.room.call(
      partyId,
      "completeAuthoredQuest",
      { heroId, sessionEpoch: hero?.sessionEpoch ?? 0, level: 1 },
      quest.id,
      null,
      undefined,
      { level: 1, xp: 0, hp: 100, inventory: {} },
    );

    expect(result).toMatchObject({ ok: true, experience: 10, gold: 5 });
    const heroAfter = await probe.heroes.findById(heroId);
    expect(heroAfter?.gold).toBe(goldBefore + 5);
    const items = await probe.heroItems.findMany({
      where: { heroId: { eq: heroId }, itemDefinitionId: { eq: HEALTH_POTION_ID } },
    });
    expect(items).toHaveLength(1);

    // A second attempt must not silently double-grant. The progress row's own `rewardClaimed`
    // flag (persisted by the first `completeAuthoredQuest`) already rejects it at the state check,
    // before ever reaching the reward-claim table's uniqueness fence — that fence is defense in
    // depth for a race between two concurrent completions, not the only guard.
    const second = await partyRoom.room.call(
      partyId,
      "completeAuthoredQuest",
      { heroId, sessionEpoch: heroAfter?.sessionEpoch ?? 0, level: 1 },
      quest.id,
      null,
      undefined,
      { level: 1, xp: 0, hp: 100, inventory: {} },
    );
    expect(second).toEqual({ ok: false, reason: "state" });
  });
});
