/**
 * The proving map: a real heightfield, on a real map row, so the rest of S3 has something to run
 * against. Modelled on `apps/lab/scripts/build-map.ts` — same generator, same encoding, same
 * non-finite guard — and it calls that lab script's own `generateIsland`, so the terrain the server
 * bakes is the terrain the HD-2D witness already renders correctly. Proving the pipeline is the
 * whole point; inventing a second island would have proved a second island.
 *
 * A DEV SCRIPT, not production code. It lives in the repo's root `scripts/` — beside the other
 * cross-workspace generators (`build-map.ts`, `lib/island-terrain.ts`) — for two reasons: nothing a
 * package ships may import it, and `tsconfig.tooling.json` actually TYPECHECKS it (its include
 * covers every `.ts` file under `scripts/`). Its earlier home under `packages/server/scripts/` did
 * neither: being outside that package's tsconfig program did not make the `apps/lab` import below
 * safe, only invisible to the checker.
 *
 * That import — reaching into `apps/lab/src/` for the island generator — remains a one-way,
 * script-only edge. `apps/lab` sits outside the package dependency graph (see the root
 * `AGENTS.md`); no package's own source may reach for it.
 *
 * LOCAL ONLY, and that is now a choice rather than a limitation. It boots the app and writes the
 * column itself (`MapService.saveHeightfield`, the unfenced in-process writer), so it needs a
 * database file this process can open — which a deployed instance does not have, its database
 * living inside the Bay process. Terrain reaches one of those over HTTP instead, through
 * `PUT /api/maps/:id/heightfield`: see `scripts/seed-proving-adventure.ts`, which generates the
 * same map with the same `buildProvingMap` below and stamps it through that route.
 *
 * Run (from the repo root):
 *   yarn map:proving --map=<mapId>
 *   yarn map:proving --dry-run --out=/tmp/proving.json
 *
 * Flags:
 *   --map=<uuid>      the map row whose `heightfield` column is written (required unless --dry-run)
 *   --out=<path>      also write the encoded map to a file
 *   --database=<path> SQLite file to open; defaults to the dev database
 *   --dry-run         generate and report, write nothing to the database
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  encodeMap,
  type HeightfieldElement,
  type HeightfieldEvent,
  type MapData,
} from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial, TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import { BODY_PARSER_OPTIONS_SEED } from "@lindocara/server/api/bodySizeCap.js";
import { LindocaraApi } from "@lindocara/server/api/index.js";
import { MapService } from "@lindocara/server/api/services/MapService.js";
import { Alepha } from "alepha";
import { SPAWN, WORLD } from "../apps/lab/src/settings.js";
import { generateIsland } from "../apps/lab/src/world/island.js";

/** `alepha dev` runs in `apps/main`, so its SQLite file lives beside that workspace's own
 *  `node_modules` (`NodeSqliteProvider`'s non-test default is a cwd-relative path — resolving it
 *  from this file instead makes the script work from any directory). */
const DEV_DATABASE = new URL("../apps/main/node_modules/.alepha/sqlite.db", import.meta.url)
  .pathname;

function argumentsOf(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args.set(raw.slice(2), "true");
    else args.set(raw.slice(2, eq), raw.slice(eq + 1));
  }
  return args;
}

/**
 * The scenery this map is dressed with — chosen from the catalogue's own placeable assets, and only
 * from those whose art is a WHOLE sheet: the HD-2D path frames a regular `cols x rows` grid, so an
 * asset cropped out of a shared image (`editor.sourceRect`, the six Update-010 trees) would be
 * skipped at draw time. Every id is checked against the catalogue below, so a typo fails here rather
 * than silently costing the map its trees.
 */
const SCENERY_ASSET_IDS = [
  "resource.terrain-resources-wood-trees.tree3",
  "resource.terrain-resources-wood-trees.tree4",
  "decoration.terrain-decorations-bushes.bushe1",
  "decoration.terrain-decorations-rocks.rock1",
] as const;

