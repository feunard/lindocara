/**
 * End-to-end through the real Durable Object: a real WebSocket, the real tick loop, the
 * real simulation. Nothing here is mocked, so a passing run means a browser would work.
 */

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RESYNC_COOLDOWN_MS } from "../src/server/world/world-runtime.js";
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
import { GUARD_VISIBILITY_RADIUS, MONSTER_VISIBILITY_RADIUS } from "../src/shared/interest.js";
import {
  NO_INPUT,
  PLAYER_SIZE,
  PLAYER_SPEED,
  TICK_DT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../src/shared/simulation.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import {
  awayFromNearestWall,
  Client,
  MMO_TEST_ROOM_KEY,
  ORIGIN,
  testCharacter,
  until,
  VERDANT_ROOM_KEY,
  waitForRoomSockets,
} from "./support/world-harness.js";

async function formRuntimeParty(leader: Client, member: Client): Promise<void> {
  const leaderWelcome = await until("combat party leader welcome", () => leader.welcome);
  const memberWelcome = await until("combat party member welcome", () => member.welcome);
  leader.sendRaw(JSON.stringify({ t: "party.create" }));
  await until("combat party created", () =>
    leader.received.find((message) => message.t === "party.state" && message.party !== null),
  );
  leader.sendRaw(JSON.stringify({ t: "party.invite", playerId: memberWelcome.selfId }));
  const invite = await until("combat party invitation", () =>
    member.received.find((message) => message.t === "party.invite"),
  );
  if (invite.t !== "party.invite") throw new Error("invalid combat party invitation");
  member.sendRaw(JSON.stringify({ t: "party.accept", inviteId: invite.inviteId }));
  await until("combat party member joined", () =>
    member.received.find(
      (message) => message.t === "party.state" && message.party?.members.length === 2,
    ),
  );
  expect(leaderWelcome.selfId).not.toBe(memberWelcome.selfId);
}

describe("World", () => {
  it("welcomes a player with the world dimensions and their own id", async () => {
    const client = await Client.join("alice");

    const welcome = await until("welcome", () => client.welcome);
    expect(Number.isSafeInteger(welcome.tick)).toBe(true);
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
    expect(welcome.world.merchant).toBeNull();
    const welcomedSelf = welcome.players.find((player) => player.id === welcome.selfId);
    if (!welcomedSelf) throw new Error("welcome omitted the local player");
    for (const monster of welcome.monsters) {
      expect(
        Math.hypot(monster.x - welcomedSelf.x, monster.y - welcomedSelf.y),
      ).toBeLessThanOrEqual(MONSTER_VISIBILITY_RADIUS);
    }
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

  it("emits network world state less often than simulation ticks", async () => {
    const client = await Client.join("bob");
    const deltas = await until("two network deltas", () => {
      const messages = client.received.filter((message) => message.t === "world.delta");
      return messages.length >= 2 ? messages : undefined;
    });
    const first = deltas[0];
    const second = deltas[1];
    if (!first || !second) throw new Error("network delta fixtures missing");
    expect(second.tick - first.tick).toBe(2);
    client.close();
  });

  it("sends sparse deltas, movement upserts, and an explicit full resynchronization", async () => {
    await waitForRoomSockets(MMO_TEST_ROOM_KEY, 0);
    const client = await Client.join("delta_probe", {
      zoneId: "mmo-test-zone",
      position: { x: 160, y: 160 },
      pump: false,
    });
    const welcome = await until("delta welcome", () => client.welcome);
    expect(welcome.players.map((player) => player.id)).toContain(welcome.selfId);

    const unchanged = await until("unchanged delta", () =>
      client.received.find((message) => message.t === "world.delta"),
    );
    for (const part of [
      unchanged.players,
      unchanged.monsters,
      unchanged.guards,
      unchanged.loot,
      unchanged.corpses,
    ]) {
      expect(part).toEqual({ upsert: [], remove: [] });
    }

    client.sendCommand({ ...NO_INPUT, right: true });
    const moved = await until("movement delta", () =>
      client.received.find(
        (message) =>
          message.t === "world.delta" &&
          message.players.upsert.some((player) => player.id === welcome.selfId),
      ),
    );
    expect(moved).toMatchObject({ t: "world.delta" });

    const beforeResync = client.received.length;
    client.requestResync();
    client.requestResync();
    const resync = await until("full world resync", () =>
      client.received.slice(beforeResync).find((message) => message.t === "world.resync"),
    );
    expect(resync.players.map((player) => player.id)).toContain(welcome.selfId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      client.received.slice(beforeResync).filter((message) => message.t === "world.resync"),
    ).toHaveLength(1);
    client.close();
  });

  // A client that asks for a resync stops applying deltas until one arrives. Dropping a
  // throttled request therefore freezes its world until it reconnects — so the throttle defers
  // the resync, it does not discard it.
  it("pays back a throttled resync once the cooldown lifts", { timeout: 15_000 }, async () => {
    const client = await Client.join("resync_debt", { pump: false });
    const welcome = await until("resync debt welcome", () => client.welcome);

    const mark = client.received.length;
    const resyncsSince = () =>
      client.received
        .slice(mark)
        .flatMap((message, index) =>
          message.t === "world.resync"
            ? [{ message, receivedAt: client.receivedAt[mark + index] ?? 0 }]
            : [],
        );

    // Two resync-worthy events inside one cooldown window: routine on a lossy connection.
    client.requestResync();
    client.requestResync();

    const both = await until("the throttled resync to arrive late", () => {
      const seen = resyncsSince();
      return seen.length >= 2 ? seen : undefined;
    });
    expect(both).toHaveLength(2);
    expect(both[1]?.message.players.map((player) => player.id)).toContain(welcome.selfId);
    // The rate limit still holds: the second one waited out the cooldown.
    expect((both[1]?.receivedAt ?? 0) - (both[0]?.receivedAt ?? 0)).toBeGreaterThanOrEqual(
      RESYNC_COOLDOWN_MS,
    );

    // And the debt is paid exactly once — no request/throttle ping-pong afterwards.
    await scheduler.wait(1_500);
    expect(resyncsSince()).toHaveLength(2);
    client.close();
  });

  it("lets a border monster enter the city and has guards remove it without rewards", {
    timeout: 12_000,
  }, async () => {
    const client = await Client.join("guard_witness", {
      position: { x: 1380, y: 980 },
    });
    const welcome = await until("guard welcome", () => client.welcome);
    const witness = welcome.players.find((player) => player.id === welcome.selfId);
    if (!witness) throw new Error("guard witness missing from welcome");
    expect(welcome.guards.length).toBeGreaterThan(0);
    for (const guard of welcome.guards) {
      expect(Math.hypot(guard.x - witness.x, guard.y - witness.y)).toBeLessThanOrEqual(
        GUARD_VISIBILITY_RADIUS,
      );
    }
    const hpBefore = client.self()?.hp ?? 100;
    const xpBefore = welcome.self.xp;

    const fighting = await until(
      "a guard to intercept the city prowler",
      () => client.latestSnapshot?.guards.find((guard) => guard.fighting),
      8_000,
    );
    expect(
      Math.hypot(fighting.x - fighting.homeX, fighting.y - fighting.homeY),
    ).toBeLessThanOrEqual(212);
    const defeated = await until(
      "the city prowler to be defeated",
      () =>
        client.latestSnapshot?.monsters.find(
          (monster) => monster.id === "city-edge-prowler" && monster.dead,
        ),
      4_000,
    );
    expect(defeated.hp).toBe(0);
    expect(client.self()?.hp).toBe(hpBefore);
    expect(client.latestState?.xp).toBe(xpBefore);
    expect(client.latestSnapshot?.loot).toEqual([]);
    for (const guard of client.latestSnapshot?.guards ?? []) {
      expect(Math.hypot(guard.x - guard.homeX, guard.y - guard.homeY)).toBeLessThanOrEqual(212);
    }
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
    // The old rectangle's edge sat exactly at WORLD_BOUNDARY_DEPTH; the tile grid coarsens that
    // wall out to the nearest solid cell, so find where it actually sits before spawning nearby,
    // rather than assuming `WORLD_BOUNDARY_DEPTH` is itself still walkable. Bounded: coarsening can
    // only fatten a wall by less than one tile (SOLID_COVERAGE is a 50% threshold), so two tiles of
    // search is already generous — if it ever runs out, the row is unexpectedly solid and the test
    // should fail loudly rather than spin forever.
    const y = 2000;
    const WALL_SEARCH_LIMIT = WORLD_BOUNDARY_DEPTH + TILE_SIZE * 2;
    let wallX = WORLD_BOUNDARY_DEPTH;
    while (!isWalkable({ x: wallX, y })) {
      wallX += 1;
      if (wallX > WALL_SEARCH_LIMIT) {
        throw new Error(
          `no walkable ground found within ${WALL_SEARCH_LIMIT}px of the boundary wall at y=${y}`,
        );
      }
    }
    const start = { x: wallX + PLAYER_SPEED * TICK_DT, y };
    const client = await Client.join("dave", { position: start });
    await until("welcome", () => client.welcome);

    client.press("left");
    // Movement is tick-quantised (one command applied per tick), and `start` was placed exactly
    // one tick's travel from `wallX` — the same computation `resolveTerrain` will make — so the
    // square settles at exactly `wallX` after a single applied tick. Poll for that real condition
    // instead of sleeping and hoping a tick landed within an arbitrary window.
    const pinned = await until(
      "the square to settle against the boundary wall",
      () => {
        const now = client.self();
        return now && now.x === wallX ? now : undefined;
      },
      2_000,
    );
    expect(pinned.x).toBe(wallX);
    expect(isWalkable({ x: pinned.x, y: pinned.y })).toBe(true);

    // Keep pushing: the wall must hold, not merely be touched once.
    await scheduler.wait(200);
    expect(client.self()?.x).toBe(pinned.x);

    client.close();
  });

  // A player's own `facing` in their own snapshot must track the direction they actually moved,
  // not just an ally's (the existing "priest facing down" coverage below only proves the y axis).
  // This pins the x axis a user reported broken in the map-editor preview sandbox: if the real
  // authoritative path ever regressed the same way, this is where it would be caught.
  it("turns a player's own facing to left when they move left", async () => {
    const client = await Client.join("lefty");
    await until("welcome", () => client.welcome);

    client.press("left");
    const facingLeft = await until("self facing left after moving left", () => {
      const self = client.self();
      return self && self.facing.x < -0.9 ? self : undefined;
    });
    expect(facingLeft.facing).toEqual({ x: -1, y: 0 });

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
    const main = await Client.join("zone_main", {
      zoneId: "verdant-reach",
      instanceId: "main",
      position: { x: 1870, y: 820 },
    });
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
    await waitForRoomSockets(MMO_TEST_ROOM_KEY, 0);
    const hunter = await Client.join("LootHunter", {
      zoneId: "verdant-reach",
      position: { x: 1870, y: 820 },
      level: 10,
    });
    const observer = await Client.join("LootEye", { zoneId: "mmo-test-zone" });
    const distant = await Client.join("DistantLootEye", {
      zoneId: "verdant-reach",
      position: { x: 4000, y: 1200 },
    });
    try {
      await until(
        "loot rooms welcome",
        () => hunter.welcome && observer.welcome && distant.welcome,
      );

      hunter.action("attack");
      await scheduler.wait(600);
      hunter.action("attack");
      const lootObserved = await until("main-room monster loot", () => {
        const snapshot = hunter.latestSnapshot;
        if (snapshot && snapshot.loot.length > 0) return true;
        return hunter.received.some(
          (message) => message.t === "event" && message.code === "loot.picked",
        )
          ? true
          : undefined;
      });
      expect(lootObserved).toBe(true);
      await until("technical-room snapshot", () => observer.latestSnapshot);
      await until("distant-room snapshot", () => distant.latestSnapshot);
      expect(observer.latestSnapshot?.loot).toEqual([]);
      expect(observer.latestSnapshot?.monsters).toEqual([]);
      expect(distant.latestSnapshot?.loot).toEqual([]);
      expect(
        distant.received.some((message) => message.t === "event" && message.code === "combat.hit"),
      ).toBe(false);
    } finally {
      hunter.close();
      observer.close();
      distant.close();
    }
  });

  // Loot enters the room, not D1: the count only reaches the database on the five-second flush.
  // A drink that trusts D1's quantity in that window destroys everything picked up since.
  it("keeps a potion added inside the D1 flush window", async () => {
    const drinker = await Client.join("potion_window", {
      zoneId: "verdant-reach",
      instanceId: "potion-window",
      hp: 20,
    });
    try {
      const welcome = await until("potion window welcome", () => drinker.welcome);
      expect(welcome.self.inventory.potions).toBe(2);

      // The test-only loot command mutates the same authoritative room inventory as a pickup, but
      // does not write D1. This creates the exact five-second race deterministically.
      drinker.chat("/loot");
      const held = await until("the in-memory potion gain", () => {
        const potions = drinker.latestState?.inventory.potions;
        return potions === 12 ? potions : undefined;
      });
      const stale = await env.DB.prepare(
        `SELECT quantity FROM character_item
         WHERE character_id = ? AND item_definition_id = 'health_potion'`,
      )
        .bind(welcome.selfId)
        .first<{ quantity: number }>();
      expect(stale?.quantity).toBe(2);

      drinker.sendRaw(JSON.stringify({ t: "use", item: "potion" }));
      await until("the drink to resolve", () =>
        drinker.received.some((message) => message.t === "event" && message.code === "item.used"),
      );
      // One drink costs one potion — not the ten it would lose if D1's stale count won.
      expect(drinker.latestState?.inventory.potions).toBe(held - 1);
    } finally {
      drinker.close();
      await waitForRoomSockets("verdant-reach:potion-window", 0);
    }
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

  it("rejects an invalid instance id without crashing", async () => {
    // New contract: `isValidInstanceId` is still checked first in handleJoin, ahead of the
    // zoneId/map hybrid routing, so a corrupt instanceId still closes the socket outright.
    const invalid = await testCharacter("invalid_instance");
    await env.DB.prepare("UPDATE character SET instance_id = ? WHERE id = ?")
      .bind("main:other", invalid.characterId)
      .run();
    const invalidClient = await Client.joinCharacter(invalid);
    expect(
      (await until("invalid instance close", () => invalidClient.closeInfo ?? undefined)).code,
    ).toBe(WS_CLOSE.INVALID_LOCATION);
  });

  it("self-heals a corrupt zone id onto a fallback map instead of rejecting the join", async () => {
    // New contract: a zoneId is only rejected structurally now (empty/oversize/non-string,
    // see isZoneId). "not-a-zone" is a well-formed but unknown zone, so handleJoin's hybrid
    // routing treats it as a D1 map id: isKnownZone() is false, resolveMapFor() falls back (own
    // map -> first map -> builtin) and relocateProfile() persists the move. The join succeeds
    // instead of closing with INVALID_LOCATION. Which fallback map is chosen is deliberately not
    // asserted here — deeper fallback coverage belongs to a later task.
    const unknown = await testCharacter("unknown_zone");
    await env.DB.prepare("UPDATE character SET zone_id = ? WHERE id = ?")
      .bind("not-a-zone", unknown.characterId)
      .run();
    const unknownClient = await Client.joinCharacter(unknown);
    const welcome = await until("relocated welcome", () => unknownClient.welcome);
    expect(welcome.selfId).toBeTruthy();
    expect(unknownClient.closeInfo).toBeNull();
    unknownClient.close();
  });

  it("enforces the technical room capacity and reconnects to the persisted test zone", {
    timeout: 15_000,
  }, async () => {
    await waitForRoomSockets(MMO_TEST_ROOM_KEY, 0);
    const first = await Client.join("capacity_one", { zoneId: "mmo-test-zone" });
    const second = await Client.join("capacity_two", { zoneId: "mmo-test-zone" });
    let third: Client | undefined;
    let joined: Client | undefined;
    try {
      await until("capacity players welcome", () => first.welcome && second.welcome);
      third = await Client.join("capacity_three", { zoneId: "mmo-test-zone" });
      expect((await until("room full close", () => third?.closeInfo ?? undefined))?.code).toBe(
        WS_CLOSE.ROOM_FULL,
      );

      const session = await testCharacter("tech_reconnect", { zoneId: "mmo-test-zone" });
      // Free a slot before asserting reconnection.
      first.close();
      await waitForRoomSockets(MMO_TEST_ROOM_KEY, 1);
      joined = await Client.joinCharacter(session);
      expect((await until("tech reconnect welcome", () => joined?.welcome)).world).toMatchObject({
        width: 640,
        height: 480,
      });
    } finally {
      first.close();
      second.close();
      third?.close();
      joined?.close();
    }
  });

  it("moves through server-owned portals, persists the destination, and returns", {
    timeout: 10_000,
  }, async () => {
    await waitForRoomSockets(MMO_TEST_ROOM_KEY, 0);
    const session = await testCharacter("portal_runner", { position: { x: 880, y: 450 } });
    const outbound = await Client.joinCharacter(session);
    await until("outbound welcome", () => outbound.welcome);
    outbound.action("interact");
    expect((await until("transition close", () => outbound.closeInfo ?? undefined)).code).toBe(
      WS_CLOSE.ZONE_TRANSITION,
    );
    const destination = await env.DB.prepare(
      "SELECT zone_id, instance_id, x, y FROM character WHERE id = ?",
    )
      .bind(session.characterId)
      .first<{ zone_id: string; instance_id: string; x: number; y: number }>();
    expect(destination).toEqual({ zone_id: "mmo-test-zone", instance_id: "main", x: 160, y: 160 });

    const inbound = await Client.joinCharacter(session);
    expect((await until("destination welcome", () => inbound.welcome)).world).toMatchObject({
      width: 640,
      height: 480,
    });
    expect((await until("destination player", () => inbound.self())).x).toBe(160);
    inbound.action("interact");
    expect(
      (await until("return transition close", () => inbound.closeInfo ?? undefined)).code,
    ).toBe(WS_CLOSE.ZONE_TRANSITION);
    const returned = await env.DB.prepare(
      "SELECT zone_id, instance_id, x, y FROM character WHERE id = ?",
    )
      .bind(session.characterId)
      .first<{ zone_id: string; instance_id: string; x: number; y: number }>();
    expect(returned).toEqual({ zone_id: "verdant-reach", instance_id: "main", x: 784, y: 450 });
  });

  it("keeps a ten-second skill unavailable across reconnect and zone transition", {
    timeout: 10_000,
  }, async () => {
    await waitForRoomSockets(MMO_TEST_ROOM_KEY, 0);
    const session = await testCharacter("cooldowner", {
      position: { x: 880, y: 450 },
      class: "priest",
      level: 10,
    });
    const first = await Client.joinCharacter(session);
    await until("cooldown first welcome", () => first.welcome);
    first.skill(5);
    const deadline = await until("ten second cooldown state", () => {
      const value = first.latestState?.cooldowns?.skillCooldowns[4];
      return value && value > Date.now() + 8_000 ? value : undefined;
    });
    first.close();

    const reconnected = await Client.joinCharacter(session);
    const reconnectWelcome = await until("cooldown reconnect welcome", () => reconnected.welcome);
    expect(reconnectWelcome.self.cooldowns?.skillCooldowns[4]).toBe(deadline);
    reconnected.skill(5);
    await scheduler.wait(150);
    expect(
      reconnected.received.some(
        (message) =>
          message.t === "event" &&
          message.code === "skill.cast" &&
          message.params?.skill === "divine_nova",
      ),
    ).toBe(false);

    reconnected.action("interact");
    expect(
      (await until("cooldown transition close", () => reconnected.closeInfo ?? undefined)).code,
    ).toBe(WS_CLOSE.ZONE_TRANSITION);
    const transitioned = await Client.joinCharacter(session);
    const transitionWelcome = await until(
      "cooldown destination welcome",
      () => transitioned.welcome,
    );
    expect(transitionWelcome.self.cooldowns?.skillCooldowns[4]).toBe(deadline);
    transitioned.skill(5);
    await scheduler.wait(150);
    expect(
      transitioned.received.some(
        (message) =>
          message.t === "event" &&
          message.code === "skill.cast" &&
          message.params?.skill === "divine_nova",
      ),
    ).toBe(false);
    transitioned.close();
  });

  it("refuses a distant or destination-spoofed portal interaction", async () => {
    const client = await Client.join("far_portal", { position: { x: 1400, y: 450 } });
    await until("far portal welcome", () => client.welcome);
    client.sendRaw(JSON.stringify({ t: "interact", destination: "mmo-test-zone" }));
    await scheduler.wait(150);
    expect(client.closeInfo).toBeNull();
    expect(client.received.some((m) => m.t === "event" && m.code === "zone.transition")).toBe(
      false,
    );
    client.close();
  });

  it("handles a double portal interact once and leaves a recoverable destination", async () => {
    const session = await testCharacter("portal_spam", { position: { x: 880, y: 450 } });
    const client = await Client.joinCharacter(session);
    await until("portal spam welcome", () => client.welcome);
    client.action("interact");
    client.action("interact");
    await until("portal spam close", () => client.closeInfo ?? undefined);
    const row = await env.DB.prepare("SELECT zone_id, session_epoch FROM character WHERE id = ?")
      .bind(session.characterId)
      .first<{ zone_id: string; session_epoch: number }>();
    expect(row).toEqual({ zone_id: "mmo-test-zone", session_epoch: 2 });
    const recovered = await Client.joinCharacter(session);
    expect((await until("portal recovery welcome", () => recovered.welcome)).world.width).toBe(640);
    recovered.close();
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

  it("filters snapshots and local chat by spatial interest while always including self", {
    timeout: 20_000,
  }, async () => {
    const alice = await Client.join("chat_a", { position: { x: 500, y: 1100 } });
    const bob = await Client.join("chat_b", { position: { x: 600, y: 1100 } });
    const far = await Client.join("chat_far", { position: { x: 1870, y: 820 } });
    try {
      // Waiting for "a snapshot exists" is not the same as waiting for the snapshot to know about
      // Bob: he reaches Alice on the next 10Hz delta, so asserting the moment three snapshots exist
      // races that delta and fails whenever the machine is slow enough to notice. Wait for the
      // condition actually under test.
      await until(
        "interest snapshots include the neighbour",
        () => {
          const neighbour = bob.welcome?.selfId;
          return neighbour &&
            alice.latestSnapshot?.players.some((player) => player.id === neighbour) &&
            bob.latestSnapshot &&
            far.latestSnapshot
            ? true
            : undefined;
        },
        10_000,
      );

      const aliceId = alice.welcome?.selfId;
      const bobId = bob.welcome?.selfId;
      const farId = far.welcome?.selfId;
      expect(alice.latestSnapshot?.players.map((player) => player.id)).toEqual(
        expect.arrayContaining([aliceId, bobId]),
      );
      expect(alice.latestSnapshot?.players.map((player) => player.id)).not.toContain(farId);
      expect(far.latestSnapshot?.players.map((player) => player.id)).toContain(farId);
      expect(far.latestSnapshot?.players.map((player) => player.id)).not.toContain(aliceId);

      alice.chat("  hello   world  ");
      const relayed = await until("chat relay", () =>
        bob.received.find((message) => message.t === "chat" && message.from === "chat_a"),
      );
      expect(relayed).toMatchObject({
        t: "chat",
        channel: "local",
        from: "chat_a",
        text: "hello world",
      });
      await scheduler.wait(200);
      expect(
        far.received.some((message) => message.t === "chat" && message.text === "hello world"),
      ).toBe(false);
    } finally {
      alice.close();
      bob.close();
      far.close();
      await waitForRoomSockets(VERDANT_ROOM_KEY, 0);
    }
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
      `SELECT json_extract(q.data, '$.wardRunExpiresAt') AS ward_run_expires_at,
              c.session_epoch
       FROM character c
       INNER JOIN character_quest q ON q.character_id = c.id AND q.quest_id = 'ward_run'
       WHERE c.id = ?`,
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
      `SELECT q.progress AS quest_progress,
              json_extract(q.data, '$.wardRunExpiresAt') AS ward_run_expires_at
       FROM character_quest q
       WHERE q.character_id = ? AND q.quest_id = 'ward_run'`,
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

  it("rate-limits spammed invalid attack intents", async () => {
    const client = await Client.join("attack_spammer", { pump: false });
    await until("welcome", () => client.welcome);

    for (let i = 0; i < 36; i++) client.action("attack");

    const closed = await until(
      "invalid attack spam policy close",
      () => client.closeInfo ?? undefined,
    );
    expect(closed.code).toBe(1008);
  });

  it("closes an oversized WebSocket frame", async () => {
    const client = await Client.join("huge_frame");
    await until("welcome", () => client.welcome);
    client.sendRaw("x".repeat(2_049));
    const closed = await until("oversized close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(1009);
  });

  it("lets a priest heal a struck ally but not themself with Mend while respecting cooldown", {
    timeout: 15_000,
  }, async () => {
    // ~250px from the nearest SPAWN_POINTS grid cell — far enough that a straggler still
    // disconnecting from an earlier test (spawned somewhere on that grid, always inside
    // heal.range 195 of *itself* but not of here) cannot be closer than the wounded ally and
    // steal the cast.
    const priest = await Client.join("mender", {
      position: { x: 1150, y: 250 },
      class: "priest",
      level: 3,
      hp: 40,
    });
    const wounded = await Client.join("wounded", { position: { x: 1220, y: 250 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && wounded.welcome);
    await formRuntimeParty(priest, wounded);

    priest.skill(2);
    await until("the wounded player to be mended", () => {
      const snapshot = wounded.self();
      return snapshot && snapshot.hp > 40 ? snapshot : undefined;
    });

    const healed = wounded.self();
    expect(healed?.hp).toBe(40 + 41); // healAmountFor(3)
    expect(priest.self()?.hp).toBe(40);

    // Cooldown: an immediate second cast must not double-heal.
    priest.skill(2);
    priest.skill(2);
    await scheduler.wait(200);
    expect(wounded.self()?.hp).toBe(81);
    expect(priest.self()?.hp).toBe(40);

    const cast = priest.received.find(
      (m) => m.t === "event" && m.code === "heal.cast" && m.params?.name === "wounded",
    );
    const received = wounded.received.find((m) => m.t === "event" && m.code === "heal.received");
    expect(cast).toMatchObject({
      params: { name: "wounded", amount: 41, color: "azure", skill: "mend" },
    });
    expect(received).toMatchObject({
      params: { name: "mender", amount: 41, color: "azure", skill: "mend" },
    });

    priest.close();
    wounded.close();
  });

  it("lets a visible directional arrow hit a monster", { timeout: 10_000 }, async () => {
    const ranger = await Client.join("sighter", {
      position: { x: 2140, y: 820 },
      class: "ranger",
      instanceId: "directional-arrow",
    });
    const observer = await Client.join("sighter_observer", {
      position: { x: 2180, y: 820 },
      instanceId: "directional-arrow",
    });
    try {
      await until("welcome", () => ranger.welcome && observer.welcome);
      ranger.action("attack");
      const hit = await until("combat hit", () => {
        ranger.action("attack");
        return ranger.received.find((m) => m.t === "event" && m.code === "combat.hit");
      });
      expect(hit).toMatchObject({ tone: "info" });
      const animation = await until("ranged attack animation for the observer", () =>
        observer.received.find(
          (message) =>
            message.t === "animation" &&
            message.actorKind === "player" &&
            message.actorId === ranger.welcome?.selfId &&
            message.action === "attack",
        ),
      );
      expect(animation).toMatchObject({
        direction: { x: 1, y: 0 },
        skillId: "quick_shot",
        startedAt: expect.any(Number),
        impactAt: expect.any(Number),
        recoveryEndsAt: expect.any(Number),
      });
    } finally {
      ranger.close();
      observer.close();
    }
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

  it("aims warrior shield bash at the nearest visible enemy and charges", {
    timeout: 10_000,
  }, async () => {
    const warrior = await Client.join("charger", {
      position: { x: 2140, y: 820 },
      level: 5,
    });
    await until("charge welcome", () => warrior.welcome);
    const before = await until("charge target", () => {
      const self = warrior.self();
      const monsters = warrior.latestSnapshot?.monsters.filter((monster) => !monster.dead);
      if (!self || !monsters?.length) return undefined;
      const target = [...monsters].sort(
        (a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y),
      )[0];
      if (!target) return undefined;
      return { self, target };
    });

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
    const animation = await until("targeted charge animation", () =>
      warrior.received.find(
        (message) =>
          message.t === "animation" &&
          message.actorId === warrior.welcome?.selfId &&
          message.skillId === "shield_bash",
      ),
    );
    if (animation.t !== "animation") throw new Error("expected charge animation");
    const targetLength = Math.hypot(
      before.target.x - before.self.x,
      before.target.y - before.self.y,
    );
    const targetDirection = {
      x: (before.target.x - before.self.x) / targetLength,
      y: (before.target.y - before.self.y) / targetLength,
    };
    expect(
      animation.direction.x * targetDirection.x + animation.direction.y * targetDirection.y,
    ).toBeGreaterThan(0.8);
    const moved = await until("charge position", () => {
      const self = warrior.self();
      if (!self) return undefined;
      return Math.hypot(self.x - before.self.x, self.y - before.self.y) > 1 ? self : undefined;
    });
    expect(Math.hypot(moved.x - before.self.x, moved.y - before.self.y)).toBeGreaterThan(1);
    warrior.close();
  });

  it("casts a directional Volley without a target", { timeout: 10_000 }, async () => {
    const ranger = await Client.join("area_volley", {
      position: { x: 1150, y: 250 },
      class: "ranger",
      level: 5,
    });
    const observer = await Client.join("volley_eye", {
      position: { x: 1190, y: 250 },
    });
    try {
      await until("area attack welcome", () => ranger.welcome && observer.welcome);
      ranger.skill(3);
      const cast = await until("untargeted volley cast", () =>
        ranger.received.find(
          (message) =>
            message.t === "event" &&
            message.code === "skill.cast" &&
            message.params?.skill === "volley",
        ),
      );
      expect(cast).toMatchObject({ tone: "good" });
      await until("area attack animation for the observer", () =>
        observer.received.find(
          (message) =>
            message.t === "animation" &&
            message.actorKind === "player" &&
            message.actorId === ranger.welcome?.selfId &&
            message.action === "skill" &&
            message.skillId === "volley",
        ),
      );
    } finally {
      ranger.close();
      observer.close();
    }
  });

  it("casts an area heal without a target", { timeout: 10_000 }, async () => {
    const priest = await Client.join("area_prayer", {
      position: { x: 1150, y: 250 },
      class: "priest",
      level: 7,
      hp: 40,
    });
    await until("area heal welcome", () => priest.welcome);

    priest.skill(4);
    const cast = await until("untargeted prayer cast", () =>
      priest.received.find(
        (message) =>
          message.t === "event" &&
          message.code === "skill.cast" &&
          message.params?.skill === "prayer",
      ),
    );
    expect(cast).toMatchObject({ tone: "good" });
    const manaAfterCast = await until("prayer mana cost", () =>
      priest.received.find(
        (message) =>
          message.t === "state" &&
          message.self.resource?.kind === "mana" &&
          message.self.resource.current < 100,
      ),
    );
    expect(manaAfterCast).toMatchObject({ self: { resource: { current: 68, max: 100 } } });
    const healed = await until("area heal state", () => {
      const snapshot = priest.self();
      return snapshot && snapshot.hp > 40 ? snapshot : undefined;
    });
    expect(healed.hp).toBeGreaterThan(40);
    priest.close();
  });

  it("blocks a directional healing projectile on terrain", { timeout: 10_000 }, async () => {
    const priest = await Client.join("blocked_heal", {
      position: { x: 480, y: 650 },
      class: "priest",
      level: 3,
    });
    const blocked = await Client.join("behind_tree", { position: { x: 590, y: 650 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && blocked.welcome);
    await formRuntimeParty(priest, blocked);

    const before = await until("blocked target initial snapshot", () => {
      const snapshot = blocked.latestSnapshot;
      const self = blocked.self();
      return snapshot && self ? { tick: snapshot.tick, hp: self.hp } : undefined;
    });
    expect(before.hp).toBe(40);

    priest.skill(2);
    const event = await until("blocked healing projectile event", () =>
      priest.received.find((m) => m.t === "event" && m.code === "skill.blocked"),
    );
    expect(event).toMatchObject({ params: { skill: "mend" }, tone: "info" });

    const after = await until("blocked target later snapshot", () => {
      const snapshot = blocked.latestSnapshot;
      const self = blocked.self();
      return snapshot && snapshot.tick > before.tick && self ? self : undefined;
    });
    expect(after.hp).toBe(40);

    priest.close();
    blocked.close();
  });

  it("heals the first wounded ally struck by Mend's directional projectile", {
    timeout: 10_000,
  }, async () => {
    const priest = await Client.join("los_priest", {
      position: { x: 480, y: 650 },
      class: "priest",
      level: 3,
    });
    const visible = await Client.join("los_visible", { position: { x: 480, y: 760 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && visible.welcome);
    await formRuntimeParty(priest, visible);

    priest.press("down");
    await until("priest facing down", () => {
      const self = priest.self();
      return self && self.facing.y > 0.9 ? self : undefined;
    });
    priest.release();
    priest.skill(2);
    const healed = await until("visible ally healed", () => {
      const snapshot = visible.self();
      return snapshot && snapshot.hp > 40 ? snapshot : undefined;
    });

    expect(healed.hp).toBe(81);
    const received = visible.received.find((m) => m.t === "event" && m.code === "heal.received");
    expect(received).toMatchObject({
      params: { name: "los_priest", amount: 41, color: "azure" },
    });

    priest.close();
    visible.close();
  });

  it("keeps a wounded ally beyond Mend projectile range untouched", {
    timeout: 10_000,
  }, async () => {
    const priest = await Client.join("far_healer", {
      position: { x: 784, y: 450 },
      class: "priest",
      level: 3,
    });
    // 260px away: past the 195px projectile travel plus both collision radii, inside snapshot view.
    const wounded = await Client.join("far_wounded", { position: { x: 1044, y: 450 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && wounded.welcome);
    await formRuntimeParty(priest, wounded);

    const before = await until("far wounded initial snapshot", () => {
      const snapshot = wounded.latestSnapshot;
      const self = wounded.self();
      return snapshot && self ? { tick: snapshot.tick, hp: self.hp } : undefined;
    });
    expect(before.hp).toBe(40);

    priest.skill(2);
    await until("Mend cast", () =>
      priest.received.find(
        (m) => m.t === "event" && m.code === "skill.cast" && m.params?.skill === "mend",
      ),
    );
    await scheduler.wait(900);

    const after = await until("far wounded later snapshot", () => {
      const snapshot = wounded.latestSnapshot;
      const self = wounded.self();
      return snapshot && snapshot.tick > before.tick && self ? self : undefined;
    });
    expect(after.hp).toBe(40);

    priest.close();
    wounded.close();
  });

  it("blocks a dead priest from casting Mend", { timeout: 15_000 }, async () => {
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
    priest.skill(2);
    priest.skill(2);
    await scheduler.wait(300);

    expect(ally.self()?.hp).toBe(40);
    expect(priest.received.some((m) => m.t === "event" && String(m.code).startsWith("heal"))).toBe(
      false,
    );

    priest.close();
    ally.close();
  });

  it("rejects legacy heal messages while allowing a full-health priest to cast Mend", {
    timeout: 10_000,
  }, async () => {
    const warrior = await Client.join("brute", { position: { x: 784, y: 450 } });
    await until("welcome", () => warrior.welcome);
    warrior.sendRaw(JSON.stringify({ t: "heal", targetId: warrior.welcome?.selfId }));
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
    priest.skill(2);
    const cast = await until("Mend cast", () =>
      priest.received.find(
        (m) => m.t === "event" && m.code === "skill.cast" && m.params?.skill === "mend",
      ),
    );
    expect(cast).toMatchObject({ params: { skill: "mend", slot: 2 }, tone: "good" });
    await scheduler.wait(900);
    expect(priest.received.some((m) => m.t === "event" && String(m.code).startsWith("heal."))).toBe(
      false,
    );

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
    // x: 223.5 (not 123.5) — the tile grid coarsens the left boundary wall out to the nearest
    // solid cell, past where this fractional legacy coordinate used to sit; see the identical
    // fix in game.test.ts's "preserves legacy positions that remain walkable".
    const attachment: Attachment = { id: "a", nick: "n", x: 223.5, y: 456.25 };
    expect(positionFromAttachment(attachment)).toEqual({ x: 223.5, y: 456.25 });
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

  it("broadcasts a monster attack animation to nearby observers", { timeout: 10_000 }, async () => {
    const observer = await Client.join("attack_eye", { position: { x: 1500, y: 1000 } });
    const fighter = await Client.join("attack_fighter", { position: KILL_ZONE });
    try {
      await until("observer and fighter welcomes", () => observer.welcome && fighter.welcome);
      fighter.action("attack");
      await until("monster attack animation", () =>
        observer.received.find(
          (message) =>
            message.t === "animation" &&
            message.actorKind === "monster" &&
            message.action === "attack",
        ),
      );
    } finally {
      observer.close();
      fighter.close();
    }
  });

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
    player.sendRaw(JSON.stringify({ t: "heal", targetId: player.welcome?.selfId }));
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
            m.code === "combat.hit" ||
            m.code === "item.used" ||
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
    await scheduler.wait(300);
    expect(fallen.self()?.hp).toBe(Math.round(maxHpForLevel(raised.level) * RESURRECT_HP_RATIO));

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
