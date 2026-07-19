/**
 * The adventures CRUD API over SELF.fetch: session gate, ownership scoping, graph validation codes,
 * and the not-found shape, under the UX-wave 1-adventure model. An adventure is POSTed as a draft;
 * its maps are created inside it and authored via PUT; the graph is saved with a later PUT.
 * Register-and-cookie pattern from maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";
import { layeredWireTerrain } from "./support/map-fixtures.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapBody(name: string, markers?: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    ...layeredWireTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: markers ?? {
      entries: [{ id: "door", col: 5, row: 5 }],
      exits: [{ id: "gate", col: 7, row: 7 }],
      monsterSpawns: [],
    },
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

/** A draft adventure over the wire, returning its id. */
async function createDraft(asCookie = cookie): Promise<string> {
  const res = await authed(
    "/api/adventures",
    { method: "POST", body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }) },
    asCookie,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
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
    start: { mapId: mapA, entryId: "door" },
    links: [
      { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
      { mapId: mapB, exitId: "gate", dest: "end" },
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
  it("creates a draft, then authors maps and saves the graph, then deletes", async () => {
    const createRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; mapIds: string[]; graph: unknown };
    expect(created).toMatchObject({ title: "Donjon", maxPlayers: 4, version: 1, mapIds: [] });
    expect(created.graph).toEqual({ start: null, links: [] });

    const mapA = await authorMap(created.id, mapBody("A"));
    const mapB = await authorMap(created.id, mapBody("B"));

    const graphRes = await authed(`/api/adventures/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });
    expect(graphRes.status).toBe(200);
    expect(await graphRes.json()).toMatchObject({ title: "Donjon", mapIds: [mapA, mapB] });

    const listRes = await authed("/api/adventures");
    expect(await listRes.json()).toEqual([{ id: created.id, title: "Donjon", maxPlayers: 4 }]);

    const getRes = await authed(`/api/adventures/${created.id}`);
    expect(getRes.status).toBe(200);

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

    // Graph validation is gated on the PUT, against the adventure's own maps.
    const advId = await createDraft();
    const mapA = await authorMap(advId, mapBody("A"));
    const mapB = await authorMap(advId, mapBody("B"));

    const unbound = await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: {
          start: { mapId: mapA, entryId: "door" },
          links: [{ mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } }],
        },
      }),
    });
    expect(unbound.status).toBe(400);
    expect(await unbound.json()).toEqual({ error: "adventure_graph" });

    // A graph naming a map the adventure does not own is a foreign reference.
    const foreign = await authed(`/api/adventures/${advId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: { start: { mapId: "ghostmap", entryId: "door" }, links: [] },
      }),
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "adventure_graph" });
  });

  it("hides other accounts' adventures and refuses referencing their maps", async () => {
    const advId = await createDraft();
    const mapA = await authorMap(advId, mapBody("A"));
    const mapB = await authorMap(advId, mapBody("B"));
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
    // The rival's adventure owns no maps, so a graph over another account's maps has no members.
    expect(await foreign.json()).toEqual({ error: "adventure_maps" });
  });

  it("accepts a realistic 16-map graph with all 128 exits through the HTTP boundary", async () => {
    const advId = await createDraft();
    const markers = {
      entries: [{ id: "entry", col: 1, row: 1 }],
      exits: Array.from({ length: 8 }, (_, exitIndex) => ({
        id: `exit-${exitIndex}`,
        col: 2 + exitIndex,
        row: 2,
      })),
      monsterSpawns: [],
    };
    const mapIds: string[] = [];
    for (let mapIndex = 0; mapIndex < 16; mapIndex += 1) {
      mapIds.push(await authorMap(advId, mapBody(`Max ${mapIndex}`, markers)));
    }

    const links = mapIds.flatMap((mapId, mapIndex) =>
      Array.from({ length: 8 }, (_, exitIndex) => ({
        mapId,
        exitId: `exit-${exitIndex}`,
        dest:
          exitIndex === 0 && mapIndex < mapIds.length - 1
            ? { mapId: mapIds[mapIndex + 1], entryId: "entry" }
            : "end",
      })),
    );
    const body = {
      title: "Maximum realistic graph",
      maxPlayers: 4,
      graph: { start: { mapId: mapIds[0], entryId: "entry" }, links },
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
