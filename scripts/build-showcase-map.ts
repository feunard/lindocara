/**
 * The showcase map: every Tiny Swords terrain case, placed on purpose.
 *
 * The proving map (`build-proving-map.ts`) generates an island, and an island proves an island. This
 * one is HAND-AUTHORED, cell by cell, because its whole job is coverage: all sixteen `edge16`
 * variants, both cliff faces (the one footed on land and the one footed in water), a two-level drop,
 * an inner shore, a beach, and both ramp directions — each of them reachable, and each visible from
 * a normal camera.
 *
 * It carries no scenery at all, deliberately. A tree standing at the foot of a cliff hides the very
 * pixels this map exists to show.
 *
 * Deterministic: no clock, no `Math.random`. Regenerating it twice gives the same map twice, so a
 * screenshot taken today is comparable to one taken after the next change.
 *
 * A DEV SCRIPT. It lives in the repo's root `scripts/` so `tsconfig.tooling.json` typechecks it, and
 * nothing a package ships may import it.
 *
 * Run (from the repo root):
 *   yarn map:showcase --dry-run       # print the ASCII plan and the coverage report
 *   yarn adventure:showcase              # seed it into a running app (see the sibling script)
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial, TerrainRamp } from "@lindocara/engine/hd2d/terrain-query.js";

/** Grid side, in cells. Big enough that the six regions below never share a shoreline by accident,
 *  small enough to cross on foot while looking at things. */
const SIZE = 48;

/** The same world scale the lab and the proving map use, so a cliff here is a cliff there. */
const LEVEL_HEIGHT = 0.9;
const WATER_LEVEL = -0.05;

/** Grid-centred world coordinates: cell `i` spans `[i - SIZE/2, i + 1 - SIZE/2]`, exactly as
 *  `meshTerrain` lays its quads out. */
const HALF = SIZE / 2;
const worldEdge = (cell: number): number => cell - HALF;
const worldCentre = (cell: number): number => cell + 0.5 - HALF;

interface Cell {
  level: number | null;
  material: TerrainMaterial;
}

/**
 * The six regions, left to right, so one camera sweep reads them all.
 *
 * The `edge16` garden sits alone in the west, out of reach of the mainland, because a variant is
 * decided by a cell's four neighbours: an islet touching the mainland stops being an islet. The
 * mainland carries everything that needs height.
 */
const REGIONS = {
  /** All sixteen edge16 variants, as four deliberately-shaped islets. */
  loneCell: { i0: 4, i1: 4, j0: 4, j1: 4 },
  column: { i0: 8, i1: 8, j0: 4, j1: 6 },
  row: { i0: 4, i1: 6, j0: 10, j1: 10 },
  block: { i0: 12, i1: 14, j0: 4, j1: 6 },
  /** The mainland, at level 0. */
  mainland: { i0: 18, i1: 44, j0: 4, j1: 43 },
  /**
   * The sea cliff, and the whole reason this map exists.
   *
   * It sits on the mainland's WESTERN shore, not its eastern one, because of where the camera is:
   * the HD-2D view looks north-east, so it shows a cell's west and south faces and never its east
   * one. A water-footed cliff on the east coast is a correct cliff nobody can see — which is what
   * the first version of this map built, and what made the fix invisible on the very map written to
   * prove it.
   *
   * So: its west face (i = 18) drops straight into the sea — the water-footed wall row, plus foam —
   * and its south face (j = 16) drops onto level-0 land, the land-footed row. Both face the camera,
   * one frame apart.
   */
  seaCliff: { i0: 18, i1: 24, j0: 8, j1: 16 },
  /** A level-2 crown on the sea cliff's northern half, so the same western coastline also carries a
   *  TWO-level drop into the water, stacked directly above the one-level drops. */
  seaCrown: { i0: 18, i1: 21, j0: 10, j1: 14 },
  /** Sand along the southern shore — a beach meeting grass inland and the sea outward. */
  beach: { i0: 18, i1: 44, j0: 40, j1: 43 },
  /**
   * The twin cliff. Its west face (i = 30) drops onto level-0 land — the land-footed wall row. Its
   * east face (i = 44) is the mainland's own edge, so it drops straight into the sea — the
   * water-footed row, plus foam. The two are one camera pan apart.
   */
  plateau: { i0: 30, i1: 44, j0: 10, j1: 26 },
  /** A level-2 block wholly inside the plateau: four one-level drops onto land. */
  mesa: { i0: 34, i1: 40, j0: 14, j1: 22 },
  /**
   * A level-2 headland at the mainland's eastern edge. Its east face drops TWO levels into the sea
   * and its north face two levels onto land, which is the pair the stretched wall UV has to survive.
   */
  headland: { i0: 42, i1: 44, j0: 6, j1: 9 },
  /** Land-locked water inside the mainland: an inner shore, foam with no sea behind it. */
  lake: { i0: 21, i1: 25, j0: 30, j1: 35 },
  /**
   * A bay cut into the southern shore, and the terrace standing over it.
   *
   * The sea cliff on the western shore is correct but reads at a grazing angle: the camera looks
   * north-east, so a west face is foreshortened and a SOUTH face is the one seen square on. This
   * pair puts the whole point of the chantier in front of the lens — a one-level and a two-level
   * drop, both footed in water, both facing the viewer — right beside the plateau's own south face,
   * which is footed on land. The two wall rows, side by side, in one frame.
   */
  bay: { i0: 27, i1: 41, j0: 36, j1: 43 },
  seaTerrace: { i0: 29, i1: 39, j0: 31, j1: 35 },
  seaTerraceCrown: { i0: 32, i1: 36, j0: 31, j1: 35 },
} as const;

