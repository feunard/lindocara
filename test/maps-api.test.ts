/**
 * The maps CRUD API: create, list, read, update, delete and flip the front-door flag, all gated by
 * a session and nothing else. Drives the real Worker through SELF.fetch, the same
 * register-and-cookie pattern as worker.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_MAP_ID } from "../src/server/maps.js";
import { SESSION_COOKIE } from "../src/server/session.js";
import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "../src/shared/game.js";
import {
  MARKER_LABEL_MAX,
  MAX_MAP_ENTRIES,
  MAX_MAP_EXITS,
  MAX_MAP_MONSTER_SPAWNS,
} from "../src/shared/map-data.js";
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
    spawn: { col: 0, row: 0 },
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
// change what resolveMapFor() returns for an unrelated test elsewhere. Elements before maps (FK).
afterEach(async () => {
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

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

describe("create, list, get, update, delete", () => {
  it("round-trips a map through the whole lifecycle", async () => {
    // A second map keeps the world non-empty so the one under test can actually be deleted.
    await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ name: "Keepalive" })),
    });

    const createRes = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ name: "Round Trip" })),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    // The response is a legal PUT body: same encoded layers back out as went in.
    expect(created).toMatchObject({
      name: "Round Trip",
      ...layeredWireTerrain(validBlocks()),
      elements: [],
      spawn: { col: 0, row: 0 },
    });
    expect(typeof created.id).toBe("string");

    const listRes = await authed("/api/maps");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; name: string }[];
    expect(list.find((m) => m.id === created.id)).toMatchObject({ name: "Round Trip" });

    const getRes = await authed(`/api/maps/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched).toMatchObject({ id: created.id, name: "Round Trip" });

    // The invariant `src/server/index.ts:509-512` claims: a GET response is a legal PUT body,
    // verbatim, with no re-encode step in between. Feed it straight back rather than re-deriving
    // a fresh body — that is exactly the case that broke when `parseMapBody` used to flatten
    // layers back to `blocks` before storing.
    const echoRes = await authed(`/api/maps/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(fetched),
    });
    expect(echoRes.status).toBe(200);
    // Same content came back — only `revision` legitimately moved, because this PUT is itself a
    // successful update.
    expect(await echoRes.json()).toMatchObject({ id: created.id, name: "Round Trip" });

    const updateRes = await authed(`/api/maps/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(mapBody({ name: "Renamed" })),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toMatchObject({ id: created.id, name: "Renamed" });

    const deleteRes = await authed(`/api/maps/${created.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await authed(`/api/maps/${created.id}`);
    expect(afterDelete.status).toBe(404);
    expect(await afterDelete.json()).toEqual({ error: "map_not_found" });
  });

  it("keeps maps private and hides foreign mutations as not found", async () => {
    const created = (await (
      await authed("/api/maps", {
        method: "POST",
        body: JSON.stringify(mapBody({ name: "Private" })),
      })
    ).json()) as { id: string };
    const rival = await register();

    expect(await (await authed("/api/maps", {}, rival)).json()).toEqual([]);
    expect((await authed(`/api/maps/${created.id}`, {}, rival)).status).toBe(404);
    expect(
      (
        await authed(
          `/api/maps/${created.id}`,
          { method: "PUT", body: JSON.stringify(mapBody({ name: "Stolen" })) },
          rival,
        )
      ).status,
    ).toBe(404);
    expect((await authed(`/api/maps/${created.id}`, { method: "DELETE" }, rival)).status).toBe(404);
    expect(await (await authed(`/api/maps/${created.id}`)).json()).toMatchObject({
      name: "Private",
      revision: 1,
    });
  });

  it("increments revision only after a successful update", async () => {
    const created = (await (
      await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody()) })
    ).json()) as { id: string; revision: number };
    expect(created.revision).toBe(1);

    const refused = await authed(`/api/maps/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(mapBody({ name: " " })),
    });
    expect(refused.status).toBe(400);
    expect(await (await authed(`/api/maps/${created.id}`)).json()).toMatchObject({ revision: 1 });

    const updated = await authed(`/api/maps/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(mapBody({ name: "Revision two" })),
    });
    expect(await updated.json()).toMatchObject({ revision: 2 });
  });
});

describe("validation", () => {
  it("rejects a tree standing in the water", async () => {
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ elements: [{ col: 1, row: 1, kind: "tree", variant: 0 }] })),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_placement" });
  });

  it("rejects a map smaller than the size floor", async () => {
    const tiny = Array.from({ length: 5 }, () => ".".repeat(5));
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ ...layeredWireTerrain(tiny), spawn: { col: 0, row: 0 } })),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_size" });
  });

  it("rejects a blank name", async () => {
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ name: "   " })),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_name" });
  });

  it("rejects a shape parseMapData cannot make sense of", async () => {
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Shape",
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols: 20,
        rows: 15,
        layers: "nope",
        elements: [],
        spawn: { col: 0, row: 0 },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_invalid" });
  });

  it("rejects a body with no name at all", async () => {
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify({ blocks: validBlocks(), elements: [], spawn: { col: 0, row: 0 } }),
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

    const put = await authed(`/api/maps/${BUILTIN_MAP_ID}`, {
      method: "PUT",
      body: JSON.stringify(mapBody()),
    });
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
    await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody()) });
    const list = (await (await authed("/api/maps")).json()) as { id: string }[];
    expect(list.map((m) => m.id)).not.toContain(BUILTIN_MAP_ID);
  });
});

describe("the front door", () => {
  it("hands the flag to a survivor when the flagged map is deleted", async () => {
    const one = (await (
      await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody({ name: "One" })) })
    ).json()) as { id: string };
    const two = (await (
      await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody({ name: "Two" })) })
    ).json()) as { id: string };

    await authed(`/api/maps/${one.id}`, { method: "DELETE" });

    const list = (await (await authed("/api/maps")).json()) as { id: string; isFirst: boolean }[];
    expect(list.find((m) => m.id === two.id)?.isFirst).toBe(true);
  });

  it("moves the flag on POST /:id/first", async () => {
    const one = (await (
      await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody({ name: "One" })) })
    ).json()) as { id: string };
    const two = (await (
      await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody({ name: "Two" })) })
    ).json()) as { id: string };

    const flip = await authed(`/api/maps/${two.id}/first`, { method: "POST" });
    expect(flip.status).toBe(204);

    const list = (await (await authed("/api/maps")).json()) as { id: string; isFirst: boolean }[];
    expect(list.find((m) => m.id === two.id)?.isFirst).toBe(true);
    expect(list.find((m) => m.id === one.id)?.isFirst).toBe(false);
  });
});

describe("the last map", () => {
  it("refuses to delete the only map", async () => {
    const created = (await (
      await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody()) })
    ).json()) as { id: string };
    const deleteRes = await authed(`/api/maps/${created.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(409);
    expect(await deleteRes.json()).toEqual({ error: "last_map" });
  });
});

describe("size caps over the wire", () => {
  it("accepts a maximal 100x100 map", async () => {
    const blocks = Array.from({ length: 100 }, () => ".".repeat(100));
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(
        mapBody({ name: "Maximal", ...layeredWireTerrain(blocks), spawn: { col: 0, row: 0 } }),
      ),
    });
    expect(response.status).toBe(201);
  });

  // `MAX_MAP_JSON_BYTES` (src/server/index.ts) is sized against the enumerated worst case: max-
  // length, non-compressible layers, `MAX_MAP_ELEMENTS` elements at the longest catalogue asset
  // id, and the full entry/exit/monster-spawn marker complement at their id/label caps with the
  // longest `MonsterSpecies` name. The old version of this test defaulted to `elements: []` and no
  // markers, so it only ever posted ~150,050 bytes — nowhere near the 196,233-byte worst case or
  // the 204,800 cap — and would have passed under any cap above ~150,060. It gave no protection
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

    const bodyText = JSON.stringify(
      mapBody({
        name: "W".repeat(48),
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols,
        rows,
        layers,
        elements,
        markers: { entries, exits, monsterSpawns },
      }),
    );
    // Sanity on the fixture itself: measurably past what the old (elements-less, marker-less)
    // fixture reached (~150,050 bytes) — proving this one actually exercises the element and
    // marker arithmetic — and still comfortably under the cap.
    expect(bodyText.length).toBeGreaterThan(155_000);
    expect(bodyText.length).toBeLessThan(204_800);

    const response = await authed("/api/maps", { method: "POST", body: bodyText });
    expect(response.status).toBe(201);
  });

  it("413s a body over the new 200 KiB cap, padded via elements since name is capped at 48", async () => {
    const elements = Array.from({ length: 5_000 }, (_, i) => ({
      col: 0,
      row: 0,
      kind: "tree",
      variant: i,
    }));
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ elements })),
    });
    expect(response.status).toBe(413);
  });

  it("400s map_elements just over the element cap, before the body would 413", async () => {
    // 401 in-bounds elements: small enough to clear the byte cap, so the element cap is what
    // answers — a legible 400 rather than a mute 413.
    const elements = Array.from({ length: 401 }, (_, i) => ({
      col: i % MAP_COLS,
      row: i % MAP_ROWS,
      kind: "bush",
      variant: 0,
    }));
    const response = await authed("/api/maps", {
      method: "POST",
      body: JSON.stringify(mapBody({ elements })),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "map_elements" });
  });
});
