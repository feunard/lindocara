/**
 * Seeds the Brumeval intro adventure (3 maps, NPCs, monsters, 6 chained quests, boss, victory)
 * through the same /api/* surface the editor uses. Idempotent: re-running updates in place;
 * `--reset` deletes the adventure first.
 *
 * Run with: npm run seed:brumeval -- --target=http://localhost:5178
 * Dry run:  npm run seed:brumeval -- --dry-run
 * Prod:     SEED_PASSWORD=… npm run seed:brumeval -- --target=https://lindocara.alepha.dev \
 *             --allow-remote --allow-production
 *
 * Design: docs/superpowers/specs/2026-07-24-brumeval-adventure-design.md
 * Plan:   docs/superpowers/plans/2026-07-24-brumeval-adventure.md
 */
import type { AdventureGraph, AdventureLink } from "@lindocara/engine/adventure.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import { isWalkable } from "@lindocara/engine/game.js";
import type { MonsterSpecies } from "@lindocara/engine/game.js";
import {
  bakeCollision,
  canPlaceElement,
  elementFitsMap,
  elementPlacementCells,
  parseMapData,
  terrainFromMap,
} from "@lindocara/engine/map-data.js";
import { kindAt } from "@lindocara/engine/tilemap.js";
import { type MapEvent, eventCellCentre, parseMapEvents } from "@lindocara/engine/map-events.js";
import {
  collectQuestCommandBindings,
  validateAuthoredQuests,
} from "@lindocara/engine/quests.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { type BuiltWorld, type MapContent, buildWorld } from "./brumeval/maps.js";
import { type MapIdByKey, buildRegistry } from "./brumeval/quests.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCTION_HOST = "lindocara.alepha.dev";
const ADVENTURE_TITLE = "Brumeval";
const AUTHOR_USERNAME = "brumevalauthor";
const MAX_PLAYERS = 4;

interface Config {
  target: URL;
  reset: boolean;
  dryRun: boolean;
  password: string;
}

function argumentsOf(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args.set(raw.slice(2), "true");
    else args.set(raw.slice(2, eq), raw.slice(eq + 1));
  }
  return args;
}

function configuration(argv: string[]): Config {
  const args = argumentsOf(argv);
  const target = new URL(args.get("target") ?? "http://localhost:5178");
  if (!LOCAL_HOSTS.has(target.hostname) && args.get("allow-remote") !== "true") {
    throw new Error("remote targets require --allow-remote=true");
  }
  if (target.hostname === PRODUCTION_HOST && args.get("allow-production") !== "true") {
    throw new Error("the production host requires --allow-production=true");
  }
  const password = process.env.SEED_PASSWORD ?? "Brumeval-Local-2026";
  if (target.hostname === PRODUCTION_HOST && !process.env.SEED_PASSWORD) {
    throw new Error("production seeding requires SEED_PASSWORD");
  }
  return {
    target,
    reset: args.get("reset") === "true",
    dryRun: args.get("dry-run") === "true",
    password,
  };
}

// ---------------------------------------------------------------------------
// Local validation (dry-run and pre-flight): the same total parsers the server runs.
// ---------------------------------------------------------------------------

function mapDataBody(map: MapContent, withExits: boolean): Record<string, unknown> {
  const events = withExits ? [...map.events, ...map.exits.map((exit) => exit.event)] : map.events;
  return {
    name: map.name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: map.cols,
    rows: map.rows,
    layers: map.layers,
    elements: map.elements,
    spawn: map.spawn,
    markers: { entries: [], exits: [], monsterSpawns: [] },
    events,
  };
}