/** One authored event, with a graphic and nothing else: this task DRAWS events, it does not run
 *  them. A pawn is a unit sheet, so it also proves a scenery billboard and a hero end up the same
 *  size — the mistake `catalog-element-render.ts` records as having shrunk Brumeval's monk. */
const EVENT_GRAPHIC_ASSET_ID = "character.units-blue-units-pawn.pawn-idle";

/** One candidate cell in this many is taken. Coprime with the two hash weights below, so the props
 *  spread over the island instead of lining up in stripes. */
const SCENERY_STRIDE = 11;
const SCENERY_LIMIT = 48;
/** Tiles kept clear around the way in: the first thing a heightfield map has to prove is that a hero
 *  can see, and a tree dropped on the spawn hides it. */
const SPAWN_CLEARANCE = 3;

/**
 * Deterministic decoration over the generated island.
 *
 * Two rules, both about the terrain rather than about taste. A cell is only dressed if it AND its
 * eight neighbours share one level: a prop straddling a shoreline or a cliff edge stands in mid-air,
 * because a billboard is placed on the ground under its own single point. And the spawn is left
 * clear. Everything else is a hash of the cell's own coordinates — no clock, no `Math.random`, so
 * regenerating the map twice gives the same island twice.
 */
function buildScenery(
  size: number,
  levels: readonly (number | null)[],
  query: TerrainQuery,
): { elements: HeightfieldElement[]; events: HeightfieldEvent[] } {
  for (const assetId of [...SCENERY_ASSET_IDS, EVENT_GRAPHIC_ASSET_ID]) {
    if (!editorAsset(assetId)) throw new Error(`unknown catalogue asset: ${assetId}`);
  }

  const levelAt = (i: number, j: number): number | null =>
    i < 0 || j < 0 || i >= size || j >= size ? null : (levels[j * size + i] ?? null);
  const flatAround = (i: number, j: number): boolean => {
    const level = levelAt(i, j);
    if (level === null) return false;
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (levelAt(i + di, j + dj) !== level) return false;
      }
    }
    return true;
  };

  const elements: HeightfieldElement[] = [];
  let nearestToGreeter: { x: number; z: number; distance: number } | null = null;
  // Where the authored event wants to stand: a couple of tiles east of the spawn, so a hero meets it
  // on the way out. The nearest dressable cell to that point wins, because the island's own shape
  // decides whether that exact spot is ground at all.
  const greeter = { x: SPAWN[0] + 2, z: SPAWN[1] };

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      if (!flatAround(i, j)) continue;
      const [x, z] = query.cellCenter(i, j);

      const distance = (x - greeter.x) ** 2 + (z - greeter.z) ** 2;
      if (!nearestToGreeter || distance < nearestToGreeter.distance) {
        nearestToGreeter = { x, z, distance };
      }

      if (Math.abs(x - SPAWN[0]) < SPAWN_CLEARANCE && Math.abs(z - SPAWN[1]) < SPAWN_CLEARANCE)
        continue;
      if ((i * 7 + j * 13) % SCENERY_STRIDE !== 0) continue;
      if (elements.length >= SCENERY_LIMIT) continue;
      const assetId = SCENERY_ASSET_IDS[(i + j) % SCENERY_ASSET_IDS.length];
      if (!assetId) continue;
      elements.push({ assetId, x, z });
    }
  }

  // A map with no flat cell at all has nowhere to stand an event; it also has no elements, and the
  // heightfield stays honest about it rather than inventing a position.
  const events: HeightfieldEvent[] = nearestToGreeter
    ? [
        {
          id: "proving-map-greeter",
          x: nearestToGreeter.x,
          z: nearestToGreeter.z,
          graphicAssetId: EVENT_GRAPHIC_ASSET_ID,
        },
      ]
    : [];
  return { elements, events };
}

/** Exported so `seed-proving-adventure.ts` builds the SAME island rather than a second one that
 *  drifts from it. The CLI below only runs when this file is the process entry (see the guard at
 *  the bottom), so importing it costs nothing but the module evaluation. */
