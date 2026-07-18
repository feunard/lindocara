import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { MapInput } from "../src/server/maps.js";
import type { AdventureGraph } from "../src/shared/adventure.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import {
  Client,
  tileCentre as centre,
  drainHeroRooms,
  heroRoomKey,
  ORIGIN,
  type TestAccount,
  type TestParty,
  testAccount,
  testHero,
  testMapInput,
  testParty,
  until,
} from "./support/world-harness.js";

function mapAInput(): MapInput {
  return testMapInput("Placed monsters", {
    cols: 20,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 4, row: 2 },
    monsterSpawns: [{ col: 10, row: 8, species: "torch_goblin", patrolRadius: 192 }],
  });
}

function mapBInput(): MapInput {
  return testMapInput("The ending", {
    cols: 20,
    rows: 15,
    spawn: { col: 3, row: 3 },
    exit: { col: 5, row: 3 },
  });
}

/** Two maps in a line: mapA's exit leads to mapB's entry, mapB's exit ends the adventure. */
function twoMapAdventure(): {
  maps: MapInput[];
  graph: (ids: readonly string[]) => AdventureGraph;
} {
  return {
    maps: [mapAInput(), mapBInput()],
    graph: (ids) => {
      const [mapA, mapB] = ids;
      if (!mapA || !mapB) throw new Error("expected two seeded maps");
      return {
        start: { mapId: mapA, entryId: "door" },
        links: [
          { mapId: mapA, exitId: "finish", dest: { mapId: mapB, entryId: "door" } },
          { mapId: mapB, exitId: "finish", dest: "end" },
        ],
      };
    },
  };
}

async function seedParty(label: string): Promise<TestParty & { mapA: string; mapB: string }> {
  const party = await testParty(label, twoMapAdventure());
  const [mapA, mapB] = party.mapIds;
  if (!mapA || !mapB) throw new Error("expected two seeded maps");
  return Object.assign(party, { mapA, mapB });
}