function validateMapLocally(map: MapContent): string[] {
  const problems: string[] = [];
  const body = mapDataBody(map, true);
  const data = parseMapData(body);
  if (!data) {
    problems.push(`${map.key}: parseMapData rejected the body`);
    return problems;
  }
  const events = parseMapEvents(body.events, map.cols, map.rows);
  if (!events) {
    problems.push(`${map.key}: parseMapEvents rejected the events`);
    return problems;
  }
  const ground = bakeCollision({ ...data, elements: [] });
  for (const element of data.elements) {
    if (!elementFitsMap(element, ground.cols, ground.rows)) {
      problems.push(`${map.key}: ${element.assetId} at (${element.col},${element.row}) exceeds bounds`);
      continue;
    }
    for (const cell of elementPlacementCells(element)) {
      const under = kindAt(ground, cell.col, cell.row);
      if (!canPlaceElement(element.assetId, under)) {
        problems.push(
          `${map.key}: ${element.assetId} at (${element.col},${element.row}) cannot stand on ${under}`,
        );
      }
    }
  }
  const terrain = terrainFromMap(data);
  const walkabilityChecks: { label: string; col: number; row: number }[] = [
    { label: "spawn", col: map.spawn.col, row: map.spawn.row },
    ...events
      .filter((event) => event.kind !== "monster")
      .map((event) => ({ label: `event ${event.name || event.kind}`, ...event })),
  ];
  for (const check of walkabilityChecks) {
    const centre = eventCellCentre(check);
    if (!isWalkable(centre, undefined, terrain)) {
      problems.push(`${map.key}: ${check.label} at (${check.col},${check.row}) is not walkable`);
    }
  }
  return problems;
}

