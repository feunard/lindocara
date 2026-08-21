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
import { DEFAULT_HARVEST_COLLISIONS, type HarvestProfile } from "@lindocara/engine/harvest.js";
import { MAX_MAP_ELEMENTS } from "@lindocara/engine/map-data.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
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
const TREE_ASSET_ID = "resource.terrain-resources-wood-trees.tree1";
const OTHER_TREE_ASSET_ID = "resource.terrain-resources-wood-trees.tree2";
const STUMP_ASSET_ID = "resource.terrain-resources-wood-trees.stump-1";
const HOUSE_ASSET_ID = "building.buildings-blue-buildings.house1";
const BRIDGE_ASSET_ID = "terrain.bridge.wood.horizontal";
const HARVEST_PROFILE: HarvestProfile = {
  resource: "wood",
  tool: "axe",
  yieldAmount: 8,
  goldValue: 0,
  hitsRequired: 3,
  range: 96,
  harvestDurationMs: 900,
  exhaustedAssetId: STUMP_ASSET_ID,
  exhaustionBehavior: "replace",
  respawn: "permanent",
  respawnDelayMs: 0,
  fadeDurationMs: 350,
  collision: DEFAULT_HARVEST_COLLISIONS.wood,
};

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
  mapElements = $repository(mapElements);
  mapEvents = $repository(mapEvents);
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
async function registerAndLogin(
  prefix: string,
): Promise<{ userId: string; token: string; username: string }> {
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
  return { userId: registered.data.id, token: tokens.access_token, username };
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
): Promise<{ id: string; isFirst: boolean; author: string }[]> {
  const response = await authedFetch(`/api/maps?adventure=${adventureId}`, token);
  return (await response.json()) as { id: string; isFirst: boolean; author: string }[];
}

