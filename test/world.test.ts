/**
 * End-to-end through the real Durable Object: a real WebSocket, the real tick loop, the
 * real simulation. Nothing here is mocked, so a passing run means a browser would work.
 */

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Attachment, positionFromAttachment } from "../src/server/world.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { CORPSE_RECLAIM_RANGE, RESURRECT_HP_RATIO } from "../src/shared/death.js";
import {
  CEMETERIES,
  isWalkable,
  maxHpForLevel,
  nearestCemetery,
  OBSTACLES,
  type PlayerClass,
  QUEST_DEFINITIONS,
  QUEST_NPC,
  QUEST_SITES,
  SAFE_ZONE,
  spawnPosition,
  WORLD_BOUNDARY_DEPTH,
  WORLD_LANDMARKS,
} from "../src/shared/game.js";
import {
  NO_INPUT,
  PLAYER_SIZE,
  PLAYER_SPEED,
  TICK_DT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../src/shared/simulation.js";
import {
  awayFromNearestWall,
  Client,
  ORIGIN,
  testCharacter,
  until,
  VERDANT_ROOM_KEY,
} from "./support/world-harness.js";

describe("World", () => {
  it("welcomes a player with the world dimensions and their own id", async () => {
    const client = await Client.join("alice");

    const welcome = await until("welcome", () => client.welcome);
    expect(welcome.selfId).toMatch(/^[0-9a-f-]{36}$/);
    expect(welcome.world).toMatchObject({
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      playerSize: PLAYER_SIZE,
      obstacles: OBSTACLES,
      safeZone: SAFE_ZONE,
      questNpc: QUEST_NPC,
    });
    expect(welcome.world.questNpcs).toEqual(QUEST_DEFINITIONS.map((quest) => quest.giver));
    expect(welcome.world.questSites).toEqual(QUEST_SITES);
    expect(welcome.monsters.length).toBeGreaterThan(0);
    expect(welcome.self.inventory).toMatchObject({ potions: 2 });
    expect(welcome.players.find((player) => player.id === welcome.selfId)).toMatchObject({
      appearance: { body: "wayfarer", primaryColor: "azure" },
      equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
    });
    expect(welcome.players.find((player) => player.id === welcome.selfId)).toMatchObject(
      spawnPosition(welcome.selfId),
    );

    client.close();
  });

  it("refuses a join for a character the session does not own", async () => {
    const alice = await testCharacter("own_a");
    const bob = await testCharacter("own_b");

    const stolen = await SELF.fetch(`${ORIGIN}/api/ws?character=${alice.characterId}`, {
      headers: { Upgrade: "websocket", Cookie: bob.cookie },
    });
    expect(stolen.status).toBe(403);

    const missing = await SELF.fetch(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: "websocket", Cookie: bob.cookie },
    });
    expect(missing.status).toBe(400);
  });

  it("broadcasts snapshots on the tick loop", async () => {
    const client = await Client.join("bob");

    const first = await until("a snapshot", () => client.latestSnapshot);
    const later = await until("a second, later snapshot", () => {
      const snapshot = client.latestSnapshot;
      return snapshot && snapshot.tick > first.tick ? snapshot : undefined;
    });

    expect(later.tick).toBeGreaterThan(first.tick);
    client.close();
  });

  it("moves a square in response to input, and only along the pressed axis", async () => {
    const client = await Client.join("carol");
    await until("welcome", () => client.welcome);

    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    client.press(direction);

    const moved = await until(`the square to move ${direction}`, () => {
      const now = client.self();
      return now && sign * (now.x - start.x) > 20 ? now : undefined;
    });

    expect(sign * (moved.x - start.x)).toBeGreaterThan(0);
    expect(moved.y).toBeCloseTo(start.y, 5);

    client.close();
  });

  it("never lets a square cross the authoritative boundary mass", async () => {
    const client = await Client.join("dave", {
      position: { x: WORLD_BOUNDARY_DEPTH + PLAYER_SPEED * TICK_DT, y: 2000 },
    });
    await until("welcome", () => client.welcome);

    client.press("left");
    const pinned = await until(
      "the square to reach the left wall",
      () => {
        const now = client.self();
        return now && now.x === WORLD_BOUNDARY_DEPTH ? now : undefined;
      },
      2_000,
    );

    expect(pinned.x).toBe(WORLD_BOUNDARY_DEPTH);

    // Keep pushing: the wall must hold, not merely be touched once.
    await scheduler.wait(200);
    expect(client.self()?.x).toBe(WORLD_BOUNDARY_DEPTH);

    client.close();
  });

  // The world is a singleton, shared by every test in this file. Assertions are therefore
  // about *which* ids are present, never about how many — a straggler from an earlier test
  // that has not finished disconnecting must not be able to fail an unrelated assertion.
  it("shows both players to each other, then drops one on disconnect", async () => {
    const alice = await Client.join("alice2");
    const bob = await Client.join("bob2");

    const aliceId = (await until("alice's welcome", () => alice.welcome)).selfId;
    const bobId = (await until("bob's welcome", () => bob.welcome)).selfId;

    const together = await until("alice to see bob", () => {
      const players = alice.latestSnapshot?.players;
      if (!players) return undefined;
      const ids = new Set(players.map((p) => p.id));
      return ids.has(aliceId) && ids.has(bobId) ? players : undefined;
    });
    expect(together.find((p) => p.id === bobId)?.nick).toBe("bob2");

    bob.close();

    await until("bob to disappear from alice's view", () => {
      const snapshot = alice.latestSnapshot;
      if (!snapshot) return undefined;
      const ids = new Set(snapshot.players.map((p) => p.id));
      return !ids.has(bobId) && ids.has(aliceId);
    });

    alice.close();
  });

  it("routes persisted zones and instances to isolated rooms", async () => {
    const main = await Client.join("zone_main", { zoneId: "verdant-reach", instanceId: "main" });
    const testZone = await Client.join("zone_test", {
      zoneId: "mmo-test-zone",
      instanceId: "main",
    });
    const mainWelcome = await until("main welcome", () => main.welcome);
    const testWelcome = await until("test-zone welcome", () => testZone.welcome);

    expect(mainWelcome.world).toMatchObject({ width: WORLD_WIDTH, height: WORLD_HEIGHT });
    expect(testWelcome.world).toMatchObject({ width: 640, height: 480 });
    expect(testWelcome.monsters).toEqual([]);
    expect(mainWelcome.monsters.length).toBeGreaterThan(0);
    await until("separate snapshots", () => main.latestSnapshot && testZone.latestSnapshot);
    expect(main.latestSnapshot?.players.map((player) => player.id)).not.toContain(
      testWelcome.selfId,
    );
    expect(testZone.latestSnapshot?.players.map((player) => player.id)).not.toContain(
      mainWelcome.selfId,
    );

    main.chat("room-local");
    await scheduler.wait(150);
    expect(
      testZone.received.some((message) => message.t === "chat" && message.text === "room-local"),
    ).toBe(false);

    const testStart = testZone.self();
    main.press("right");
    await scheduler.wait(200);
    main.release();
    expect(testZone.self()).toMatchObject({ x: testStart?.x, y: testStart?.y });

    main.close();
    testZone.close();
  });

  it("isolates two instances of the same zone", async () => {
    const main = await Client.join("instance_main", { instanceId: "main" });
    const raid = await Client.join("instance_raid", { instanceId: "raid-1" });
    const mainWelcome = await until("main instance welcome", () => main.welcome);
    const raidWelcome = await until("raid instance welcome", () => raid.welcome);
    await until("instance snapshots", () => main.latestSnapshot && raid.latestSnapshot);

    expect(main.latestSnapshot?.players.map((player) => player.id)).not.toContain(
      raidWelcome.selfId,
    );
    expect(raid.latestSnapshot?.players.map((player) => player.id)).not.toContain(
      mainWelcome.selfId,
    );
    raid.chat("raid-only");
    await scheduler.wait(150);
    expect(
      main.received.some((message) => message.t === "chat" && message.text === "raid-only"),
    ).toBe(false);
    main.close();
    raid.close();
  });

  it("keeps monster drops and combat snapshots inside their room", {
    timeout: 10_000,
  }, async () => {
    const hunter = await Client.join("LootHunter", {
      zoneId: "verdant-reach",
      position: { x: 1870, y: 820 },
      level: 10,
    });
    const observer = await Client.join("LootEye", { zoneId: "mmo-test-zone" });
    await until("loot rooms welcome", () => hunter.welcome && observer.welcome);

    hunter.action("attack");
    await scheduler.wait(600);
    hunter.action("attack");
    const loot = await until("main-room monster loot", () => {
      const snapshot = hunter.latestSnapshot;
      return snapshot && snapshot.loot.length > 0 ? snapshot.loot : undefined;
    });
    expect(loot.length).toBeGreaterThan(0);
    await until("technical-room snapshot", () => observer.latestSnapshot);
    expect(observer.latestSnapshot?.loot).toEqual([]);
    expect(observer.latestSnapshot?.monsters).toEqual([]);

    hunter.close();
    observer.close();
  });

  it("does not let the URL select a room", async () => {
    const session = await testCharacter("url_room", {
      zoneId: "verdant-reach",
      instanceId: "main",
    });
    const response = await SELF.fetch(
      `${ORIGIN}/api/ws?character=${session.characterId}&zone=mmo-test-zone&instance=evil`,
      { headers: { Upgrade: "websocket", Cookie: session.cookie } },
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) throw new Error("expected websocket");
    const client = new Client(socket);
    const welcome = await until("URL spoof welcome", () => client.welcome);
    expect(welcome.world).toMatchObject({ width: WORLD_WIDTH, height: WORLD_HEIGHT });
    client.sendRaw(JSON.stringify({ t: "zone", zoneId: "mmo-test-zone", instanceId: "main" }));
    await scheduler.wait(100);
    expect(client.welcome?.world.width).toBe(WORLD_WIDTH);
    client.close();
  });

  it("rejects corrupt D1 locations and invalid instance ids without crashing", async () => {
    const unknown = await testCharacter("unknown_zone");
    await env.DB.prepare("UPDATE character SET zone_id = ? WHERE id = ?")
      .bind("not-a-zone", unknown.characterId)
      .run();
    const unknownClient = await Client.joinCharacter(unknown);
    expect(
      (await until("unknown location close", () => unknownClient.closeInfo ?? undefined)).code,
    ).toBe(WS_CLOSE.INVALID_LOCATION);

    const invalid = await testCharacter("invalid_instance");
    await env.DB.prepare("UPDATE character SET instance_id = ? WHERE id = ?")
      .bind("main:other", invalid.characterId)
      .run();
    const invalidClient = await Client.joinCharacter(invalid);
    expect(
      (await until("invalid instance close", () => invalidClient.closeInfo ?? undefined)).code,
    ).toBe(WS_CLOSE.INVALID_LOCATION);
  });

  it("enforces the technical room capacity and reconnects to the persisted test zone", async () => {
    const first = await Client.join("capacity_one", { zoneId: "mmo-test-zone" });
    const second = await Client.join("capacity_two", { zoneId: "mmo-test-zone" });
    await until("capacity players welcome", () => first.welcome && second.welcome);
    const third = await Client.join("capacity_three", { zoneId: "mmo-test-zone" });
    expect((await until("room full close", () => third.closeInfo ?? undefined)).code).toBe(
      WS_CLOSE.ROOM_FULL,
    );

    const session = await testCharacter("tech_reconnect", { zoneId: "mmo-test-zone" });
    // Free a slot before asserting reconnection.
    first.close();
    await scheduler.wait(100);
    const joined = await Client.joinCharacter(session);
    expect((await until("tech reconnect welcome", () => joined.welcome)).world).toMatchObject({
      width: 640,
      height: 480,
    });
    joined.close();
    second.close();
  });

  it("starts the server-owned quest only when interacting near the quest NPC", async () => {
    const client = await Client.join("quester", {
      position: { x: QUEST_NPC.x + 50, y: QUEST_NPC.y },
    });
    await until("welcome", () => client.welcome);
    expect(client.latestState?.quest.status).toBe("available");

    client.action("interact");
    await until("quest state", () =>
      client.latestState?.quest.status === "active" ? client.latestState : undefined,
    );
    expect(client.latestState?.quest.progress).toBe(0);
    client.close();
  });

  it("publishes a clear server-timed deadline when the ward run begins", async () => {
    const ward = QUEST_SITES.find(
      (candidate) => candidate.chapter === "ward_run" && candidate.order === 0,
    );
    if (!ward) throw new Error("first ward missing");
    const client = await Client.join("timerunner", {
      position: { x: ward.x + 30, y: ward.y },
      quest: { chapter: "ward_run", status: "active", progress: 0 },
    });
    await until("ward welcome", () => client.welcome);

    client.action("interact");
    const state = await until("ward timer", () =>
      client.latestState?.quest.timerEndsAt ? client.latestState : undefined,
    );
    expect(state.quest.timerEndsAt).toBeGreaterThan(Date.now() + 40_000);
    client.close();
  });

  it("advances ordered gathering sites on the authoritative server", async () => {
    const site = QUEST_SITES.find(
      (candidate) => candidate.chapter === "three_offerings" && candidate.order === 0,
    );
    if (!site) throw new Error("first offering site missing");
    const client = await Client.join("gatherer", {
      position: { x: site.x + 30, y: site.y },
      quest: { chapter: "three_offerings", status: "active", progress: 0 },
    });
    await until("gathering welcome", () => client.welcome);

    client.action("interact");
    const state = await until("gathering progress", () =>
      client.latestState?.quest.progress === 1 ? client.latestState : undefined,
    );
    expect(state.quest).toMatchObject({
      chapter: "three_offerings",
      status: "active",
      progress: 1,
      target: 3,
    });
    expect(
      client.received.find(
        (message) =>
          message.t === "event" &&
          message.code === "quest.site_harvested" &&
          message.params?.site === site.id,
      ),
    ).toMatchObject({ params: { seconds: 15 } });
    client.close();
  });

  it("resets the mire-rune puzzle when a rune is used out of order", async () => {
    const wrongRune = QUEST_SITES.find(
      (candidate) => candidate.chapter === "mire_runes" && candidate.order === 3,
    );
    if (!wrongRune) throw new Error("wrong rune fixture missing");
    const client = await Client.join("runebreaker", {
      position: { x: wrongRune.x + 30, y: wrongRune.y },
      quest: { chapter: "mire_runes", status: "active", progress: 2 },
    });
    await until("rune welcome", () => client.welcome);

    client.action("interact");
    const state = await until("rune reset", () =>
      client.received.some(
        (message) => message.t === "event" && message.code === "quest.site_wrong",
      )
        ? client.latestState
        : undefined,
    );
    expect(state?.quest).toMatchObject({ chapter: "mire_runes", status: "active", progress: 0 });
    client.close();
  });

  it("relays trimmed chat to every connected player", async () => {
    const alice = await Client.join("chat_a");
    const bob = await Client.join("chat_b");
    await until("both welcomes", () => alice.welcome && bob.welcome);

    alice.chat("  hello   world  ");
    const relayed = await until("chat relay", () =>
      bob.received.find((message) => message.t === "chat" && message.from === "chat_a"),
    );
    expect(relayed).toMatchObject({ t: "chat", from: "chat_a", text: "hello world" });
    alice.close();
    bob.close();
  });

  // A Durable Object is rebuilt on deploys and evictions, not only when it hibernates idle.
  // Its in-memory state dies; the hibernatable sockets do not. Without a persisted position
  // every connected player would teleport to a random spawn the moment we ship a new build.
  //
  // The rebuild cannot be simulated end-to-end here: evictDurableObject() waits for in-flight
  // work to drain, and the tick loop never drains. So the two halves are tested separately —
  // the write, here, and the read, in positionFromAttachment below.
  it("persists a moved player's position onto their socket", { timeout: 20_000 }, async () => {
    const client = await Client.join("persist");
    await until("welcome", () => client.welcome);

    // Move, then stand still long enough for a persist tick to capture the resting position.
    client.press("right");
    await scheduler.wait(800);
    client.release();
    await scheduler.wait(1300);

    const resting = await until("a resting position", () => client.self());

    const stub = env.WORLD.getByName(VERDANT_ROOM_KEY);
    const attachments = await runInDurableObject(stub, (_instance, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as Attachment | null),
    );

    const mine = attachments.find((a) => a?.nick === "persist");
    expect(mine).toBeDefined();
    expect(mine?.id).toBe(resting.id);
    expect(mine?.x).toBeCloseTo(resting.x, 1);
    expect(mine?.y).toBeCloseTo(resting.y, 1);

    client.close();
  });

  it("persists authoritative state before reconnecting the same character", async () => {
    const session = await testCharacter("rejoin", {
      position: { x: QUEST_NPC.x + 50, y: QUEST_NPC.y },
      hp: 40,
    });
    const first = await Client.joinCharacter(session);
    await until("welcome", () => first.welcome);

    first.action("interact");
    await until("quest to become active", () =>
      first.latestState?.quest.status === "active" ? first.latestState : undefined,
    );
    first.usePotion();
    await until("potion state", () =>
      first.latestState?.inventory.potions === 1 && first.self()?.hp === 85
        ? first.latestState
        : undefined,
    );

    const beforeMove = await until("position before reconnect move", () => first.self());
    first.press("right");
    await until("moved before reconnect", () => {
      const self = first.self();
      return self && self.x > beforeMove.x + 12 ? self : undefined;
    });
    first.release();
    // Capture the resting position after input stops — rejoin saves in-memory truth, not an
    // early snapshot taken while the pump was still holding "right".
    await scheduler.wait(400);
    const moved = await until("resting position before reconnect", () => first.self());

    const rejoined = await Client.joinCharacter(session);
    const oldClosed = await until("old socket to close", () => first.closeInfo ?? undefined);
    expect(oldClosed.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
    expect(
      first.received.some(
        (message) => message.t === "event" && message.code === "presence.replaced",
      ),
    ).toBe(true);

    const welcome = await until("rejoin welcome", () => rejoined.welcome);
    const self = welcome.players.find((player) => player.id === welcome.selfId);
    expect(self?.x).toBeCloseTo(moved.x, 1);
    expect(self?.y).toBeCloseTo(moved.y, 1);
    expect(self?.hp).toBe(85);
    expect(welcome.self.inventory).toMatchObject({ potions: 1, gold: 0, crystals: 0 });
    expect(welcome.self.quest).toMatchObject({ status: "active", progress: 0 });

    const rejoinedPosition = self ? { x: self.x, y: self.y } : undefined;
    first.attemptAfterRevocation({
      t: "input",
      seq: 999_999,
      input: { ...NO_INPUT, right: true },
    });
    first.attemptAfterRevocation({ t: "skill", slot: 3 });
    await scheduler.wait(150);
    expect(rejoined.self()).toMatchObject(rejoinedPosition ?? {});

    const epoch = await env.DB.prepare("SELECT session_epoch FROM character WHERE id = ?")
      .bind(session.characterId)
      .first<{ session_epoch: number }>();
    expect(epoch?.session_epoch).toBe(2);

    rejoined.close();
  });

  it("detects a stale runtime save, revokes it, and closes its socket", async () => {
    const session = await testCharacter("stale_runtime");
    const client = await Client.joinCharacter(session);
    await until("stale runtime welcome", () => client.welcome);
    const start = await until("stale runtime start", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    client.press(direction);
    await until("stale runtime moved", () => {
      const self = client.self();
      return self && sign * (self.x - start.x) > 12 ? self : undefined;
    });
    client.release();

    // Simulate a newer room having acquired the next epoch before this old runtime flushes.
    await env.DB.prepare(
      "UPDATE character SET session_epoch = session_epoch + 1, x = 1500, y = 1600, xp = 88 WHERE id = ?",
    )
      .bind(session.characterId)
      .run();
    const world = env.WORLD.getByName(VERDANT_ROOM_KEY);
    expect(await world.persistCharacter(session.characterId)).toBe(false);

    const closed = await until("stale runtime close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(WS_CLOSE.PRESENCE_LOST);
    client.attemptAfterRevocation({ t: "skill", slot: 3 });
    client.attemptAfterRevocation({
      t: "input",
      seq: 999_999,
      input: { ...NO_INPUT, right: true },
    });
    const row = await env.DB.prepare("SELECT x, y, xp FROM character WHERE id = ?")
      .bind(session.characterId)
      .first<{ x: number; y: number; xp: number }>();
    expect(row).toEqual({ x: 1500, y: 1600, xp: 88 });
  });

  it("preserves one absolute ward-run deadline across replacement and cannot restart it", async () => {
    const ward = QUEST_SITES.find(
      (candidate) => candidate.chapter === "ward_run" && candidate.order === 0,
    );
    if (!ward) throw new Error("first ward missing");
    const session = await testCharacter("ward_rejoin", {
      position: { x: ward.x + 30, y: ward.y },
      quest: { chapter: "ward_run", status: "active", progress: 0 },
    });
    const first = await Client.joinCharacter(session);
    await until("ward first welcome", () => first.welcome);
    first.action("interact");
    const originalDeadline = await until(
      "original ward deadline",
      () => first.latestState?.quest.timerEndsAt,
    );

    const second = await Client.joinCharacter(session);
    await until("old ward socket closed", () => first.closeInfo ?? undefined);
    const welcome = await until("ward replacement welcome", () => second.welcome);
    expect(welcome.self.quest.timerEndsAt).toBe(originalDeadline);

    first.attemptAfterRevocation({ t: "interact" });
    await scheduler.wait(100);
    expect(second.latestState?.quest.timerEndsAt).toBe(originalDeadline);
    const row = await env.DB.prepare(
      "SELECT ward_run_expires_at, session_epoch FROM character WHERE id = ?",
    )
      .bind(session.characterId)
      .first<{ ward_run_expires_at: number | null; session_epoch: number }>();
    expect(row).toMatchObject({ ward_run_expires_at: originalDeadline, session_epoch: 2 });
    second.close();
  });

  it("expires a ward run that elapsed while disconnected", async () => {
    const session = await testCharacter("ward_elapsed", {
      quest: { chapter: "ward_run", status: "active", progress: 2 },
      wardRunExpiresAt: Date.now() - 1_000,
    });
    const client = await Client.joinCharacter(session);
    const welcome = await until("expired ward welcome", () => client.welcome);
    expect(welcome.self.quest).toMatchObject({
      chapter: "ward_run",
      status: "active",
      progress: 0,
    });
    expect(welcome.self.quest.timerEndsAt).toBeUndefined();
    client.close();

    await until("expired ward persisted", () => (client.closeInfo ? client.closeInfo : undefined));
    await scheduler.wait(100);
    const row = await env.DB.prepare(
      "SELECT quest_progress, ward_run_expires_at FROM character WHERE id = ?",
    )
      .bind(session.characterId)
      .first<{ quest_progress: number; ward_run_expires_at: number | null }>();
    expect(row).toEqual({ quest_progress: 0, ward_run_expires_at: null });
  });

  it("acknowledges the commands it has applied", async () => {
    const client = await Client.join("acker");
    await until("welcome", () => client.welcome);

    // The pump is running, so acks must climb.
    const first = await until("a non-zero ack", () => {
      const self = client.self();
      return self && self.ack > 0 ? self.ack : undefined;
    });

    const later = await until("the ack to advance", () => {
      const self = client.self();
      return self && self.ack > first ? self.ack : undefined;
    });

    expect(later).toBeGreaterThan(first);
    client.close();
  });

  /**
   * The whole point of draining one command per tick. A client that sends many commands at once
   * must not travel 40 ticks' worth of distance — otherwise sending faster is a speed hack.
   */
  it("applies at most one command per tick, so flooding buys no speed", {
    timeout: 10_000,
  }, async () => {
    const client = await Client.join("flooder", { pump: false });
    await until("welcome", () => client.welcome);
    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);

    const flood = 24;
    for (let i = 0; i < flood; i++) client.sendCommand({ ...NO_INPUT, [direction]: true });

    const startTick = client.latestSnapshot?.tick ?? 0;
    const minimumTicks = 4;
    const after = await until("the flooded player to move", () => {
      const snapshot = client.latestSnapshot;
      const self = client.self();
      if (!snapshot || !self) return undefined;
      const tickDelta = snapshot.tick - startTick;
      const travelled = sign * (self.x - start.x);
      return tickDelta >= minimumTicks && travelled > 0 ? self : undefined;
    });
    const afterTick = client.latestSnapshot?.tick ?? startTick;
    const tickDelta = afterTick - startTick;
    const travelled = sign * (after.x - start.x);

    // Generous ceiling: the observed ticks, plus the starvation grace period, plus slack.
    const ceiling = (tickDelta + 6) * PLAYER_SPEED * TICK_DT;
    const ifFloodingWorked = flood * PLAYER_SPEED * TICK_DT;

    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(ceiling);
    expect(travelled).toBeLessThan(ifFloodingWorked / 2);

    client.close();
  });

  it("ignores a replayed sequence number", async () => {
    const client = await Client.join("replayer", { pump: false });
    await until("welcome", () => client.welcome);
    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    const backwards = direction === "right" ? "left" : "right";

    client.sendCommandAt(100, { ...NO_INPUT, [direction]: true });
    const moved = await until("the square to move", () => {
      const self = client.self();
      return self && sign * (self.x - start.x) > 1 ? self : undefined;
    });

    // A stale command, arriving late or replayed by an attacker. It must not be applied.
    client.sendCommandAt(3, { ...NO_INPUT, [backwards]: true });
    await scheduler.wait(400);

    const after = await until("a later snapshot", () => client.self());
    // Never travelled backwards, and the stale sequence never became the acknowledged one.
    expect(sign * (after.x - moved.x)).toBeGreaterThanOrEqual(0);
    expect(after.ack).toBe(100);

    client.close();
  });

  it("stops a square whose client has gone silent", async () => {
    const client = await Client.join("ghost");
    await until("welcome", () => client.welcome);

    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    client.press(direction);

    await scheduler.wait(300);
    const beforeSilence = await until("the square to be moving", () => {
      const self = client.self();
      return self && sign * (self.x - start.x) > 20 ? self : undefined;
    });

    // The tab froze: no more commands. The server may coast briefly, then must stop.
    client.stopPump();
    await scheduler.wait(700);

    const settled = await until("a snapshot", () => client.self());
    await scheduler.wait(300);
    const stillSettled = await until("a later snapshot", () => client.self());

    expect(stillSettled.x).toBe(settled.x);

    // It stopped because the server gave up on us, not because it hit a wall.
    expect(settled.x).toBeGreaterThan(0);
    expect(settled.x).toBeLessThan(WORLD_WIDTH - PLAYER_SIZE);

    // Coasting is bounded by the queue depth plus the starvation grace period.
    const coasted = sign * (settled.x - beforeSilence.x);
    expect(coasted).toBeLessThan(18 * PLAYER_SPEED * TICK_DT);

    client.close();
  });

  it("ignores malformed frames instead of dying", async () => {
    const client = await Client.join("mallory");
    await until("welcome", () => client.welcome);
    const before = await until("a snapshot", () => client.latestSnapshot);

    client.sendRaw("not json at all");
    client.sendRaw(JSON.stringify({ t: "input", input: { up: "yes" } }));
    client.sendRaw(JSON.stringify({ t: "teleport", x: 9999, y: 9999 }));

    // The world keeps ticking, and the square never teleports.
    await until("the world to keep ticking", () => {
      const snapshot = client.latestSnapshot;
      return snapshot && snapshot.tick > before.tick + 2;
    });

    const self = await until("to still see ourselves", () => client.self());
    expect(self.x).toBeLessThanOrEqual(WORLD_WIDTH - PLAYER_SIZE);
    expect(self.y).toBeLessThanOrEqual(WORLD_HEIGHT - PLAYER_SIZE);

    client.close();
  });

  it("closes clients that repeatedly send malformed frames", async () => {
    const client = await Client.join("bad_frames");
    await until("welcome", () => client.welcome);
    for (let i = 0; i < 5; i++) client.sendRaw("{broken");
    const closed = await until("policy close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(1008);
  });

  it("closes an oversized WebSocket frame", async () => {
    const client = await Client.join("huge_frame");
    await until("welcome", () => client.welcome);
    client.sendRaw("x".repeat(2_049));
    const closed = await until("oversized close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(1009);
  });

  it("lets a priest mend the most injured player in range, respecting cooldown", async () => {
    // ~250px from the nearest SPAWN_POINTS grid cell — far enough that a straggler still
    // disconnecting from an earlier test (spawned somewhere on that grid, always inside
    // heal.range 130 of *itself* but not of here) cannot be closer than the wounded ally and
    // steal the cast.
    const priest = await Client.join("mender", {
      position: { x: 1150, y: 250 },
      class: "priest",
      level: 3,
    });
    const wounded = await Client.join("wounded", { position: { x: 1166, y: 250 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && wounded.welcome);

    priest.action("heal");
    await until("the wounded player to be mended", () => {
      // Re-send: belt and suspenders in case the very first cast raced the join.
      priest.action("heal");
      const snapshot = wounded.self();
      return snapshot && snapshot.hp > 40 ? snapshot : undefined;
    });

    const healed = wounded.self();
    expect(healed?.hp).toBe(40 + 41); // healAmountFor(3)

    // Cooldown: an immediate second cast must not double-heal.
    priest.action("heal");
    priest.action("heal");
    await scheduler.wait(200);
    expect(wounded.self()?.hp).toBe(81);

    const cast = priest.received.find((m) => m.t === "event" && m.code === "heal.cast");
    const received = wounded.received.find((m) => m.t === "event" && m.code === "heal.received");
    expect(cast).toMatchObject({ params: { name: "wounded", amount: 41 } });
    expect(received).toMatchObject({ params: { name: "mender", amount: 41 } });

    priest.close();
    wounded.close();
  });

  it("lets a visible ranged attack hit a monster", async () => {
    const ranger = await Client.join("sighter", {
      position: { x: 1750, y: 820 },
      class: "ranger",
    });
    await until("welcome", () => ranger.welcome);

    ranger.action("attack");
    const hit = await until("combat hit", () => {
      ranger.action("attack");
      return ranger.received.find((m) => m.t === "event" && m.code === "combat.hit");
    });
    expect(hit).toMatchObject({ tone: "info" });

    ranger.close();
  });

  it("rejects an ability before its level requirement", async () => {
    const warrior = await Client.join("locked_skill", { position: { x: 1750, y: 820 } });
    await until("locked skill welcome", () => warrior.welcome);

    warrior.skill(3);
    const locked = await until("locked ability event", () =>
      warrior.received.find((message) => message.t === "event" && message.code === "skill.locked"),
    );
    expect(locked).toMatchObject({ params: { level: 5, skill: "shield_bash" } });
    warrior.close();
  });

  it("charges the nearest monster with the warrior shield bash", async () => {
    const warrior = await Client.join("charger", {
      position: { x: 1700, y: 820 },
      level: 5,
    });
    await until("charge welcome", () => warrior.welcome);

    warrior.skill(3);
    const cast = await until("charge cast", () =>
      warrior.received.find(
        (message) =>
          message.t === "event" &&
          message.code === "skill.cast" &&
          message.params?.skill === "shield_bash",
      ),
    );
    expect(cast).toMatchObject({ tone: "good" });
    const moved = await until("charge position", () => {
      const self = warrior.self();
      return self && self.x > 1760 ? self : undefined;
    });
    expect(moved.x).toBeGreaterThan(1760);
    warrior.close();
  });

  it("reports a blocked heal target in range", async () => {
    const priest = await Client.join("blocked_heal", {
      position: { x: 480, y: 650 },
      class: "priest",
      level: 3,
    });
    const blocked = await Client.join("behind_tree", { position: { x: 590, y: 650 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && blocked.welcome);

    const before = await until("blocked target initial snapshot", () => {
      const snapshot = blocked.latestSnapshot;
      const self = blocked.self();
      return snapshot && self ? { tick: snapshot.tick, hp: self.hp } : undefined;
    });
    expect(before.hp).toBe(40);

    priest.action("heal");
    const event = await until("blocked heal event", () =>
      priest.received.find((m) => m.t === "event" && m.code === "heal.blocked"),
    );
    expect(event).toMatchObject({ tone: "info" });

    const after = await until("blocked target later snapshot", () => {
      const snapshot = blocked.latestSnapshot;
      const self = blocked.self();
      return snapshot && snapshot.tick > before.tick && self ? self : undefined;
    });
    expect(after.hp).toBe(40);

    priest.close();
    blocked.close();
  });

  it("heals the best visible target instead of a blocked lower-health target", async () => {
    const priest = await Client.join("los_priest", {
      position: { x: 480, y: 650 },
      class: "priest",
      level: 3,
    });
    const blocked = await Client.join("los_blocked", { position: { x: 590, y: 650 }, hp: 10 });
    const visible = await Client.join("los_visible", { position: { x: 480, y: 760 }, hp: 40 });
    await until("all welcomes", () => priest.welcome && blocked.welcome && visible.welcome);

    priest.action("heal");
    const healed = await until("visible ally healed", () => {
      priest.action("heal");
      const snapshot = visible.self();
      return snapshot && snapshot.hp > 40 ? snapshot : undefined;
    });

    expect(healed.hp).toBe(81);
    expect(blocked.self()?.hp).toBe(10);
    const cast = priest.received.find((m) => m.t === "event" && m.code === "heal.cast");
    expect(cast).toMatchObject({ params: { name: "los_visible", amount: 41 } });

    priest.close();
    blocked.close();
    visible.close();
  });

  it("keeps a wounded ally beyond heal.range untouched", async () => {
    const priest = await Client.join("far_healer", {
      position: { x: 784, y: 450 },
      class: "priest",
      level: 3,
    });
    // 200px away: past heal.range (130), well inside the snapshot view.
    const wounded = await Client.join("far_wounded", { position: { x: 984, y: 450 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && wounded.welcome);

    const before = await until("far wounded initial snapshot", () => {
      const snapshot = wounded.latestSnapshot;
      const self = wounded.self();
      return snapshot && self ? { tick: snapshot.tick, hp: self.hp } : undefined;
    });
    expect(before.hp).toBe(40);

    priest.action("heal");
    const nobody = await until("heal.nobody", () =>
      priest.received.find((m) => m.t === "event" && m.code === "heal.nobody"),
    );
    expect(nobody).toMatchObject({ tone: "info" });

    const after = await until("far wounded later snapshot", () => {
      const snapshot = wounded.latestSnapshot;
      const self = wounded.self();
      return snapshot && snapshot.tick > before.tick && self ? self : undefined;
    });
    expect(after.hp).toBe(40);

    priest.close();
    wounded.close();
  });

  it("blocks a dead priest from casting heal", { timeout: 10_000 }, async () => {
    // The first road goblin patrols within 75px of its spawn, well inside the 210px aggro
    // range, so a player standing on the spawn point draws it reliably. One HP means the first
    // landed hit kills regardless of the species-specific damage table.
    const priest = await Client.join("dying_priest", {
      position: { x: 1870, y: 820 },
      class: "priest",
      hp: 1,
    });
    await until("welcome", () => priest.welcome);
    await until(
      "the monster to kill the priest",
      () => (priest.self()?.life === "corpse" ? priest.self() : undefined),
      10_000,
    );

    // Only bring in a healable ally now that the priest is dead. The monster orbits its spawn
    // at a roughly constant distance, so if it had joined earlier there'd be a real chance the
    // patrol phase put the ally closer to the monster than the (stationary) priest, drawing the
    // kill onto the wrong player. Landing the killing blow just reset the monster's own
    // MONSTER_ATTACK_COOLDOWN_MS (900ms), so whichever player it picks next, it cannot land a
    // second hit inside the 300ms this test asserts over — the ally is safe by timing, not
    // position.
    const ally = await Client.join("spared_ally", { position: { x: 1870, y: 920 }, hp: 40 });
    await until("ally welcome", () => ally.welcome);

    // Dead priests must not be able to cast: no cooldown check saves them, the intent is
    // dropped outright — the server never even sends heal.nobody.
    priest.action("heal");
    priest.action("heal");
    await scheduler.wait(300);

    expect(ally.self()?.hp).toBe(40);
    expect(priest.received.some((m) => m.t === "event" && String(m.code).startsWith("heal"))).toBe(
      false,
    );

    priest.close();
    ally.close();
  });

  it("ignores heal intents from non-priests and out-of-range or full-health situations", async () => {
    const warrior = await Client.join("brute", { position: { x: 784, y: 450 } });
    await until("welcome", () => warrior.welcome);
    warrior.action("heal");
    await scheduler.wait(150);
    expect(warrior.received.some((m) => m.t === "event" && String(m.code).startsWith("heal"))).toBe(
      false,
    );

    const priest = await Client.join("lonely", {
      position: { x: 3000, y: 2200 },
      class: "priest",
      level: 3,
    });
    await until("welcome", () => priest.welcome);
    priest.action("heal"); // full HP everywhere near → nobody
    const nobody = await until("heal.nobody", () =>
      priest.received.find((m) => m.t === "event" && m.code === "heal.nobody"),
    );
    expect(nobody).toMatchObject({ tone: "info" });

    warrior.close();
    priest.close();
  });

  it("deleting a connected character kicks its socket", async () => {
    const session = await testCharacter("deleteme");
    const client = await Client.joinCharacter(session);
    await until("welcome", () => client.welcome);

    const deleted = await SELF.fetch(`${ORIGIN}/api/characters/${session.characterId}`, {
      method: "DELETE",
      headers: { Cookie: session.cookie },
    });
    expect(deleted.status).toBe(204);

    const closed = await until("kick close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(4002);
  });
});

/** The read half of surviving a rebuild — see the persistence test above. */
describe("positionFromAttachment", () => {
  const inWorld = (position: { x: number; y: number }) => {
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.x).toBeLessThanOrEqual(WORLD_WIDTH - PLAYER_SIZE);
    expect(position.y).toBeLessThanOrEqual(WORLD_HEIGHT - PLAYER_SIZE);
    expect(isWalkable(position)).toBe(true);
  };

  it("resumes a persisted position exactly", () => {
    const attachment: Attachment = { id: "a", nick: "n", x: 123.5, y: 456.25 };
    expect(positionFromAttachment(attachment)).toEqual({ x: 123.5, y: 456.25 });
  });

  it("spawns fresh when there is no attachment", () => {
    inWorld(positionFromAttachment(null));
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("spawns fresh rather than trusting a %s coordinate", (_label, bad) => {
    inWorld(positionFromAttachment({ id: "a", nick: "n", x: bad, y: 10 }));
    inWorld(positionFromAttachment({ id: "a", nick: "n", x: 10, y: bad }));
  });

  it("uses the player-specific spawn for blocked and out-of-world attachments", () => {
    const collider = WORLD_LANDMARKS.find((landmark) => landmark.collider)?.collider;
    if (!collider) throw new Error("test world needs a landmark collider");
    const expected = spawnPosition("returning-id");
    expect(
      positionFromAttachment({
        id: "returning-id",
        nick: "n",
        x: collider.x + 1,
        y: collider.y + 1,
      }),
    ).toEqual(expected);
    expect(positionFromAttachment({ id: "returning-id", nick: "n", x: -500, y: 500 })).toEqual(
      expected,
    );
  });
});

/**
 * Death, end to end. Dying leaves a body; the body is the only way back, by one of two routes.
 *
 * These drive the real Durable Object, so they assert on *which* ids are present, never on how
 * many — a straggler from an earlier test is still disconnecting and must not be able to fail
 * an assertion here.
 */
describe("death, ghosts, and the corpse run", () => {
  /** Park on the first road goblin's spawn with 1 HP: it aggros, and one hit is fatal. */
  const KILL_ZONE = { x: 1870, y: 820 };

  async function joinAndDie(nickname: string, options: { class?: PlayerClass } = {}) {
    const client = await Client.join(nickname, { ...options, position: KILL_ZONE, hp: 1 });
    await until("welcome", () => client.welcome);
    await until(
      "the goblin to land a killing blow",
      () => (client.self()?.life === "corpse" ? client.self() : undefined),
      10_000,
    );
    return client;
  }

  it("leaves a body where you fell, and freezes you over it", { timeout: 10_000 }, async () => {
    const player = await joinAndDie("faller");

    const corpse = player.corpse();
    expect(corpse).toBeDefined();
    // The body lies where the player fell, not at a spawn point: dying does not move you.
    expect(corpse?.x).toBeCloseTo(player.self()?.x ?? -1, 5);
    expect(corpse?.y).toBeCloseTo(player.self()?.y ?? -1, 5);
    expect(player.latestState?.life).toBe("corpse");

    // A corpse does not walk, no matter how hard the client pushes.
    const before = { x: player.self()?.x, y: player.self()?.y };
    player.press("left");
    await scheduler.wait(400);
    expect(player.self()?.x).toBeCloseTo(before.x ?? -1, 5);
    expect(player.self()?.y).toBeCloseTo(before.y ?? -1, 5);

    player.close();
  });

  it("sends a released spirit to the nearest cemetery", { timeout: 10_000 }, async () => {
    const player = await joinAndDie("releaser");
    const corpse = player.corpse();
    if (!corpse) throw new Error("expected a body");

    player.releaseSpirit();
    await until("the ghost to rise", () =>
      player.self()?.life === "ghost" ? player.self() : undefined,
    );

    const expected = nearestCemetery(corpse);
    // Nearest, not merely *a* cemetery — the whole point is that the walk home stays short.
    expect(expected.id).toBe(
      [...CEMETERIES].sort(
        (a, b) =>
          Math.hypot(a.x - corpse.x, a.y - corpse.y) - Math.hypot(b.x - corpse.x, b.y - corpse.y),
      )[0]?.id,
    );
    expect(player.self()?.x).toBeCloseTo(expected.x, 5);
    expect(player.self()?.y).toBeCloseTo(expected.y, 5);

    // And the body stays behind. If it vanished on release there would be nothing to run to.
    expect(player.corpse()?.x).toBeCloseTo(corpse.x, 5);
    expect(player.corpse()?.y).toBeCloseTo(corpse.y, 5);

    player.close();
  });

  it("lets a ghost walk, faster than the living", { timeout: 10_000 }, async () => {
    const player = await joinAndDie("walker");
    player.releaseSpirit();
    await until("the ghost to rise", () =>
      player.self()?.life === "ghost" ? player.self() : undefined,
    );

    const start = player.self();
    if (!start) throw new Error("expected a ghost");
    const { direction, sign } = awayFromNearestWall(start.x);
    player.press(direction);
    await scheduler.wait(500);
    player.release();
    await scheduler.wait(120);

    const travelled = ((player.self()?.x ?? start.x) - start.x) * sign;
    expect(travelled).toBeGreaterThan(0);
    // Ghost speed, not living speed: over half a second the gap is far wider than the slop.
    expect(travelled).toBeGreaterThan(PLAYER_SPEED * 0.35);

    player.close();
  });

  it("hides a ghost from the monsters that killed it", { timeout: 12_000 }, async () => {
    const player = await joinAndDie("unhaunted");
    player.releaseSpirit();
    await until("the ghost to rise", () =>
      player.self()?.life === "ghost" ? player.self() : undefined,
    );
    const hurtBefore = player.received.filter(
      (m) => m.t === "event" && m.code === "combat.hurt",
    ).length;

    // Walk the ghost straight back onto the goblin that killed it and stand there.
    const corpse = player.corpse();
    if (!corpse) throw new Error("expected a body");
    await scheduler.wait(1_500);

    const hurtAfter = player.received.filter(
      (m) => m.t === "event" && m.code === "combat.hurt",
    ).length;
    expect(hurtAfter).toBe(hurtBefore);
    expect(player.self()?.life).toBe("ghost");

    player.close();
  });

  it("drops every action a spirit tries to take", { timeout: 10_000 }, async () => {
    const player = await joinAndDie("inert", { class: "priest" });
    const potionsBefore = player.latestState?.inventory.potions ?? 0;
    // Everything before this point includes the blow that killed us. Only what comes after counts.
    const mark = player.received.length;

    player.action("attack");
    player.action("heal");
    player.action("interact");
    player.usePotion();
    player.skill(3);
    await scheduler.wait(300);

    // Not "rejected with an explanation" — dropped outright. A corpse gets no events at all.
    const acted = player.received
      .slice(mark)
      .filter(
        (m) =>
          m.t === "event" &&
          (String(m.code).startsWith("heal.") ||
            String(m.code).startsWith("skill.") ||
            m.code === "combat.too_far" ||
            m.code === "combat.blocked" ||
            m.code === "combat.hit" ||
            m.code === "potion.used" ||
            m.code === "interact.nothing"),
      );
    expect(acted).toEqual([]);
    expect(player.latestState?.inventory.potions).toBe(potionsBefore);
    expect(player.self()?.life).toBe("corpse");

    player.close();
  });

  it("revives a ghost that reaches its own body", { timeout: 15_000 }, async () => {
    const player = await joinAndDie("reclaimer");
    const corpse = player.corpse();
    if (!corpse) throw new Error("expected a body");

    player.releaseSpirit();
    await until("the ghost to rise", () =>
      player.self()?.life === "ghost" ? player.self() : undefined,
    );

    // Walk the ghost home. It is a long way, so steer each tick rather than holding one key.
    const arrived = await until(
      "the ghost to reach its body and draw breath",
      () => {
        const self = player.self();
        if (!self) return undefined;
        if (self.life === "alive") return self;
        const dx = corpse.x - self.x;
        const dy = corpse.y - self.y;
        if (Math.abs(dx) > Math.abs(dy)) player.press(dx > 0 ? "right" : "left");
        else player.press(dy > 0 ? "down" : "up");
        return undefined;
      },
      14_000,
    );

    expect(arrived.life).toBe("alive");
    // Back at the body, not at a spawn point, and paying for it in health.
    expect(Math.hypot(arrived.x - corpse.x, arrived.y - corpse.y)).toBeLessThanOrEqual(
      CORPSE_RECLAIM_RANGE,
    );
    expect(arrived.hp).toBe(Math.round(maxHpForLevel(arrived.level) * RESURRECT_HP_RATIO));
    expect(player.corpse()).toBeUndefined();
    expect(player.received.some((m) => m.t === "event" && m.code === "death.reclaimed")).toBe(true);

    player.close();
  });

  it("lets a priest raise a body in place", { timeout: 12_000 }, async () => {
    const fallen = await joinAndDie("raisable");
    const corpse = fallen.corpse();
    if (!corpse) throw new Error("expected a body");

    // Stand the priest on the body. Interact is the resurrect: no sixth skill slot needed.
    const priest = await Client.join("raiser", {
      class: "priest",
      position: { x: corpse.x + 20, y: corpse.y },
      level: 5,
    });
    await until("priest welcome", () => priest.welcome);
    priest.action("interact");

    const raised = await until(
      "the fallen to be called back",
      () => (fallen.self()?.life === "alive" ? fallen.self() : undefined),
      8_000,
    );

    // Raised where they lay — the whole value of a priest is that you skip the walk.
    expect(Math.hypot(raised.x - corpse.x, raised.y - corpse.y)).toBeLessThanOrEqual(2);
    expect(raised.hp).toBe(Math.round(maxHpForLevel(raised.level) * RESURRECT_HP_RATIO));
    expect(fallen.corpse()).toBeUndefined();
    expect(fallen.received.some((m) => m.t === "event" && m.code === "death.resurrected")).toBe(
      true,
    );

    priest.close();
    fallen.close();
  });

  it("refuses a warrior standing on the same body", { timeout: 12_000 }, async () => {
    const fallen = await joinAndDie("unraisable");
    const corpse = fallen.corpse();
    if (!corpse) throw new Error("expected a body");

    const warrior = await Client.join("wrongclass", {
      class: "warrior",
      position: { x: corpse.x + 20, y: corpse.y },
    });
    await until("warrior welcome", () => warrior.welcome);
    warrior.action("interact");
    await scheduler.wait(400);

    expect(fallen.self()?.life).toBe("corpse");
    expect(warrior.received.some((m) => m.t === "event" && m.code === "resurrect.not_priest")).toBe(
      true,
    );

    warrior.close();
    fallen.close();
  });

  it("closes the priest's door once you release", { timeout: 12_000 }, async () => {
    const fallen = await joinAndDie("gone");
    const corpse = fallen.corpse();
    if (!corpse) throw new Error("expected a body");

    fallen.releaseSpirit();
    await until("the ghost to rise", () =>
      fallen.self()?.life === "ghost" ? fallen.self() : undefined,
    );

    // The body is still lying there, but its owner has left it. Releasing is one-way.
    const priest = await Client.join("late_priest", {
      class: "priest",
      position: { x: corpse.x + 20, y: corpse.y },
      level: 5,
    });
    await until("priest welcome", () => priest.welcome);
    priest.action("interact");
    await scheduler.wait(400);

    // Assert on *this* ghost, never on the absence of any resurrect at all: the world is one
    // Durable Object across this file, and a straggler's body could be lying in the same dirt.
    expect(fallen.self()?.life).toBe("ghost");
    expect(fallen.corpse()).toBeDefined();
    expect(fallen.received.some((m) => m.t === "event" && m.code === "death.resurrected")).toBe(
      false,
    );

    priest.close();
    fallen.close();
  });

  it("survives a reconnect: logging out is not a resurrection", { timeout: 15_000 }, async () => {
    const session = await testCharacter("persistent", { position: KILL_ZONE, hp: 1 });
    const first = await Client.joinCharacter(session);
    await until("welcome", () => first.welcome);
    const died = await until(
      "the goblin to land a killing blow",
      () => (first.self()?.life === "corpse" ? first.self() : undefined),
      10_000,
    );

    first.releaseSpirit();
    await until("the ghost to rise", () =>
      first.self()?.life === "ghost" ? first.self() : undefined,
    );
    // Give the world its five-second D1 write, then vanish mid-corpse-run.
    await scheduler.wait(5_500);
    first.close();
    await scheduler.wait(300);

    const second = await Client.joinCharacter(session);
    const welcome = await until("the second welcome", () => second.welcome);
    await until("the first snapshot", () => second.latestSnapshot);

    // Still a ghost, and the body is still out there waiting.
    expect(welcome.self.life).toBe("ghost");
    expect(welcome.self.corpse?.x).toBeCloseTo(died.x, 0);
    expect(welcome.self.corpse?.y).toBeCloseTo(died.y, 0);
    expect(second.corpse()).toBeDefined();

    second.close();
  });
});
