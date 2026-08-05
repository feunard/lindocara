/**
 * End-to-end Peasant class contract: ordinary HTTP creation feeds the real Alepha repositories,
 * then the exact `WorldRoom.roomOptions` production uses validates talents, persists the hero and
 * restores it across fresh room sessions. No controller, admission or realtime seam is mocked.
 */

import { emptyCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { skillWithTalents } from "@lindocara/engine/talents.js";
import type { PlayerRuntime } from "@lindocara/server/world/world-runtime.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { heroEquipment } from "../src/api/entities/heroEquipment.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { heroSkills } from "../src/api/entities/heroSkills.ts";
import { PresenceRoom } from "../src/api/realtime/PresenceRoom.ts";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, provingHeightfield } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

class Probe {
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroEquipment = $repository(heroEquipment);
  heroSkills = $repository(heroSkills);
}

class FakeClock implements RoomClock {
  protected ms = 0;
  protected handlers = new Map<number, () => void>();
  protected nextId = 1;

  setInterval(fn: () => void): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.handlers.set(id, fn);
    return id;
  }

  clearInterval(handle: unknown): void {
    this.handlers.delete(handle as number);
  }

  now(): number {
    return this.ms;
  }
}

interface FakeSocket extends RoomSocket {
  sent: string[];
  closed?: { code?: number; reason?: string };
}

interface PeasantFixture {
  token: string;
  userId: string;
  partyId: string;
  mapId: string;
  roomId: string;
  heroId: string;
}

function fakeSocket(userId: string, heroId: string, connectionId: string): FakeSocket {
  const sent: string[] = [];
  const socket: FakeSocket = {
    id: connectionId,
    userId,
    query: { hero: heroId },
    data: {},
    sent,
    closed: undefined,
    sendRaw: (data: string) => {
      sent.push(data);
    },
    close: (code?: number, reason?: string) => {
      socket.closed = { code, reason };
    },
  };
  return socket;
}

/** Every frame through `parseServerMessage`, the single wire truth — never a bare `JSON.parse`, or
 *  a welcome the real client would drop would read here as a delivered admission. */
function messages(socket: FakeSocket, offset = 0): ServerMessage[] {
  return socket.sent.slice(offset).map((raw) => {
    const message = parseServerMessage(raw);
    if (message === null) {
      throw new Error(
        `the wire refused a '${String((JSON.parse(raw) as { t?: unknown }).t)}' frame`,
      );
    }
    return message;
  });
}

function welcome(socket: FakeSocket): Extract<ServerMessage, { t: "welcome" }> {
  const message = messages(socket).find(
    (candidate): candidate is Extract<ServerMessage, { t: "welcome" }> => candidate.t === "welcome",
  );
  if (!message) throw new Error("socket did not receive a welcome");
  return message;
}

function eventFrom(
  socket: FakeSocket,
  offset: number,
): Extract<ServerMessage, { t: "event" }> | undefined {
  return messages(socket, offset).find(
    (message): message is Extract<ServerMessage, { t: "event" }> => message.t === "event",
  );
}

function stateFrom(
  socket: FakeSocket,
  offset: number,
): Extract<ServerMessage, { t: "state" }> | undefined {
  return messages(socket, offset).find(
    (message): message is Extract<ServerMessage, { t: "state" }> => message.t === "state",
  );
}

function createEngine(roomId: string): RoomEngine<never, never, WorldRoomState> {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock: new FakeClock(),
    options: worldRoom.roomOptions,
    validate: () => {},
  }) as RoomEngine<never, never, WorldRoomState>;
}

function roomState(engine: object): WorldRoomState {
  return (engine as unknown as { state: WorldRoomState }).state;
}

function playerOf(state: WorldRoomState, heroId: string): PlayerRuntime {
  const connectionId = state.connectionIdByHeroId.get(heroId);
  const player = connectionId === undefined ? undefined : state.players.get(connectionId);
  if (!player) throw new Error(`hero ${heroId} is not admitted`);
  return player;
}

let alepha: ReturnType<typeof createTestApp>;
let probe: Probe;
let presenceRoom: PresenceRoom;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(Probe);
  presenceRoom = alepha.inject(PresenceRoom);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ token: string; userId: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { token: tokens.access_token, userId: registered.data.id };
}

function authedFetch(path: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function newPeasant(prefix: string): Promise<PeasantFixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const adventureResponse = await authedFetch("/api/adventures", token, {
    title: "Peasant integration",
    maxPlayers: 4,
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as {
    id: string;
    defaultMap: { id: string };
  };
  const partyResponse = await authedFetch("/api/parties", token, {
    adventureId: adventure.id,
  });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
    name: "Till",
    class: "peasant",
  });
  expect(heroResponse.status).toBe(201);
  const hero = (await heroResponse.json()) as { id: string; class: string };
  expect(hero.class).toBe("peasant");
  // Without a heightfield the map produces no zone and every join closes 4007 — no welcome, so
  // none of the loadout/talent restoration below would ever be observed.
  await alepha.inject(MapService).saveHeightfield(adventure.defaultMap.id, provingHeightfield());
  return {
    token,
    userId,
    partyId,
    mapId: adventure.defaultMap.id,
    roomId: `${partyId}:${adventure.defaultMap.id}`,
    heroId: hero.id,
  };
}

