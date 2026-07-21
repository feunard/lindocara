/**
 * The maps CRUD API: create, list, read, update, delete and flip the front-door flag, all gated by
 * a session and nothing else. Drives the real Worker through SELF.fetch, the same
 * register-and-cookie pattern as worker.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAdventure } from "../src/server/adventures.js";
import { createDb } from "../src/server/db/index.js";
import { BUILTIN_MAP_ID } from "../src/server/maps.js";
import { SESSION_COOKIE } from "../src/server/session.js";
import { MAX_ADVENTURE_MAPS } from "../src/shared/adventure.js";
import { COMMAND_TEXT_MAX, MAX_CHOICE_OPTIONS } from "../src/shared/event-commands.js";
import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "../src/shared/game.js";
import {
  MARKER_LABEL_MAX,
  MAX_MAP_ENTRIES,
  MAX_MAP_EXITS,
  MAX_MAP_MONSTER_SPAWNS,
} from "../src/shared/map-data.js";
import {
  EVENT_NAME_MAX,
  MAX_EVENTS_PER_MAP,
  MAX_PAGES_PER_EVENT,
} from "../src/shared/map-events.js";
import { encodeTileLayer, type TileLayer } from "../src/shared/tile-layer-codec.js";
import { fixedId } from "../src/shared/tileset.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";
import { EDITOR_ASSETS, editorAsset } from "../src/shared/tiny-swords-catalog.js";
import { layeredWireTerrain } from "./support/map-fixtures.js";

const ORIGIN = "https://lindocara.test";

// Exactly the size floor (20x15), with a one-cell-wide water strip at (1,1)/(2,1) standing in for
// "the sea" — everything else is grass. Mirrors test/maps.test.ts's fixture.
const MAP_COLS = 20;
const MAP_ROWS = 15;
function validBlocks(): string[] {
  const blocks = [".".repeat(MAP_COLS), `.##${".".repeat(MAP_COLS - 3)}`];
  while (blocks.length < MAP_ROWS) blocks.push(".".repeat(MAP_COLS));
  return blocks;
}

function mapBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Test Map",
    ...layeredWireTerrain(validBlocks()),
    elements: [],
    events: [],
    spawn: { col: 0, row: 0 },
    ...overrides,
  };
}

/** A wire event page with every required field, overridable per test — the same shape
 *  `parseMapEvents` accepts and `mapResponseBody` returns. */
function wirePage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    moveType: "fixed",
    moveSpeed: 3,
    moveFreq: 3,
    optMoveAnim: false,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
    ...overrides,
  };
}

let cookie = "";
let userCount = 0;

async function register(): Promise<string> {
  userCount += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `mapapi${userCount}`, password: "12345678" }),
  });
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  const value = setCookie.split(";")[0]?.split("=")[1];
  if (!value) throw new Error("expected a session cookie");
  return `${SESSION_COOKIE}=${value}`;
}

beforeAll(async () => {
  cookie = await register();
});

function authed(path: string, init: RequestInit = {}, asCookie = cookie): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: asCookie, ...(init.headers ?? {}) },
  });
}

// The pool does not isolate storage between tests, or between files: a map left behind here would
// change what resolveMapFor() returns for an unrelated test elsewhere. Adventure delete cascades to
// its maps and their children.
afterEach(async () => {
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM adventure");
});

/**
 * A DRAFT adventure with NO maps, seeded directly through the server function rather than the HTTP
 * POST. The HTTP `POST /api/adventures` is now atomic (it creates a default first map), which would
 * perturb this file's map-count and front-door assertions; these tests own the map lifecycle
 * themselves, so they start from an empty adventure. The owner is resolved from the cookie via
 * `/api/me` so every existing call site keeps passing a cookie.
 */
async function newAdventure(asCookie = cookie): Promise<string> {
  const me = (await (await authed("/api/me", {}, asCookie)).json()) as { id: string };
  const adv = await createAdventure(createDb(env.DB), me.id, { title: "Adv", maxPlayers: 4 });
  return adv.id;
}

/** Create the 5x5 template map inside `adventureId` (the only thing POST /api/maps does now). */
async function newMap(adventureId: string, name = "Map", asCookie = cookie): Promise<Response> {
  return authed(
    "/api/maps",
    { method: "POST", body: JSON.stringify({ adventureId, name }) },
    asCookie,
  );
}

