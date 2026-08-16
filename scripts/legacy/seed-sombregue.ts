/**
 * Seeds "Sombregué" — six generated islands, the Goblin Raiders warband, a merchant and a seven-quest
 * chain — through the same /api/* surface the editor uses. Idempotent: re-running updates in place;
 * `--reset` deletes the adventure first.
 *
 * Run with: yarn seed:sombregue --target=http://localhost:5273
 * Dry run:  yarn seed:sombregue --dry-run
 *
 * There is no adventure GRAPH here. Every crossing is a `teleport` command on an ordinary scripted
 * event, which is why the seed runs in two content passes: pass one writes each map (terrain, props,
 * NPCs, monsters), pass two rewrites it with the ferry events now that every destination map has a
 * server-minted uuid.
 */
import {
  bakeCollision,
  elementCoversCell,
  elementFitsMap,
  parseMapData,
} from "@lindocara/engine/map-data.js";
import { type MapEvent, parseMapEvents } from "@lindocara/engine/map-events.js";
import { validateAuthoredQuests } from "@lindocara/engine/quests.js";
import { isSolidKind, kindAt } from "@lindocara/engine/tilemap.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import {
  type BuiltWorld,
  buildSombregue,
  type MapContent,
  type MapKey,
  SWITCH_GRUMLOK,
} from "./sombregue/maps.js";
import { buildQuests, type MapIdByKey } from "./sombregue/quests.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
// Bay is current; keep the retired Cloudflare host protected while its data remains reachable.
const PRODUCTION_HOSTS = new Set(["lindocara.bay.alepha.dev", "lindocara.alepha.dev"]);
const ADVENTURE_TITLE = "Sombregué";
const AUTHOR_USERNAME = "sombregueauthor";
const MAX_PLAYERS = 4;

interface Config {
  target: URL;
  reset: boolean;
  dryRun: boolean;
  password: string;
}

interface ApiResult {
  response: Response;
  body: unknown;
}

let sessionCookieValue: string | null = null;

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
  const target = new URL(args.get("target") ?? "http://localhost:5273");
  if (!LOCAL_HOSTS.has(target.hostname) && args.get("allow-remote") !== "true") {
    throw new Error("remote targets require --allow-remote=true");
  }
  if (PRODUCTION_HOSTS.has(target.hostname) && args.get("allow-production") !== "true") {
    throw new Error("the production host requires --allow-production=true");
  }
  const password = process.env.SEED_PASSWORD ?? "Sombregue-Local-2026";
  if (PRODUCTION_HOSTS.has(target.hostname) && !process.env.SEED_PASSWORD) {
    throw new Error("production seeding requires SEED_PASSWORD");
  }
  return {
    target,
    reset: args.get("reset") === "true",
    dryRun: args.get("dry-run") === "true",
    password,
  };
}

function mapBody(map: MapContent, events: MapEvent[]): Record<string, unknown> {
  return {
    name: map.name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: map.cols,
    rows: map.rows,
    layers: map.layers,
    spawn: map.spawn,
    elements: map.elements,
    events,
  };
}

/**
 * The same total parsers the server runs, plus the two facts a generated island can get wrong:
 * a spawn or an event standing in the sea, and a prop hanging off the map.
 */
function validateMapLocally(map: MapContent, events: MapEvent[]): string[] {
  const problems: string[] = [];
  const data = parseMapData(mapBody(map, events));
  if (!data) {
    problems.push(`${map.key}: the wire parser rejected the map`);
    return problems;
  }
  if (!parseMapEvents(events, map.cols, map.rows)) {
    problems.push(`${map.key}: the wire parser rejected the events`);
  }
  // Mirror the server's own three rules exactly (`maps.ts`), so a dry run that passes is a save that
  // passes: baked collision at the spawn, no scenery COVERING it, and every functional event on
  // walkable ground.
  const baked = bakeCollision(data);
  if (isSolidKind(kindAt(baked, map.spawn.col, map.spawn.row))) {
    problems.push(`${map.key}: the spawn (${map.spawn.col},${map.spawn.row}) is not walkable`);
  }
  for (const element of map.elements) {
    if (elementCoversCell(element, map.spawn.col, map.spawn.row)) {
      problems.push(`${map.key}: ${element.assetId} covers the spawn`);
    }
  }
  for (const event of events) {
    if (event.kind === "normal") continue;
    if (isSolidKind(kindAt(baked, event.col, event.row))) {
      problems.push(
        `${map.key}: ${event.kind} event "${event.name}" at (${event.col},${event.row}) is on solid ground`,
      );
    }
  }
  const slots = new Set<string>();
  for (const element of map.elements) {
    if (!elementFitsMap(element, map.cols, map.rows)) {
      problems.push(
        `${map.key}: element ${element.assetId} at (${element.col},${element.row}) is off the map`,
      );
    }
    // The D1 primary key `(mapId, col, row, offsetX, offsetY)`: two props in one slot fail the insert.
    const slot = `${element.col}:${element.row}:${element.offsetX}:${element.offsetY}`;
    if (slots.has(slot)) problems.push(`${map.key}: two elements share the slot ${slot}`);
    slots.add(slot);
  }
  return problems;
}

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