/** The two ramps, in cells. Each rectangle covers its LOW bank, per `TerrainRamp`. */
const RAMP_CELLS = [
  // 0 -> 1, climbing east onto the plateau's west face.
  { i0: 28, i1: 29, j0: 18, j1: 19, direction: "east", lowLevel: 0 },
  // 1 -> 2, climbing west onto the mesa's east face.
  { i0: 41, i1: 42, j0: 17, j1: 18, direction: "west", lowLevel: 1 },
] as const;

/**
 * Where a hero lands: mainland grass a few tiles north of the bay, so the very first frame carries
 * the pair this map was built for — the sea terrace's water-footed south face over the bay, with
 * the plateau's land-footed south face off to the east.
 */
const SPAWN_CELL = { i: 34, j: 28 };

function inside(region: { i0: number; i1: number; j0: number; j1: number }, i: number, j: number) {
  return i >= region.i0 && i <= region.i1 && j >= region.j0 && j <= region.j1;
}

/** One cell of the authored map. Later clauses win, so the regions read top to bottom as layers. */
function cellAt(i: number, j: number): Cell {
  const water: Cell = { level: null, material: "herbe" };
  if (inside(REGIONS.lake, i, j)) return water;
  if (inside(REGIONS.bay, i, j)) return water;
  if (inside(REGIONS.seaTerraceCrown, i, j)) return { level: 2, material: "herbe" };
  if (inside(REGIONS.seaTerrace, i, j)) return { level: 1, material: "herbe" };
  if (inside(REGIONS.seaCrown, i, j)) return { level: 2, material: "herbe" };
  if (inside(REGIONS.seaCliff, i, j)) return { level: 1, material: "herbe" };
  if (inside(REGIONS.headland, i, j)) return { level: 2, material: "herbe" };
  if (inside(REGIONS.mesa, i, j)) return { level: 2, material: "herbe" };
  if (inside(REGIONS.plateau, i, j)) return { level: 1, material: "herbe" };
  if (inside(REGIONS.beach, i, j)) return { level: 0, material: "sable" };
  if (inside(REGIONS.mainland, i, j)) return { level: 0, material: "herbe" };
  for (const islet of [REGIONS.loneCell, REGIONS.column, REGIONS.row, REGIONS.block]) {
    if (inside(islet, i, j)) return { level: 0, material: "herbe" };
  }
  return water;
}

function rampsOf(): TerrainRamp[] {
  return RAMP_CELLS.map((ramp) => ({
    x: worldEdge(ramp.i0),
    z: worldEdge(ramp.j0),
    width: ramp.i1 - ramp.i0 + 1,
    depth: ramp.j1 - ramp.j0 + 1,
    direction: ramp.direction,
    lowLevel: ramp.lowLevel,
  }));
}

/**
 * The map's own acceptance test.
 *
 * A showcase that quietly stops covering a variant is worse than no showcase: it still looks fine,
 * and the one thing it was built to prove is gone. So the builder recomputes every level-0 cell's
 * `edge16` mask — N=1, E=2, S=4, W=8, the same weights `edge16Mask` uses — and refuses to hand back
 * a map that misses one.
 */
function assertEveryEdge16Variant(levels: readonly (number | null)[]): void {
  const at = (i: number, j: number): number | null =>
    i < 0 || j < 0 || i >= SIZE || j >= SIZE ? null : (levels[j * SIZE + i] ?? null);
  const seen = new Set<number>();
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      if (at(i, j) !== 0) continue;
      const same = (di: number, dj: number): number => (at(i + di, j + dj) === 0 ? 1 : 0);
      seen.add(same(0, -1) | (same(1, 0) << 1) | (same(0, 1) << 2) | (same(-1, 0) << 3));
    }
  }
  const missing = [...Array(16).keys()].filter((mask) => !seen.has(mask));
  if (missing.length > 0) {
    throw new Error(`showcase map misses edge16 variants: ${missing.join(", ")}`);
  }
}

