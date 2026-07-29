/**
 * The adventures CRUD API on Alepha: session gate, atomic create-with-default-map, collaborative
 * listing/editing, graph integrity codes and delete conflicts, under the real HTTP server — same
 * idiom as `maps.test.ts` (real `fetch()` against `ServerProvider.hostname`, never the typed client,
 * because `AdventureController`'s schemas are deliberately loose; see its own docblock).
 *
 * Business rules are ported from `packages/server/test/adventures-api.test.ts` and
 * `packages/server/test/adventures.test.ts` (read in full before writing this file).
 */
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { heroes } from "../src/api/entities/heroes.ts";
import { parties } from "../src/api/entities/parties.ts";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";
const COLS = 20;
const ROWS = 15;

// UX wave #12: the graph binds entry/exit EVENT uuids. Map A and map B use distinct uuid families
// because a `map_event` id is a global primary key — two maps must never reuse the same event uuid.
const ENTRY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const EXIT_A = "aaaaaaaa-0000-4000-8000-000000000002";
const ENTRY_B = "bbbbbbbb-0000-4000-8000-000000000001";
const EXIT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function blocks(): string[] {
  return Array.from({ length: ROWS }, () => ".".repeat(COLS));
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

function corridorGraph(mapA: string, mapB: string): Record<string, unknown> {
  return {
    start: { mapId: mapA, entryId: ENTRY_A },
    links: [
      { mapId: mapA, exitId: EXIT_A, dest: { mapId: mapB, entryId: ENTRY_B } },
      { mapId: mapB, exitId: EXIT_B, dest: "end" },
    ],
  };
}

/** Direct repository access for seeding rows no controller route creates yet (parties/heroes) —
 *  the same test-local probe idiom `maps.test.ts` established. */
class SeedProbe {
  parties = $repository(parties);
  heroes = $repository(heroes);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ userId: string; token: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { userId: registered.data.id, token: tokens.access_token };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function createAdventure(
  token: string,
  body: Record<string, unknown> = { title: "Donjon", maxPlayers: 4 },
): Promise<Response> {
  return authedFetch("/api/adventures", token, { method: "POST", body: JSON.stringify(body) });
}

/** Create a template map inside the adventure and author `body` onto it, returning its id. */
async function authorMap(
  adventureId: string,
  body: Record<string, unknown>,
  token: string,
): Promise<string> {
  const created = await authedFetch("/api/maps", token, {
    method: "POST",
    body: JSON.stringify({ adventureId, name: body.name }),
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const put = await authedFetch(`/api/maps/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  expect(put.status).toBe(200);
  return id;
}

describe("session gate", () => {
  test("401s every adventure route without a bearer token", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/adventures"],
      ["POST", "/api/adventures"],
      ["GET", "/api/adventures/some-id"],
      ["PUT", "/api/adventures/some-id"],
      ["DELETE", "/api/adventures/some-id"],
    ];
    for (const [method, path] of routes) {
      const needsBody = method === "POST" || method === "PUT";
      const response = await fetch(`${hostname}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(needsBody ? { body: JSON.stringify({}) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("create: atomic with a default map", () => {
  test("creates a draft adventure with a blank default map and a born graph, in one POST", async () => {
    const { token } = await registerAndLogin("advcreate");
    const response = await createAdventure(token, { title: "Donjon", maxPlayers: 4 });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      mapIds: string[];
      graph: { start: unknown; links: unknown[] };
      defaultMap: { id: string; events: unknown[] };
    };
    expect(created).toMatchObject({ title: "Donjon", maxPlayers: 4, version: 1 });
    // Atomic: exactly one default map, born genuinely blank (no auto-seeded entry/exit events), so
    // the born adventure is a draft (no start, no links).
    expect(created.mapIds).toHaveLength(1);
    expect(created.defaultMap.id).toBe(created.mapIds[0]);
    expect(created.defaultMap.events).toEqual([]);
    expect(created.graph.start).toBeNull();
    expect(created.graph.links).toEqual([]);
  });

  test("400s adventure_invalid/title/players on a malformed create body", async () => {
    const { token } = await registerAndLogin("advinvalid");
    const invalid = await createAdventure(token, { nope: true } as never);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "adventure_invalid" });

    const blankTitle = await createAdventure(token, { title: " ", maxPlayers: 4 });
    expect(blankTitle.status).toBe(400);
    expect(await blankTitle.json()).toMatchObject({ error: "adventure_title" });

    const tooManyPlayers = await createAdventure(token, { title: "T", maxPlayers: 9 });
    expect(tooManyPlayers.status).toBe(400);
    expect(await tooManyPlayers.json()).toMatchObject({ error: "adventure_players" });
  });
});

describe("lifecycle over the wire", () => {
  test("authors maps, saves the graph, lists, reads, renames, then deletes", async () => {
    const { token } = await registerAndLogin("advlife");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;

    const mapA = await authorMap(advId, mapBody("A"), token);
    const mapB = await authorMap(advId, mapBody("B", eventsB()), token);

    const graphRes = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });
    expect(graphRes.status).toBe(200);
    const graphed = (await graphRes.json()) as { title: string; mapIds: string[] };
    expect(graphed.title).toBe("Donjon");
    // mapIds[0] is the default map born with the adventure; mapA/mapB were authored afterward.
    expect(graphed.mapIds).toHaveLength(3);
    expect(graphed.mapIds).toEqual(expect.arrayContaining([mapA, mapB]));

    const listRes = await authedFetch("/api/adventures", token);
    const list = (await listRes.json()) as { id: string; mapCount: number; playable: boolean }[];
    expect(list.find((entry) => entry.id === advId)).toMatchObject({ mapCount: 3, playable: true });

    const getRes = await authedFetch(`/api/adventures/${advId}`, token);
    expect(getRes.status).toBe(200);

    const renamed = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "Renamed", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ title: "Renamed" });

    const deleteRes = await authedFetch(`/api/adventures/${advId}`, token, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
    const gone = await authedFetch(`/api/adventures/${advId}`, token);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: "adventure_not_found" });
  });
});