async function newMapId(adventureId: string, name = "Map", asCookie = cookie): Promise<string> {
  const res = await newMap(adventureId, name, asCookie);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Author real terrain onto a map — where all the validation now lives. */
function putMap(id: string, body: unknown, asCookie = cookie): Promise<Response> {
  return authed(`/api/maps/${id}`, { method: "PUT", body: JSON.stringify(body) }, asCookie);
}

describe("session gate", () => {
  it("401s every map route without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/maps"],
      ["GET", "/api/maps/whatever"],
      ["POST", "/api/maps"],
      ["PUT", "/api/maps/whatever"],
      ["DELETE", "/api/maps/whatever"],
      ["POST", "/api/maps/whatever/first"],
    ];
    for (const [method, path] of routes) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, { method });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("create under an adventure", () => {
  it("creates the blank flat-grass template with no events, ignoring any client terrain", async () => {
    const adventureId = await newAdventure();
    // Deliberately send terrain — the server must ignore it and build the blank template.
    const res = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify({ adventureId, ...mapBody(), name: "Fresh" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      name: string;
      cols: number;
      rows: number;
      spawn: unknown;
      events: unknown[];
    };
    // Spawn dead centre of the MAP_MIN field, and genuinely blank — no auto-seeded events (B2).
    expect(created).toMatchObject({
      name: "Fresh",
      cols: 20,
      rows: 15,
      spawn: { col: 10, row: 7 },
    });
    expect(created.events).toEqual([]);
  });

  it("refuses creating a map under an adventure the caller does not own (404)", async () => {
    const adventureId = await newAdventure();
    const rival = await register();
    const res = await newMap(adventureId, "Sneaky", rival);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "map_not_found" });
  });

  it("400s a create body with no adventure or no name", async () => {
    const adventureId = await newAdventure();
    expect(
      (await authed("/api/maps", { method: "POST", body: JSON.stringify({ name: "x" }) })).status,
    ).toBe(400);
    expect(
      (await authed("/api/maps", { method: "POST", body: JSON.stringify({ adventureId }) })).status,
    ).toBe(400);
  });

  it(`refuses a ${MAX_ADVENTURE_MAPS + 1}th map in one adventure`, async () => {
    const adventureId = await newAdventure();
    for (let index = 0; index < MAX_ADVENTURE_MAPS; index += 1) {
      expect((await newMap(adventureId, `Map ${index + 1}`)).status).toBe(201);
    }

    const refused = await newMap(adventureId, "Too many");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "map_limit" });
  });
});