/**
 * The other half of the claim: the two wall rows, and — the part that is easy to get wrong — that
 * they face the CAMERA.
 *
 * A wall's foot is in water when the neighbour it faces has no level at all, and on land when that
 * neighbour is simply lower. But the HD-2D view looks north-east, so it only ever shows a cell's
 * WEST face (di = -1) and its SOUTH face (dj = +1). The first version of this map put every one of
 * its sea cliffs on the eastern shore: all correct, none visible, and the fix the map exists to
 * prove could not be seen on it. Counting only camera-facing walls is what stops that recurring.
 */
function assertBothWallFeet(levels: readonly (number | null)[]): void {
  const at = (i: number, j: number): number | null =>
    i < 0 || j < 0 || i >= SIZE || j >= SIZE ? null : (levels[j * SIZE + i] ?? null);
  // The SOUTH face only. The camera can also catch a west face, but at a grazing angle that
  // foreshortens it to a sliver — proven the hard way, by shipping a map whose sea cliffs were all
  // west-facing and then not being able to photograph one. A south face is seen square on.
  const VISIBLE = [[0, 1]] as const;
  let intoWater = 0;
  let ontoLand = 0;
  let twoLevel = 0;
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const h = at(i, j);
      if (h === null || h === 0) continue;
      for (const [di, dj] of VISIBLE) {
        const n = at(i + di, j + dj);
        if (n === null) {
          intoWater += 1;
          if (h >= 2) twoLevel += 1;
        } else if (n < h) ontoLand += 1;
      }
    }
  }
  if (intoWater === 0) throw new Error("showcase map has no VISIBLE cliff falling into the sea");
  if (ontoLand === 0) throw new Error("showcase map has no VISIBLE cliff falling onto land");
  if (twoLevel === 0) throw new Error("showcase map has no VISIBLE two-level drop into the sea");
}

/** Exported so the seeder builds the SAME map rather than a second one that drifts from it. */
export function buildShowcaseMap(): MapData {
  const levels = new Array<number | null>(SIZE * SIZE);
  const materials = new Array<TerrainMaterial>(SIZE * SIZE);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const { level, material } = cellAt(i, j);
      levels[j * SIZE + i] = level;
      materials[j * SIZE + i] = material;
    }
  }
  assertEveryEdge16Variant(levels);
  assertBothWallFeet(levels);
  return {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: WATER_LEVEL,
    levels,
    materials,
    ramps: rampsOf(),
    colliders: [],
    spawns: [{ name: "default", x: worldCentre(SPAWN_CELL.i), z: worldCentre(SPAWN_CELL.j) }],
    // None, on purpose: a prop at the foot of a cliff hides the pixels this map exists to show.
    elements: [],
    events: [],
  };
}

/**
 * The layout as text, so it can be reviewed before anything boots. `~` water, `.` sand, a digit for
 * a grass level, `<`/`>` for a ramp's footprint and its direction of climb, `+` the spawn.
 */
export function showcaseAscii(map: MapData): string {
  const marks = new Map<string, string>();
  for (const ramp of map.ramps ?? []) {
    for (let dz = 0; dz < ramp.depth; dz += 1) {
      for (let dx = 0; dx < ramp.width; dx += 1) {
        const i = Math.round(ramp.x + dx + HALF);
        const j = Math.round(ramp.z + dz + HALF);
        marks.set(`${i},${j}`, ramp.direction === "east" ? ">" : "<");
      }
    }
  }
  const spawn = map.spawns[0];
  if (spawn) marks.set(`${Math.floor(spawn.x + HALF)},${Math.floor(spawn.z + HALF)}`, "+");

  const lines: string[] = [];
  for (let j = 0; j < map.size; j += 1) {
    let line = "";
    for (let i = 0; i < map.size; i += 1) {
      const mark = marks.get(`${i},${j}`);
      if (mark) {
        line += mark;
        continue;
      }
      const level = map.levels[j * map.size + i] ?? null;
      if (level === null) line += "~";
      else if (map.materials[j * map.size + i] === "sable") line += ".";
      else line += String(level);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

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

function main(): void {
  const args = argumentsOf(process.argv.slice(2));
  const map = buildShowcaseMap();
  const encoded = encodeMap(map);
  const water = map.levels.filter((level) => level === null).length;
  console.log(showcaseAscii(map));
  console.log(
    `\nShowcase map: ${map.size}x${map.size} cells, ${map.size * map.size - water} ground, ` +
      `${water} water, ${(map.ramps ?? []).length} ramps, ${encoded.length} bytes.`,
  );
  console.log("Coverage: all 16 edge16 variants, both wall feet, a two-level drop — asserted.");

  const out = args.get("out");
  if (out) {
    writeFileSync(out, encoded);
    console.log(`Written: ${out}`);
  }
}

// Only when this file IS the process entry: `seed-showcase-adventure.ts` imports the builder above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
