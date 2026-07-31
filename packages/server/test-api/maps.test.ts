/**
 * The maps CRUD API on Alepha: create, list, read, update, delete and flip the front-door flag.
 * Drives the real HTTP server (`ServerProvider.hostname` + raw `fetch()`, the same idiom
 * `auth.test.ts`'s second test uses) rather than the typed `.fetch()` client, because
 * `MapController`'s body/query/params schemas are deliberately loose (see its own docblock) and a
 * real round trip is the only thing that proves the server-side "shape only" validation actually
 * produces the exact legacy machine codes.
 *
 * Business rules are ported from `packages/server/test/maps-api.test.ts` (read in full before
 * writing this file) — see `MapService`'s docblock for why "foreign user -> 404" from the task
 * brief was NOT ported: the actual source of truth (`maps.ts` + its own tests, literally named
 * "collaborative editing is open") is the opposite, and porting the brief's assumption over the
 * real behavior would be a regression, not a port.
 */
import { MAX_ADVENTURE_MAPS } from "@lindocara/engine/adventure.js";
import { MAX_MAP_ELEMENTS } from "@lindocara/engine/map-data.js";
import { MAP_MIN_COLS, MAP_MIN_ROWS } from "@lindocara/engine/map-limits.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { adventures } from "../src/api/entities/adventures.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { mapElements } from "../src/api/entities/mapElements.ts";
import { mapEventPages } from "../src/api/entities/mapEventPages.ts";
import { mapEvents } from "../src/api/entities/mapEvents.ts";
import { maps } from "../src/api/entities/maps.ts";
import { parties } from "../src/api/entities/parties.ts";
import { HeroService } from "../src/api/services/HeroService.ts";
import {
  MAP_ELEMENT_COLUMNS,
  MAP_EVENT_COLUMNS,
  MAP_EVENT_PAGE_COLUMNS,
} from "../src/api/services/MapService.ts";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";
const MAP_COLS = MAP_MIN_COLS;
const MAP_ROWS = MAP_MIN_ROWS;

// A one-cell-wide water strip at (1,1)/(2,1) standing in for "the sea", mirroring the legacy
// fixture — everything else is grass.
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

/** A wire event page with every required field, overridable per test. */
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

/** Direct repository access for seeding rows no MapController route creates yet (adventures,
 *  parties, heroes) — the same test-local probe idiom `entities-authoring.test.ts` established. */
