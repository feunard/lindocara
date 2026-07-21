/**
 * The adventures CRUD API over SELF.fetch: session gate, ownership scoping, graph validation codes,
 * and the not-found shape, under the UX-wave 1-adventure model. An adventure is POSTed as a draft;
 * its maps are created inside it and authored via PUT; the graph is saved with a later PUT.
 * Register-and-cookie pattern from maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { createAdventure } from "@lindocara/server/adventures.js";
import { createDb } from "@lindocara/server/db/index.js";
import { SESSION_COOKIE } from "@lindocara/server/session.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { layeredWireTerrain } from "./support/map-fixtures.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

// UX wave #12: the graph binds entry/exit EVENT uuids. Map A and map B use distinct uuid families
// because a `map_event` id is a global primary key — two maps must never reuse the same event uuid.
const ENTRY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const EXIT_A = "aaaaaaaa-0000-4000-8000-000000000002";
const ENTRY_B = "bbbbbbbb-0000-4000-8000-000000000001";
const EXIT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function ev(id: string, kind: "entry" | "exit", col: number, row: number): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 0, kind });
}

function eventsA(): MapEvent[] {
  return [ev(ENTRY_A, "entry", 5, 5), ev(EXIT_A, "exit", 7, 7)];
}

function eventsB(): MapEvent[] {
  return [ev(ENTRY_B, "entry", 5, 5), ev(EXIT_B, "exit", 7, 7)];
}

function mapBody(name: string, events: MapEvent[] = eventsA()): Record<string, unknown> {
  return {
    name,
    ...layeredWireTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
    events,
  };
}

let cookie = "";
let userCount = 0;

async function register(): Promise<string> {
  userCount += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `advapi${userCount}`, password: "12345678" }),
  });
  const value = (response.headers.get("Set-Cookie") ?? "").split(";")[0]?.split("=")[1];
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

/**
 * A DRAFT adventure with NO maps, seeded directly through the server function. The HTTP POST is now
 * atomic (it creates a default first map + a born graph, covered by its own test below); the
 * authoring/validation tests here start from an empty adventure and create their own maps, so they
 * seed the draft directly. Owner resolved from the cookie via `/api/me`.
 */
async function createDraft(asCookie = cookie): Promise<string> {
  const me = (await (await authed("/api/me", {}, asCookie)).json()) as { id: string };
  const adv = await createAdventure(createDb(env.DB), me.id, { title: "Donjon", maxPlayers: 4 });
  return adv.id;
}

/** Create a template map inside the adventure and author `body` onto it, returning its id. */
async function authorMap(
  adventureId: string,
  body: Record<string, unknown>,
  asCookie = cookie,
): Promise<string> {
  const created = await authed(
    "/api/maps",
    { method: "POST", body: JSON.stringify({ adventureId, name: body.name }) },
    asCookie,
  );
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const put = await authed(
    `/api/maps/${id}`,
    { method: "PUT", body: JSON.stringify(body) },
    asCookie,
  );
  expect(put.status).toBe(200);
  return id;
}

function corridorGraph(mapA: string, mapB: string): Record<string, unknown> {
  return {
    start: { mapId: mapA, entryId: ENTRY_A },
    links: [
      { mapId: mapA, exitId: EXIT_A, dest: { mapId: mapB, entryId: ENTRY_B } },
      { mapId: mapB, exitId: EXIT_B, dest: "end" },
    ],
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("session gate", () => {
  it("401s every route without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/adventures"],
      ["POST", "/api/adventures"],
      ["GET", "/api/adventures/some-id"],
      ["PUT", "/api/adventures/some-id"],
      ["DELETE", "/api/adventures/some-id"],
    ];
    for (const [method, path] of routes) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, { method });
      expect(response.status).toBe(401);
    }
  });
});