async function rejectHero(
  session: TestAccount,
  partyId: string,
  heroId: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/ws?party=${partyId}&hero=${heroId}`, {
    headers: { Upgrade: "websocket", Cookie: session.cookie },
  });
}

afterEach(async () => {
  await drainHeroRooms();
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
    const party = await seedParty("route");
    const hero = await testHero("Mira", {
      party,
      class: "priest",
      position: centre(4, 2),
    });

    const first = await Client.joinHero(hero);
    const welcome = await until("authored-map welcome", () => first.welcome);
    expect(welcome.world.zoneId).toBe(party.mapA);
    expect(welcome.monsters).toHaveLength(1);
    expect(welcome.monsters[0]?.species).toBe("torch_goblin");
    const sourceDiagnostics = await env.WORLD.getByName(
      heroRoomKey(party.partyId, party.mapA),
    ).roomDiagnostics();
    expect(sourceDiagnostics.monsters).toEqual([
      expect.objectContaining({ species: "torch_goblin", patrolRadius: 192 }),
    ]);

    const close = await until("authoritative map transition", () => first.closeInfo ?? undefined);
    expect(close.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    const second = await Client.joinHero(hero);
    const destination = await until("destination welcome", () => second.welcome);
    expect(destination.world.zoneId).toBe(party.mapB);
    expect(destination.monsters).toEqual([]);
    expect(second.self()).toMatchObject(centre(3, 3));
    const persisted = await env.DB.prepare("SELECT map_id, x, y FROM hero WHERE id = ?")
      .bind(hero.heroId)
      .first<{ map_id: string; x: number; y: number }>();
    expect(persisted?.map_id).toBe(party.mapB);
    expect(persisted?.x).toBeCloseTo(centre(3, 3).x, 1);
    expect(persisted?.y).toBeCloseTo(centre(3, 3).y, 1);
  });

  it("accepts authoritative attacks against a placed monster's protocol-safe id", async () => {
    const party = await seedParty("combat");
    const hero = await testHero("Hunter", {
      party,
      class: "ranger",
      position: centre(9, 8),
    });

    const client = await Client.joinHero(hero);
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
    const party = await seedParty("isolation");
    const secondParty = await testParty("isolation2", { host: party.host, adventure: party });
    const firstHero = await testHero("First", { party, class: "warrior" });
    const secondHero = await testHero("Second", { party: secondParty, class: "ranger" });

    const first = await Client.joinHero(firstHero);
    const second = await Client.joinHero(secondHero);
    await until("both isolated welcomes", () => first.welcome && second.welcome);
    expect(first.welcome?.players.map((player) => player.id)).toEqual([firstHero.heroId]);
    expect(second.welcome?.players.map((player) => player.id)).toEqual([secondHero.heroId]);
    const firstRoom = await env.WORLD.getByName(firstHero.roomKey).roomDiagnostics();
    const secondRoom = await env.WORLD.getByName(secondHero.roomKey).roomDiagnostics();
    expect(firstRoom.playerIds).toEqual([firstHero.heroId]);
    expect(secondRoom.playerIds).toEqual([secondHero.heroId]);

    const replacement = await Client.joinHero(firstHero);
    await until("replacement welcome", () => replacement.welcome);
    const replaced = await until("old hero fenced", () => first.closeInfo ?? undefined);
    expect(replaced.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
  });

  it("rejects foreign heroes and maps member colour to the Tiny Swords appearance", async () => {
    const party = await seedParty("host");
    const outsider = await testAccount("outsider");
    const hostHero = await testHero("Host", { party, account: party.host, class: "warrior" });
    const memberHero = await testHero("Red", { party, class: "ranger", color: "red" });

    expect((await rejectHero(outsider, party.partyId, hostHero.heroId)).status).toBe(403);
    expect((await rejectHero(hostHero, party.partyId, memberHero.heroId)).status).toBe(403);
    const red = await Client.joinHero(memberHero);
    const welcome = await until("red hero welcome", () => red.welcome);
    expect(
      welcome.players.find((player) => player.id === memberHero.heroId)?.appearance.primaryColor,
    ).toBe("ember");
  });

  it("repairs an out-of-adventure map and resumes persisted hero position and core stats", async () => {
    const party = await seedParty("resume");
    const hero = await testHero("Persistent", {
      party,
      class: "warrior",
      position: { x: 999, y: 999 },
      level: 3,
      xp: 17,
      hp: 73,
    });
    await env.DB.prepare("UPDATE hero SET map_id = ? WHERE id = ?")
      .bind(crypto.randomUUID(), hero.heroId)
      .run();

    const repaired = await Client.joinHero(hero);
    const repairedWelcome = await until("repaired hero welcome", () => repaired.welcome);
    expect(repairedWelcome.world.zoneId).toBe(party.mapA);
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

    const resumed = await Client.joinHero(hero);
    await until("resumed hero welcome", () => resumed.welcome);
    expect(resumed.self()?.x).toBeCloseTo(resting.x, 0);
    expect(resumed.self()).toMatchObject({ level: 3, hp: 73 });
    expect(resumed.latestState?.xp).toBe(17);
  }, 10_000);

  it("broadcasts party chat across map rooms and completes END exactly once", async () => {
    const party = await seedParty("victory");
    const hostHero = await testHero("Scout", { party, account: party.host, class: "warrior" });
    const finisher = await testHero("Finisher", {
      party,
      class: "priest",
      color: "purple",
      mapId: party.mapB,
      position: centre(5, 3),
    });

    const scout = await Client.joinHero(hostHero);
    const ender = await Client.joinHero(finisher);
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
      .bind(party.partyId)
      .first<{ status: string }>();
    expect(completed?.status).toBe("completed");
  }, 10_000);

  it("stops and resets an authored room after its last hero leaves", async () => {
    const party = await seedParty("unload");
    const hero = await testHero("Visitor", { party, class: "warrior" });
    const client = await Client.joinHero(hero);
    await until("room started", () => client.welcome);
    const stub = env.WORLD.getByName(hero.roomKey);
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