class SeedProbe {
  adventures = $repository(adventures);
  maps = $repository(maps);
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

/** Registers a user through the real realm flow and logs in via the credentials provider — same
 *  two-phase idiom as `auth.test.ts`/`entities-authoring.test.ts`, plus the login step neither of
 *  those needed. Bearer token, not a cookie: this realm has no session cookie concept. */
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

async function newAdventure(userId: string): Promise<string> {
  const adventure = await probe.adventures.create({
    userId,
    title: "Adv",
    graph: JSON.stringify({ start: null, links: [] }),
  });
  return adventure.id;
}

async function newMapId(adventureId: string, token: string, name = "Map"): Promise<string> {
  const response = await authedFetch("/api/maps", token, {
    method: "POST",
    body: JSON.stringify({ adventureId, name }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function putMap(id: string, token: string, body: unknown): Promise<Response> {
  return authedFetch(`/api/maps/${id}`, token, { method: "PUT", body: JSON.stringify(body) });
}

async function listMaps(
  adventureId: string,
  token: string,
): Promise<{ id: string; isFirst: boolean }[]> {
  const response = await authedFetch(`/api/maps?adventure=${adventureId}`, token);
  return (await response.json()) as { id: string; isFirst: boolean }[];
}

describe("session gate", () => {
  test("401s every map route without a bearer token", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/maps?adventure=00000000-0000-4000-8000-000000000000"],
      ["GET", "/api/maps/whatever"],
      ["POST", "/api/maps"],
      ["PUT", "/api/maps/whatever"],
      ["DELETE", "/api/maps/whatever"],
      ["POST", "/api/maps/whatever/first"],
    ];
    for (const [method, path] of routes) {
      // POST/PUT declare a body schema (`z.any()`), so an actually empty request body fails JSON
      // parsing before `$secure` ever runs — send a well-formed empty object, matching what a real
      // client sends, so this asserts the auth gate specifically, not a body-parse 400.
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

describe("create under an adventure", () => {
  test("creates the blank flat-grass template, ignoring any client terrain, revision 1", async () => {
    const { userId, token } = await registerAndLogin("mapcreate");
    const adventureId = await newAdventure(userId);
    const response = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({ adventureId, ...mapBody(), name: "Fresh" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      revision: number;
      cols: number;
      rows: number;
      spawn: unknown;
      events: unknown[];
    };
    expect(created).toMatchObject({
      revision: 1,
      cols: MAP_MIN_COLS,
      rows: MAP_MIN_ROWS,
      spawn: { col: MAP_MIN_COLS / 2, row: Math.floor(MAP_MIN_ROWS / 2) },
    });
    expect(created.events).toEqual([]);

    // ...and the first map created for an account is flagged first (MapSummary-only field).
    const list = await listMaps(adventureId, token);
    expect(list.find((entry) => entry.id === created.id)?.isFirst).toBe(true);
  });

  test(`refuses a ${MAX_ADVENTURE_MAPS + 1}th map in one adventure`, async () => {
    const { userId, token } = await registerAndLogin("maplimit");
    const adventureId = await newAdventure(userId);
    for (let index = 0; index < MAX_ADVENTURE_MAPS; index += 1) {
      const created = await authedFetch("/api/maps", token, {
        method: "POST",
        body: JSON.stringify({ adventureId, name: `Map ${index + 1}` }),
      });
      expect(created.status).toBe(201);
    }
    const refused = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "Too many" }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "map_limit" });
  });

  test("404s a create under an unknown adventure", async () => {
    const { token } = await registerAndLogin("mapadvmiss");
    const response = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({ adventureId: "00000000-0000-4000-8000-000000000000", name: "Orphan" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "map_not_found" });
  });

  test("400s a create body with no adventure or no name", async () => {
    const { userId, token } = await registerAndLogin("mapcreate400");
    const adventureId = await newAdventure(userId);
    const noAdventure = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({ name: "x" }),
    });
    expect(noAdventure.status).toBe(400);
    expect(await noAdventure.json()).toMatchObject({ error: "map_invalid" });

    const noName = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    expect(noName.status).toBe(400);
    expect(await noName.json()).toMatchObject({ error: "map_invalid" });
  });
});

describe("list, get, update, delete", () => {
  test("round-trips a map through the whole lifecycle", async () => {
    const { userId, token } = await registerAndLogin("maplife");
    const adventureId = await newAdventure(userId);
    await newMapId(adventureId, token, "Keepalive");
    const id = await newMapId(adventureId, token, "Round Trip");

    const authorRes = await putMap(id, token, mapBody({ name: "Round Trip" }));
    expect(authorRes.status).toBe(200);
    expect(await authorRes.json()).toMatchObject({ id, name: "Round Trip", revision: 2 });

    const listRes = await authedFetch(`/api/maps?adventure=${adventureId}`, token);
    const list = (await listRes.json()) as { id: string; name: string }[];
    expect(list.find((entry) => entry.id === id)).toMatchObject({ name: "Round Trip" });

    const getRes = await authedFetch(`/api/maps/${id}`, token);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched).toMatchObject({ id, name: "Round Trip" });

    // A GET response is a legal PUT body, verbatim.
    const echoRes = await putMap(id, token, fetched);
    expect(echoRes.status).toBe(200);
    expect(await echoRes.json()).toMatchObject({ id, name: "Round Trip", revision: 3 });

    const deleteRes = await authedFetch(`/api/maps/${id}`, token, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await authedFetch(`/api/maps/${id}`, token);
    expect(afterDelete.status).toBe(404);
    expect(await afterDelete.json()).toMatchObject({ error: "map_not_found" });
  });

  test("round-trips an authored monster event (with its tuning) through GET -> PUT", async () => {
    const { userId, token } = await registerAndLogin("mapevent");
    const adventureId = await newAdventure(userId);
    await newMapId(adventureId, token, "Keepalive");
    const id = await newMapId(adventureId, token, "Wolves");

    const monsterEvent = {
      id: crypto.randomUUID(),
      col: 5,
      row: 5,
      name: "Wolf",
      ordinal: 1,
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 0,
      monsterMaxHp: 0,
      monsterDamage: 0,
      monsterSpeed: 0,
      monsterXp: 10_000,
      monsterWeaknessPercent: 0,
      monsterRespawnDelayMs: 75_000,
      pages: [wirePage()],
    };
    const authored = await putMap(id, token, mapBody({ name: "Wolves", events: [monsterEvent] }));
    expect(authored.status).toBe(200);

    const fetched = await authedFetch(`/api/maps/${id}`, token);
    const payload = (await fetched.json()) as {
      events: {
        species: string;
        patrolRadius: number;
        monsterMaxHp: number | null;
        monsterDamage: number | null;
        monsterSpeed: number | null;
        monsterXp: number | null;
        monsterWeaknessPercent: number | null;
        monsterRespawnDelayMs: number;
      }[];
    };
    expect(payload.events[0]).toMatchObject({
      species: "spear_goblin",
      patrolRadius: 0,
      monsterMaxHp: 0,
      monsterDamage: 0,
      monsterSpeed: 0,
      monsterXp: 10_000,
      monsterWeaknessPercent: 0,
      monsterRespawnDelayMs: 75_000,
    });
    // Explicit zeroes must survive persistence instead of being replaced by species defaults.
    expect(payload.events[0]?.monsterMaxHp).toBe(0);

    // The editor reuses that GET payload as its next PUT body without turning it into a 400.
    const editorSave = await putMap(id, token, payload);
    expect(editorSave.status).toBe(200);
  });

  test("round-trips a free NPC with characteristics and a walking routine", async () => {
    const { userId, token } = await registerAndLogin("mapnpc");
    const adventureId = await newAdventure(userId);
    await newMapId(adventureId, token, "Keepalive");
    const id = await newMapId(adventureId, token, "Village");
    const npcEvent = {
      id: crypto.randomUUID(),
      col: 5,
      row: 5,
      name: "Mara",
      ordinal: 1,
      kind: "npc",
      species: null,
      patrolRadius: 160,
      monsterMaxHp: 275,
      monsterDamage: 24,
      pages: [
        wirePage({
          graphicTint: 0x7c3aed,
          moveType: "custom",
          moveRoute: [
            { offsetCol: 2, offsetRow: 0, waitMs: 1_500 },
            { offsetCol: 0, offsetRow: -1, waitMs: 0 },
          ],
          moveSpeed: 3,
          moveFreq: 2,
        }),
      ],
    };

    const authored = await putMap(id, token, mapBody({ name: "Village", events: [npcEvent] }));
    expect(authored.status).toBe(200);

    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as {
      events: {
        kind: string;
        patrolRadius: number;
        monsterMaxHp: number;
        monsterDamage: number;
        pages: { graphicTint: number; moveType: string; moveRoute: unknown[] }[];
      }[];
    };
    expect(payload.events[0]).toMatchObject({
      kind: "npc",
      patrolRadius: 160,
      monsterMaxHp: 275,
      monsterDamage: 24,
      pages: [
        {
          graphicTint: 0x7c3aed,
          moveType: "custom",
          moveRoute: [
            { offsetCol: 2, offsetRow: 0, waitMs: 1_500 },
            { offsetCol: 0, offsetRow: -1, waitMs: 0 },
          ],
        },
      ],
    });

    const editorSave = await putMap(id, token, payload);
    expect(editorSave.status).toBe(200);
  });

  // Regression coverage for the chunked-write fix: `MapService.writeElements`/`writeEvents` used
  // to hand `createMany` an unchunked array. Alepha's `Repository.createMany` batches by ROW COUNT
  // only (`.vendor/alepha/src/orm/core/services/Repository.ts:866-908`), never by bound-parameter
  // count, so a wide-enough row set (events carry ~19 columns each) blew past D1's ~100-bound-param
  // cap in production while staying green here, because this suite's sqlite is in-memory and has no
  // such limit. This test cannot exercise the D1 cap itself (that requires production D1, not
  // `:memory:`), but it does prove the batched write path still round-trips every row intact — the
  // thing a bad chunk boundary (an off-by-one slice, a wrong batch size) would break first.
  test("round-trips 40+ elements and 15+ events (with pages) through GET -> PUT, across multiple write batches", async () => {
    const { userId, token } = await registerAndLogin("mapbulk");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token, "Bulk");

    const ELEMENT_COUNT = 44;
    const EVENT_COUNT = 17;

    // Distinct cells, all with a one-cell margin from every edge (a bush's visual footprint spans
    // the anchor's 8 neighbours) and clear of the spawn cell (0,0) and the water strip at row 1.
    const elements = Array.from({ length: ELEMENT_COUNT }, (_, i) => ({
      col: 3 + (i % 15),
      row: 3 + Math.floor(i / 15),
      kind: "bush",
      variant: 0,
    }));

    // A different row band so no event cell collides with an element cell (elements/events are
    // independent tables, but keeping them apart makes the fixture easy to reason about).
    const events = Array.from({ length: EVENT_COUNT }, (_, i) => ({
      id: crypto.randomUUID(),
      col: 2 + (i % 16),
      row: 9 + Math.floor(i / 16),
      name: `Scripted ${i}`,
      ordinal: i,
      kind: "normal",
      pages: [wirePage(), wirePage({ trigger: "player-touch" })],
    }));

    const authored = await putMap(id, token, mapBody({ name: "Bulk", elements, events }));
    expect(authored.status).toBe(200);
    expect(await authored.json()).toMatchObject({ revision: 2 });

    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as {
      elements: unknown[];
      events: { pages: unknown[] }[];
    };
    expect(payload.elements).toHaveLength(ELEMENT_COUNT);
    expect(payload.events).toHaveLength(EVENT_COUNT);
    for (const event of payload.events) expect(event.pages).toHaveLength(2);

    // The editor reuses that GET payload as its next PUT body without turning it into a 400 — the
    // same round-trip proof the monster-event test above establishes for a single event.
    const editorSave = await putMap(id, token, payload);
    expect(editorSave.status).toBe(200);
    expect(await editorSave.json()).toMatchObject({ revision: 3 });
  });

  test("increments revision only after a successful update", async () => {
    const { userId, token } = await registerAndLogin("maprevbump");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token);

    const refused = await putMap(id, token, mapBody({ name: " " }));
    expect(refused.status).toBe(400);
    const stillOne = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as {
      revision: number;
    };
    expect(stillOne.revision).toBe(1);

    const updated = await putMap(id, token, mapBody({ name: "Revision two" }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ revision: 2 });
  });

  test("refuses a save based on a stale editor revision", async () => {
    const { userId, token } = await registerAndLogin("mapstale");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token);

    const first = await putMap(id, token, mapBody({ name: "Current", expectedRevision: 1 }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ revision: 2, name: "Current" });

    const stale = await putMap(
      id,
      token,
      mapBody({ name: "Stale overwrite", expectedRevision: 1 }),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "map_conflict" });
    expect(await (await authedFetch(`/api/maps/${id}`, token)).json()).toMatchObject({
      revision: 2,
      name: "Current",
    });
  });
});