function validateQuestsLocally(world: BuiltWorld, mapId: MapIdByKey): string[] {
  const registry = buildRegistry(mapId, world.refs);
  const keyToId = mapId;
  const mapIds = new Set(Object.values(keyToId));
  const eventIdsByMap = new Map<string, Set<string>>();
  const monsterSpeciesByMap = new Map<string, Set<MonsterSpecies>>();
  const monsterEventIdsByMap = new Map<string, Set<string>>();
  const areaIdsByMap = new Map<string, Set<string>>();
  const offeredQuestIds = new Set<string>();
  const turnInQuestIds = new Set<string>();
  const activityIds = new Set<string>();

  for (const map of world.maps) {
    const id = keyToId[map.key];
    const allEvents: MapEvent[] = [...map.events, ...map.exits.map((exit) => exit.event)];
    eventIdsByMap.set(id, new Set(allEvents.map((event) => event.id)));
    monsterSpeciesByMap.set(
      id,
      new Set(
        allEvents
          .filter((event) => event.kind === "monster" && event.species)
          .map((event) => event.species as MonsterSpecies),
      ),
    );
    monsterEventIdsByMap.set(
      id,
      new Set(allEvents.filter((event) => event.kind === "monster").map((event) => event.id)),
    );
    const areas = new Set<string>();
    for (const event of allEvents) {
      for (const page of event.pages) {
        collectQuestCommandBindings(
          page.commands as EventCommand[],
          offeredQuestIds,
          turnInQuestIds,
          activityIds,
          areas,
        );
      }
    }
    areaIdsByMap.set(id, areas);
  }

  const diagnostics = validateAuthoredQuests(registry.quests, {
    mapIds,
    eventIdsByMap,
    monsterSpeciesByMap,
    monsterEventIdsByMap,
    areaIdsByMap,
    itemIds: new Set(CONSUMABLE_IDS),
    activityIds,
    switchIds: new Set(registry.switches.map((entry) => entry.id)),
    variableIds: new Set(registry.variables.map((entry) => entry.id)),
    offeredQuestIds,
    turnInQuestIds,
  });
  for (const diagnostic of diagnostics.filter((entry) => entry.severity === "warning")) {
    console.warn(`quest warning: ${diagnostic.code} (quest ${diagnostic.questId})`);
  }
  return diagnostics
    .filter((entry) => entry.severity === "error")
    .map(
      (entry) =>
        `quest ${entry.questId}: ${entry.code}${entry.reference ? ` [${entry.reference}]` : ""}`,
    );
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

interface ApiResult {
  response: Response;
  body: unknown;
}

let sessionCookieValue: string | null = null;

async function api(config: Config, path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (sessionCookieValue) headers.Cookie = sessionCookieValue;
  const response = await fetch(new URL(path, config.target), { ...init, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

function failure(operation: string, result: ApiResult): Error {
  const record = result.body as Record<string, unknown> | null;
  const code = typeof record?.error === "string" ? `: ${record.error}` : "";
  return new Error(`${operation} failed (${result.response.status}${code})`);
}

async function ensureSession(config: Config): Promise<void> {
  const credentials = JSON.stringify({ username: AUTHOR_USERNAME, password: config.password });
  let auth = await api(config, "/api/register", { method: "POST", body: credentials });
  if (auth.response.status === 409) {
    auth = await api(config, "/api/session", { method: "POST", body: credentials });
  }
  if (!auth.response.ok) throw failure("authentication", auth);
  const cookie = auth.response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
  if (!cookie) throw new Error("authentication response omitted the session cookie");
  sessionCookieValue = cookie;
  console.log(`session ok (${AUTHOR_USERNAME} @ ${config.target.origin})`);
}

interface AdventureSummary {
  id: string;
  title: string;
}

async function findAdventureByTitle(config: Config, title: string): Promise<string | null> {
  const result = await api(config, "/api/adventures", { method: "GET" });
  if (!result.response.ok || !Array.isArray(result.body)) throw failure("adventure list", result);
  const found = (result.body as AdventureSummary[]).find((entry) => entry.title === title);
  return found?.id ?? null;
}

interface StoredMapSummary {
  id: string;
  name: string;
  revision: number;
}

// ---------------------------------------------------------------------------
// Seed flow
// ---------------------------------------------------------------------------

async function seed(config: Config, world: BuiltWorld): Promise<void> {
  // ① Adventure + three maps.
  let adventureId = await findAdventureByTitle(config, ADVENTURE_TITLE);
  if (adventureId && config.reset) {
    const del = await api(config, `/api/adventures/${adventureId}`, { method: "DELETE" });
    if (!del.response.ok) throw failure("adventure delete", del);
    console.log(`deleted existing adventure ${adventureId}`);
    adventureId = null;
  }
  let createdDefaultMapId: string | null = null;
  if (!adventureId) {
    const created = await api(config, "/api/adventures", {
      method: "POST",
      body: JSON.stringify({ title: ADVENTURE_TITLE, maxPlayers: MAX_PLAYERS }),
    });
    const body = created.body as { id?: string; defaultMap?: { id?: string } } | null;
    if (!created.response.ok || !body?.id) throw failure("adventure create", created);
    adventureId = body.id;
    createdDefaultMapId = body.defaultMap?.id ?? null;
    console.log(`created adventure ${adventureId}`);
  }

  const listed = await api(config, `/api/maps?adventure=${adventureId}`, { method: "GET" });
  if (!listed.response.ok || !Array.isArray(listed.body)) throw failure("map list", listed);
  const summaries = listed.body as StoredMapSummary[];

  const mapId = {} as MapIdByKey;
  const revisions = new Map<string, number>();
  for (const [index, map] of world.maps.entries()) {
    let existing = summaries.find((entry) => entry.name === map.name);
    if (!existing && index === 0) {
      // The adventure's default map becomes Brumeval's first map.
      existing =
        summaries.length === 1 && !summaries.some((entry) => entry.name === map.name)
          ? summaries[0]
          : createdDefaultMapId
            ? summaries.find((entry) => entry.id === createdDefaultMapId)
            : undefined;
    }
    if (!existing) {
      const created = await api(config, "/api/maps", {
        method: "POST",
        body: JSON.stringify({ adventureId, name: map.name }),
      });
      const body = created.body as { id?: string; revision?: number } | null;
      if (!created.response.ok || !body?.id) throw failure(`map create ${map.key}`, created);
      existing = { id: body.id, name: map.name, revision: body.revision ?? 0 };
      console.log(`created map ${map.key} → ${existing.id}`);
    }
    mapId[map.key] = existing.id;
    revisions.set(existing.id, existing.revision);
  }

  // ② Content without exits (no graph constraint applies to a map without exit events).
  for (const map of world.maps) {
    const id = mapId[map.key];
    const put = await api(config, `/api/maps/${id}`, {
      method: "PUT",
      body: JSON.stringify(mapDataBody(map, false)),
    });
    const body = put.body as { revision?: number } | null;
    if (!put.response.ok) throw failure(`map content ${map.key}`, put);
    revisions.set(id, body?.revision ?? 0);
    console.log(`saved ${map.key} content (rev ${body?.revision})`);
  }

  // ③ Exits + cumulative graph, one map at a time, graph in the same transaction.
  const entryId = (mapKey: MapContent["key"], entryKey: string): string => {
    const map = world.maps.find((entry) => entry.key === mapKey);
    const event = map?.entries[entryKey];
    if (!event) throw new Error(`unknown entry ${mapKey}:${entryKey}`);
    return event.id;
  };
  const boundLinks: AdventureLink[] = [];
  for (const map of world.maps) {
    if (map.exits.length === 0) continue;
    const id = mapId[map.key];
    for (const exit of map.exits) {
      boundLinks.push({
        mapId: id,
        exitId: exit.event.id,
        dest:
          exit.dest === "end"
            ? "end"
            : { mapId: mapId[exit.dest.toMap], entryId: entryId(exit.dest.toMap, exit.dest.entryKey) },
      });
    }
    const graph: AdventureGraph = { start: null, links: [...boundLinks] };
    const put = await api(config, `/api/maps/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...mapDataBody(map, true),
        adventure: { title: ADVENTURE_TITLE, maxPlayers: MAX_PLAYERS, graph },
      }),
    });
    const body = put.body as { revision?: number } | null;
    if (!put.response.ok) throw failure(`map exits ${map.key}`, put);
    revisions.set(id, body?.revision ?? 0);
    console.log(`saved ${map.key} exits + graph (rev ${body?.revision})`);
  }

  // ④ Registry (switches + quests) on the adventure row.
  const registry = buildRegistry(mapId, world.refs);
  const graph: AdventureGraph = { start: null, links: boundLinks };
  const putAdventure = await api(config, `/api/adventures/${adventureId}`, {
    method: "PUT",
    body: JSON.stringify({ title: ADVENTURE_TITLE, maxPlayers: MAX_PLAYERS, graph, registry }),
  });
  if (!putAdventure.response.ok) throw failure("adventure registry", putAdventure);
  console.log("saved adventure registry (switches + quests)");

  // ⑤ Verification: re-read everything and assert counts.
  const adventure = await api(config, `/api/adventures/${adventureId}`, { method: "GET" });
  const adventureBody = adventure.body as {
    mapIds?: string[];
    graph?: { links?: unknown[] };
    registry?: { quests?: unknown[]; switches?: unknown[] };
  } | null;
  if (!adventure.response.ok || !adventureBody) throw failure("adventure verify", adventure);
  const questCount = adventureBody.registry?.quests?.length ?? 0;
  const linkCount = adventureBody.graph?.links?.length ?? 0;
  if (adventureBody.mapIds?.length !== 3) throw new Error("verify: expected 3 maps");
  if (questCount !== 6) throw new Error(`verify: expected 6 quests, got ${questCount}`);
  if (linkCount !== 5) throw new Error(`verify: expected 5 graph links, got ${linkCount}`);
  for (const map of world.maps) {
    const stored = await api(config, `/api/maps/${mapId[map.key]}`, { method: "GET" });
    const storedBody = stored.body as { events?: unknown[]; elements?: unknown[] } | null;
    if (!stored.response.ok || !storedBody) throw failure(`map verify ${map.key}`, stored);
    const expectedEvents = map.events.length + map.exits.length;
    if (storedBody.events?.length !== expectedEvents) {
      throw new Error(
        `verify ${map.key}: expected ${expectedEvents} events, got ${storedBody.events?.length}`,
      );
    }
    const spawnEvent = (storedBody.events as MapEvent[]).find((event) => event.kind === "spawn");
    if (map.key === "abbaye" && !spawnEvent) throw new Error("verify: abbaye lost its spawn event");
  }
  console.log(`seed verified: adventure ${adventureId} — 3 maps, 5 links, 6 quests`);
}

async function main(): Promise<void> {
  const config = configuration(process.argv.slice(2));
  const world = buildWorld();

  const problems = world.maps.flatMap((map) => validateMapLocally(map));
  const placeholderIds: MapIdByKey = {
    abbaye: "00000000-0000-4000-8000-000000000001",
    ronceclair: "00000000-0000-4000-8000-000000000002",
    antre: "00000000-0000-4000-8000-000000000003",
  };
  problems.push(...validateQuestsLocally(world, placeholderIds));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`invalid: ${problem}`);
    throw new Error(`${problems.length} local validation problem(s)`);
  }
  console.log(`local validation ok: ${world.maps.length} maps, 6 quests`);
  if (config.dryRun) return;

  await ensureSession(config);
  await seed(config, world);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
