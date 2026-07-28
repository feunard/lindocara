/**
 * Print the étalon map as ASCII, without a browser.
 *
 * The browser preview (`?preview=1`) is the real judge of how the map LOOKS; this is the fast check
 * that its SHAPE is what was intended — that no terrace is stranded, no staircase silently failed to
 * fit, and no building is standing in the sea. It reads the same `buildReferenceMapBuild()` the
 * browser does, so the two can never describe different maps.
 *
 *   npx tsx scripts/preview-reference-map.ts
 */
import { buildReferenceMapBuild } from "@lindocara/client/dev/reference-map.js";
import { bakeCollision, elementCells } from "@lindocara/engine/map-data.js";
import { decodeTileId } from "@lindocara/engine/tileset.js";
import { elevationOfSlot, isRampFixedIndex } from "@lindocara/engine/tilesets/tiny-swords.js";

const { map, stairsPlaced, stairsRequested } = buildReferenceMapBuild();
const ground = map.layers[0];
const walls = map.layers[1];
if (!ground || !walls) throw new Error("the étalon must have a ground and a wall layer");

/** Where each element sits, so scenery standing in the sea is visible at a glance. */
const marks = new Map<string, string>();
for (const element of map.elements) {
  const symbol = element.assetId.startsWith("building.")
    ? "H"
    : element.assetId.includes("trees")
      ? "T"
      : element.assetId.includes("bushes")
        ? "b"
        : element.assetId.includes("rocks-in-the-water")
          ? "o"
          : "r";
  for (const cell of elementCells(element)) marks.set(`${cell.col}:${cell.row}`, symbol);
}

const collision = bakeCollision(map);
const legend =
  "~ sea   . level0   1 level1   2 level2   / stairs   # cliff face   T T H b r o = scenery";
const header = `    ${Array.from({ length: map.cols }, (_, col) => `${col % 10}`).join("")}`;

const lines: string[] = [];
for (let row = 0; row < map.rows; row += 1) {
  let line = "";
  for (let col = 0; col < map.cols; col += 1) {
    const index = row * map.cols + col;
    const wall = decodeTileId(walls.ids[index] ?? 0);
    if (wall.kind === "fixed") {
      line += isRampFixedIndex(wall.index) ? "/" : "#";
      continue;
    }
    const mark = marks.get(`${col}:${row}`);
    const base = decodeTileId(ground.ids[index] ?? 0);
    if (base.kind === "empty") {
      line += mark === "o" ? "o" : "~";
      continue;
    }
    if (mark && mark !== "o") {
      line += mark;
      continue;
    }
    const level = base.kind === "autotile" ? elevationOfSlot(base.slot) : -1;
    line += level <= 0 ? "." : `${level}`;
  }
  lines.push(`${`${row}`.padStart(3, " ")} ${line}`);
}

let land = 0;
let walkable = 0;
for (let row = 0; row < map.rows; row += 1) {
  for (let col = 0; col < map.cols; col += 1) {
    const kind = collision.kinds[row * map.cols + col];
    if (kind && kind !== "water") land += 1;
    if (kind === "grass" || kind === "ramp") walkable += 1;
  }
}

/**
 * Sea cells the open ocean cannot reach.
 *
 * A bay is meant to be a bite the sea takes OUT of the coast; a rectangle of water fully ringed by
 * land is a swimming pool, and it reads as one instantly on screen — foam all the way round, no
 * horizon. The difference is invisible in the ASCII (both are `~`) and obvious in a screenshot,
 * which is exactly the kind of thing worth turning into a number. Flood-fill from the border and
 * whatever the fill never reaches is a pond.
 */
const reached = new Uint8Array(map.cols * map.rows);
const queue: number[] = [];
const isWater = (col: number, row: number): boolean =>
  collision.kinds[row * map.cols + col] === "water";
for (let col = 0; col < map.cols; col += 1) {
  for (const row of [0, map.rows - 1]) if (isWater(col, row)) queue.push(row * map.cols + col);
}
for (let row = 0; row < map.rows; row += 1) {
  for (const col of [0, map.cols - 1]) if (isWater(col, row)) queue.push(row * map.cols + col);
}
while (queue.length > 0) {
  const index = queue.pop() as number;
  if (reached[index]) continue;
  reached[index] = 1;
  const col = index % map.cols;
  const row = Math.floor(index / map.cols);
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nextCol = col + dc;
    const nextRow = row + dr;
    if (nextCol < 0 || nextCol >= map.cols || nextRow < 0 || nextRow >= map.rows) continue;
    if (!isWater(nextCol, nextRow)) continue;
    const next = nextRow * map.cols + nextCol;
    if (!reached[next]) queue.push(next);
  }
}
const ponds: string[] = [];
for (let row = 0; row < map.rows; row += 1) {
  for (let col = 0; col < map.cols; col += 1) {
    const index = row * map.cols + col;
    if (isWater(col, row) && !reached[index]) ponds.push(`[${col},${row}]`);
  }
}

console.log(header);
console.log(lines.join("\n"));
console.log(`\n${legend}`);
console.log(
  `\ncells ${map.cols}x${map.rows}  land ${land}  walkable ${walkable}  elements ${map.elements.length}`,
);
if (ponds.length > 0) {
  console.log(
    `\n!! ${ponds.length} water cells the open sea cannot reach — a landlocked pool, not a bay:`,
  );
  console.log(`   ${ponds.slice(0, 40).join(" ")}${ponds.length > 40 ? " …" : ""}`);
}
console.log(`stairs placed ${stairsPlaced}/${stairsRequested}`);
if (stairsPlaced < stairsRequested) {
  // `paintStairs` refuses silently, and guessing at the fix is how the last three got their
  // orientation backwards. Enumerate what the terrain actually accepts instead: a staircase needs
  // its two stacked cells at `lowLevel` and both of their neighbours on the high side one level up.
  console.log("\n!! a staircase did not fit — its terrace may be unreachable.");
  console.log("   positions this terrain accepts, as [col,row]:");
  const elevationAt = (col: number, row: number): number => {
    if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) return -1;
    const ref = decodeTileId(ground.ids[row * map.cols + col] ?? 0);
    return ref.kind === "autotile" ? elevationOfSlot(ref.slot) : -1;
  };
  for (const lowLevel of [0, 1] as const) {
    for (const direction of ["east", "west"] as const) {
      const side = direction === "east" ? 1 : -1;
      const hits: string[] = [];
      for (let row = 1; row < map.rows; row += 1) {
        for (let col = 0; col < map.cols; col += 1) {
          if (elevationAt(col, row) !== lowLevel || elevationAt(col, row - 1) !== lowLevel)
            continue;
          if (
            elevationAt(col + side, row) !== lowLevel + 1 ||
            elevationAt(col + side, row - 1) !== lowLevel + 1
          )
            continue;
          hits.push(`[${col},${row}]`);
        }
      }
      console.log(`   low=${lowLevel} ${direction}: ${hits.join(" ") || "(none)"}`);
    }
  }
}