describe("ownership: collaborative editing, not per-map fencing", () => {
  // `maps.ts` and its own tests ("opens foreign maps to reading and editing — collaborative
  // editing is open") establish that any authenticated account may act on any adventure's maps —
  // there is no per-map ownership fence to preserve, so this is what "preserving every legacy
  // behavior" actually means here. See `MapService`'s docblock for the full rationale.
  test("a foreign account may list, read and edit any adventure's maps", async () => {
    const owner = await registerAndLogin("mapowner");
    const adventureId = await newAdventure(owner.userId);
    const id = await newMapId(adventureId, owner.token, "Shared");

    const rival = await registerAndLogin("maprival");
    const library = await listMaps(adventureId, rival.token);
    expect(library.some((entry) => entry.id === id)).toBe(true);

    expect((await authedFetch(`/api/maps/${id}`, rival.token)).status).toBe(200);

    const edited = await putMap(id, rival.token, mapBody({ name: "Edited by rival" }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ name: "Edited by rival", revision: 2 });
  });

  test("404s an id that matches no row", async () => {
    const { token } = await registerAndLogin("mapmissing");
    const response = await authedFetch("/api/maps/00000000-0000-4000-8000-000000000000", token);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "map_not_found" });
  });

  test("404s a non-uuid id, like the retired builtin-floor sentinel, on every route", async () => {
    const { token } = await registerAndLogin("mapbuiltin");
    const get = await authedFetch("/api/maps/builtin", token);
    expect(get.status).toBe(404);
    expect(await get.json()).toMatchObject({ error: "map_not_found" });

    const put = await putMap("builtin", token, mapBody());
    expect(put.status).toBe(404);
    expect(await put.json()).toMatchObject({ error: "map_not_found" });

    const del = await authedFetch("/api/maps/builtin", token, { method: "DELETE" });
    expect(del.status).toBe(404);
    expect(await del.json()).toMatchObject({ error: "map_not_found" });

    const first = await authedFetch("/api/maps/builtin/first", token, { method: "POST" });
    expect(first.status).toBe(404);
    expect(await first.json()).toMatchObject({ error: "map_not_found" });
  });
});

