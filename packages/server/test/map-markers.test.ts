/**
 * UX wave #12: markers are dead — entries/exits/monster spawns are typed EVENTS. This file covers
 * the rules that moved onto events (walkable ground per kind, an exit off the spawn cell), the event
 * round-trip through D1, and the map_events wire code. The quarantined markers column still parses,
 * so its malformed-shape guard is kept too. Same SELF.fetch cookie pattern as maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { EMPTY_MARKERS, type MapMarkers } from "@lindocara/engine/map-data.js";
import {
  entryEvents,
  exitEvents,
  functionalEvent,
  type MapEvent,
  monsterEvents,
} from "@lindocara/engine/map-events.js";
import { account, createDb } from "@lindocara/server/db/index.js";
import { loadMap, type MapInput, validateMapInput } from "@lindocara/server/maps.js";
import { SESSION_COOKIE } from "@lindocara/server/session.js";
import { layeredTerrain, layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { authorMap, seedAdventure } from "./adventure-fixtures.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

const E_ENTRY = "aaaaaaaa-0000-4000-8000-000000000001";
const E_EXIT = "aaaaaaaa-0000-4000-8000-000000000002";
const E_MON = "aaaaaaaa-0000-4000-8000-000000000003";

/** Row 1 columns 1-2 are water (`#`); everything else is grass. */
function blocks(): string[] {
  const rows = [".".repeat(COLS), `.##${".".repeat(COLS - 3)}`];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

/** Entry@(5,5), exit@(6,6), monster@(8,8) — all on grass, exit off the spawn (0,0). */
function events(overrides: MapEvent[] | null = null): MapEvent[] {
  if (overrides) return overrides;
  return [
    functionalEvent({ id: E_ENTRY, col: 5, row: 5, ordinal: 1, kind: "entry" }),
    functionalEvent({ id: E_EXIT, col: 6, row: 6, ordinal: 2, kind: "exit" }),
    functionalEvent({
      id: E_MON,
      col: 8,
      row: 8,
      ordinal: 3,
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 96,
    }),
  ];
}

function input(overrides: Partial<MapInput> = {}): MapInput {
  return {
    name: "Marked",
    ...layeredTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
    events: events(),
    ...overrides,
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM map_event_page");
  await env.DB.exec("DELETE FROM map_event");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account WHERE id = 'marker-owner'");
});

describe("validateMapInput event rules", () => {
  it("accepts functional events on walkable ground", () => {
    expect(() => validateMapInput(input())).not.toThrow();
  });

  it("rejects an entry or monster event on water", () => {
    expect(() =>
      validateMapInput(
        input({
          events: [functionalEvent({ id: E_ENTRY, col: 1, row: 1, ordinal: 1, kind: "entry" })],
        }),
      ),
    ).toThrow(/^events:/);
    expect(() =>
      validateMapInput(
        input({
          events: [
            functionalEvent({
              id: E_MON,
              col: 2,
              row: 1,
              ordinal: 1,
              kind: "monster",
              species: "mire_troll",
              patrolRadius: 96,
            }),
          ],
        }),
      ),
    ).toThrow(/^events:/);
  });

  it("rejects an exit event sharing the spawn cell", () => {
    expect(() =>
      validateMapInput(
        input({
          events: [functionalEvent({ id: E_EXIT, col: 0, row: 0, ordinal: 1, kind: "exit" })],
        }),
      ),
    ).toThrow(/^events:/);
  });

  it("still rejects a malformed markers payload wholesale (quarantined column)", () => {
    const broken = { entries: "nope", exits: [], monsterSpawns: [] } as unknown as MapMarkers;
    expect(() => validateMapInput(input({ markers: broken }))).toThrow(/^markers:/);
  });
});

describe("event persistence", () => {
  it("round-trips functional events through D1 and defaults legacy rows to none", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "marker-owner",
      username: "marker-owner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    const adventureId = await seedAdventure(db, "marker-owner");
    const created = await authorMap(db, "marker-owner", adventureId, input());
    const loaded = await loadMap(db, created.id);
    expect(loaded?.events).toHaveLength(3);
    expect(entryEvents(loaded?.events ?? [])).toHaveLength(1);
    expect(exitEvents(loaded?.events ?? [])).toHaveLength(1);
    const [monster] = monsterEvents(loaded?.events ?? []);
    expect(monster).toMatchObject({ species: "spear_goblin", patrolRadius: 96 });

    const plain = await authorMap(
      db,
      "marker-owner",
      adventureId,
      input({ name: "Plain", events: [] }),
    );
    const loadedPlain = await loadMap(db, plain.id);
    expect(loadedPlain?.events).toEqual([]);
  });
});

describe("events over the wire", () => {
  let cookie = "";
  beforeAll(async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "markers1", password: "12345678" }),
    });
    const value = (response.headers.get("Set-Cookie") ?? "").split(";")[0]?.split("=")[1];
    if (!value) throw new Error("expected a session cookie");
    cookie = `${SESSION_COOKIE}=${value}`;
  });

  it("saves valid events and answers map_events for misplaced ones", async () => {
    const adv = await SELF.fetch(`${ORIGIN}/api/adventures`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Wire", maxPlayers: 4 }),
    });
    const adventureId = ((await adv.json()) as { id: string }).id;
    // The atomic create gives the adventure a saved graph binding its default map; reset it to a
    // draft so authoring a fresh map with its own exits isn't gated by the all-exits-bound rule.
    await SELF.fetch(`${ORIGIN}/api/adventures/${adventureId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Wire", maxPlayers: 4, graph: { start: null, links: [] } }),
    });
    const template = await SELF.fetch(`${ORIGIN}/api/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ adventureId, name: "Wire" }),
    });
    const mapId = ((await template.json()) as { id: string }).id;

    const good = await SELF.fetch(`${ORIGIN}/api/maps/${mapId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Wire",
        ...layeredWireTerrain(blocks()),
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: EMPTY_MARKERS,
        events: events(),
      }),
    });
    expect(good.status).toBe(200);
    expect(entryEvents(((await good.json()) as { events: MapEvent[] }).events)).toHaveLength(1);

    const bad = await SELF.fetch(`${ORIGIN}/api/maps/${mapId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Wire",
        ...layeredWireTerrain(blocks()),
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: EMPTY_MARKERS,
        events: [functionalEvent({ id: E_ENTRY, col: 1, row: 1, ordinal: 1, kind: "entry" })],
      }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "map_events" });
  });
});
