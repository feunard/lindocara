/**
 * Export / import a whole adventure as ONE portable JSON bundle (engine `adventure-bundle.ts`).
 *
 *   npm run adventure:export -- --adventure="Brumeval" --out=adventures/brumeval.json \
 *     [--target=http://localhost:5178] [--username=brumevalauthor]
 *   npm run adventure:import -- --file=adventures/brumeval.json [--title="Autre titre"] \
 *     [--reset] [--target=…] [--username=…]
 *
 * Remote/production targets are gated behind --allow-remote / --allow-production and SEED_PASSWORD,
 * exactly like the seed. Import is idempotent by title; it re-mints every event uuid (a map_event id
 * is a global primary key) and rewrites all internal references (graph, quests, teleports).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { AdventureGraph } from "@lindocara/engine/adventure.js";
import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  type AdventureBundleMap,
  mintEventIdMapping,
  parseAdventureBundle,
  rewriteBundleIds,
} from "@lindocara/engine/adventure-bundle.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import { ApiClient, argumentsOf, resolveCredentials, resolveTarget } from "./lib/adventure-api.js";

const DEFAULT_USERNAME = "brumevalauthor";

interface StoredMapPayload {
  id: string;
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: unknown[];
  spawn: { col: number; row: number };
  events: MapEvent[];
  revision: number;
}

function mapSaveBody(
  map: AdventureBundleMap,
  events: readonly MapEvent[],
): Record<string, unknown> {
  return {
    name: map.name,
    tilesetId: map.tilesetId,
    cols: map.cols,
    rows: map.rows,
    layers: map.layers,
    elements: map.elements,
    spawn: map.spawn,
    markers: { entries: [], exits: [], monsterSpawns: [] },
    events,
  };
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

async function exportAdventure(client: ApiClient, title: string, outFile: string): Promise<void> {
  const adventureId = await client.findAdventureByTitle(title);
  if (!adventureId) throw new Error(`no adventure titled "${title}" on this account`);
  const adventure = await client.request(`/api/adventures/${adventureId}`, { method: "GET" });
  const adventureBody = adventure.body as {
    title: string;
    maxPlayers: number;
    mapIds: string[];
    graph: AdventureGraph;
    registry: unknown;
  } | null;
  if (!adventure.response.ok || !adventureBody) throw client.failure("adventure read", adventure);

  const maps: AdventureBundleMap[] = [];
  for (const mapId of adventureBody.mapIds) {
    const stored = await client.request(`/api/maps/${mapId}`, { method: "GET" });
    const body = stored.body as StoredMapPayload | null;
    if (!stored.response.ok || !body) throw client.failure(`map read ${mapId}`, stored);
    maps.push({
      id: body.id,
      name: body.name,
      tilesetId: body.tilesetId,
      cols: body.cols,
      rows: body.rows,
      layers: body.layers,
      elements: body.elements as AdventureBundleMap["elements"],
      spawn: body.spawn,
      events: body.events,
    });
  }

  const bundle = {
    format: ADVENTURE_BUNDLE_FORMAT,
    version: ADVENTURE_BUNDLE_VERSION,
    adventure: {
      title: adventureBody.title,
      maxPlayers: adventureBody.maxPlayers,
      registry: adventureBody.registry,
    },
    maps,
    graph: adventureBody.graph,
  };
  const parsed = parseAdventureBundle(bundle);
  if (!parsed) throw new Error("exported bundle failed its own parser — refusing to write it");
  writeFileSync(outFile, `${JSON.stringify(parsed, null, 2)}\n`);
  const quests = parsed.adventure.registry.quests?.length ?? 0;
  console.log(
    `exported "${parsed.adventure.title}" → ${outFile} (${parsed.maps.length} maps, ` +
      `${parsed.graph.links.length} links, ${quests} quests)`,
  );
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

async function importAdventure(
  client: ApiClient,
  bundle: AdventureBundle,
  reset: boolean,
): Promise<void> {
  const title = bundle.adventure.title;
  // ① Find-or-create the adventure (and delete first under --reset).
  let adventureId = await client.findAdventureByTitle(title);
  if (adventureId && reset) {
    const del = await client.request(`/api/adventures/${adventureId}`, { method: "DELETE" });
    if (!del.response.ok) throw client.failure("adventure delete", del);
    console.log(`deleted existing adventure ${adventureId}`);
    adventureId = null;
  }
  let createdDefaultMapId: string | null = null;
  if (!adventureId) {
    const created = await client.request("/api/adventures", {
      method: "POST",
      body: JSON.stringify({ title, maxPlayers: bundle.adventure.maxPlayers }),
    });
    const body = created.body as { id?: string; defaultMap?: { id?: string } } | null;
    if (!created.response.ok || !body?.id) throw client.failure("adventure create", created);
    adventureId = body.id;
    createdDefaultMapId = body.defaultMap?.id ?? null;
    console.log(`created adventure ${adventureId}`);
  }

  // ② Find-or-create destination maps (by name), building the old→new map id mapping.
  const listed = await client.request(`/api/maps?adventure=${adventureId}`, { method: "GET" });
  if (!listed.response.ok || !Array.isArray(listed.body)) throw client.failure("map list", listed);
  const summaries = listed.body as { id: string; name: string }[];
  const mapIds = new Map<string, string>();
  for (const [index, map] of bundle.maps.entries()) {
    let existing = summaries.find((entry) => entry.name === map.name);
    if (!existing && index === 0) {
      existing = createdDefaultMapId
        ? summaries.find((entry) => entry.id === createdDefaultMapId)
        : summaries.length === 1
          ? summaries[0]
          : undefined;
    }
    if (!existing) {
      const created = await client.request("/api/maps", {
        method: "POST",
        body: JSON.stringify({ adventureId, name: map.name }),
      });
      const body = created.body as { id?: string } | null;
      if (!created.response.ok || !body?.id)
        throw client.failure(`map create ${map.name}`, created);
      existing = { id: body.id, name: map.name };
      console.log(`created map "${map.name}" → ${existing.id}`);
    }
    mapIds.set(map.id, existing.id);
  }

  // ③ Mint fresh event uuids and rewrite every internal reference.
  const eventIds = mintEventIdMapping(bundle, () => crypto.randomUUID());
  const rewritten = rewriteBundleIds(bundle, { mapIds, eventIds });

  // ④ Content without exits first — a map save with an unbound exit is rejected by graph validation.
  for (const map of rewritten.maps) {
    const withoutExits = map.events.filter((event) => event.kind !== "exit");
    const put = await client.request(`/api/maps/${map.id}`, {
      method: "PUT",
      body: JSON.stringify(mapSaveBody(map, withoutExits)),
    });
    if (!put.response.ok) throw client.failure(`map content ${map.name}`, put);
    console.log(`saved "${map.name}" content`);
  }

  // ⑤ Exits + cumulative graph in the same transaction (the loadtest/seed seam).
  const boundLinks: AdventureGraph["links"][number][] = [];
  for (const map of rewritten.maps) {
    const exits = map.events.filter((event) => event.kind === "exit");
    if (exits.length === 0) continue;
    for (const exit of exits) {
      const link = rewritten.graph.links.find(
        (candidate) => candidate.mapId === map.id && candidate.exitId === exit.id,
      );
      if (!link) throw new Error(`bundle graph has no link for exit ${exit.id} on "${map.name}"`);
      boundLinks.push(link);
    }
    const graph: AdventureGraph = { start: rewritten.graph.start, links: [...boundLinks] };
    const put = await client.request(`/api/maps/${map.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...mapSaveBody(map, map.events),
        adventure: { title, maxPlayers: bundle.adventure.maxPlayers, graph },
      }),
    });
    if (!put.response.ok) throw client.failure(`map exits ${map.name}`, put);
    console.log(`saved "${map.name}" exits + graph`);
  }

  // ⑥ Registry (switches/variables/quests) + final graph on the adventure row.
  const putAdventure = await client.request(`/api/adventures/${adventureId}`, {
    method: "PUT",
    body: JSON.stringify({
      title,
      maxPlayers: bundle.adventure.maxPlayers,
      graph: { start: rewritten.graph.start, links: boundLinks },
      registry: rewritten.adventure.registry,
    }),
  });
  if (!putAdventure.response.ok) throw client.failure("adventure registry", putAdventure);

  // ⑦ Verify by re-reading.
  const verify = await client.request(`/api/adventures/${adventureId}`, { method: "GET" });
  const verifyBody = verify.body as {
    mapIds?: string[];
    graph?: { links?: unknown[] };
    registry?: { quests?: unknown[] };
  } | null;
  if (!verify.response.ok || !verifyBody) throw client.failure("adventure verify", verify);
  const expectedQuests = bundle.adventure.registry.quests?.length ?? 0;
  if (verifyBody.mapIds?.length !== bundle.maps.length) {
    throw new Error(
      `verify: expected ${bundle.maps.length} maps, got ${verifyBody.mapIds?.length}`,
    );
  }
  if ((verifyBody.graph?.links?.length ?? 0) !== rewritten.graph.links.length) {
    throw new Error("verify: graph link count mismatch");
  }
  if ((verifyBody.registry?.quests?.length ?? 0) !== expectedQuests) {
    throw new Error("verify: quest count mismatch");
  }
  console.log(
    `import verified: "${title}" → ${adventureId} (${bundle.maps.length} maps, ` +
      `${rewritten.graph.links.length} links, ${expectedQuests} quests)`,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = argumentsOf(rest);
  const target = resolveTarget(args);
  const credentials = resolveCredentials(args, target, DEFAULT_USERNAME);
  const client = new ApiClient({ target, ...credentials });

  if (command === "export") {
    const title = args.get("adventure");
    const out = args.get("out");
    if (!title || !out) throw new Error('usage: export --adventure="Titre" --out=fichier.json');
    await client.ensureSession();
    await exportAdventure(client, title, out);
    return;
  }
  if (command === "import") {
    const file = args.get("file");
    if (!file) throw new Error("usage: import --file=fichier.json [--title=Override] [--reset]");
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const parsed = parseAdventureBundle(raw);
    if (!parsed)
      throw new Error(
        `${file} is not a valid ${ADVENTURE_BUNDLE_FORMAT} v${ADVENTURE_BUNDLE_VERSION} bundle`,
      );
    const override = args.get("title");
    const bundle = override
      ? { ...parsed, adventure: { ...parsed.adventure, title: override.trim() } }
      : parsed;
    await client.ensureSession();
    await importAdventure(client, bundle, args.get("reset") === "true");
    return;
  }
  throw new Error("usage: adventure-io.ts <export|import> …");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