describe("adventure lifecycle over the wire", () => {
  it("creates an adventure with a blank default map and a draft graph in one POST", async () => {
    const createRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      mapIds: string[];
      graph: { start: unknown; links: unknown[] };
      defaultMap: {
        id: string;
        events: MapEvent[];
      };
    };
    expect(created).toMatchObject({ title: "Donjon", maxPlayers: 4, version: 1 });
    // Atomic: exactly one default map, born GENUINELY BLANK — no auto-seeded entry/exit events (B2) —
    // so the born adventure is a DRAFT (no start, no links). Spawn/entry are explicit author choices;
    // an author places them and wires the graph later, never gated on a save.
    expect(created.mapIds).toHaveLength(1);
    const mapId = created.mapIds[0];
    expect(created.defaultMap.events).toEqual([]);
    expect(created.graph.start).toBeNull();
    expect(created.graph.links).toEqual([]);
    expect(created.defaultMap.id).toBe(mapId);

    // The D1 rows exist: one adventure, exactly one map owned by it, and no event rows for it.
    const advRows = await env.DB.prepare("SELECT id FROM adventure WHERE id = ?")
      .bind(created.id)
      .all();
    expect(advRows.results).toHaveLength(1);
    const mapRows = await env.DB.prepare("SELECT id FROM map WHERE adventure_id = ?")
      .bind(created.id)
      .all();
    expect(mapRows.results.map((r) => r.id)).toEqual([mapId]);
    const eventRows = await env.DB.prepare("SELECT id FROM map_event WHERE map_id = ?")
      .bind(mapId)
      .all();
    expect(eventRows.results).toHaveLength(0);
  });

  it("authors maps and saves the graph, then deletes", async () => {
    const advId = await createDraft();

    const mapA = await authorMap(advId, mapBody("A"));
    const mapB = await authorMap(advId, mapBody("B", eventsB()));

    const graphRes = await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });
    expect(graphRes.status).toBe(200);
    expect(await graphRes.json()).toMatchObject({ title: "Donjon", mapIds: [mapA, mapB] });

    const listRes = await authed("/api/adventures");
    expect(await listRes.json()).toEqual([
      { id: advId, title: "Donjon", maxPlayers: 4, mapCount: 2, playable: true },
    ]);

    const getRes = await authed(`/api/adventures/${advId}`);
    expect(getRes.status).toBe(200);

    const created = { id: advId };

    const updateRes = await authed(`/api/adventures/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Renamed", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()) as object).toMatchObject({ title: "Renamed" });

    const deleteRes = await authed(`/api/adventures/${created.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
    const gone = await authed(`/api/adventures/${created.id}`);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "adventure_not_found" });
  });

  it("answers machine codes for invalid bodies and graphs", async () => {
    const invalid = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify({ nope: true }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "adventure_invalid" });

    // Title and player count are gated at create time.
    expect(
      await (
        await authed("/api/adventures", {
          method: "POST",
          body: JSON.stringify({ title: " ", maxPlayers: 4 }),
        })
      ).json(),
    ).toEqual({ error: "adventure_title" });
    expect(
      await (
        await authed("/api/adventures", {
          method: "POST",
          body: JSON.stringify({ title: "T", maxPlayers: 9 }),
        })
      ).json(),
    ).toEqual({ error: "adventure_players" });

    // Graph integrity is gated on the PUT, against the adventure's own maps. Completeness is NOT: a
    // partially-wired graph (map B's exit left unbound, no reachable ending) now SAVES.
    const advId = await createDraft();
    const mapA = await authorMap(advId, mapBody("A"));
    const mapB = await authorMap(advId, mapBody("B", eventsB()));

    const partial = await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: {
          start: { mapId: mapA, entryId: ENTRY_A },
          links: [{ mapId: mapA, exitId: EXIT_A, dest: { mapId: mapB, entryId: ENTRY_B } }],
        },
      }),
    });
    expect(partial.status).toBe(200);

    // A graph naming a map the adventure does not own is a foreign reference — still refused.
    const foreign = await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: { start: { mapId: "ghostmap", entryId: ENTRY_A }, links: [] },
      }),
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "adventure_graph" });
  });

  it("hides other accounts' adventures and refuses referencing their maps", async () => {
    const advId = await createDraft();
    const mapA = await authorMap(advId, mapBody("A"));
    const mapB = await authorMap(advId, mapBody("B", eventsB()));
    await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });

    const rival = await register();
    expect(await (await authed("/api/adventures", {}, rival)).json()).toEqual([]);
    expect((await authed(`/api/adventures/${advId}`, {}, rival)).status).toBe(404);
    expect(
      (
        await authed(
          `/api/adventures/${advId}`,
          {
            method: "PUT",
            body: JSON.stringify({
              title: "Steal",
              maxPlayers: 4,
              graph: corridorGraph(mapA, mapB),
            }),
          },
          rival,
        )
      ).status,
    ).toBe(404);
    expect((await authed(`/api/adventures/${advId}`, { method: "DELETE" }, rival)).status).toBe(
      404,
    );

    // The rival's own adventure cannot bind another account's maps: they are not its members.
    const rivalAdv = await createDraft(rival);
    const foreign = await authed(
      `/api/adventures/${rivalAdv}`,
      {
        method: "PUT",
        body: JSON.stringify({ title: "Theft", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
      },
      rival,
    );
    expect(foreign.status).toBe(400);
    // The rival's adventure owns no maps, so the graph's start (and links) name non-member maps — a
    // dangling reference, refused as a graph integrity error.
    expect(await foreign.json()).toEqual({ error: "adventure_graph" });
  });

  it("accepts a realistic 16-map graph with all 128 exits through the HTTP boundary", {
    timeout: 15_000,
  }, async () => {
    const advId = await createDraft();
    // Each map carries one entry EVENT and eight exit EVENTS. Event uuids are minted per map and
    // per event because a `map_event` id is a global primary key — all 144 must be distinct.
    const maps: { id: string; entryId: string; exitIds: string[] }[] = [];
    for (let mapIndex = 0; mapIndex < 16; mapIndex += 1) {
      const entryId = crypto.randomUUID();
      const exitIds = Array.from({ length: 8 }, () => crypto.randomUUID());
      const events: MapEvent[] = [
        functionalEvent({ id: entryId, col: 1, row: 1, ordinal: 1, kind: "entry" }),
        ...exitIds.map((id, exitIndex) =>
          functionalEvent({ id, col: 2 + exitIndex, row: 2, ordinal: 2 + exitIndex, kind: "exit" }),
        ),
      ];
      const id = await authorMap(advId, mapBody(`Max ${mapIndex}`, events));
      maps.push({ id, entryId, exitIds });
    }

    const links = maps.flatMap((meta, mapIndex) => {
      const next = maps[mapIndex + 1];
      return meta.exitIds.map((exitId, exitIndex) => ({
        mapId: meta.id,
        exitId,
        dest: exitIndex === 0 && next ? { mapId: next.id, entryId: next.entryId } : "end",
      }));
    });
    const first = maps[0];
    if (!first) throw new Error("expected at least one map");
    const body = {
      title: "Maximum realistic graph",
      maxPlayers: 4,
      graph: { start: { mapId: first.id, entryId: first.entryId }, links },
    };
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThan(65_536);

    const response = await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { graph: { links: unknown[] } }).graph.links).toHaveLength(
      128,
    );
  });
});
