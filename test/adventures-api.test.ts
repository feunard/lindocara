/**
 * The adventures CRUD API over SELF.fetch: session gate, ownership scoping, graph validation
 * codes, and the not-found shape. Register-and-cookie pattern from maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapBody(name: string): Record<string, unknown> {
  return {
    name,
    blocks: blocks(),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: {
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

async function createTwoMaps(): Promise<[string, string]> {
  const a = await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody("A")) });
  const b = await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody("B")) });
  const idA = ((await a.json()) as { id: string }).id;
  const idB = ((await b.json()) as { id: string }).id;
  return [idA, idB];
}

function adventureBody(
  mapA: string,
  mapB: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Donjon",
    maxPlayers: 4,
    mapIds: [mapA, mapB],
    graph: {
      start: { mapId: mapA, entryId: "door" },
      links: [
        { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
        { mapId: mapB, exitId: "gate", dest: "end" },
      ],
    },
    ...overrides,
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM adventure_map");
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
  it("round-trips create, list, get, update, delete", async () => {
    const [mapA, mapB] = await createTwoMaps();

    const createRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB)),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    expect(created).toMatchObject({
      title: "Donjon",
      maxPlayers: 4,
      version: 1,
      mapIds: [mapA, mapB],
    });

    const listRes = await authed("/api/adventures");
    expect(await listRes.json()).toEqual([{ id: created.id, title: "Donjon", maxPlayers: 4 }]);

    const getRes = await authed(`/api/adventures/${created.id}`);
    expect(getRes.status).toBe(200);

    const updateRes = await authed(`/api/adventures/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(adventureBody(mapA, mapB, { title: "Renamed" })),
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
    const [mapA, mapB] = await createTwoMaps();

    const invalid = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify({ nope: true }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "adventure_invalid" });

    const unbound = adventureBody(mapA, mapB);
    (unbound.graph as { links: unknown[] }).links = [
      { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
    ];
    const graphRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(unbound),
    });
    expect(graphRes.status).toBe(400);
    expect(await graphRes.json()).toEqual({ error: "adventure_graph" });

    const titleRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB, { title: " " })),
    });
    expect(await titleRes.json()).toEqual({ error: "adventure_title" });

    const playersRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB, { maxPlayers: 9 })),
    });
    expect(await playersRes.json()).toEqual({ error: "adventure_players" });

    const mapsRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB, { mapIds: [mapA, "ghost"] })),
    });
    expect(await mapsRes.json()).toEqual({ error: "adventure_maps" });
  });

  it("hides other accounts' adventures", async () => {
    const [mapA, mapB] = await createTwoMaps();
    const createRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB)),
    });
    const created = (await createRes.json()) as { id: string };

    const rival = await register();
    expect(await (await authed("/api/adventures", {}, rival)).json()).toEqual([]);
    expect((await authed(`/api/adventures/${created.id}`, {}, rival)).status).toBe(404);
    expect(
      (await authed(`/api/adventures/${created.id}`, { method: "DELETE" }, rival)).status,
    ).toBe(404);
  });
});
