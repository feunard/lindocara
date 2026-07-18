import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { AdventureGraph } from "../src/shared/adventure.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { ATTACK_COOLDOWN_MS, MONSTER_STATS, maxHpForLevel } from "../src/shared/game.js";
import {
  Client,
  tileCentre as centre,
  drainHeroRooms,
  heroRoomKey,
  ORIGIN,
  type TestAccount,
  type TestMapBody,
  type TestParty,
  testAccount,
  testHero,
  testMapInput,
  testParty,
  until,
} from "./support/world-harness.js";

function mapAInput(): TestMapBody {
  return testMapInput("Placed monsters", {
    cols: 20,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 4, row: 2 },
    monsterSpawns: [{ col: 10, row: 8, species: "torch_goblin", patrolRadius: 192 }],
  });
}

function mapBInput(): TestMapBody {
  return testMapInput("The ending", {
    cols: 20,
    rows: 15,
    spawn: { col: 3, row: 3 },
    exit: { col: 5, row: 3 },
  });
}

/** Two maps in a line: mapA's exit leads to mapB's entry, mapB's exit ends the adventure. */
function twoMapAdventure(): {
  maps: TestMapBody[];
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

  /**
   * Combat on an authored map has to run in both directions. It did not: `terrainFromMap` used to
   * declare the whole map a safe zone, and `monster-system` reads that rect as "monsters may not
   * touch a player here" — so on every D1 map, i.e. the entire live gameplay path, no player ever
   * entered a monster's threat table and `damagePlayer` was unreachable. Every existing test built
   * its own `TerrainGeometry` by hand, so nothing exercised the geometry heroes actually play on.
   */
  it("lets a placed monster acquire threat, close in and wound a hero on an authored map", async () => {
    const party = await seedParty("aggro");
    const hero = await testHero("Bait", {
      party,
      class: "warrior",
      position: centre(9, 8),
    });

    const client = await Client.joinHero(hero);
    const welcome = await until("aggro welcome", () => client.welcome);
    const placed = welcome.monsters[0];
    if (!placed) throw new Error("expected an authored monster");
    expect(welcome.players.find((player) => player.id === hero.heroId)?.hp).toBe(maxHpForLevel(1));

    // Threat first: the monster must actually chase, not merely happen to stand on the hero.
    const closed = await until("monster closes on the hero", () => {
      const monster = client.latestSnapshot?.monsters.find((m) => m.id === placed.id);
      const self = client.self();
      if (!monster || !self) return undefined;
      return Math.hypot(monster.x - self.x, monster.y - self.y) < 64 ? monster : undefined;
    });
    expect(closed.x).not.toBe(placed.x);

    const wounded = await until("hero wounded by the placed monster", () => {
      const self = client.self();
      return self && self.hp < maxHpForLevel(1) ? self : undefined;
    });
    expect(wounded.hp).toBeLessThanOrEqual(maxHpForLevel(1) - MONSTER_STATS.goblin.damage);
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

/**
 * A hero room is named `${partyId}:${mapId}` and admission refuses any other room key, so the
 * persistent party — not the in-room `party.*` runtime, which no hero can ever build — is what
 * "who is in my party" has to mean when a monster pays out.
 */
function rewardMapInput(): TestMapBody {
  return testMapInput("Shared kill", {
    cols: 40,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 38, row: 13 },
    // The smallest legal patrol, so the goblin stays inside a level-10 warrior's reach.
    monsterSpawns: [{ col: 10, row: 8, species: "torch_goblin", patrolRadius: 32 }],
  });
}

describe("cooperative rewards inside a party room", () => {
  it("splits experience with an idle hero party member but never loot or kill credit", async () => {
    const party = await testParty("coopxp", { maps: [rewardMapInput()] });
    // On top of the goblin: a level-10 warrior hits for 66, so one swing settles a 48 HP goblin.
    const killerHero = await testHero("Striker", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
      position: centre(10, 8),
    });
    // 576 px away: inside REWARD_DISTANCE (900) and outside MONSTER_AGGRO_RANGE (210), so this
    // hero cannot even accumulate the proximity threat that would make it a contributor.
    const idleHero = await testHero("Idler", {
      party,
      class: "warrior",
      level: 10,
      position: centre(19, 8),
    });
    // 1472 px away: a party member, but too far to be paid.
    const farHero = await testHero("Distant", {
      party,
      class: "warrior",
      level: 10,
      position: centre(33, 8),
    });

    const killer = await Client.joinHero(killerHero);
    const idle = await Client.joinHero(idleHero);
    const far = await Client.joinHero(farHero);
    await until("three heroes welcomed", () => killer.welcome && idle.welcome && far.welcome);
    const monster = killer.welcome?.monsters[0];
    if (!monster) throw new Error("expected the authored goblin");

    let lastAttackAt = 0;
    const killed = await until("the killer defeats the goblin", () => {
      if (Date.now() - lastAttackAt >= ATTACK_COOLDOWN_MS) {
        lastAttackAt = Date.now();
        killer.action("attack", monster.id);
      }
      return killer.received.find(
        (message) => message.t === "event" && message.code === "monster.defeated",
      );
    });

    // A goblin is worth 28 XP. Two eligible heroes means 14 each — the killer keeping all 28 is
    // exactly the symptom of the party never being consulted.
    expect(killed).toMatchObject({ params: { xp: 14 } });
    const shared = await until("the idle member shares the kill", () =>
      idle.received.find((message) => message.t === "event" && message.code === "monster.defeated"),
    );
    expect(shared).toMatchObject({ params: { xp: 14 } });
    await until("the idle member banks its share", () => idle.latestState?.xp === 14);

    // Loot and quest credit are minted per recipient, so they stay with the contributor. Loot is
    // only ever sent to its owner, so an empty list is proof of absence rather than of distance.
    await scheduler.wait(1_000);
    expect(idle.latestSnapshot?.loot ?? []).toEqual([]);
    expect(
      idle.received.some((message) => message.t === "event" && message.code === "loot.picked"),
    ).toBe(false);
    expect(
      idle.received.some((message) => message.t === "event" && message.code.startsWith("quest.")),
    ).toBe(false);
    // The killer did earn a drop. It lands at the goblin's feet, where the killer is standing, so
    // it is often collected the same tick it appears — accept either sighting.
    expect(
      (killer.latestSnapshot?.loot.length ?? 0) > 0 ||
        killer.received.some((message) => message.t === "event" && message.code === "loot.picked"),
    ).toBe(true);

    // Distance still gates the party: standing in the next postcode earns nothing at all.
    expect(
      far.received.some((message) => message.t === "event" && message.code === "monster.defeated"),
    ).toBe(false);
    expect(far.latestState?.xp).toBe(0);
  }, 20_000);
});

/**
 * The party roster a hero sees is the persistent party its room is named after. `party.*` is
 * refused for heroes, so the in-room party runtime is permanently empty here: a roster built from
 * it would leave every hero believing it adventures alone.
 */
function rosterMapInput(): TestMapBody {
  return testMapInput("Roster", {
    cols: 20,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 18, row: 13 },
  });
}

