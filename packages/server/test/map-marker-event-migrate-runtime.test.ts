/**
 * The proof that the markers -> typed-events migration is safe (UX wave #12 / Task 5), in the class
 * of `map-migrate.test.ts`: a map authored under the OLD marker model, migrated, must behave
 * IDENTICALLY through the live World Durable Object — the graph start still lands a fresh hero on the
 * same cell, monsters still spawn at the same cells with the same species/radius, and an exit still
 * routes to the destination map's entry cell.
 *
 * Fixtures are inserted as PRE-migration rows directly in D1 (markers on `map.markers`, no functional
 * events, graph binding marker-id slugs), then `migrateMarkersToEvents` runs, then the assertions go
 * through a real hero admission. The mutation proof drives the plan WITHOUT its graph rewrite and
 * shows the exit transition is denied — proving the rewrite is load-bearing.
 */
import { env } from "cloudflare:test";
import type { AdventureGraph } from "@lindocara/engine/adventure.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import type { MapMarkers } from "@lindocara/engine/map-data.js";
import {
  adventure,
  createDb,
  type Db,
  map,
  party,
  partyMember,
} from "@lindocara/server/db/index.js";
import { createHero } from "@lindocara/server/heroes.js";
import { migrateMarkersToEvents } from "@lindocara/server/map-marker-event-migrate.js";
import { layeredWireTerrain } from "@lindocara/test-utils/map-fixtures.js";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  tileCentre as centre,
  drainHeroRooms,
  type TestAccount,
  type TestHero,
  testAccount,
  until,
  waitForRoomSockets,
} from "./world-harness.js";

const COLS = 20;
const ROWS = 15;
const roomsToDrain = new Set<string>();

function allGrass(): string[] {
  return Array.from({ length: ROWS }, () => ".".repeat(COLS));
}

/** Insert one PRE-migration map row: markers on the column, no `map_event` rows. */
async function insertOldMap(
  db: Db,
  args: {
    id: string;
    accountId: string;
    adventureId: string;
    name: string;
    spawn: { col: number; row: number };
    markers: MapMarkers;
    isFirst: boolean;
  },
): Promise<void> {
  const wire = layeredWireTerrain(allGrass());
  await db.insert(map).values({
    id: args.id,
    accountId: args.accountId,
    adventureId: args.adventureId,
    name: args.name,
    cols: wire.cols,
    rows: wire.rows,
    tilesetId: wire.tilesetId,
    layers: JSON.stringify(wire.layers),
    spawnCol: args.spawn.col,
    spawnRow: args.spawn.row,
    markers: JSON.stringify(args.markers),
    isFirst: args.isFirst ? 1 : 0,
  });
}

interface OldAdventure {
  account: TestAccount;
  adventureId: string;
  partyId: string;
  mapA: string;
  mapB: string;
}

/** A two-map corridor authored entirely under the marker model: A."finish" -> B."door", B."finish"
 *  -> end. Monster on A. Nothing here is an event yet. */
async function seedOldAdventure(db: Db, label: string): Promise<OldAdventure> {
  const acct = await testAccount(label);
  const adventureId = crypto.randomUUID();
  const mapA = crypto.randomUUID();
  const mapB = crypto.randomUUID();
  const graph: AdventureGraph = {
    start: { mapId: mapA, entryId: "door" },
    links: [
      { mapId: mapA, exitId: "finish", dest: { mapId: mapB, entryId: "door" } },
      { mapId: mapB, exitId: "finish", dest: "end" },
    ],
  };
  await db.insert(adventure).values({
    id: adventureId,
    accountId: acct.accountId,
    title: "Migrated corridor",
    maxPlayers: 4,
    graph: JSON.stringify(graph),
  });
  await insertOldMap(db, {
    id: mapA,
    accountId: acct.accountId,
    adventureId,
    name: "Map A",
    spawn: { col: 2, row: 2 },
    markers: {
      entries: [{ id: "door", col: 2, row: 2 }],
      exits: [{ id: "finish", col: 4, row: 2 }],
      monsterSpawns: [{ col: 10, row: 8, species: "spear_goblin", patrolRadius: 192 }],
    },
    isFirst: true,
  });
  await insertOldMap(db, {
    id: mapB,
    accountId: acct.accountId,
    adventureId,
    name: "Map B",
    spawn: { col: 3, row: 3 },
    markers: {
      entries: [{ id: "door", col: 3, row: 3 }],
      exits: [{ id: "finish", col: 5, row: 3 }],
      monsterSpawns: [],
    },
    isFirst: false,
  });
  const partyId = crypto.randomUUID();
  await db.insert(party).values({
    id: partyId,
    adventureId,
    adventureVersion: 1,
    maxPlayers: 4,
    hostAccountId: acct.accountId,
    status: "open",
  });
  await db.insert(partyMember).values({ partyId, accountId: acct.accountId, color: "blue" });
  roomsToDrain.add(`${partyId}:${mapA}`);
  roomsToDrain.add(`${partyId}:${mapB}`);
  return { account: acct, adventureId, partyId, mapA, mapB };
}

