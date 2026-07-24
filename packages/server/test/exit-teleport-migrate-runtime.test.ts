/**
 * The proof that the exits -> teleport-events migration is safe, in the class of
 * `map-marker-event-migrate-runtime.test.ts`: an adventure authored with `exit` events bound by the
 * adventure GRAPH must, after migration, move a hero to exactly the same destination — but now
 * through the ordinary `teleport` command the interpreter runs, with no graph link left to resolve.
 *
 * Fixtures are inserted as PRE-migration rows (exit/entry EVENTS on `map_event`, graph links binding
 * their uuids), then `migrateExitsToTeleports` runs, then a real hero walks onto the cell through the
 * live World Durable Object. The mutation proof shows the graph link is genuinely gone afterwards, so
 * the transition can only be coming from the migrated event's program.
 */
import { env } from "cloudflare:test";
import type { AdventureGraph } from "@lindocara/engine/adventure.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import {
  adventure,
  createDb,
  type Db,
  map,
  party,
  partyMember,
} from "@lindocara/server/db/index.js";
import { migrateExitsToTeleports } from "@lindocara/server/exit-teleport-migrate.js";
import { createHero } from "@lindocara/server/heroes.js";
import { insertEventStatements, loadMap } from "@lindocara/server/maps.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
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

async function insertMapWithEvents(
  db: Db,
  args: {
    id: string;
    accountId: string;
    adventureId: string;
    name: string;
    spawn: { col: number; row: number };
    events: readonly MapEvent[];
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
    isFirst: args.isFirst ? 1 : 0,
  });
  const statements = insertEventStatements(db, args.id, args.events);
  for (const statement of statements) await statement;
}

interface ExitAdventure {
  account: TestAccount;
  adventureId: string;
  partyId: string;
  mapA: string;
  mapB: string;
  exitA: string;
  entryB: string;
}

/** A two-map corridor bound by the graph: A's exit at (4,2) leads to B's entry at (7,9). */
async function seedExitAdventure(db: Db, label: string): Promise<ExitAdventure> {
  const acct = await testAccount(label);
  const adventureId = crypto.randomUUID();
  const mapA = crypto.randomUUID();
  const mapB = crypto.randomUUID();
  const exitA = crypto.randomUUID();
  const entryA = crypto.randomUUID();
  const entryB = crypto.randomUUID();
  const graph: AdventureGraph = {
    start: { mapId: mapA, entryId: entryA },
    links: [{ mapId: mapA, exitId: exitA, dest: { mapId: mapB, entryId: entryB } }],
  };
  await db.insert(adventure).values({
    id: adventureId,
    accountId: acct.accountId,
    title: "Exit corridor",
    maxPlayers: 4,
    graph: JSON.stringify(graph),
  });
  await insertMapWithEvents(db, {
    id: mapA,
    accountId: acct.accountId,
    adventureId,
    name: "Map A",
    spawn: { col: 2, row: 2 },
    events: [
      functionalEvent({ id: entryA, col: 2, row: 2, ordinal: 1, kind: "entry" }),
      functionalEvent({
        id: exitA,
        col: 4,
        row: 2,
        ordinal: 2,
        kind: "exit",
        name: "Vers le pont",
      }),
    ],
    isFirst: true,
  });
  await insertMapWithEvents(db, {
    id: mapB,
    accountId: acct.accountId,
    adventureId,
    name: "Map B",
    spawn: { col: 3, row: 3 },
    events: [functionalEvent({ id: entryB, col: 7, row: 9, ordinal: 1, kind: "entry" })],
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
  return { account: acct, adventureId, partyId, mapA, mapB, exitA, entryB };
}

async function joinHero(seed: ExitAdventure, heroId: string, mapId: string): Promise<Client> {
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

describe("exit -> teleport migration: identical live-runtime behaviour", () => {
  it("still moves a hero to the destination entry's cell, now as a scripted teleport", {
    timeout: 20_000,
  }, async () => {
    const db = createDb(env.DB);
    const seed = await seedExitAdventure(db, "xmig");

    const result = await migrateExitsToTeleports(db);
    expect(result.migratedMaps).toBe(1);
    expect(result.convertedExits).toBe(1);
    expect(result.skipped).toEqual([]);

    // The graph link is GONE: nothing but the migrated event's own program can route this hero.
    const [advRow] = await db.select().from(adventure).where(eq(adventure.id, seed.adventureId));
    const graph = JSON.parse(advRow?.graph ?? "{}") as AdventureGraph;
    expect(graph.links).toEqual([]);

    const created = await createHero(db, seed.account.accountId, seed.partyId, {
      name: "Pilgrim",
      class: "priest",
    });
    // Stand the hero one cell WEST of the migrated cell and walk him into it.
    //
    // This is the one behavioural difference the migration makes, and it is deliberate. An `exit`
    // fired on OCCUPANCY — `#detectAdventureExits` re-checked every tick who was standing in the
    // cell — whereas `player-touch` fires on ENTRY, when a movement box lands on it. For an exit an
    // author drew to be walked into, the two are the same. They differ only for a hero placed on
    // the cell without moving (a save resumed exactly on it), who now steps off freely instead of
    // being re-routed the instant he connects. That is the friendlier behaviour of the two.
    await env.DB.prepare("UPDATE hero SET x = ?, y = ? WHERE id = ?")
      .bind(centre(3, 2).x, centre(3, 2).y, created.id)
      .run();

    const first = await joinHero(seed, created.id, seed.mapA);
    const welcome = await until("source welcome", () => first.welcome);
    expect(welcome.world.zoneId).toBe(seed.mapA);

    first.press("right");
    const close = await until("migrated teleport handoff", () => first.closeInfo ?? undefined);
    expect(close.code).toBe(WS_CLOSE.ZONE_TRANSITION);

    // The destination is the entry event's cell (7,9) — the exit's old destination, unchanged.
    const second = await joinHero(seed, created.id, seed.mapB);
    const destination = await until("destination welcome", () => second.welcome);
    expect(destination.world.zoneId).toBe(seed.mapB);
    expect(second.self()).toMatchObject(centre(7, 9));
  });

  it("leaves the migrated event authorable: a normal event carrying one teleport command", {
    timeout: 20_000,
  }, async () => {
    const db = createDb(env.DB);
    const seed = await seedExitAdventure(db, "xauth");
    await migrateExitsToTeleports(db);

    // The whole point of the migration: what used to be an uneditable graph binding is now an
    // ordinary scripted event an author can open in the editor and retarget.
    const stored = await loadMap(db, seed.mapA);
    const migrated = stored?.events.find((event) => event.id === seed.exitA);
    expect(migrated?.kind).toBe("normal");
    expect(migrated?.name).toBe("Vers le pont");
    expect(migrated?.col).toBe(4);
    expect(migrated?.row).toBe(2);
    expect(migrated?.pages[0]?.trigger).toBe("player-touch");
    expect(migrated?.pages[0]?.commands).toEqual([
      { t: "teleport", mapId: seed.mapB, col: 7, row: 9 },
    ]);
    // And no exit survives anywhere, so `#detectAdventureExits` has nothing left to fire on.
    expect(stored?.events.some((event) => event.kind === "exit")).toBe(false);
  });
});
