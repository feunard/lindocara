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
import { adventures } from "../src/api/entities/adventures.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { mapEventPages } from "../src/api/entities/mapEventPages.ts";
import { mapEvents } from "../src/api/entities/mapEvents.ts";
import { maps } from "../src/api/entities/maps.ts";
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

/** A wire event page with every required field — mirrors `maps.test.ts`'s `wirePage`. */
function wirePage(): Record<string, unknown> {
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
  };
}

/** `count` distinct `normal`-kind events on distinct cells, own uuids captured for later assertion.
 *  `normal` events carry no walkable-ground requirement, so any distinct in-bounds cell works. */
function manyEvents(count: number): { events: MapEvent[]; ids: string[] } {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const events = ids.map(
    (id, index) =>
      ({
        id,
        col: (index + 1) % COLS,
        row: Math.floor((index + 1) / COLS) % ROWS,
        name: `Scripted ${index}`,
        ordinal: index,
        kind: "normal",
        pages: [wirePage()],
      }) as unknown as MapEvent,
  );
  return { events, ids };
}

/** Direct repository access for seeding rows no controller route creates yet (parties/heroes), and
 *  for post-delete cleanup assertions (maps/mapEvents/mapEventPages) — the same test-local probe
 *  idiom `maps.test.ts` established. */
