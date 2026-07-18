import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createAdventure } from "../src/server/adventures.js";
import { createDb } from "../src/server/db/index.js";
import { createHero } from "../src/server/heroes.js";
import { createMap, type MapInput } from "../src/server/maps.js";
import { createParty, joinParty } from "../src/server/parties.js";
import type { AdventureInput } from "../src/shared/adventure.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import { Client, ORIGIN, until } from "./support/world-harness.js";

interface AccountSession {
  accountId: string;
  cookie: string;
}

interface SeededAdventure {
  adventureId: string;
  partyId: string;
  mapA: string;
  mapB: string;
}

let accountSequence = 0;
const openClients: Client[] = [];

function centre(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

function blocks(): string[] {
  return Array.from({ length: 15 }, () => ".".repeat(20));
}

function mapAInput(): MapInput {
  return {
    name: "Placed monsters",
    blocks: blocks(),
    elements: [],
    spawn: { col: 2, row: 2 },
    markers: {
      entries: [{ id: "door", col: 2, row: 2 }],
      exits: [{ id: "passage", col: 4, row: 2 }],
      monsterSpawns: [{ col: 10, row: 8, species: "torch_goblin", patrolRadius: 192 }],
    },
  };
}

function mapBInput(): MapInput {
  return {
    name: "The ending",
    blocks: blocks(),
    elements: [],
    spawn: { col: 3, row: 3 },
    markers: {
      entries: [{ id: "arrival", col: 3, row: 3 }],
      exits: [{ id: "finish", col: 5, row: 3 }],
      monsterSpawns: [],
    },
  };
}

async function register(label: string): Promise<AccountSession> {
  const username = `hero${++accountSequence}${label}`.toLowerCase().slice(0, 16);
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(response.status).toBe(200);
  const body = (await response.clone().json()) as { id: string };
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!cookie) throw new Error("registration did not issue a session cookie");
  return { accountId: body.id, cookie };
}

async function seedAdventure(host: AccountSession): Promise<SeededAdventure> {
  const db = createDb(env.DB);
  const mapA = await createMap(db, host.accountId, mapAInput());
  const mapB = await createMap(db, host.accountId, mapBInput());
  const input: AdventureInput = {
    title: "Authoritative route",
    maxPlayers: 4,
    mapIds: [mapA.id, mapB.id],
    graph: {
      start: { mapId: mapA.id, entryId: "door" },
      links: [
        {
          mapId: mapA.id,
          exitId: "passage",
          dest: { mapId: mapB.id, entryId: "arrival" },
        },
        { mapId: mapB.id, exitId: "finish", dest: "end" },
      ],
    },
  };
  const adventure = await createAdventure(db, host.accountId, input);
  const party = await createParty(db, host.accountId, {
    adventureId: adventure.id,
    name: null,
    color: "blue",
  });
  return { adventureId: adventure.id, partyId: party.id, mapA: mapA.id, mapB: mapB.id };
}

async function connectHero(
  session: AccountSession,
  partyId: string,
  heroId: string,
): Promise<Client> {
  const response = await SELF.fetch(`${ORIGIN}/api/ws?party=${partyId}&hero=${heroId}`, {
    headers: { Upgrade: "websocket", Cookie: session.cookie },
  });
  expect(response.status).toBe(101);
  if (!response.webSocket) throw new Error("hero admission did not return a websocket");
  const client = new Client(response.webSocket);
  client.startPump();
  openClients.push(client);
  return client;
}

