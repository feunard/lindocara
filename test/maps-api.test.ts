/**
 * The maps CRUD API: create, list, read, update, delete and flip the front-door flag, all gated by
 * a session and nothing else. Drives the real Worker through SELF.fetch, the same
 * register-and-cookie pattern as worker.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_MAP_ID } from "../src/server/maps.js";
import { SESSION_COOKIE } from "../src/server/session.js";
import { encodeTileLayer, type TileLayer } from "../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";
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

  // `MAX_MAP_JSON_BYTES` (src/server/index.ts) is sized against this exact worst case: a 100x100
  // map whose layers cannot run-length compress at all. Two ids near `Number.MAX_SAFE_INTEGER`,
  // alternated across every cell so no two neighbours match, push each layer close to the
  // `cols * rows * 17 - 1` ceiling `parseTileLayer` actually allows. Under the old 32 KiB cap this
  // body — ~510 KB once encoded — would 413 with no diagnostic the editor could explain, even
  // though it is a legitimate map. It must now be accepted.
  it("accepts a near-worst-case, non-compressible 100x100 map that would have 413'd under the old 32 KiB cap", async () => {
    const cols = 100;
    const rows = 100;
    const cells = cols * rows;
    const idA = Number.MAX_SAFE_INTEGER;
    const idB = Number.MAX_SAFE_INTEGER - 1;
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
    const bodyText = JSON.stringify(
      mapBody({ name: "Worst Case", tilesetId: TINY_SWORDS_TILESET_ID, cols, rows, layers }),
    );
    // Sanity on the fixture itself: over the old cap, comfortably under the new one.
    expect(bodyText.length).toBeGreaterThan(32_768);
    expect(bodyText.length).toBeLessThan(589_824);

    const response = await authed("/api/maps", { method: "POST", body: bodyText });
    expect(response.status).toBe(201);
  });

  it("413s a body over the new 576 KiB cap, padded via elements since name is capped at 48", async () => {
    const elements = Array.from({ length: 13_000 }, (_, i) => ({
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