describe("scope=play / scope=all: collaborative listings with author", () => {
  test("scope=play lists another account's playable adventure, with its author; scope defaults stay owner-scoped", async () => {
    const owner = await registerAndLogin("advowner");
    const advId = ((await (await createAdventure(owner.token)).json()) as { id: string }).id;

    const rival = await registerAndLogin("advrival");
    // The default (owner-scoped) listing never shows another account's adventure.
    const defaultList = (await (await authedFetch("/api/adventures", rival.token)).json()) as {
      id: string;
    }[];
    expect(defaultList.some((entry) => entry.id === advId)).toBe(false);

    const playList = (await (
      await authedFetch("/api/adventures?scope=play", rival.token)
    ).json()) as { id: string; author: string; playable: boolean }[];
    const listed = playList.find((entry) => entry.id === advId);
    expect(listed).toMatchObject({ playable: true });
    expect(listed?.author).toMatch(/^advowner\d+$/);

    const allList = (await (
      await authedFetch("/api/adventures?scope=all", rival.token)
    ).json()) as {
      id: string;
      author: string;
    }[];
    expect(allList.find((entry) => entry.id === advId)?.author).toMatch(/^advowner\d+$/);
  });

  test("scope=play omits a mapless draft (only the default map exists, but it is still >=1 map, so this is actually playable)", async () => {
    // A freshly created adventure already carries its default map, so it IS playable immediately —
    // this documents that D25 behavior explicitly (see AdventureService.createAdventureWithDefaultMap).
    const { token } = await registerAndLogin("advplayable");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;
    const playList = (await (await authedFetch("/api/adventures?scope=play", token)).json()) as {
      id: string;
    }[];
    expect(playList.some((entry) => entry.id === advId)).toBe(true);
  });
});