async function rejectHero(
  session: AccountSession,
  partyId: string,
  heroId: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/ws?party=${partyId}&hero=${heroId}`, {
    headers: { Upgrade: "websocket", Cookie: session.cookie },
  });
}

afterEach(async () => {
  for (const client of openClients.splice(0)) client.close();
  await scheduler.wait(250);
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("party hero admission and authored runtime", () => {
  it("hydrates placed monsters and crosses an exit to the server-selected entry", async () => {
    const host = await register("route");
    const seeded = await seedAdventure(host);
    const hero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "Mira",
      class: "priest",
    });
    await env.DB.prepare("UPDATE hero SET x = ?, y = ? WHERE id = ?")
      .bind(centre(4, 2).x, centre(4, 2).y, hero.id)
      .run();

    const first = await connectHero(host, seeded.partyId, hero.id);
    const welcome = await until("authored-map welcome", () => first.welcome);
    expect(welcome.world.zoneId).toBe(seeded.mapA);
    expect(welcome.monsters).toHaveLength(1);
    expect(welcome.monsters[0]?.species).toBe("torch_goblin");
    const sourceDiagnostics = await env.WORLD.getByName(
      `${seeded.partyId}:${seeded.mapA}`,
    ).roomDiagnostics();
    expect(sourceDiagnostics.monsters).toEqual([
      expect.objectContaining({ species: "torch_goblin", patrolRadius: 192 }),
    ]);

    const close = await until("authoritative map transition", () => first.closeInfo ?? undefined);
    expect(close.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    const second = await connectHero(host, seeded.partyId, hero.id);
    const destination = await until("destination welcome", () => second.welcome);
    expect(destination.world.zoneId).toBe(seeded.mapB);
    expect(destination.monsters).toEqual([]);
    expect(second.self()).toMatchObject(centre(3, 3));
    const persisted = await env.DB.prepare("SELECT map_id, x, y FROM hero WHERE id = ?")
      .bind(hero.id)
      .first<{ map_id: string; x: number; y: number }>();
    expect(persisted?.map_id).toBe(seeded.mapB);
    expect(persisted?.x).toBeCloseTo(centre(3, 3).x, 1);
    expect(persisted?.y).toBeCloseTo(centre(3, 3).y, 1);
  });

  it("accepts authoritative attacks against a placed monster's protocol-safe id", async () => {
    const host = await register("combat");
    const seeded = await seedAdventure(host);
    const hero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "Hunter",
      class: "ranger",
    });
    await env.DB.prepare("UPDATE hero SET x = ?, y = ? WHERE id = ?")
      .bind(centre(9, 8).x, centre(9, 8).y, hero.id)
      .run();

    const client = await connectHero(host, seeded.partyId, hero.id);
    const welcome = await until("combat welcome", () => client.welcome);
    const placed = welcome.monsters[0];
    expect(placed?.id).toMatch(/^[A-Za-z0-9_-]+$/);
    if (!placed) throw new Error("expected an authored monster");

    client.action("attack", placed.id);
    const damaged = await until("placed monster damage", () => {
      const monster = client.latestSnapshot?.monsters.find(
        (candidate) => candidate.id === placed.id,
      );
      return monster && monster.hp < placed.hp ? monster : undefined;
    });
    expect(damaged.hp).toBe(placed.hp - 16);
  });

  it("isolates two parties playing the same adventure and fences duplicate hero connections", async () => {
    const host = await register("isolation");
    const seeded = await seedAdventure(host);
    const secondParty = await createParty(createDb(env.DB), host.accountId, {
      adventureId: seeded.adventureId,
      name: "Second save",
      color: "blue",
    });
    const firstHero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "First",
      class: "warrior",
    });
    const secondHero = await createHero(createDb(env.DB), host.accountId, secondParty.id, {
      name: "Second",
      class: "ranger",
    });

    const first = await connectHero(host, seeded.partyId, firstHero.id);
    const second = await connectHero(host, secondParty.id, secondHero.id);
    await until("both isolated welcomes", () => first.welcome && second.welcome);
    expect(first.welcome?.players.map((player) => player.id)).toEqual([firstHero.id]);
    expect(second.welcome?.players.map((player) => player.id)).toEqual([secondHero.id]);
    const firstRoom = await env.WORLD.getByName(
      `${seeded.partyId}:${seeded.mapA}`,
    ).roomDiagnostics();
    const secondRoom = await env.WORLD.getByName(
      `${secondParty.id}:${seeded.mapA}`,
    ).roomDiagnostics();
    expect(firstRoom.playerIds).toEqual([firstHero.id]);
    expect(secondRoom.playerIds).toEqual([secondHero.id]);

    const replacement = await connectHero(host, seeded.partyId, firstHero.id);
    await until("replacement welcome", () => replacement.welcome);
    const replaced = await until("old hero fenced", () => first.closeInfo ?? undefined);
    expect(replaced.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
  });

  it("rejects foreign heroes and maps member colour to the Tiny Swords appearance", async () => {
    const host = await register("host");
    const member = await register("member");
    const outsider = await register("outsider");
    const seeded = await seedAdventure(host);
    await joinParty(createDb(env.DB), member.accountId, seeded.partyId, "red");
    const hostHero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "Host",
      class: "warrior",
    });
    const memberHero = await createHero(createDb(env.DB), member.accountId, seeded.partyId, {
      name: "Red",
      class: "ranger",
    });

    expect((await rejectHero(outsider, seeded.partyId, hostHero.id)).status).toBe(403);
    expect((await rejectHero(host, seeded.partyId, memberHero.id)).status).toBe(403);
    const red = await connectHero(member, seeded.partyId, memberHero.id);
    const welcome = await until("red hero welcome", () => red.welcome);
    expect(
      welcome.players.find((player) => player.id === memberHero.id)?.appearance.primaryColor,
    ).toBe("ember");
  });

  it("repairs an out-of-adventure map and resumes persisted hero position and core stats", async () => {
    const host = await register("resume");
    const seeded = await seedAdventure(host);
    const hero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "Persistent",
      class: "warrior",
    });
    await env.DB.prepare(
      "UPDATE hero SET map_id = ?, x = ?, y = ?, level = 3, xp = 17, hp = 73 WHERE id = ?",
    )
      .bind(crypto.randomUUID(), 999, 999, hero.id)
      .run();

    const repaired = await connectHero(host, seeded.partyId, hero.id);
    const repairedWelcome = await until("repaired hero welcome", () => repaired.welcome);
    expect(repairedWelcome.world.zoneId).toBe(seeded.mapA);
    expect(repaired.self()).toMatchObject({ ...centre(2, 2), level: 3, hp: 73 });
    expect(repaired.latestState?.xp).toBe(17);
    repaired.press("right");
    await until("hero moved before resume", () => {
      const self = repaired.self();
      return self && self.x > centre(2, 2).x + 10 ? self : undefined;
    });
    repaired.release();
    await scheduler.wait(400);
    const resting = await until("hero resting position", () => repaired.self());
    repaired.close();
    await until("hero disconnected", () => repaired.closeInfo ?? undefined);

    const resumed = await connectHero(host, seeded.partyId, hero.id);
    await until("resumed hero welcome", () => resumed.welcome);
    expect(resumed.self()?.x).toBeCloseTo(resting.x, 0);
    expect(resumed.self()).toMatchObject({ level: 3, hp: 73 });
    expect(resumed.latestState?.xp).toBe(17);
  }, 10_000);

  it("broadcasts party chat across map rooms and completes END exactly once", async () => {
    const host = await register("victory");
    const member = await register("ally");
    const seeded = await seedAdventure(host);
    await joinParty(createDb(env.DB), member.accountId, seeded.partyId, "purple");
    const hostHero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "Scout",
      class: "warrior",
    });
    const finisher = await createHero(createDb(env.DB), member.accountId, seeded.partyId, {
      name: "Finisher",
      class: "priest",
    });
    await env.DB.prepare("UPDATE hero SET map_id = ?, x = ?, y = ? WHERE id = ?")
      .bind(seeded.mapB, centre(5, 3).x, centre(5, 3).y, finisher.id)
      .run();

    const scout = await connectHero(host, seeded.partyId, hostHero.id);
    const ender = await connectHero(member, seeded.partyId, finisher.id);
    await until("two map rooms welcomed", () => scout.welcome && ender.welcome);
    scout.partyChat("Across rooms");
    const remoteChat = await until("cross-room party chat", () =>
      ender.received.find(
        (message) =>
          message.t === "chat" && message.channel === "party" && message.text === "Across rooms",
      ),
    );
    expect(remoteChat).toMatchObject({ from: "Scout" });
    scout.chat("Only here");
    await scheduler.wait(250);
    expect(
      ender.received.some(
        (message) =>
          message.t === "chat" && message.channel === "local" && message.text === "Only here",
      ),
    ).toBe(false);

    await until("victory in source room", () =>
      scout.received.find(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    );
    await until("victory in ending room", () =>
      ender.received.find(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    );
    expect(ender.closeInfo).toBeNull();
    await scheduler.wait(900);
    expect(
      ender.received.filter(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    ).toHaveLength(1);
    const completed = await env.DB.prepare("SELECT status FROM party WHERE id = ?")
      .bind(seeded.partyId)
      .first<{ status: string }>();
    expect(completed?.status).toBe("completed");
  }, 10_000);

  it("stops and resets an authored room after its last hero leaves", async () => {
    const host = await register("unload");
    const seeded = await seedAdventure(host);
    const hero = await createHero(createDb(env.DB), host.accountId, seeded.partyId, {
      name: "Visitor",
      class: "warrior",
    });
    const client = await connectHero(host, seeded.partyId, hero.id);
    await until("room started", () => client.welcome);
    const stub = env.WORLD.getByName(`${seeded.partyId}:${seeded.mapA}`);
    expect((await stub.roomDiagnostics()).tickActive).toBe(true);
    client.close();
    await until("room client closed", () => client.closeInfo ?? undefined);
    await until("room tick stopped", async () => {
      const diagnostics = await stub.roomDiagnostics();
      return diagnostics.tickActive ? undefined : diagnostics;
    });
    const unloaded = await stub.roomDiagnostics();
    expect(unloaded.playerIds).toEqual([]);
    expect(unloaded.monsters).toEqual([
      expect.objectContaining({ species: "torch_goblin", patrolRadius: 192 }),
    ]);
  });
});