export function buildProvingMap(): MapData {
  const { field, query } = generateIsland({ size: WORLD.size, seed: WORLD.seed });
  const size = field.cols;
  const levels = new Array<number | null>(size * size);
  const materials = new Array<TerrainMaterial>(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const index = j * size + i;
      const height = field.levelAt(i, j);
      // `encodeMap` is `JSON.stringify`, which serialises `NaN`/`Infinity` as `null` — and `null`
      // is this format's word for water. A broken height would therefore become a lake, silently,
      // and `decodeMap` would happily accept it. Fail loudly here, at generation time, instead.
      if (height !== null && !Number.isFinite(height)) {
        throw new Error(`non-finite height at cell (${i}, ${j}): ${height}`);
      }
      levels[index] = height;
      if (height === null) {
        // Meaningless wherever `levels` is `null` (see `MapData`): any valid value will do.
        materials[index] = "herbe";
        continue;
      }
      const [x, z] = query.cellCenter(i, j);
      materials[index] = query.kindAt(x, z) ?? "herbe";
    }
  }
  const { elements, events } = buildScenery(size, levels, query);
  return {
    version: 1,
    size,
    levelHeight: WORLD.levelHeight,
    waterLevel: WORLD.waterLevel,
    levels,
    materials,
    // Deliberately none: the lab's collider rects belong to lab BILLBOARDS (props, the house, the
    // chest) that this game does not draw, and an invisible wall is worse than no wall on a map
    // whose only job is to prove the terrain pipeline. The collider index the server builds from
    // these rects is pinned by `test-api/terrain-access.test.ts` instead.
    colliders: [],
    spawns: [{ name: "default", x: SPAWN[0], z: SPAWN[1] }],
    // Decoration and one authored event, so the HD-2D path has something to draw beyond bare
    // ground. APPEARANCE ONLY, and deliberately alongside the empty `colliders` above: neither an
    // element nor an event bakes anything a hero can bump into — collision on this path comes from
    // the terrain and from nowhere else (`zoneTerrainFromHeightfield`, `engine/terrain-access.ts`).
    elements,
    events,
  };
}

async function main(): Promise<void> {
  const args = argumentsOf(process.argv.slice(2));
  const dryRun = args.get("dry-run") === "true";
  const mapId = args.get("map");
  if (!dryRun && !mapId) throw new Error("--map=<mapId> is required (or pass --dry-run)");

  const map = buildProvingMap();
  const encoded = encodeMap(map);
  const water = map.levels.filter((level) => level === null).length;
  console.log(
    `Proving map: ${map.size}x${map.size} cells, ${map.size * map.size - water} ground, ` +
      `${water} water, spawn (${SPAWN[0]}, ${SPAWN[1]}), ${map.elements.length} elements, ` +
      `${map.events.length} events, ${encoded.length} bytes.`,
  );

  const out = args.get("out");
  if (out) {
    writeFileSync(out, encoded);
    console.log(`Written: ${out}`);
  }

  if (dryRun || !mapId) return;

  // Alepha reads an unset `NODE_ENV` as production, which turns the dev schema sync off and makes
  // this script fail on any column the local database has not caught up with yet. It talks to the
  // dev database, so it boots the way `alepha dev` does.
  process.env.NODE_ENV ??= "development";
  process.env.DATABASE_URL = args.get("database") ?? DEV_DATABASE;
  // Port 0 rather than the 3000 default: booting the app to reach `MapService` must not fail
  // because `yarn dev` already holds that port.
  process.env.SERVER_PORT = "0";
  const alepha = Alepha.create({ ...BODY_PARSER_OPTIONS_SEED }).with(LindocaraApi);
  await alepha.start();
  try {
    await alepha.inject(MapService).saveHeightfield(mapId, encoded);
    console.log(`Stored on map ${mapId} (${process.env.DATABASE_URL}).`);
  } finally {
    await alepha.stop();
  }
}

// Only when this file IS the process entry. `seed-proving-adventure.ts` imports `buildProvingMap`
// above, and an unguarded top-level `await main()` would run this whole CLI — including its
// `--map is required` throw — as a side effect of that import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
