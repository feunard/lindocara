/**
 * The proving map: a real heightfield, on a real map row, so the rest of S3 has something to run
 * against. Modelled on `apps/lab/scripts/build-map.ts` — same generator, same encoding, same
 * non-finite guard — and it calls that lab script's own `generateIsland`, so the terrain the server
 * bakes is the terrain the HD-2D witness already renders correctly. Proving the pipeline is the
 * whole point; inventing a second island would have proved a second island.
 *
 * A DEV SCRIPT, not production code: nothing under `src/` imports it, it is outside the server's
 * tsconfig program, and the one-way import into `apps/lab/src/` below is a script-only edge that
 * must never appear in the server's runtime path (`apps/lab` sits outside the package graph —
 * see the root `AGENTS.md`).
 *
 * Run (from the repo root):
 *   npm run map:proving -- --map=<mapId>
 *   npm run map:proving -- --dry-run --out=/tmp/proving.json
 *
 * Flags:
 *   --map=<uuid>      the map row whose `heightfield` column is written (required unless --dry-run)
 *   --out=<path>      also write the encoded map to a file
 *   --database=<path> SQLite file to open; defaults to the dev database
 *   --dry-run         generate and report, write nothing to the database
 */

import { writeFileSync } from "node:fs";
import { encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { Alepha } from "alepha";
import { SPAWN, WORLD } from "../../../apps/lab/src/settings.js";
import { generateIsland } from "../../../apps/lab/src/world/island.js";
import { BODY_PARSER_OPTIONS_SEED } from "../src/api/bodySizeCap.ts";
import { LindocaraApi } from "../src/api/index.ts";
import { MapService } from "../src/api/services/MapService.ts";

/** `alepha dev` runs in `apps/main`, so its SQLite file lives beside that workspace's own
 *  `node_modules` (`NodeSqliteProvider`'s non-test default is a cwd-relative path — resolving it
 *  from this file instead makes the script work from any directory). */
const DEV_DATABASE = new URL("../../../apps/main/node_modules/.alepha/sqlite.db", import.meta.url)
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

function buildProvingMap(): MapData {
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
  return {
    version: 1,
    size,
    levelHeight: WORLD.levelHeight,
    waterLevel: WORLD.waterLevel,
    levels,
    materials,
    // Deliberately none: the lab's collider rects belong to lab BILLBOARDS (props, the house, the
    // chest) that this game does not draw, and an invisible wall is worse than no wall on a map
    // whose only job is to prove the terrain pipeline. `pixelTerrainFromHeightfield`'s rect
    // conversion is pinned by `test-api/heightfield-pixel-bridge.test.ts` instead.
    colliders: [],
    spawns: [{ name: "default", x: SPAWN[0], z: SPAWN[1] }],
    // Authored decoration and events are the tile editor's, not this generator's.
    elements: [],
    events: [],
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
      `${water} water, spawn (${SPAWN[0]}, ${SPAWN[1]}), ${encoded.length} bytes.`,
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
  // because `npm run dev` already holds that port.
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

await main();
