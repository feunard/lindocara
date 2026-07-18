/**
 * Markers through the server boundary: validateMapInput's terrain rules, the JSON column
 * round-trip, and the map_markers wire code. Same SELF.fetch cookie pattern as maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { account, createDb } from "../src/server/db/index.js";
import { createMap, loadMap, type MapInput, validateMapInput } from "../src/server/maps.js";
import { SESSION_COOKIE } from "../src/server/session.js";
import type { MapMarkers } from "../src/shared/map-data.js";

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
    blocks: blocks(),
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
    const created = await createMap(db, "marker-owner", input());
    const loaded = await loadMap(db, created.id);
    expect(loaded?.markers).toEqual(markers());

    const plain = await createMap(db, "marker-owner", input({ name: "Plain", markers: undefined }));
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
    const good = await SELF.fetch(`${ORIGIN}/api/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Wire",
        blocks: blocks(),
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: markers(),
      }),
    });
    expect(good.status).toBe(201);
    expect(((await good.json()) as { markers: MapMarkers }).markers).toEqual(markers());

    const bad = await SELF.fetch(`${ORIGIN}/api/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Wire",
        blocks: blocks(),
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: markers({ entries: [{ id: "wet", col: 1, row: 1 }] }),
      }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "map_markers" });
  });
});
