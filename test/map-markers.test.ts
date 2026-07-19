/**
 * Markers through the server boundary: validateMapInput's terrain rules, the JSON column
 * round-trip, and the map_markers wire code. Same SELF.fetch cookie pattern as maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { account, createDb } from "../src/server/db/index.js";
import { loadMap, type MapInput, validateMapInput } from "../src/server/maps.js";
import { SESSION_COOKIE } from "../src/server/session.js";
import type { MapMarkers } from "../src/shared/map-data.js";
import { authorMap, seedAdventure } from "./support/adventure-fixtures.js";
import { layeredTerrain, layeredWireTerrain } from "./support/map-fixtures.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows = [".".repeat(COLS), `.##${".".repeat(COLS - 3)}`];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function markers(overrides: Partial<MapMarkers> = {}): MapMarkers {
  return {
    entries: [{ id: "door", col: 5, row: 5 }],
    exits: [{ id: "cave", col: 6, row: 6 }],
    monsterSpawns: [{ col: 8, row: 8, species: "spear_goblin", patrolRadius: 96 }],
    ...overrides,
  };
}

function input(overrides: Partial<MapInput> = {}): MapInput {
  return {
    name: "Marked",
    ...layeredTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: markers(),
    ...overrides,
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account WHERE id = 'marker-owner'");
});

describe("validateMapInput marker rules", () => {
  it("accepts markers on walkable ground", () => {
    expect(() => validateMapInput(input())).not.toThrow();
  });

  it("rejects a marker on water", () => {
    expect(() =>
      validateMapInput(input({ markers: markers({ entries: [{ id: "wet", col: 1, row: 1 }] }) })),
    ).toThrow(/^markers:/);
    expect(() =>
      validateMapInput(
        input({
          markers: markers({
            monsterSpawns: [{ col: 2, row: 1, species: "mire_troll", patrolRadius: 96 }],
          }),
        }),
      ),
    ).toThrow(/^markers:/);
  });

  it("rejects an exit sharing a cell with the spawn or an entry", () => {
    expect(() =>
      validateMapInput(input({ markers: markers({ exits: [{ id: "onspawn", col: 0, row: 0 }] }) })),
    ).toThrow(/^markers:/);
    expect(() =>
      validateMapInput(input({ markers: markers({ exits: [{ id: "ondoor", col: 5, row: 5 }] }) })),
    ).toThrow(/^markers:/);
  });

  it("rejects a malformed marker payload wholesale", () => {
    const broken = { entries: "nope", exits: [], monsterSpawns: [] } as unknown as MapMarkers;
    expect(() => validateMapInput(input({ markers: broken }))).toThrow(/^markers:/);
  });
});

describe("marker persistence", () => {
  it("round-trips markers through D1 and defaults legacy rows to empty", async () => {
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
    expect(loaded?.markers).toEqual(markers());

    const plain = await authorMap(
      db,
      "marker-owner",
      adventureId,
      input({ name: "Plain", markers: undefined }),
    );
    const loadedPlain = await loadMap(db, plain.id);
    expect(loadedPlain?.markers).toEqual({ entries: [], exits: [], monsterSpawns: [] });
  });
});

describe("markers over the wire", () => {
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

  it("saves valid markers and answers map_markers for misplaced ones", async () => {
    // POST /api/maps only mints a template inside an adventure now; markers are validated and
    // persisted by the authoring PUT.
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
        markers: markers(),
      }),
    });
    expect(good.status).toBe(200);
    expect(((await good.json()) as { markers: MapMarkers }).markers).toEqual(markers());

    const bad = await SELF.fetch(`${ORIGIN}/api/maps/${mapId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Wire",
        ...layeredWireTerrain(blocks()),
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: markers({ entries: [{ id: "wet", col: 1, row: 1 }] }),
      }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "map_markers" });
  });
});