async function sendAndReadEvent(
  engine: RoomEngine<never, never, WorldRoomState>,
  socket: FakeSocket,
  message: unknown,
): Promise<Extract<ServerMessage, { t: "event" }> | undefined> {
  const offset = socket.sent.length;
  await engine.message(socket.id, message);
  return eventFrom(socket, offset);
}

async function unlock(
  engine: RoomEngine<never, never, WorldRoomState>,
  socket: FakeSocket,
  nodeId: string,
): Promise<Extract<ServerMessage, { t: "event" }> | undefined> {
  return sendAndReadEvent(engine, socket, { t: "talent.unlock", nodeId });
}

describe("Peasant HTTP + WorldRoom persistence", () => {
  test("creates the complete starter loadout and admits an older save with defaults", async () => {
    const fixture = await newPeasant("peasantlegacy");
    const row = await probe.heroes.findById(fixture.heroId);
    expect(row).toMatchObject({
      class: "peasant",
      talents: "[]",
      combatCooldowns: "{}",
    });

    const items = await probe.heroItems.findMany({
      where: { heroId: { eq: fixture.heroId } },
    });
    expect(items.map((item) => item.itemDefinitionId).sort()).toEqual(
      ["health_potion", "worn_toolkit"].sort(),
    );
    const toolkit = items.find((item) => item.itemDefinitionId === "worn_toolkit");
    expect(toolkit).toBeDefined();
    expect(
      await probe.heroEquipment.findMany({ where: { heroId: { eq: fixture.heroId } } }),
    ).toMatchObject([{ slot: "main_hand", heroItemId: toolkit?.id }]);

    const skills = await probe.heroSkills.findMany({
      where: { heroId: { eq: fixture.heroId } },
    });
    expect(skills).toHaveLength(5);
    for (const definition of CLASS_SKILLS.peasant) {
      const stored = skills.find((skill) => skill.skillId === definition.id);
      expect(stored).toMatchObject({
        unlocked: definition.slot === 1,
        equipped: definition.slot === 1,
        ...(definition.slot === 1 ? { slot: 1 } : {}),
      });
      if (definition.slot !== 1) expect(stored?.slot).toBeUndefined();
    }

    // A migrated row whose JSON payload predates talents/cooldowns is represented by JSON null in
    // the non-null text columns. Admission must normalize it, never reject the old save.
    await probe.heroes.updateById(fixture.heroId, {
      talents: "null",
      combatCooldowns: "null",
    });

    const engine = createEngine(fixture.roomId);
    const socket = fakeSocket(fixture.userId, fixture.heroId, "peasant-legacy");
    await engine.join(socket);
    const admitted = welcome(socket);
    expect(admitted.players.find((player) => player.id === fixture.heroId)).toMatchObject({
      class: "peasant",
      level: 1,
      equipment: { mainHand: "worn_toolkit", offHand: null },
    });
    expect(admitted.self.talents).toEqual({
      selected: [],
      pointsSpent: 0,
      pointsAvailable: 1,
    });
    expect(admitted.self.cooldowns).toEqual(emptyCombatCooldowns());

    const state = roomState(engine);
    const player = playerOf(state, fixture.heroId);
    const epoch = player.sessionEpoch;
    await engine.leave(socket.id);
    await Promise.resolve();

    const normalizedLegacyRow = await probe.heroes.findById(fixture.heroId);
    expect(JSON.parse(normalizedLegacyRow?.talents ?? "null")).toEqual([]);
    expect(JSON.parse(normalizedLegacyRow?.combatCooldowns ?? "null")).toEqual(
      emptyCombatCooldowns(),
    );
    expect(engine.size).toBe(0);
    expect(state.players.size).toBe(0);
    expect(state.connectionIdByHeroId.size).toBe(0);
    expect(state.pendingSaves.size).toBe(0);
    expect(player).toMatchObject({ authorized: false, disconnecting: true });
    expect(
      await presenceRoom.room.call(fixture.heroId, "isAuthorized", socket.id, epoch, state.roomKey),
    ).toBe(false);
    engine.dispose();
  });

  test("enforces A/B and level gates, then restores talents and the talented axe cooldown", async () => {
    const fixture = await newPeasant("peasanttalents");
    await probe.heroes.updateById(fixture.heroId, { level: 4 });

    const engine = createEngine(fixture.roomId);
    const firstSocket = fakeSocket(fixture.userId, fixture.heroId, "peasant-level-4");
    await engine.join(firstSocket);
    expect(welcome(firstSocket).players.find((player) => player.id === fixture.heroId)?.level).toBe(
      4,
    );

    const common = [
      "peasant.woodcutters_swing.bounty",
      "peasant.woodcutters_swing.readiness",
      "peasant.woodcutters_swing.reach",
    ];
    const evolutionA = "peasant.woodcutters_swing.clean_cut";
    const evolutionB = "peasant.woodcutters_swing.sweeping_fell";
    const ultimate = "peasant.woodcutters_swing.great_felling";

    for (const nodeId of [...common, evolutionA]) {
      expect(await unlock(engine, firstSocket, nodeId)).toMatchObject({
        code: "talent.unlocked",
        params: { talent: nodeId },
      });
    }
    expect(await unlock(engine, firstSocket, evolutionB)).toMatchObject({
      code: "talent.invalid",
      params: { reason: "exclusive" },
    });
    expect(await unlock(engine, firstSocket, ultimate)).toMatchObject({
      code: "talent.invalid",
      params: { reason: "points" },
    });

    const levelFourSelection = [...common, evolutionA];
    expect(playerOf(roomState(engine), fixture.heroId).talents).toEqual(levelFourSelection);
    await engine.leave(firstSocket.id);
    expect(JSON.parse((await probe.heroes.findById(fixture.heroId))?.talents ?? "null")).toEqual(
      levelFourSelection,
    );

    // Level is server-owned. Seeding the next authoritative level directly models the progression
    // boundary while keeping this test independent from combat XP balancing.
    await probe.heroes.updateById(fixture.heroId, { level: 5 });
    const secondSocket = fakeSocket(fixture.userId, fixture.heroId, "peasant-level-5");
    await engine.join(secondSocket);
    expect(welcome(secondSocket).self.talents).toEqual({
      selected: levelFourSelection,
      pointsSpent: 4,
      pointsAvailable: 1,
    });
    expect(await unlock(engine, secondSocket, evolutionB)).toMatchObject({
      code: "talent.invalid",
      params: { reason: "exclusive" },
    });

    expect(await sendAndReadEvent(engine, secondSocket, { t: "talent.reset" })).toMatchObject({
      code: "talent.reset",
    });
    const finalSelection = [...common, evolutionB, ultimate];
    for (const nodeId of finalSelection) {
      expect(await unlock(engine, secondSocket, nodeId)).toMatchObject({
        code: "talent.unlocked",
        params: { talent: nodeId },
      });
    }

    const configuredAxe = skillWithTalents("peasant", finalSelection, 1);
    expect(configuredAxe.cooldownMs).toBe(370);
    expect(configuredAxe.cooldownMs).toBeLessThan(CLASS_SKILLS.peasant[0]?.cooldownMs ?? 0);

    const attackOffset = secondSocket.sent.length;
    await engine.message(secondSocket.id, { t: "attack" });
    expect(eventFrom(secondSocket, attackOffset)).toMatchObject({
      code: "skill.cast",
      params: { skill: "woodcutters_swing", slot: 1 },
    });
    const activePlayer = playerOf(roomState(engine), fixture.heroId);
    const acceptedAt = activePlayer.lastAttackAt;
    const expectedDeadline = acceptedAt + configuredAxe.cooldownMs;
    expect(stateFrom(secondSocket, attackOffset)?.self.cooldowns?.attackUntil).toBe(
      expectedDeadline,
    );

    await engine.leave(secondSocket.id);
    const persisted = await probe.heroes.findById(fixture.heroId);
    expect(JSON.parse(persisted?.talents ?? "null")).toEqual(finalSelection);
    expect(
      (JSON.parse(persisted?.combatCooldowns ?? "null") as { attackUntil: number }).attackUntil,
    ).toBe(expectedDeadline);

    const thirdSocket = fakeSocket(fixture.userId, fixture.heroId, "peasant-reconnect");
    await engine.join(thirdSocket);
    const reconnected = welcome(thirdSocket);
    expect(reconnected.self.talents).toEqual({
      selected: finalSelection,
      pointsSpent: 5,
      pointsAvailable: 0,
    });
    expect(reconnected.self.cooldowns?.attackUntil).toBe(expectedDeadline);
    expect(playerOf(roomState(engine), fixture.heroId).lastAttackAt).toBe(acceptedAt);

    const castCount = messages(thirdSocket).filter(
      (message) => message.t === "event" && message.code === "skill.cast",
    ).length;
    await engine.message(thirdSocket.id, { t: "attack" });
    expect(
      messages(thirdSocket).filter(
        (message) => message.t === "event" && message.code === "skill.cast",
      ),
    ).toHaveLength(castCount);

    const finalState = roomState(engine);
    const finalPlayer = playerOf(finalState, fixture.heroId);
    const finalEpoch = finalPlayer.sessionEpoch;
    await engine.leave(thirdSocket.id);
    expect(finalState.players.size).toBe(0);
    expect(finalState.connectionIdByHeroId.size).toBe(0);
    expect(
      await presenceRoom.room.call(
        fixture.heroId,
        "isAuthorized",
        thirdSocket.id,
        finalEpoch,
        finalState.roomKey,
      ),
    ).toBe(false);
    engine.dispose();
  });
});