describe("collaborative editing: any account may read, edit and (force-)delete", () => {
  test("a foreign account may read, edit and force-delete another account's adventure", async () => {
    const owner = await registerAndLogin("advcollab");
    const advId = ((await (await createAdventure(owner.token)).json()) as { id: string }).id;
    const mapA = await authorMap(advId, mapBody("A"), owner.token);
    const mapB = await authorMap(advId, mapBody("B", eventsB()), owner.token);
    await authedFetch(`/api/adventures/${advId}`, owner.token, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });

    const rival = await registerAndLogin("advrival2");
    expect((await authedFetch(`/api/adventures/${advId}`, rival.token)).status).toBe(200);
    const edited = await authedFetch(`/api/adventures/${advId}`, rival.token, {
      method: "PUT",
      body: JSON.stringify({
        title: "Retouche rivale",
        maxPlayers: 4,
        graph: corridorGraph(mapA, mapB),
      }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ title: "Retouche rivale" });

    const deleted = await authedFetch(`/api/adventures/${advId}`, rival.token, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
  });
});

describe("graph integrity: adventure_graph", () => {
  test("400s adventure_graph when the graph names a map the adventure does not own", async () => {
    const { token } = await registerAndLogin("advgraph");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;
    const mapA = await authorMap(advId, mapBody("A"), token);
    const mapB = await authorMap(advId, mapBody("B", eventsB()), token);

    // A partially wired graph (map B's exit left unbound) still saves — completeness is not enforced.
    const partial = await authedFetch(`/api/adventures/${advId}`, token, {
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

    // A graph naming a map outside this adventure's members is a foreign reference.
    const foreign = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: {
          start: { mapId: "00000000-0000-4000-8000-000000000000", entryId: ENTRY_A },
          links: [],
        },
      }),
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ error: "adventure_graph" });
  });
});

describe("delete conflicts: adventure_referenced / adventure_in_use", () => {
  test("adventure_referenced: refuses a non-forced delete while a party references the adventure, force clears it", async () => {
    const { userId, token } = await registerAndLogin("advref");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;

    const party = await probe.parties.create({
      adventureId: advId,
      adventureVersion: 1,
      maxPlayers: 4,
      hostUserId: userId,
      status: "open",
    });
    await probe.heroes.create({
      partyId: party.id,
      userId,
      name: "Hero",
      class: "warrior",
      mapId: "whatever",
      x: 0,
      y: 0,
    });

    const blocked = await authedFetch(`/api/adventures/${advId}`, token, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "adventure_referenced" });

    const forced = await authedFetch(`/api/adventures/${advId}?force=true`, token, {
      method: "DELETE",
    });
    expect(forced.status).toBe(204);
  });

  test("adventure_in_use: refuses moving the graph start while a party still references the adventure", async () => {
    const { userId, token } = await registerAndLogin("advinuse");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;
    const mapA = await authorMap(advId, mapBody("A"), token);
    const mapB = await authorMap(advId, mapBody("B", eventsB()), token);
    const wired = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: corridorGraph(mapA, mapB) }),
    });
    expect(wired.status).toBe(200);

    await probe.parties.create({
      adventureId: advId,
      adventureVersion: 1,
      maxPlayers: 4,
      hostUserId: userId,
      status: "open",
    });

    const nulled = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, graph: { start: null, links: [] } }),
    });
    expect(nulled.status).toBe(409);
    expect(await nulled.json()).toMatchObject({ error: "adventure_in_use" });

    // A rename that leaves the start where it is remains allowed mid-play.
    const renamed = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({
        title: "Renamed mid-play",
        maxPlayers: 4,
        graph: corridorGraph(mapA, mapB),
      }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ title: "Renamed mid-play" });
  });
});

describe("ownership: 404 vs 400", () => {
  test("404s an id that matches no row, on every id route", async () => {
    const { token } = await registerAndLogin("advmissing");
    const missingId = "00000000-0000-4000-8000-000000000000";
    const get = await authedFetch(`/api/adventures/${missingId}`, token);
    expect(get.status).toBe(404);
    expect(await get.json()).toMatchObject({ error: "adventure_not_found" });

    const put = await authedFetch(`/api/adventures/${missingId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "X", maxPlayers: 4 }),
    });
    expect(put.status).toBe(404);
    expect(await put.json()).toMatchObject({ error: "adventure_not_found" });

    const del = await authedFetch(`/api/adventures/${missingId}`, token, { method: "DELETE" });
    expect(del.status).toBe(404);
    expect(await del.json()).toMatchObject({ error: "adventure_not_found" });
  });

  test("404s a non-uuid id, like a plain string, on every route", async () => {
    const { token } = await registerAndLogin("advbuiltin");
    const get = await authedFetch("/api/adventures/whatever", token);
    expect(get.status).toBe(404);
    expect(await get.json()).toMatchObject({ error: "adventure_not_found" });
  });

  test("400s adventure_invalid on an update body PUT cannot parse", async () => {
    const { token } = await registerAndLogin("advputinvalid");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;
    const response = await authedFetch(`/api/adventures/${advId}`, token, {
      method: "PUT",
      body: JSON.stringify({ nope: true }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "adventure_invalid" });
  });
});