describe("list, get, update, delete", () => {
  it("round-trips a map through the whole lifecycle", async () => {
    const adventureId = await newAdventure();
    // A second map keeps the world non-empty so the one under test can actually be deleted.
    await newMapId(adventureId, "Keepalive");

    const id = await newMapId(adventureId, "Round Trip");

    // Events ride the PUT body and must survive the GET -> PUT verbatim path below just like layers.
    const roundTripEvents = [
      {
        id: crypto.randomUUID(),
        col: 5,
        row: 5,
        name: "Sign",
        ordinal: 1,
        pages: [wirePage({ condSwitchId: "0007", trigger: "player-touch" })],
      },
      {
        id: crypto.randomUUID(),
        col: 6,
        row: 5,
        name: "",
        ordinal: 2,
        pages: [wirePage(), wirePage({ moveType: "random", optOnTop: true })],
      },
    ];
    const authorRes = await putMap(id, mapBody({ name: "Round Trip", events: roundTripEvents }));
    expect(authorRes.status).toBe(200);
    expect(await authorRes.json()).toMatchObject({
      id,
      name: "Round Trip",
      ...layeredWireTerrain(validBlocks()),
      elements: [],
      spawn: { col: 0, row: 0 },
      events: roundTripEvents,
    });

    const listRes = await authed(`/api/maps?adventure=${adventureId}`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; name: string }[];
    expect(list.find((m) => m.id === id)).toMatchObject({ name: "Round Trip" });

    const getRes = await authed(`/api/maps/${id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched).toMatchObject({ id, name: "Round Trip", events: roundTripEvents });

    // A GET response is a legal PUT body, verbatim, with no re-encode step in between.
    const echoRes = await putMap(id, fetched);
    expect(echoRes.status).toBe(200);
    expect(await echoRes.json()).toMatchObject({ id, name: "Round Trip" });

    const updateRes = await putMap(id, mapBody({ name: "Renamed" }));
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ id, name: "Renamed" });

    const deleteRes = await authed(`/api/maps/${id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await authed(`/api/maps/${id}`);
    expect(afterDelete.status).toBe(404);
    expect(await afterDelete.json()).toEqual({ error: "map_not_found" });
  });

  it("round-trips a page's nested command program through D1", async () => {
    const adventureId = await newAdventure();
    await newMapId(adventureId, "Keepalive");
    const id = await newMapId(adventureId, "Scripted");

    // A nested program (a choice whose branches nest an if with a loop and a break) exercises the
    // JSON `commands` column through the whole save/load path, not just a flat list.
    const commands = [
      { t: "say", text: "La porte est verrouillee.", name: "Mira" },
      {
        t: "choices",
        prompt: "Ouvrir ?",
        options: [
          {
            label: "Ouvrir",
            body: [
              { t: "setSwitch", switchId: "0001", value: true },
              {
                t: "if",
                cond: { type: "variable", variableId: "0002", min: 3 },
                then: [{ t: "loop", body: [{ t: "changeGold", amount: 1 }, { t: "breakLoop" }] }],
                else: [{ t: "changeItems", itemId: "health_potion", count: 1 }],
              },
            ],
          },
          { label: "Laisser", body: [{ t: "exitRun" }] },
        ],
      },
      { t: "wait", frames: 20 },
    ];
    const events = [
      {
        id: crypto.randomUUID(),
        col: 4,
        row: 4,
        name: "Door",
        ordinal: 1,
        pages: [wirePage({ commands })],
      },
    ];

    const putRes = await putMap(id, mapBody({ name: "Scripted", events }));
    expect(putRes.status).toBe(200);

    const getRes = await authed(`/api/maps/${id}`);
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as {
      events: { pages: { commands: unknown }[] }[];
    };
    expect(fetched.events[0]?.pages[0]?.commands).toEqual(commands);
  });

  it("keeps maps private and hides foreign mutations as not found", async () => {
    const adventureId = await newAdventure();
    const id = await newMapId(adventureId, "Private");
    const rival = await register();
    const rivalAdventure = await newAdventure(rival);

    expect(await (await authed(`/api/maps?adventure=${rivalAdventure}`, {}, rival)).json()).toEqual(
      [],
    );
    expect((await authed(`/api/maps/${id}`, {}, rival)).status).toBe(404);
    expect((await putMap(id, mapBody({ name: "Stolen" }), rival)).status).toBe(404);
    expect((await authed(`/api/maps/${id}`, { method: "DELETE" }, rival)).status).toBe(404);
    expect(await (await authed(`/api/maps/${id}`)).json()).toMatchObject({
      name: "Private",
      revision: 1,
    });
  });

  it("increments revision only after a successful update", async () => {
    const adventureId = await newAdventure();
    const created = (await (await newMap(adventureId)).json()) as { id: string; revision: number };
    expect(created.revision).toBe(1);

    const refused = await putMap(created.id, mapBody({ name: " " }));
    expect(refused.status).toBe(400);
    expect(await (await authed(`/api/maps/${created.id}`)).json()).toMatchObject({ revision: 1 });

    const updated = await putMap(created.id, mapBody({ name: "Revision two" }));
    expect(await updated.json()).toMatchObject({ revision: 2 });
  });

  it("refuses a save based on a stale editor revision", async () => {
    const adventureId = await newAdventure();
    const created = (await (await newMap(adventureId)).json()) as {
      id: string;
      revision: number;
    };
    const first = await putMap(
      created.id,
      mapBody({ name: "Current", expectedRevision: created.revision }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ revision: 2, name: "Current" });

    const stale = await putMap(
      created.id,
      mapBody({ name: "Stale overwrite", expectedRevision: created.revision }),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "map_conflict" });
    expect(await (await authed(`/api/maps/${created.id}`)).json()).toMatchObject({
      revision: 2,
      name: "Current",
    });
  });
});

describe("validation (on the authoring PUT)", () => {
  it("rejects a tree standing in the water", async () => {
    const id = await newMapId(await newAdventure());
    const response = await putMap(
      id,
      mapBody({ elements: [{ col: 1, row: 1, kind: "tree", variant: 0 }] }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_placement" });
  });

  it("rejects a map smaller than the size floor", async () => {
    const id = await newMapId(await newAdventure());
    const tiny = Array.from({ length: 5 }, () => ".".repeat(5));
    const response = await putMap(
      id,
      mapBody({ ...layeredWireTerrain(tiny), spawn: { col: 0, row: 0 } }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_size" });
  });

  it("rejects a blank name", async () => {
    const id = await newMapId(await newAdventure());
    const response = await putMap(id, mapBody({ name: "   " }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_name" });
  });

  it("rejects a shape parseMapData cannot make sense of", async () => {
    const id = await newMapId(await newAdventure());
    const response = await putMap(id, {
      name: "Bad Shape",
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 20,
      rows: 15,
      layers: "nope",
      elements: [],
      spawn: { col: 0, row: 0 },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_invalid" });
  });

  it("rejects a body with no name at all", async () => {
    const id = await newMapId(await newAdventure());
    const response = await putMap(id, {
      blocks: validBlocks(),
      elements: [],
      spawn: { col: 0, row: 0 },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_invalid" });
  });
});

describe("not found", () => {
  it("404s an unknown id", async () => {
    const response = await authed("/api/maps/00000000-0000-4000-8000-000000000000");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "map_not_found" });
  });

  it("404s the built-in floor on every route — it is not a D1 row to find, edit or delete", async () => {
    const get = await authed(`/api/maps/${BUILTIN_MAP_ID}`);
    expect(get.status).toBe(404);
    expect(await get.json()).toEqual({ error: "map_not_found" });

    const put = await putMap(BUILTIN_MAP_ID, mapBody());
    expect(put.status).toBe(404);
    expect(await put.json()).toEqual({ error: "map_not_found" });

    const del = await authed(`/api/maps/${BUILTIN_MAP_ID}`, { method: "DELETE" });
    expect(del.status).toBe(404);
    expect(await del.json()).toEqual({ error: "map_not_found" });

    const first = await authed(`/api/maps/${BUILTIN_MAP_ID}/first`, { method: "POST" });
    expect(first.status).toBe(404);
    expect(await first.json()).toEqual({ error: "map_not_found" });
  });

  it("never lists the built-in floor", async () => {
    const adventureId = await newAdventure();
    await newMapId(adventureId);
    const list = (await (await authed(`/api/maps?adventure=${adventureId}`)).json()) as {
      id: string;
    }[];
    expect(list.map((m) => m.id)).not.toContain(BUILTIN_MAP_ID);
  });
});

describe("the front door", () => {
  it("hands the flag to a survivor when the flagged map is deleted", async () => {
    const adventureId = await newAdventure();
    const one = await newMapId(adventureId, "One");
    const two = await newMapId(adventureId, "Two");

    await authed(`/api/maps/${one}`, { method: "DELETE" });

    const list = (await (await authed(`/api/maps?adventure=${adventureId}`)).json()) as {
      id: string;
      isFirst: boolean;
    }[];
    expect(list.find((m) => m.id === two)?.isFirst).toBe(true);
  });

  it("moves the flag on POST /:id/first", async () => {
    const adventureId = await newAdventure();
    const one = await newMapId(adventureId, "One");
    const two = await newMapId(adventureId, "Two");

    const flip = await authed(`/api/maps/${two}/first`, { method: "POST" });
    expect(flip.status).toBe(204);

    const list = (await (await authed(`/api/maps?adventure=${adventureId}`)).json()) as {
      id: string;
      isFirst: boolean;
    }[];
    expect(list.find((m) => m.id === two)?.isFirst).toBe(true);
    expect(list.find((m) => m.id === one)?.isFirst).toBe(false);
  });
});

describe("the last map", () => {
  it("refuses to delete the only map", async () => {
    const id = await newMapId(await newAdventure());
    const deleteRes = await authed(`/api/maps/${id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(409);
    expect(await deleteRes.json()).toEqual({ error: "last_map" });
  });
});

describe("size caps over the wire (on the authoring PUT)", () => {
  it("accepts a maximal 100x100 map", async () => {
    const id = await newMapId(await newAdventure());
    const blocks = Array.from({ length: 100 }, () => ".".repeat(100));
    const response = await putMap(
      id,
      mapBody({ name: "Maximal", ...layeredWireTerrain(blocks), spawn: { col: 0, row: 0 } }),
    );
    expect(response.status).toBe(200);
  });

  // `MAX_MAP_JSON_BYTES` (src/server/index.ts) is sized against the enumerated worst case: max-
  // length, non-compressible layers, `MAX_MAP_ELEMENTS` elements at the longest catalogue asset
  // id, and the full entry/exit/monster-spawn marker complement at their id/label caps with the
  // longest `MonsterSpecies` name. The old version of this test defaulted to `elements: []` and no
  // markers (and, as of tranche 3, no events — which now dominate the worst case), so it only ever
  // posted ~150,050 bytes — nowhere near the enumerated worst case (now 385,234 bytes) or the
  // 409,600-byte cap — and would have passed under any cap above ~150,060. It gave no protection
  // against the failure mode it exists to prevent: someone shortening the element/marker
  // arithmetic (a longer asset id, a longer species name, a raised `MAX_MAP_ELEMENTS`) and
  // silently making the cap too tight for legitimate large maps once the painting brushes ship.
  // This version actually builds that worst case as far as the real endpoint can be driven:
  //  - the three tile layers, unchanged: `fixedId(3)`/`fixedId(2)` alternated across every cell so
  //    no run compresses (both are passable ramps, so the whole grid bakes walkable);
  //  - as many elements as one `createMap` call can actually persist (see
  //    `ELEMENTS_PER_CREATE_CEILING` below — a real ceiling well short of `MAX_MAP_ELEMENTS`),
  //    using the catalogue's longest asset id, laid out on a grid spaced by that asset's own
  //    visual footprint so none overlap and none leave the map;
  //  - the full marker complement (`MAX_MAP_ENTRIES` + `MAX_MAP_EXITS` + `MAX_MAP_MONSTER_SPAWNS`,
  //    none of which hit that ceiling — see below), at 32-character ids, `MARKER_LABEL_MAX`-length
  //    labels, and the longest `MonsterSpecies` name, placed on a row the element grid never
  //    touches.
  // Residual gap: measured 156,322 bytes against the enumerated 196,233 (39,911 bytes short) —
  // short by the elements this fixture cannot place, not by anything `validateMapInput` refuses,
  // and still a real improvement on the ~150,050 bytes the old fixture reached with no elements
  // or markers at all. `elementRows`
  // (server/maps.ts) inserts one `map_element` row per element in a single multi-row INSERT, 5
  // bound parameters each (mapId, col, row, kind, variant — server/db/schema.ts). D1 enforces at
  // most 100 bound parameters per query, so a single `createMap` call can carry at most
  // `Math.floor(100 / 5)` = 20 elements before D1 itself refuses the batch with "too many SQL
  // variables" — independently of `MAX_MAP_ELEMENTS` (400) and of this test. No existing test had
  // ever created a map with more than a handful of elements, so nothing had exercised this before.
  // Chunking the elements insert would fix it, but that is a separate, pre-existing bug from the
  // byte cap this test protects, and out of scope here. Markers carry no equivalent ceiling: the
  // whole `MapMarkers` value is one JSON string in the `map` row itself, not one row per marker.
  // Under the old 32 KiB cap this body would already 413 with no diagnostic the editor could
  // explain, even though it is a legitimate map. It must be accepted.
  it("accepts a near-worst-case 100x100 map with maximal elements and markers that would have 413'd under the old 32 KiB cap", async () => {
    // See the residual-gap note above: this is D1's real per-query bound-parameter ceiling
    // (100) divided by the 5 parameters `elementRows` binds per element row, not `MAX_MAP_ELEMENTS`.
    const ELEMENTS_PER_CREATE_CEILING = 20;
    const cols = 100;
    const rows = 100;
    const cells = cols * rows;
    const idA = fixedId(3);
    const idB = fixedId(2);
    const alternating = (spawnOverride: number): number[] => {
      const ids = Array.from({ length: cells }, (_, i) => (i % 2 === 0 ? idA : idB));
      ids[0] = spawnOverride;
      return ids;
    };
    // Spawn sits at (0, 0) — index 0. Ground gets a real passable grass tile id (1) there; the
    // other two layers get EMPTY_TILE so the collision sweep skips them and the spawn stays
    // walkable, exactly like an authored map would need.
    const ground: TileLayer = { cols, rows, ids: alternating(1) };
    const elevation: TileLayer = { cols, rows, ids: alternating(0) };
    const objects: TileLayer = { cols, rows, ids: alternating(0) };
    const layers = [ground, elevation, objects].map(encodeTileLayer);

    // The longest asset id in the shipped catalogue, and its own visual footprint — used (not
    // hardcoded) so this keeps working if the catalogue's longest id or its footprint changes.
    const longestAssetId = EDITOR_ASSETS.reduce((longest, asset) =>
      asset.id.length > longest.id.length ? asset : longest,
    ).id;
    const longestAsset = editorAsset(longestAssetId);
    if (!longestAsset) throw new Error("expected the longest catalogue asset id to resolve");
    const footprint = longestAsset.editor.visualFootprint;
    const minColOffset = Math.min(...footprint.map((cell) => cell.col));
    const maxColOffset = Math.max(...footprint.map((cell) => cell.col));
    const minRowOffset = Math.min(...footprint.map((cell) => cell.row));
    const maxRowOffset = Math.max(...footprint.map((cell) => cell.row));
    // One empty cell of margin around the footprint's own bounding box is enough to guarantee no
    // two placements' visual cells can ever collide, regardless of the footprint's exact shape.
    const colStep = maxColOffset - minColOffset + 2;
    const rowStep = maxRowOffset - minRowOffset + 2;
    const colStart = Math.max(10, -minColOffset);
    const rowStart = Math.max(10, -minRowOffset);

    const elements: { col: number; row: number; assetId: string }[] = [];
    const touchedRows = new Set<number>();
    outer: for (let r = rowStart; r + maxRowOffset < rows; r += rowStep) {
      for (let c = colStart; c + maxColOffset < cols; c += colStep) {
        if (elements.length >= ELEMENTS_PER_CREATE_CEILING) break outer;
        elements.push({ col: c, row: r, assetId: longestAssetId });
      }
      for (let rr = r + minRowOffset; rr <= r + maxRowOffset; rr += 1) touchedRows.add(rr);
    }
    if (elements.length < ELEMENTS_PER_CREATE_CEILING) {
      throw new Error("fixture bug: could not fit ELEMENTS_PER_CREATE_CEILING on a 100x100 grid");
    }
    // A row the element grid never touches, for the marker complement below.
    let freeRow = -1;
    for (let r = rowStart; r < rows; r += 1) {
      if (!touchedRows.has(r)) {
        freeRow = r;
        break;
      }
    }
    if (freeRow < 0) throw new Error("fixture bug: no free row left for markers");

    const longestSpecies = (Object.keys(MONSTER_SPECIES_KIND) as MonsterSpecies[]).reduce(
      (longest, species) => (species.length > longest.length ? species : longest),
    );
    const markerIdChar = (n: number): string => String.fromCharCode(97 + (n % 26));
    const markerId = (prefix: string, index: number): string => {
      let id = `${prefix}${index}`;
      while (id.length < 32) id += markerIdChar(id.length);
      return id.slice(0, 32);
    };
    const label = "l".repeat(MARKER_LABEL_MAX);
    const entries = Array.from({ length: MAX_MAP_ENTRIES }, (_, i) => ({
      id: markerId("entry-", i),
      label,
      col: 10 + i,
      row: freeRow,
    }));
    const exits = Array.from({ length: MAX_MAP_EXITS }, (_, i) => ({
      id: markerId("exit-", i),
      label,
      col: 20 + i,
      row: freeRow,
    }));
    const monsterSpawns = Array.from({ length: MAX_MAP_MONSTER_SPAWNS }, (_, i) => ({
      col: 30 + i,
      row: freeRow,
      species: longestSpecies,
      patrolRadius: 768,
    }));

    // Events dominate the re-derived worst case (see MAX_MAP_JSON_BYTES in server/index.ts): the
    // full MAX_EVENTS_PER_MAP x MAX_PAGES_PER_EVENT complement, every page field at its widest —
    // 4-digit condition ids, a 10-digit variable threshold, the longest catalogue graphic id, the
    // longest move type and trigger, all five options true, AND a tranche-5 command program built
    // from the widest single node (a `choices` with a max-length prompt and MAX_CHOICE_OPTIONS
    // max-length labels). The theoretical 200-node page is far past this cap (see the comment on
    // MAX_MAP_JSON_BYTES — it exceeds Worker memory), so this drives several such nodes per page,
    // enough to prove the commands column is exercised and the body clears 400 KiB while staying
    // memory-safe under the new 4 MiB cap. Events float above collision, so their cells are
    // unconstrained; one per column on a single row keeps them distinct and in bounds. createMap
    // chunks these into D1-safe INSERTs (commands are one TEXT param each), so this drives that path.
    const maxText = "x".repeat(COMMAND_TEXT_MAX);
    const maxWidthChoice = () => ({
      t: "choices",
      prompt: maxText,
      options: Array.from({ length: MAX_CHOICE_OPTIONS }, () => ({ label: maxText, body: [] })),
    });
    const maxWidthCommands = Array.from({ length: 4 }, maxWidthChoice);
    const maxWidthPage = (): Record<string, unknown> => ({
      condSwitchId: "9999",
      condVariableId: "9999",
      condVariableMin: 2_147_483_647,
      condSelfSwitch: "A",
      graphicAssetId: longestAssetId,
      moveType: "approach",
      moveSpeed: 5,
      moveFreq: 4,
      optMoveAnim: true,
      optStopAnim: true,
      optDirFix: true,
      optThrough: true,
      optOnTop: true,
      trigger: "player-touch",
      commands: maxWidthCommands,
    });
    const events = Array.from({ length: MAX_EVENTS_PER_MAP }, (_, i) => ({
      id: crypto.randomUUID(),
      col: i,
      row: rows - 5,
      name: "e".repeat(EVENT_NAME_MAX),
      ordinal: i,
      pages: Array.from({ length: MAX_PAGES_PER_EVENT }, maxWidthPage),
    }));

    const bodyText = JSON.stringify(
      mapBody({
        name: "W".repeat(48),
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols,
        rows,
        layers,
        elements,
        markers: { entries, exits, monsterSpawns },
        events,
      }),
    );
    // Sanity on the fixture: the command payload lifts it past 2 MB — well beyond the ~385 KB
    // events+elements+markers body — proving the tranche-5 commands arithmetic is exercised, and
    // still under the re-derived 4 MiB cap with headroom.
    expect(bodyText.length).toBeGreaterThan(2_000_000);
    expect(bodyText.length).toBeLessThan(4_194_304);

    const id = await newMapId(await newAdventure());
    const response = await authed(`/api/maps/${id}`, { method: "PUT", body: bodyText });
    expect(response.status).toBe(200);
  });

  it("413s a body over the re-derived 4 MiB cap, padded via elements since name is capped at 48", async () => {
    // ~46 bytes/element x 100,000 clears the 4,194,304-byte cap by a wide margin, so `readJson` 413s
    // on the byte stream before any semantic gate runs. (The old 400 KiB cap grew 10x once tranche 5
    // added per-page command programs — see MAX_MAP_JSON_BYTES.)
    const id = await newMapId(await newAdventure());
    const elements = Array.from({ length: 100_000 }, (_, i) => ({
      col: 0,
      row: 0,
      kind: "tree",
      variant: i,
    }));
    const response = await putMap(id, mapBody({ elements }));
    expect(response.status).toBe(413);
  });

  it("400s map_elements just over the element cap, before the body would 413", async () => {
    // 401 in-bounds elements: small enough to clear the byte cap, so the element cap is what
    // answers — a legible 400 rather than a mute 413.
    const id = await newMapId(await newAdventure());
    const elements = Array.from({ length: 401 }, (_, i) => ({
      col: i % MAP_COLS,
      row: i % MAP_ROWS,
      kind: "bush",
      variant: 0,
    }));
    const response = await putMap(id, mapBody({ elements }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_elements" });
  });

  it("rejects an event count exceeding the limit", async () => {
    const id = await newMapId(await newAdventure());
    const events = Array.from({ length: MAX_EVENTS_PER_MAP + 1 }, (_, i) => ({
      id: crypto.randomUUID(),
      col: i % MAP_COLS,
      row: i % MAP_ROWS,
      name: `Event ${i}`,
      ordinal: i + 1,
      pages: [wirePage()],
    }));
    const response = await putMap(id, mapBody({ events }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_invalid" });
  });
});