interface StoredMapSummary {
  id: string;
  name: string;
  revision: number;
}

async function findAdventureByTitle(config: Config, title: string): Promise<string | null> {
  const result = await api(config, "/api/adventures", { method: "GET" });
  if (!result.response.ok || !Array.isArray(result.body)) throw failure("adventure list", result);
  return (result.body as AdventureSummary[]).find((entry) => entry.title === title)?.id ?? null;
}

async function seed(config: Config, world: BuiltWorld): Promise<void> {
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
  for (const [index, map] of world.maps.entries()) {
    let existing = summaries.find((entry) => entry.name === map.name);
    if (!existing && index === 0) {
      existing = createdDefaultMapId
        ? summaries.find((entry) => entry.id === createdDefaultMapId)
        : summaries.length === 1
          ? summaries[0]
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
  }

  // Pass one: everything that needs no other map's id.
  for (const map of world.maps) {
    const put = await api(config, `/api/maps/${mapId[map.key]}`, {
      method: "PUT",
      body: JSON.stringify(mapBody(map, map.events)),
    });
    if (!put.response.ok) throw failure(`map content ${map.key}`, put);
    console.log(`saved ${map.key} content`);
  }

  // Pass two: the ferries, now that every destination exists.
  for (const map of world.maps) {
    const events = [...map.events, ...map.linkedEvents(mapId)];
    const put = await api(config, `/api/maps/${mapId[map.key]}`, {
      method: "PUT",
      body: JSON.stringify(mapBody(map, events)),
    });
    if (!put.response.ok) throw failure(`map ferries ${map.key}`, put);
    console.log(`saved ${map.key} ferries (${map.linkedEvents(mapId).length})`);
  }

  const quests = buildQuests(mapId, world.refs);
  const registry = {
    switches: [{ id: SWITCH_GRUMLOK, name: "Grumlok vaincu" }],
    variables: [],
    quests,
  };
  const putAdventure = await api(config, `/api/adventures/${adventureId}`, {
    method: "PUT",
    body: JSON.stringify({ title: ADVENTURE_TITLE, maxPlayers: MAX_PLAYERS, registry }),
  });
  if (!putAdventure.response.ok) throw failure("adventure registry", putAdventure);
  console.log(`saved adventure registry (${quests.length} quests)`);

  const adventure = await api(config, `/api/adventures/${adventureId}`, { method: "GET" });
  const adventureBody = adventure.body as {
    mapIds?: string[];
    registry?: { quests?: unknown[] };
  } | null;
  if (!adventure.response.ok || !adventureBody) throw failure("adventure verify", adventure);
  if (adventureBody.mapIds?.length !== world.maps.length) {
    throw new Error(`verify: expected ${world.maps.length} maps`);
  }
  const questCount = adventureBody.registry?.quests?.length ?? 0;
  if (questCount !== quests.length) {
    throw new Error(`verify: expected ${quests.length} quests, got ${questCount}`);
  }
  for (const map of world.maps) {
    const stored = await api(config, `/api/maps/${mapId[map.key]}`, { method: "GET" });
    const storedBody = stored.body as { events?: unknown[] } | null;
    if (!stored.response.ok || !storedBody) throw failure(`map verify ${map.key}`, stored);
    const expected = map.events.length + map.linkedEvents(mapId).length;
    if (storedBody.events?.length !== expected) {
      throw new Error(
        `verify ${map.key}: expected ${expected} events, got ${storedBody.events?.length}`,
      );
    }
  }
  console.log(
    `seed verified: ${ADVENTURE_TITLE} ${adventureId} — ${world.maps.length} maps, ${quests.length} quests`,
  );
}

async function main(): Promise<void> {
  const config = configuration(process.argv.slice(2));
  const world = buildSombregue();

  const problems: string[] = [];
  const fakeIds = Object.fromEntries(
    world.maps.map((map) => [map.key, "00000000-0000-4000-8000-000000000000"]),
  ) as Record<MapKey, string>;
  for (const map of world.maps) {
    problems.push(...validateMapLocally(map, [...map.events, ...map.linkedEvents(fakeIds)]));
  }
  const questProblems = validateAuthoredQuests(buildQuests(fakeIds, world.refs));
  problems.push(...questProblems.map((problem) => `quests: ${problem}`));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    throw new Error(`${problems.length} content problem(s) — nothing was written`);
  }
  for (const map of world.maps) {
    console.log(
      `  ✓ ${map.name}: ${map.cols}x${map.rows}, ${map.elements.length} props, ` +
        `${map.events.length + map.linkedEvents(fakeIds).length} events`,
    );
  }
  if (config.dryRun) {
    console.log("dry run: content validated, nothing written");
    return;
  }
  await ensureSession(config);
  await seed(config, world);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