/** Connect an existing hero id through the live admission route. */
async function joinHero(seed: OldAdventure, heroId: string, mapId: string): Promise<Client> {
  const heroLike: TestHero = {
    cookie: seed.account.cookie,
    accountId: seed.account.accountId,
    heroId,
    partyId: seed.partyId,
    adventureId: seed.adventureId,
    mapId,
    roomKey: `${seed.partyId}:${mapId}`,
    party: {} as TestHero["party"],
  };
  return Client.joinHero(heroLike);
}

afterEach(async () => {
  await drainHeroRooms();
  for (const roomKey of roomsToDrain) await waitForRoomSockets(roomKey, 0);
  roomsToDrain.clear();
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM map_event_page");
  await env.DB.exec("DELETE FROM map_event");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account");
});

describe("marker -> event migration: identical live-runtime behaviour", () => {
  it("keeps the start entry, monster spawns and exit routing after migration", {
    timeout: 15_000,
  }, async () => {
    const db = createDb(env.DB);
    const seed = await seedOldAdventure(db, "mig");

    const result = await migrateMarkersToEvents(db);
    expect(result.migratedMaps).toBe(2);
    expect(result.rewrittenGraphs).toBe(1);

    // 1) The graph start resolves through the MIGRATED entry event: a fresh hero lands on (2,2).
    const created = await createHero(db, seed.account.accountId, seed.partyId, {
      name: "Pilgrim",
      class: "priest",
    });
    expect(created.x).toBeCloseTo(centre(2, 2).x, 1);
    expect(created.y).toBeCloseTo(centre(2, 2).y, 1);

    // Stand the hero on the exit cell so admission both shows the source room and triggers the exit.
    await env.DB.prepare("UPDATE hero SET x = ?, y = ? WHERE id = ?")
      .bind(centre(4, 2).x, centre(4, 2).y, created.id)
      .run();

    const first = await joinHero(seed, created.id, seed.mapA);
    const welcome = await until("source welcome", () => first.welcome);
    expect(welcome.world.zoneId).toBe(seed.mapA);

    // 2) The monster event migrated at the same cell, species and radius.
    expect(welcome.monsters).toHaveLength(1);
    expect(welcome.monsters[0]).toMatchObject({ species: "spear_goblin", ...centre(10, 8) });
    const diagnostics = await env.WORLD.getByName(`${seed.partyId}:${seed.mapA}`).roomDiagnostics();
    expect(diagnostics.monsters).toEqual([
      expect.objectContaining({ species: "spear_goblin", patrolRadius: 192 }),
    ]);

    // 3) The exit routes through the MIGRATED exit event + rewritten graph to map B's entry cell.
    const close = await until("exit transition", () => first.closeInfo ?? undefined);
    expect(close.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    const second = await joinHero(seed, created.id, seed.mapB);
    const destination = await until("destination welcome", () => second.welcome);
    expect(destination.world.zoneId).toBe(seed.mapB);
    expect(second.self()).toMatchObject(centre(3, 3));
  });
});

describe("marker -> event migration mutation proof", () => {
  it("a graph exit not rewritten to the migrated exit event's uuid denies the transition", {
    timeout: 15_000,
  }, async () => {
    const db = createDb(env.DB);
    const seed = await seedOldAdventure(db, "mut");
    await migrateMarkersToEvents(db);

    // MUTATION: pretend the graph-id rewrite for map A's exit was skipped — its exit link no longer
    // names the migrated exit event's uuid. (A literal un-rewritten graph would keep the marker slug
    // "finish", which is not a uuid and would make the whole graph unparseable; a fresh uuid is the
    // parseable stand-in that isolates the exit binding.) The start entry stays correctly rewritten,
    // so admission still works and the failure is precisely the exit routing.
    const [advRow] = await db.select().from(adventure).where(eq(adventure.id, seed.adventureId));
    if (!advRow) throw new Error("adventure vanished");
    const graph = JSON.parse(advRow.graph) as AdventureGraph;
    const brokenLink = graph.links.find((link) => link.mapId === seed.mapA);
    if (!brokenLink) throw new Error("expected a link from map A");
    brokenLink.exitId = crypto.randomUUID();
    await db
      .update(adventure)
      .set({ graph: JSON.stringify(graph) })
      .where(eq(adventure.id, seed.adventureId));

    const created = await createHero(db, seed.account.accountId, seed.partyId, {
      name: "Blocked",
      class: "priest",
    });
    await env.DB.prepare("UPDATE hero SET x = ?, y = ? WHERE id = ?")
      .bind(centre(4, 2).x, centre(4, 2).y, created.id)
      .run();

    const client = await joinHero(seed, created.id, seed.mapA);
    await until("source welcome", () => client.welcome);
    // The exit is detected but refused: a transition_denied event arrives and no transition close.
    const denied = await until("transition denied", () =>
      client.received.find(
        (message) => message.t === "event" && message.code === "zone.transition_denied",
      ),
    );
    expect(denied).toBeTruthy();
    expect(client.closeInfo).toBeNull();
  });
});