describe("party state inside a hero room", () => {
  it("lists every hero of the persistent party sharing the room", async () => {
    const party = await testParty("roster", { maps: [rosterMapInput()] });
    const firstHero = await testHero("Ana", {
      party,
      account: party.host,
      level: 10,
      position: centre(2, 2),
    });
    const secondHero = await testHero("Bo", { party, level: 10, position: centre(4, 2) });

    const first = await Client.joinHero(firstHero);
    const second = await Client.joinHero(secondHero);
    await until("both heroes welcomed", () => first.welcome && second.welcome);
    const firstId = first.welcome?.selfId;
    const secondId = second.welcome?.selfId;
    if (!firstId || !secondId) throw new Error("expected both heroes to know their own id");

    const expected = [firstId, secondId].sort();
    for (const [label, client] of [
      ["the first hero", first],
      ["the second hero", second],
    ] as const) {
      const roster = await until(`${label} sees the whole party`, () =>
        client.received.find(
          (message) => message.t === "party.state" && message.party?.members.length === 2,
        ),
      );
      if (roster.t !== "party.state" || !roster.party) throw new Error("expected a party state");
      expect(roster.party.id).toBe(party.partyId);
      expect(roster.party.members.map((member) => member.id).sort()).toEqual(expected);
      expect(roster.party.members.map((member) => member.nick).sort()).toEqual(["Ana", "Bo"]);
      for (const member of roster.party.members) {
        expect(member.maxHp).toBe(maxHpForLevel(10));
        expect(member.hp).toBe(maxHpForLevel(10));
        expect(member.life).toBe("alive");
      }
    }
  }, 20_000);

  it("keeps a member's health bar live rather than freezing it at admission", async () => {
    const party = await testParty("wounded", { maps: [rosterMapInput()] });
    const watcherHero = await testHero("Watcher", {
      party,
      account: party.host,
      level: 10,
      position: centre(2, 2),
    });
    // Wounded before it ever connects, so the roster has somewhere to move to.
    const woundedHero = await testHero("Wounded", {
      party,
      level: 10,
      hp: 50,
      position: centre(4, 2),
    });

    const watcher = await Client.joinHero(watcherHero);
    const wounded = await Client.joinHero(woundedHero);
    await until("both heroes welcomed", () => watcher.welcome && wounded.welcome);
    const woundedId = wounded.welcome?.selfId;
    if (!woundedId) throw new Error("expected the wounded hero to know its own id");

    const before = await until("the watcher sees its ally wounded", () =>
      watcher.received.find(
        (message) =>
          message.t === "party.state" &&
          message.party?.members.some((member) => member.id === woundedId && member.hp === 50),
      ),
    );
    if (before.t !== "party.state") throw new Error("expected a party state");

    // A potion is an authoritative heal: the server decides how much and tells the room.
    wounded.usePotion();
    const after = await until("the watcher sees the potion land", () =>
      watcher.received.find(
        (message) =>
          message.t === "party.state" &&
          message.party?.members.some((member) => member.id === woundedId && member.hp > 50),
      ),
    );
    if (after.t !== "party.state" || !after.party) throw new Error("expected a party state");
    const healed = after.party.members.find((member) => member.id === woundedId);
    expect(healed?.hp).toBeGreaterThan(50);
    expect(healed?.hp).toBeLessThanOrEqual(maxHpForLevel(10));
  }, 20_000);

  it("re-sends the roster only when it changes", async () => {
    const party = await testParty("quiet", { maps: [rosterMapInput()] });
    const firstHero = await testHero("Still", {
      party,
      account: party.host,
      level: 10,
      position: centre(2, 2),
    });
    const secondHero = await testHero("Statue", { party, level: 10, position: centre(4, 2) });

    const first = await Client.joinHero(firstHero);
    const second = await Client.joinHero(secondHero);
    await until("both heroes welcomed", () => first.welcome && second.welcome);
    await until("the roster lists both heroes", () =>
      first.received.find(
        (message) => message.t === "party.state" && message.party?.members.length === 2,
      ),
    );

    // Nothing about an idle party changes, but the tick loop runs 10 network ticks a second. A
    // roster rebroadcast per tick would show up here as a pile of identical messages.
    const before = first.received.filter((message) => message.t === "party.state").length;
    await scheduler.wait(1_500);
    const after = first.received.filter((message) => message.t === "party.state").length;
    expect(after).toBe(before);
  }, 20_000);
});