describe("session gate", () => {
  test("401s every map route without a bearer token", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/maps?adventure=00000000-0000-4000-8000-000000000000"],
      ["GET", "/api/maps/whatever"],
      ["POST", "/api/maps"],
      ["POST", "/api/maps/whatever/interiors"],
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
    const { userId, token, username } = await registerAndLogin("mapcreate");
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
    expect(list.find((entry) => entry.id === created.id)).toMatchObject({ author: username });
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

  test("round-trips reciprocal teleporter links and the locator-ring preference", async () => {
    const { userId, token } = await registerAndLogin("maplinkedtp");
    const id = await newMapId(await newAdventure(userId), token, "Linked passage");
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const first = {
      id: firstId,
      col: 3,
      row: 4,
      name: "Passage A",
      ordinal: 1,
      linkedEventId: secondId,
      showMarker: false,
      kind: "normal",
      pages: [
        wirePage({
          trigger: "player-touch",
          commands: [{ t: "teleport", mapId: id, col: 8, row: 9, category: "geographic" }],
        }),
      ],
    };
    const second = {
      id: secondId,
      col: 8,
      row: 9,
      name: "Passage B",
      ordinal: 2,
      linkedEventId: firstId,
      kind: "normal",
      pages: [
        wirePage({
          trigger: "player-touch",
          commands: [{ t: "teleport", mapId: id, col: 3, row: 4, category: "geographic" }],
        }),
      ],
    };

    expect((await putMap(id, token, mapBody({ events: [first, second] }))).status).toBe(200);
    const payload = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as {
      events: Array<Record<string, unknown>>;
    };
    expect(payload.events).toEqual([
      expect.objectContaining({ id: firstId, linkedEventId: secondId, showMarker: false }),
      expect.objectContaining({ id: secondId, linkedEventId: firstId, showMarker: true }),
    ]);
    const rows = await probe.mapEvents.findMany({ where: { mapId: { eq: id } } });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstId, linkedEventId: secondId, showMarker: false }),
        expect.objectContaining({ id: secondId, linkedEventId: firstId, showMarker: true }),
      ]),
    );
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
      monsterAttackProfile: "arrow",
      monsterRespawnDelayMs: 75_000,
      pages: [wirePage()],
    };
    const { monsterAttackProfile: _profile, ...legacyMonsterEvent } = {
      ...monsterEvent,
      id: crypto.randomUUID(),
      col: 6,
      name: "Legacy wolf",
      ordinal: 2,
    };
    const authored = await putMap(
      id,
      token,
      mapBody({ name: "Wolves", events: [monsterEvent, legacyMonsterEvent] }),
    );
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
        monsterAttackProfile?: string;
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
      monsterAttackProfile: "arrow",
      monsterRespawnDelayMs: 75_000,
    });
    // Explicit zeroes must survive persistence instead of being replaced by species defaults.
    expect(payload.events[0]?.monsterMaxHp).toBe(0);
    expect(payload.events[1]?.monsterAttackProfile).toBeUndefined();

    // The editor reuses that GET payload as its next PUT body without turning it into a 400.
    const editorSave = await putMap(id, token, payload);
    expect(editorSave.status).toBe(200);
  });

  test("round-trips multiple sea guardians when each one is explicitly anchored on water", async () => {
    const { userId, token } = await registerAndLogin("mapguardian");
    const id = await newMapId(await newAdventure(userId), token, "Guardian waters");
    const guardian = {
      id: crypto.randomUUID(),
      col: 1,
      row: 1,
      name: "Sea guardian",
      ordinal: 1,
      kind: "sea-guardian",
      pages: [wirePage({ moveSpeed: 4, optMoveAnim: true })],
    };

    const authored = await putMap(id, token, mapBody({ events: [guardian] }));
    expect(authored.status).toBe(200);
    const fetched = await authedFetch(`/api/maps/${id}`, token);
    const payload = (await fetched.json()) as { events: Array<Record<string, unknown>> };
    expect(payload.events).toEqual([
      expect.objectContaining({
        id: guardian.id,
        col: 1,
        row: 1,
        kind: "sea-guardian",
        species: null,
        patrolRadius: null,
      }),
    ]);
    expect((await putMap(id, token, payload)).status).toBe(200);

    const onLand = await putMap(id, token, mapBody({ events: [{ ...guardian, col: 5, row: 5 }] }));
    expect(onLand.status).toBe(400);
    expect(await onLand.json()).toMatchObject({ error: "map_events" });

    const multiple = await putMap(
      id,
      token,
      mapBody({
        events: [guardian, { ...guardian, id: crypto.randomUUID(), col: 2, ordinal: 2 }],
      }),
    );
    expect(multiple.status).toBe(200);
    const refetched = await authedFetch(`/api/maps/${id}`, token);
    expect(((await refetched.json()) as { events: unknown[] }).events).toHaveLength(2);
  });

  test("round-trips an explicit harvest profile independently from its graphic", async () => {
    const { userId, token } = await registerAndLogin("mapharvest");
    const adventureId = await newAdventure(userId);
    await newMapId(adventureId, token, "Keepalive");
    const id = await newMapId(adventureId, token, "Orchard");
    const resourceId = crypto.randomUUID();
    const harvestable = {
      id: resourceId,
      col: 5,
      row: 5,
      name: "Oak",
      ordinal: 1,
      kind: "harvestable",
      harvestProfile: HARVEST_PROFILE,
      pages: [wirePage({ graphicAssetId: TREE_ASSET_ID })],
    };

    const authored = await putMap(id, token, mapBody({ name: "Orchard", events: [harvestable] }));
    expect(authored.status).toBe(200);

    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as Record<string, unknown> & {
      events: {
        id: string;
        harvestProfile: HarvestProfile;
        pages: (Record<string, unknown> & { graphicAssetId: string | null })[];
      }[];
    };
    expect(payload.events[0]?.harvestProfile).toEqual(HARVEST_PROFILE);
    expect(payload.events[0]?.pages[0]?.graphicAssetId).toBe(TREE_ASSET_ID);

    const changedGraphic = {
      ...payload,
      events: payload.events.map((resource) => ({
        ...resource,
        pages: resource.pages.map((resourcePage) => ({
          ...resourcePage,
          graphicAssetId: OTHER_TREE_ASSET_ID,
        })),
      })),
    };
    const resaved = await putMap(id, token, changedGraphic);
    expect(resaved.status).toBe(200);

    const reloaded = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as typeof payload;
    expect(reloaded.events[0]?.pages[0]?.graphicAssetId).toBe(OTHER_TREE_ASSET_ID);
    expect(reloaded.events[0]?.harvestProfile).toEqual(HARVEST_PROFILE);
    expect(reloaded.events[0]?.harvestProfile).toMatchObject({ resource: "wood", tool: "axe" });
  });

  test("rejects invalid or missing harvest profiles", async () => {
    const { userId, token } = await registerAndLogin("mapharvestbad");
    const id = await newMapId(await newAdventure(userId), token, "Bad Orchard");
    const base = {
      id: crypto.randomUUID(),
      col: 5,
      row: 5,
      name: "Oak",
      ordinal: 1,
      kind: "harvestable",
      pages: [wirePage({ graphicAssetId: TREE_ASSET_ID })],
    };

    const missing = await putMap(id, token, mapBody({ events: [base] }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "map_invalid" });

    const wrongTool = await putMap(
      id,
      token,
      mapBody({
        events: [{ ...base, harvestProfile: { ...HARVEST_PROFILE, tool: "knife" } }],
      }),
    );
    expect(wrongTool.status).toBe(400);
    expect(await wrongTool.json()).toMatchObject({ error: "map_invalid" });

    const invisible = await putMap(
      id,
      token,
      mapBody({
        events: [
          {
            ...base,
            harvestProfile: HARVEST_PROFILE,
            pages: [wirePage({ graphicAssetId: null })],
          },
        ],
      }),
    );
    expect(invisible.status).toBe(400);
    expect(await invisible.json()).toMatchObject({ error: "map_invalid" });
  });

  test("accepts a harvest footprint crossing map bounds", async () => {
    const { userId, token } = await registerAndLogin("maphbounds");
    const id = await newMapId(await newAdventure(userId), token, "Bounded Orchard");
    const crossing = {
      id: crypto.randomUUID(),
      col: 0,
      row: 5,
      name: "Boundary oak",
      ordinal: 1,
      kind: "harvestable",
      harvestProfile: {
        ...HARVEST_PROFILE,
        collision: {
          ...DEFAULT_HARVEST_COLLISIONS.wood,
          intact: { offsetX: -40, offsetY: -30, width: 64, height: 30 },
        },
      },
      pages: [wirePage({ graphicAssetId: TREE_ASSET_ID })],
    };

    const overhanging = await putMap(id, token, mapBody({ events: [crossing] }));
    expect(overhanging.status).toBe(200);

    const accepted = await putMap(id, token, mapBody({ events: [{ ...crossing, col: 1 }] }));
    expect(accepted.status).toBe(200);
  });

  test("drops a harvestable event whose persisted profile JSON is corrupt", async () => {
    const { userId, token } = await registerAndLogin("maphcorrupt");
    const id = await newMapId(await newAdventure(userId), token, "Damaged Orchard");
    const resourceId = crypto.randomUUID();
    const authored = await putMap(
      id,
      token,
      mapBody({
        events: [
          {
            id: resourceId,
            col: 5,
            row: 5,
            name: "Oak",
            ordinal: 1,
            kind: "harvestable",
            harvestProfile: HARVEST_PROFILE,
            pages: [wirePage({ graphicAssetId: TREE_ASSET_ID })],
          },
        ],
      }),
    );
    expect(authored.status).toBe(200);

    await probe.mapEvents.updateById(resourceId, { harvestProfile: "{not-json" });
    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()) as { events: unknown[] }).toMatchObject({ events: [] });
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
  test("round-trips content beyond the former 400-element and 64-event caps", async () => {
    const { userId, token } = await registerAndLogin("mapbulk");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token, "Bulk");

    const ELEMENT_COUNT = 401;
    const EVENT_COUNT = 65;

    // Distinct quarter-cell slots, all with a one-cell margin from every edge (a bush's visual
    // footprint spans the anchor's neighbours) and clear of the spawn and water strip.
    const elements = Array.from({ length: ELEMENT_COUNT }, (_, i) => {
      const slot = i % 16;
      const cell = Math.floor(i / 16);
      return {
        col: 3 + (cell % 15),
        row: 3 + Math.floor(cell / 15),
        offsetX: slot % 4,
        offsetY: Math.floor(slot / 4),
        kind: "bush",
        variant: 0,
      };
    });

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

  test("round-trips authored building durability, orientation and dimensions", async () => {
    const { userId, token } = await registerAndLogin("mapbuilding");
    const id = await newMapId(await newAdventure(userId), token, "Village");
    const building = {
      col: 8,
      row: 8,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE_ASSET_ID,
      orientation: 2,
      building: {
        destructible: false,
        maxHp: 2_750,
        dimensions: { width: 5, depth: 3.125 },
      },
    };

    expect((await putMap(id, token, mapBody({ elements: [building] }))).status).toBe(200);
    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as { elements: unknown[] };
    expect(payload.elements).toEqual([expect.objectContaining(building)]);

    const rows = await probe.mapElements.findMany({ where: { mapId: { eq: id } } });
    expect(rows[0]?.variant).toBeGreaterThan(3);
  });

  test("round-trips resized bridge dimensions through the existing transform column", async () => {
    const { userId, token } = await registerAndLogin("mapbridge");
    const id = await newMapId(await newAdventure(userId), token, "Crossing");
    const bridge = {
      col: 8,
      row: 8,
      offsetX: 0,
      offsetY: 0,
      assetId: BRIDGE_ASSET_ID,
      bridge: { length: 7, width: 2 },
    };

    expect((await putMap(id, token, mapBody({ elements: [bridge] }))).status).toBe(200);
    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as { elements: unknown[] };
    expect(payload.elements).toEqual([expect.objectContaining(bridge)]);

    const rows = await probe.mapElements.findMany({ where: { mapId: { eq: id } } });
    expect(rows[0]?.variant).toBeGreaterThan(3);
  });

  test("round-trips free 3D rotation through the existing transform column", async () => {
    const { userId, token } = await registerAndLogin("maprotation");
    const id = await newMapId(await newAdventure(userId), token, "Rotated village");
    const elements = [
      {
        col: 8,
        row: 8,
        offsetX: 0,
        offsetY: 0,
        assetId: HOUSE_ASSET_ID,
        rotation: 37,
        building: { destructible: true, maxHp: 900 },
      },
      {
        col: 14,
        row: 8,
        offsetX: 0,
        offsetY: 0,
        assetId: BRIDGE_ASSET_ID,
        rotation: 123,
        bridge: { length: 7, width: 2 },
      },
      {
        col: 18,
        row: 13,
        offsetX: 0,
        offsetY: 0,
        assetId: "terrain.bridge.wood.vertical",
        rotation: 0,
      },
    ];

    expect((await putMap(id, token, mapBody({ elements }))).status).toBe(200);
    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as { elements: unknown[] };
    expect(payload.elements).toEqual(elements.map((element) => expect.objectContaining(element)));

    const rows = await probe.mapElements.findMany({ where: { mapId: { eq: id } } });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.variant >= 1_000_000)).toBe(true);
  });

  test("creates one editable interior per building and unlinks it when deleted", async () => {
    const { userId, token } = await registerAndLogin("mapinterior");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token, "Village");
    const building = {
      col: 8,
      row: 8,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE_ASSET_ID,
      building: { destructible: true, maxHp: 1_500 },
    };
    expect(
      (await putMap(id, token, mapBody({ spawn: { col: 6, row: 7 }, elements: [building] })))
        .status,
    ).toBe(200);

    const storedExterior = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as {
      elements: { id?: string }[];
    };
    const buildingId = storedExterior.elements[0]?.id;
    expect(buildingId).toMatch(/^[0-9a-f-]{36}$/i);

    const create = () =>
      authedFetch(`/api/maps/${id}/interiors`, token, {
        method: "POST",
        // The editor captured this slot before its preceding save moved the element. Durable row
        // identity must still resolve the intended building instead of returning map_placement.
        body: JSON.stringify({ elementId: buildingId, col: 3, row: 4, offsetX: 1, offsetY: 2 }),
      });
    const first = await create();
    expect(first.status).toBe(200);
    const created = (await first.json()) as {
      sourceMap: { revision: number; elements: { building?: { interiorMapId?: string } }[] };
      interiorMap: {
        id: string;
        adventureId: string;
        environment: string;
        elements: unknown[];
        events: { pages: { commands: unknown[] }[] }[];
      };
    };
    expect(created.sourceMap.revision).toBe(3);
    expect(created.sourceMap.elements[0]?.building?.interiorMapId).toBe(created.interiorMap.id);
    expect(created.interiorMap).toMatchObject({
      adventureId,
      environment: "interior",
      elements: expect.any(Array),
    });
    expect(created.interiorMap.elements.length).toBeGreaterThan(0);
    expect(created.interiorMap.events[0]?.pages[0]?.commands).toEqual([
      expect.objectContaining({
        t: "teleport",
        mapId: id,
        col: 6,
        row: 7,
        category: "interior",
      }),
    ]);

    // The durable building id is its idempotency key: a double-click cannot mint duplicate rooms.
    const second = await create();
    expect(second.status).toBe(200);
    expect(((await second.json()) as typeof created).interiorMap.id).toBe(created.interiorMap.id);
    expect(await listMaps(adventureId, token)).toHaveLength(2);

    expect(
      (await authedFetch(`/api/maps/${created.interiorMap.id}`, token, { method: "DELETE" }))
        .status,
    ).toBe(204);
    const exterior = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as {
      revision: number;
      elements: { building?: { interiorMapId?: string } }[];
    };
    expect(exterior.revision).toBe(4);
    expect(exterior.elements[0]?.building).not.toHaveProperty("interiorMapId");
  });

  test("does not let editable interiors consume exterior map slots", async () => {
    const { userId, token } = await registerAndLogin("mapintlimit");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token, "Village");
    expect(
      (
        await putMap(
          id,
          token,
          mapBody({
            elements: [
              {
                col: 8,
                row: 8,
                offsetX: 0,
                offsetY: 0,
                assetId: HOUSE_ASSET_ID,
              },
            ],
          }),
        )
      ).status,
    ).toBe(200);
    const building = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as {
      elements: { id?: string }[];
    };
    expect(
      (
        await authedFetch(`/api/maps/${id}/interiors`, token, {
          method: "POST",
          body: JSON.stringify({ elementId: building.elements[0]?.id }),
        })
      ).status,
    ).toBe(200);

    for (let index = 1; index < MAX_ADVENTURE_MAPS; index += 1) {
      const response = await authedFetch("/api/maps", token, {
        method: "POST",
        body: JSON.stringify({
          adventureId,
          name: `Exterior ${index + 1}`,
          cols: MAP_COLS,
          rows: MAP_ROWS,
        }),
      });
      expect(response.status).toBe(201);
    }
    expect(await listMaps(adventureId, token)).toHaveLength(MAX_ADVENTURE_MAPS + 1);
    const refused = await authedFetch("/api/maps", token, {
      method: "POST",
      body: JSON.stringify({
        adventureId,
        name: "Exterior de trop",
        cols: MAP_COLS,
        rows: MAP_ROWS,
      }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "map_limit" });
  });

  test("refuses to create an interior for a non-building slot", async () => {
    const { userId, token } = await registerAndLogin("mapinteriorbad");
    const id = await newMapId(await newAdventure(userId), token, "Forest");
    expect(
      (
        await putMap(
          id,
          token,
          mapBody({
            elements: [{ col: 8, row: 8, offsetX: 0, offsetY: 0, assetId: TREE_ASSET_ID }],
          }),
        )
      ).status,
    ).toBe(200);
    const response = await authedFetch(`/api/maps/${id}/interiors`, token, {
      method: "POST",
      body: JSON.stringify({ col: 8, row: 8, offsetX: 0, offsetY: 0 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "map_placement" });
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

  test("persists per-map hero stats and disabled abilities", async () => {
    const { userId, token } = await registerAndLogin("mapheroes");
    const adventureId = await newAdventure(userId);
    const id = await newMapId(adventureId, token);
    const heroSettings = defaultMapHeroSettings();
    // A PIXEL speed, as every stored map authored before the tile-unit conversion holds. The map
    // boundary accepts it for compatibility but never lets the pixel reading reach movement.
    heroSettings.classes.rogue.stats.movementSpeed = 350;
    heroSettings.classes.rogue.disabledSkills = [3, 5];

    const updated = await putMap(id, token, mapBody({ heroSettings }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      heroSettings: {
        classes: {
          rogue: { stats: { movementSpeed: 350 / 64 }, disabledSkills: [3, 5] },
        },
      },
    });

    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({
      heroSettings: {
        classes: {
          rogue: { stats: { movementSpeed: 350 / 64 }, disabledSkills: [3, 5] },
        },
      },
    });
  });

  test("persists the per-map day/night cycle and fixed ambience policy", async () => {
    const { userId, token } = await registerAndLogin("mapclock");
    const id = await newMapId(await newAdventure(userId), token);

    const initial = await authedFetch(`/api/maps/${id}`, token);
    expect(initial.status).toBe(200);
    // A created map comes off `defaultMapInput`, which mints permanent day rather than the cycle.
    expect(await initial.json()).toMatchObject({ dayNightCycle: false, fixedLighting: "day" });

    const updated = await putMap(
      id,
      token,
      mapBody({ dayNightCycle: false, fixedLighting: "night-middle" }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      dayNightCycle: false,
      fixedLighting: "night-middle",
    });

    const fetched = await authedFetch(`/api/maps/${id}`, token);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({
      dayNightCycle: false,
      fixedLighting: "night-middle",
    });

    // And back the other way — opting a map INTO the cycle persists too, which the default no
    // longer proves on its own.
    const cycling = await putMap(
      id,
      token,
      mapBody({ dayNightCycle: true, fixedLighting: "night-middle" }),
    );
    expect(cycling.status).toBe(200);
    const reread = await authedFetch(`/api/maps/${id}`, token);
    expect(reread.status).toBe(200);
    expect(await reread.json()).toMatchObject({ dayNightCycle: true });
  });

  test("upgrades a persisted four-class hero profile without dropping its overrides", async () => {
    const { userId, token } = await registerAndLogin("maphlegacy");
    const id = await newMapId(await newAdventure(userId), token);
    const legacy = defaultMapHeroSettings() as unknown as {
      classes: Record<string, unknown>;
    };
    const rogue = legacy.classes.rogue as ReturnType<
      typeof defaultMapHeroSettings
    >["classes"]["rogue"];
    rogue.stats.movementSpeed = 341;
    rogue.disabledSkills = [2, 5];
    delete legacy.classes.peasant;
    await probe.maps.updateById(id, { heroSettings: JSON.stringify(legacy) });

    const loaded = (await (await authedFetch(`/api/maps/${id}`, token)).json()) as {
      heroSettings: ReturnType<typeof defaultMapHeroSettings>;
    };
    expect(loaded.heroSettings.classes.rogue).toMatchObject({
      stats: { movementSpeed: 341 / 64 },
      disabledSkills: [2, 5],
    });
    expect(loaded.heroSettings.classes.peasant).toEqual(defaultMapHeroSettings().classes.peasant);

    const resaved = await putMap(id, token, mapBody({ heroSettings: loaded.heroSettings }));
    expect(resaved.status).toBe(200);
    expect(await resaved.json()).toMatchObject({
      heroSettings: {
        classes: {
          rogue: { stats: { movementSpeed: 341 / 64 }, disabledSkills: [2, 5] },
          peasant: { stats: { movementSpeed: 247 / 64 }, disabledSkills: [] },
        },
      },
    });
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

describe("map ownership fence", () => {
  // An id is not a capability for WRITING: every mutating route proves the authenticated author
  // before touching a row. Reading is a different question and deliberately answers differently —
  // an adventure is readable by any account, and an adventure whose maps are not readable is not
  // readable at all. That half is asserted in `adventures.test.ts`; this test owns the write half
  // and the two enumerating/reading lines below now assert the OPEN behaviour so the split is
  // visible in one place.
  test("a foreign account can enumerate and read, but cannot edit, re-flag, delete or extend", async () => {
    const owner = await registerAndLogin("mapowner");
    const adventureId = await newAdventure(owner.userId);
    const id = await newMapId(adventureId, owner.token, "Shared");

    const rival = await registerAndLogin("maprival");
    expect(await listMaps(adventureId, rival.token)).toHaveLength(1);
    expect((await authedFetch(`/api/maps/${id}`, rival.token)).status).toBe(200);

    const edited = await putMap(id, rival.token, mapBody({ name: "Edited by rival" }));
    expect(edited.status).toBe(404);
    expect(await edited.json()).toMatchObject({ error: "map_not_found" });

    const flagged = await authedFetch(`/api/maps/${id}/first`, rival.token, { method: "POST" });
    expect(flagged.status).toBe(404);

    const removed = await authedFetch(`/api/maps/${id}?force=true`, rival.token, {
      method: "DELETE",
    });
    expect(removed.status).toBe(404);

    const created = await authedFetch("/api/maps", rival.token, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "Injected" }),
    });
    expect(created.status).toBe(404);

    const preserved = await authedFetch(`/api/maps/${id}`, owner.token);
    expect(preserved.status).toBe(200);
    expect(await preserved.json()).toMatchObject({ name: "Shared", revision: 1 });
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

  test("accepts scenery anchored on a border even when its art overhangs", async () => {
    const { userId, token } = await registerAndLogin("mapborderdecor");
    const id = await newMapId(await newAdventure(userId), token);
    const response = await putMap(
      id,
      token,
      mapBody({ elements: [{ col: 0, row: 5, kind: "tree", variant: 0 }] }),
    );
    expect(response.status).toBe(200);
  });

  test("400s map_spawn when scenery covers the spawn cell", async () => {
    const { userId, token } = await registerAndLogin("mapspawn");
    const id = await newMapId(await newAdventure(userId), token);
    // The spawn rule remains independent from the now-authorized visual overhang at map borders.
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

  test("accepts a functional event on water", async () => {
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
    expect(response.status).toBe(200);
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

  test("force-deleting the start map clears startMapId, and a hero still lands somewhere real", async () => {
    const { userId, token } = await registerAndLogin("mapstartclear");
    const adventureId = await newAdventure(userId);
    // Created first, so it is also the earliest-created member map — the tier the cleared column
    // falls back to (`HeroService.resolveHeroStart`'s tier 2).
    const survivorId = await newMapId(adventureId, token, "Survivor");
    const startId = await newMapId(adventureId, token, "Start");

    const pinned = await authedFetch(`/api/adventures/${adventureId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "Adv", maxPlayers: 4, startMapId: startId }),
    });
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toMatchObject({ startMapId: startId });

    const forced = await authedFetch(`/api/maps/${startId}?force=true`, token, {
      method: "DELETE",
    });
    expect(forced.status).toBe(204);

    // Cleared at the source (`MapService.deleteMap`'s conditional `updateMany`), not just tolerated
    // at read time: the editor's star must not keep pointing at a map that no longer exists.
    const read = await authedFetch(`/api/adventures/${adventureId}`, token);
    expect(await read.json()).toMatchObject({ startMapId: null });

    const partyResponse = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    expect(partyResponse.status).toBe(201);
    const partyId = ((await partyResponse.json()) as { id: string }).id;
    const heroResponse = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Survivor", class: "warrior" }),
    });
    expect(heroResponse.status).toBe(201);
    // A cleared column is not a broken adventure — the hero lands on the earliest surviving map,
    // exactly like an adventure that never authored a start map at all.
    expect((await heroResponse.json()) as { mapId: string }).toMatchObject({ mapId: survivorId });
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