class SeedProbe {
  adventures = $repository(adventures);
  parties = $repository(parties);
  heroes = $repository(heroes);
  maps = $repository(maps);
  mapEvents = $repository(mapEvents);
  mapEventPages = $repository(mapEventPages);
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

/** Seeds a bare adventure row directly through the repository (same idiom `maps.test.ts` uses),
 *  bypassing the atomic create-with-default-map route for tests that only need an id to hang a
 *  map off of. */
async function newAdventure(userId: string): Promise<string> {
  const adventure = await probe.adventures.create({
    userId,
    title: "Adv",
    graph: JSON.stringify({ start: null, links: [] }),
  });
  return adventure.id;
}

/** Creates a bare map inside `adventureId` and returns its id, without authoring any content onto
 *  it — mirrors `maps.test.ts`'s helper of the same name. */
async function newMapId(adventureId: string, token: string, name = "Map"): Promise<string> {
  const response = await authedFetch("/api/maps", token, {
    method: "POST",
    body: JSON.stringify({ adventureId, name }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** PUTs a patch onto an adventure, filling in the required shell fields the route always expects. */
function putAdventure(
  id: string,
  token: string,
  patch: Record<string, unknown>,
): Promise<Response> {
  return authedFetch(`/api/adventures/${id}`, token, {
    method: "PUT",
    body: JSON.stringify({ title: "Adventure", maxPlayers: 4, ...patch }),
  });
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
    expect(created).toMatchObject({
      title: "Donjon",
      maxPlayers: 4,
      cameraMode: "hd2d",
      version: 1,
    });
    // Atomic: exactly one default map, born genuinely blank (no auto-seeded entry/exit events), so
    // the born adventure is a draft (no start, no links).
    expect(created.mapIds).toHaveLength(1);
    expect(created.defaultMap.id).toBe(created.mapIds[0]);
    expect(created.defaultMap.events).toEqual([]);
    expect(created.graph.start).toBeNull();
    expect(created.graph.links).toEqual([]);
  });

  test("creates and updates the adventure-wide camera mode", async () => {
    const { token } = await registerAndLogin("advcamera");
    const createdResponse = await createAdventure(token, {
      title: "Orbit",
      maxPlayers: 4,
      cameraMode: "orbit",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string; cameraMode: string };
    expect(created.cameraMode).toBe("orbit");

    const updated = await putAdventure(created.id, token, { cameraMode: "hd2d" });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ cameraMode: "hd2d" });
  });

  // The editor opens an unsaved local sandbox and only creates a row at the author's first save, so
  // that save must land the adventure AND the map it was drawing in ONE request: a create-then-PUT
  // pair could persist a named adventure and then fail the map, presenting one action as done when
  // half of it was.
  test("creates the adventure and its first map from an authored map, in one POST", async () => {
    const { token } = await registerAndLogin("advsandbox");
    const response = await createAdventure(token, {
      title: "Sandbox",
      maxPlayers: 4,
      map: mapBody("Atelier"),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      mapIds: string[];
      defaultMap: {
        id: string;
        name: string;
        cols: number;
        rows: number;
        events: unknown[];
        heightfield: string | null;
      };
    };
    expect(created.mapIds).toHaveLength(1);
    expect(created.defaultMap.id).toBe(created.mapIds[0]);
    expect(created.defaultMap.name).toBe("Atelier");
    expect(created.defaultMap.cols).toBe(COLS);
    expect(created.defaultMap.rows).toBe(ROWS);
    // The authored events rode along, and the terrain was compiled by the server from them.
    expect(created.defaultMap.events).toHaveLength(2);
    expect(created.defaultMap.heightfield).toBeTruthy();
    // Exactly one map: the carried map REPLACES the blank template, it is not created beside it.
    const list = await authedFetch(`/api/maps?adventure=${created.id}`, token);
    expect((await list.json()) as unknown[]).toHaveLength(1);
  });

  test("400s map_invalid when the create body carries a malformed map, writing nothing", async () => {
    const { token } = await registerAndLogin("advsandbadmap");
    const response = await createAdventure(token, {
      title: "Sandbox",
      maxPlayers: 4,
      map: { name: "Atelier", nope: true },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_invalid" });
    const list = await authedFetch("/api/adventures", token);
    expect(await list.json()).toEqual([]);
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

  test("413s request_too_large on a create body over the 64 KiB adventure cap", async () => {
    const { token } = await registerAndLogin("advtoolarge");
    // Padding well past `MAX_ADVENTURE_JSON_BYTES` (64 KiB) — `enforceBodySizeCap` runs before
    // `parseCreateAdventureInput`, so this 413s regardless of the rest of the body's shape.
    const response = await createAdventure(token, {
      title: "T",
      maxPlayers: 4,
      padding: "x".repeat(70_000),
    } as never);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "request_too_large" });
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

describe("the owner listing is ordered by what was last worked on", () => {
  test("a plain map save moves its adventure to the front", async () => {
    const { token } = await registerAndLogin("advrecent");
    const older = (
      (await (await createAdventure(token, { title: "Older", maxPlayers: 4 })).json()) as {
        id: string;
      }
    ).id;
    const newer = (
      (await (await createAdventure(token, { title: "Newer", maxPlayers: 4 })).json()) as {
        id: string;
      }
    ).id;

    const listedIds = async (): Promise<string[]> =>
      ((await (await authedFetch("/api/adventures", token)).json()) as { id: string }[]).map(
        (entry) => entry.id,
      );

    // The order is what a bare `/editor` resumes, so it is asserted here rather than left to the
    // client: newest work first, which for two untouched adventures is the newer one.
    expect(await listedIds()).toEqual([newer, older]);

    // A map PUT carrying NO `adventure` metadata: the shape the editor sends when it saves
    // terrain. The owning adventure must still be touched, or an hour of painting would leave it
    // looking untouched since the day it was titled, and the editor would resume the wrong one.
    const { mapIds } = (await (await authedFetch(`/api/adventures/${older}`, token)).json()) as {
      mapIds: string[];
    };
    const saved = await authedFetch(`/api/maps/${mapIds[0]}`, token, {
      method: "PUT",
      body: JSON.stringify(mapBody("Painted")),
    });
    expect(saved.status).toBe(200);

    expect(await listedIds()).toEqual([older, newer]);
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

describe("force delete: chunked event-page cleanup", () => {
  // Regression coverage for the chunked-delete fix: `AdventureService.deleteAdventure` used to hand
  // `mapEventPages.deleteMany` an unchunked `eventId: { inArray: [...] }` sized to a map's whole live
  // event count. 50 events (under `MAX_EVENTS_PER_MAP` = 64, so a real editor could author this) with
  // `MAP_EVENT_PAGE_DELETE_CHUNK` = 40 forces this delete across two chunks — this proves the chunked
  // path still round-trips full cleanup, the same thing a bad chunk boundary would break first.
  test("force-deletes an adventure whose map carries 50 events (spanning multiple delete chunks), leaving no orphan rows", async () => {
    const { token } = await registerAndLogin("advchunk");
    const advId = ((await (await createAdventure(token)).json()) as { id: string }).id;
    const { events, ids: eventIds } = manyEvents(50);
    const mapId = await authorMap(advId, mapBody("Bulk", events), token);

    const authoredEventRows = await probe.mapEvents.findMany({
      where: { mapId: { eq: mapId } },
    });
    expect(authoredEventRows).toHaveLength(50);

    const forced = await authedFetch(`/api/adventures/${advId}?force=true`, token, {
      method: "DELETE",
    });
    expect(forced.status).toBe(204);

    const remainingMaps = await probe.maps.findMany({ where: { id: { eq: mapId } } });
    expect(remainingMaps).toHaveLength(0);
    const remainingEvents = await probe.mapEvents.findMany({ where: { mapId: { eq: mapId } } });
    expect(remainingEvents).toHaveLength(0);
    const remainingPages = await probe.mapEventPages.findMany({
      where: { eventId: { inArray: eventIds } },
    });
    expect(remainingPages).toHaveLength(0);

    const gone = await authedFetch(`/api/adventures/${advId}`, token);
    expect(gone.status).toBe(404);
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

describe("start map: author, foreign refusal, clear", () => {
  test("stores an explicit start map, refuses a foreign one, and clears on null", async () => {
    const { userId, token } = await registerAndLogin("startmap");
    const adventureId = await newAdventure(userId);
    const mapId = await newMapId(adventureId, token);

    const initial = await authedFetch(`/api/adventures/${adventureId}`, token);
    expect(await initial.json()).toMatchObject({ startMapId: null });

    const set = await putAdventure(adventureId, token, { startMapId: mapId });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ startMapId: mapId });

    // Omitting the field preserves it — the same "absent means preserve" contract audio and
    // registry already use, so a title-only save cannot silently unset the start map.
    const renamed = await putAdventure(adventureId, token, { title: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ startMapId: mapId, title: "Renamed" });

    // A map belonging to somebody else's adventure is not a member of this one.
    const other = await registerAndLogin("startmap2");
    const foreignMap = await newMapId(await newAdventure(other.userId), other.token);
    const foreign = await putAdventure(adventureId, token, { startMapId: foreignMap });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toBe("adventure_maps");

    const cleared = await putAdventure(adventureId, token, { startMapId: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ startMapId: null });
  });
});

describe("start map: the in_use guard excludes the editor's own test-session party", () => {
  test("adventure_in_use: refuses moving the start map while a REAL party references the adventure", async () => {
    const { userId, token } = await registerAndLogin("advstartinuse");
    const created = (await (await createAdventure(token)).json()) as {
      id: string;
      defaultMap: { id: string };
    };

    await probe.parties.create({
      adventureId: created.id,
      adventureVersion: 1,
      maxPlayers: 4,
      hostUserId: userId,
      status: "open",
    });

    const blocked = await putAdventure(created.id, token, { startMapId: created.defaultMap.id });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "adventure_in_use" });
  });

  // TestSessionService.createTestSession provisions a REAL `parties` row for every playtest — an
  // author who plays their own draft and returns to the editor must still be able to move the start.
  test("moving the start map succeeds while only the caller's own test-session party references the adventure", async () => {
    const { token } = await registerAndLogin("advstarttest");
    const created = (await (await createAdventure(token)).json()) as {
      id: string;
      defaultMap: { id: string };
    };

    const session = await authedFetch(`/api/adventures/${created.id}/test-sessions`, token, {
      method: "POST",
      body: JSON.stringify({ startMapId: null, heroClass: "warrior" }),
    });
    expect(session.status).toBe(201);

    const moved = await putAdventure(created.id, token, { startMapId: created.defaultMap.id });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ startMapId: created.defaultMap.id });
  });
});

/**
 * Read is open, write is owned.
 *
 * These two halves used to disagree in a way that made sharing impossible AND left writes wide
 * open: an adventure ROW was readable and writable by any account, while every one of its MAPS
 * was owner-fenced on read. So a shared link handed a visitor an adventure whose maps all 404'd —
 * the editor failed the load and told them it did not exist — and meanwhile any account could
 * rewrite or delete someone else's adventure. Both directions are asserted here because both
 * moved, and each is silent when it breaks: the read side fails as an empty/absent adventure, the
 * write side as no failure at all.
 */
describe("adventure access: any account reads, only the owner writes", () => {
  test("a foreign account can read the adventure AND its maps", async () => {
    const owner = await registerAndLogin("owner");
    const visitor = await registerAndLogin("visitor");
    const created = (await (await createAdventure(owner.token)).json()) as {
      id: string;
      defaultMap: { id: string };
    };

    const readAdventure = await authedFetch(`/api/adventures/${created.id}`, visitor.token);
    expect(readAdventure.status).toBe(200);

    // The half that was broken. A 404 here is what produced "this adventure could not be opened".
    const readMap = await authedFetch(`/api/maps/${created.defaultMap.id}`, visitor.token);
    expect(readMap.status).toBe(200);

    // And the listing must not answer "no maps" — the owner filter used to make it look empty
    // rather than refused, which is the same wrong answer wearing a friendlier face.
    const listed = await authedFetch(`/api/maps?adventure=${created.id}`, visitor.token);
    expect(listed.status).toBe(200);
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });

  test("a foreign account cannot edit or delete the adventure", async () => {
    const owner = await registerAndLogin("owner");
    const visitor = await registerAndLogin("visitor");
    const created = (await (await createAdventure(owner.token)).json()) as { id: string };

    const edit = await authedFetch(`/api/adventures/${created.id}`, visitor.token, {
      method: "PUT",
      body: JSON.stringify({ title: "Stolen", maxPlayers: 4 }),
    });
    // 403, not 404: the visitor can read this row, so denying its existence would contradict the
    // GET above.
    expect(edit.status).toBe(403);

    const removed = await authedFetch(`/api/adventures/${created.id}`, visitor.token, {
      method: "DELETE",
    });
    expect(removed.status).toBe(403);

    // Still there, and still called what its owner called it.
    const after = await authedFetch(`/api/adventures/${created.id}`, owner.token);
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ title: "Donjon" });
  });

  test("a foreign account cannot write the maps it can read", async () => {
    const owner = await registerAndLogin("owner");
    const visitor = await registerAndLogin("visitor");
    const created = (await (await createAdventure(owner.token)).json()) as {
      id: string;
      defaultMap: { id: string };
    };

    const write = await authedFetch(`/api/maps/${created.defaultMap.id}`, visitor.token, {
      method: "PUT",
      // A fully VALID body on purpose: the controller parses and validates before it reaches the
      // ownership fence, so a malformed one 400s and proves nothing about who may write.
      body: JSON.stringify(mapBody("Stolen")),
    });
    expect(write.status).toBe(404);

    const removed = await authedFetch(`/api/maps/${created.defaultMap.id}`, visitor.token, {
      method: "DELETE",
    });
    expect(removed.status).toBe(404);
  });

  test("the owner can still edit and delete", async () => {
    const owner = await registerAndLogin("owner");
    const created = (await (await createAdventure(owner.token)).json()) as { id: string };

    const edit = await authedFetch(`/api/adventures/${created.id}`, owner.token, {
      method: "PUT",
      body: JSON.stringify({ title: "Renamed", maxPlayers: 4 }),
    });
    expect(edit.status).toBe(200);

    const removed = await authedFetch(`/api/adventures/${created.id}?force=true`, owner.token, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
  });
});