describe("validation family reachable from the wire (on the authoring PUT)", () => {
  // `map_markers`/`map_audio` are validateMapInput-internal defensive checks that can never
  // actually fire from the HTTP boundary: `parseMapBody` already runs `parseMapMarkers`/
  // `parseMapAudioConfig` against the same cols/rows before `validateMapInput` sees either field,
  // so a malformed one is rejected as `map_invalid` first. This matches legacy exactly — its own
  // `maps-api.test.ts` has no `map_markers`/`map_audio` case either — so neither is exercised here.

  test("400s map_name on a blank name", async () => {
    const { userId, token } = await registerAndLogin("mapname");
    const id = await newMapId(await newAdventure(userId), token);
    const response = await putMap(id, token, mapBody({ name: "   " }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_name" });
  });

  test("400s map_size on a map smaller than the size floor", async () => {
    const { userId, token } = await registerAndLogin("mapsize");
    const id = await newMapId(await newAdventure(userId), token);
    const tiny = Array.from({ length: 5 }, () => ".".repeat(5));
    const response = await putMap(
      id,
      token,
      mapBody({ ...layeredWireTerrain(tiny), spawn: { col: 0, row: 0 } }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_size" });
  });

  test("400s map_elements just over the element cap", async () => {
    const { userId, token } = await registerAndLogin("mapelems");
    const id = await newMapId(await newAdventure(userId), token);
    const elements = Array.from({ length: MAX_MAP_ELEMENTS + 1 }, (_, i) => ({
      col: i % MAP_COLS,
      row: i % MAP_ROWS,
      kind: "bush",
      variant: 0,
    }));
    const response = await putMap(id, token, mapBody({ elements }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_elements" });
  });

  test("400s map_placement on a duplicated element slot", async () => {
    const { userId, token } = await registerAndLogin("mapplace");
    const id = await newMapId(await newAdventure(userId), token);
    const elements = [
      { col: 5, row: 5, kind: "tree", variant: 0 },
      { col: 5, row: 5, kind: "tree", variant: 0 },
    ];
    const response = await putMap(id, token, mapBody({ elements }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_placement" });
  });

  test("400s map_spawn when scenery covers the spawn cell", async () => {
    const { userId, token } = await registerAndLogin("mapspawn");
    const id = await newMapId(await newAdventure(userId), token);
    // Away from the edges (unlike col/row 0) so the tree's own multi-cell visual footprint stays
    // in bounds — otherwise `map_placement` ("exceeds map bounds") fires first, before the
    // spawn-coverage check ever runs.
    const response = await putMap(
      id,
      token,
      mapBody({
        elements: [{ col: 5, row: 5, kind: "tree", variant: 0 }],
        spawn: { col: 5, row: 5 },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_spawn" });
  });

  test("400s map_events when a functional event stands on unwalkable ground", async () => {
    const { userId, token } = await registerAndLogin("mapevents");
    const id = await newMapId(await newAdventure(userId), token);
    // validBlocks() row 1 is `.##...`: (1,1) and (2,1) are water/solid.
    const events = [
      {
        id: crypto.randomUUID(),
        col: 1,
        row: 1,
        name: "Blocked",
        ordinal: 1,
        kind: "exit",
        pages: [wirePage()],
      },
    ];
    const response = await putMap(id, token, mapBody({ events }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_events" });
  });

  test("400s map_invalid on a shape parseMapData cannot make sense of", async () => {
    const { userId, token } = await registerAndLogin("mapinvalid");
    const id = await newMapId(await newAdventure(userId), token);
    const response = await putMap(id, token, {
      name: "Bad Shape",
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: MAP_COLS,
      rows: MAP_ROWS,
      layers: "nope",
      elements: [],
      spawn: { col: 0, row: 0 },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_invalid" });
  });

  test("413s a body over the 4 MiB cap", async () => {
    const { userId, token } = await registerAndLogin("map413");
    const id = await newMapId(await newAdventure(userId), token);
    const elements = Array.from({ length: 100_000 }, (_, i) => ({
      col: 0,
      row: 0,
      kind: "tree",
      variant: i,
    }));
    const response = await putMap(id, token, mapBody({ elements }));
    expect(response.status).toBe(413);
  });
});

describe("the last map", () => {
  test("refuses to delete the only map in an adventure", async () => {
    const { userId, token } = await registerAndLogin("maplast");
    const id = await newMapId(await newAdventure(userId), token);
    const response = await authedFetch(`/api/maps/${id}`, token, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "last_map" });
  });

  test("force still refuses the last map of an adventure", async () => {
    const { userId, token } = await registerAndLogin("maplastforce");
    const id = await newMapId(await newAdventure(userId), token);
    const response = await authedFetch(`/api/maps/${id}?force=true`, token, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "last_map" });
  });
});

describe("the front door", () => {
  test("hands the flag to a survivor when the flagged map is deleted", async () => {
    const { userId, token } = await registerAndLogin("mapsurvive");
    const adventureId = await newAdventure(userId);
    const oneId = await newMapId(adventureId, token, "One");
    const twoId = await newMapId(adventureId, token, "Two");

    await authedFetch(`/api/maps/${oneId}`, token, { method: "DELETE" });

    const list = await listMaps(adventureId, token);
    expect(list.find((entry) => entry.id === twoId)?.isFirst).toBe(true);
  });

  // Task 6's deferred coverage: moving `isFirst` back and forth must never trip the
  // `map_account_first_unique` partial-unique index (clear-then-set order matters).
  test("moves the first flag between maps repeatedly without violating the partial unique index", async () => {
    const { userId, token } = await registerAndLogin("mapflag");
    const adventureId = await newAdventure(userId);
    const oneId = await newMapId(adventureId, token, "One");
    const twoId = await newMapId(adventureId, token, "Two");

    let list = await listMaps(adventureId, token);
    expect(list.find((entry) => entry.id === oneId)?.isFirst).toBe(true);
    expect(list.find((entry) => entry.id === twoId)?.isFirst).toBe(false);

    for (let round = 0; round < 3; round += 1) {
      const toTwo = await authedFetch(`/api/maps/${twoId}/first`, token, { method: "POST" });
      expect(toTwo.status).toBe(204);
      list = await listMaps(adventureId, token);
      expect(list.find((entry) => entry.id === twoId)?.isFirst).toBe(true);
      expect(list.find((entry) => entry.id === oneId)?.isFirst).toBe(false);

      const toOne = await authedFetch(`/api/maps/${oneId}/first`, token, { method: "POST" });
      expect(toOne.status).toBe(204);
      list = await listMaps(adventureId, token);
      expect(list.find((entry) => entry.id === oneId)?.isFirst).toBe(true);
      expect(list.find((entry) => entry.id === twoId)?.isFirst).toBe(false);
    }
  });
});

describe("delete conflicts", () => {
  test("map_in_use: refuses a non-forced delete while a hero occupies the map in an open party", async () => {
    const { userId, token } = await registerAndLogin("mapinuse");
    const adventureId = await newAdventure(userId);
    await newMapId(adventureId, token, "Keepalive");
    const occupiedId = await newMapId(adventureId, token, "Occupied");

    const party = await probe.parties.create({
      adventureId,
      adventureVersion: 1,
      maxPlayers: 4,
      hostUserId: userId,
      status: "open",
    });
    const occupant = await probe.heroes.create({
      partyId: party.id,
      userId,
      name: "Occupant",
      class: "warrior",
      mapId: occupiedId,
      x: 0,
      y: 0,
    });

    // The realtime tranche overrides this in production; here it just proves the same
    // `HeroService.onHeroDeleted` seam `PartyService.deleteParty` honors also fires when
    // `deleteMap`'s force path removes a hero, not only when a party is deleted directly.
    const heroService = alepha.inject(HeroService);
    const revoked: string[] = [];
    heroService.onHeroDeleted = (heroId: string) => {
      revoked.push(heroId);
    };

    const blocked = await authedFetch(`/api/maps/${occupiedId}`, token, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "map_in_use" });
    expect(revoked).toEqual([]);

    const forced = await authedFetch(`/api/maps/${occupiedId}?force=true`, token, {
      method: "DELETE",
    });
    expect(forced.status).toBe(204);
    expect(revoked).toEqual([occupant.id]);
  });

  test("map_referenced: adventure-graph revalidation blocks delete of a graph-referenced map until forced", async () => {
    const { userId, token } = await registerAndLogin("mapref");
    const adventureId = await newAdventure(userId);
    const mapAId = await newMapId(adventureId, token, "A");
    await newMapId(adventureId, token, "B");

    const entryEvent = {
      id: crypto.randomUUID(),
      col: 2,
      row: 2,
      name: "Entry",
      ordinal: 1,
      kind: "entry",
      pages: [wirePage()],
    };
    const seeded = await putMap(mapAId, token, {
      ...mapBody({ name: "A", events: [entryEvent] }),
      adventure: {
        title: "Adv",
        maxPlayers: 4,
        graph: { start: { mapId: mapAId, entryId: entryEvent.id }, links: [] },
      },
    });
    expect(seeded.status).toBe(200);

    const blocked = await authedFetch(`/api/maps/${mapAId}`, token, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "map_referenced" });

    const forced = await authedFetch(`/api/maps/${mapAId}?force=true`, token, { method: "DELETE" });
    expect(forced.status).toBe(204);
  });
});

describe("D1 chunking column-count constants stay in step with their entities", () => {
  // `MapService`'s `MAP_ELEMENT_BATCH_SIZE`/`MAP_EVENT_BATCH_SIZE`/`MAP_EVENT_PAGE_BATCH_SIZE` are
  // sized from these hand-derived column counts to keep `rows * columns` under D1's ~100
  // bound-parameter cap per statement (see `MapService.ts`'s own comment). Nothing re-derives them
  // from the actual entity schema at runtime, so an author adding a column to `mapElements`/
  // `mapEvents`/`mapEventPages` without also bumping the matching constant here would silently
  // undercount the real per-row parameter cost — this test breaks loudly instead.
  test("MAP_ELEMENT_COLUMNS matches mapElements' schema", () => {
    expect(MAP_ELEMENT_COLUMNS).toBe(Object.keys(mapElements.schema.shape).length);
  });

  test("MAP_EVENT_COLUMNS matches mapEvents' schema", () => {
    expect(MAP_EVENT_COLUMNS).toBe(Object.keys(mapEvents.schema.shape).length);
  });

  test("MAP_EVENT_PAGE_COLUMNS matches mapEventPages' schema", () => {
    expect(MAP_EVENT_PAGE_COLUMNS).toBe(Object.keys(mapEventPages.schema.shape).length);
  });
});
