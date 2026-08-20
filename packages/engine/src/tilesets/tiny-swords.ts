/**
 * The one tileset this slice ships, as data.
 *
 * A tileset is a versioned file in the repo, not a row an author edits: tile behaviour is set once
 * per tile by us, and the "Base de données" editor that would expose it is a later tranche. That is
 * also why deferred behaviours (terrain tag, counter) need no reserved columns — adding one later
 * is a code change, not a migration.
 *
 * `Tilemap_color1.png` is 576x384: a 9x6 grid of 64px cells holding the flat grass group at column
 * 0, the raised group at column 5, and the cliff wall band beneath the raised group.
 */
import type { TerrainMaterial } from "../hd2d/terrain-query.js";
import type { Tileset } from "../tileset.js";

export const TINY_SWORDS_TILESET_ID = "tiny-swords";

/**
 * The atlas grid every `origin`/`col`/`row` below is a coordinate in.
 *
 * Here rather than beside the client's slicer because it is the bound the ids must respect, and the
 * test that proves no declared slot and variant resolves outside the sheet is shared arithmetic: it
 * must be able to name this without importing PixiJS.
 */
export const TINY_SWORDS_SHEET_COLS = 9;
export const TINY_SWORDS_SHEET_ROWS = 6;

const ATLAS = "tilemap-color1";

/**
 * Elevation shading, as a multiplicative tint. The wireframe darkens raised ground with a CSS
 * `brightness()` filter; a tint is the same multiply and is what PixiJS already spends per sprite.
 * Its `saturate()` companion has no tint equivalent and is dropped — the brightness step is what
 * reads as height.
 */
const RAISED_1_TINT = 0xdbdbdb;
const RAISED_2_TINT = 0xb8b8b8;
const RAISED_3_TINT = 0x969696;

/** Autotile slots, in declaration order. The indices are the contract; the array below matches. */
export const GRASS_SLOTS: readonly [number, number, number, number] = [0, 1, 2, 19];
export const AUTHORED_TERRAIN_MATERIALS = [
  "herbe",
  "sable",
  "neige",
  "glace",
] as const satisfies readonly TerrainMaterial[];
const EXTRA_TERRAIN_MATERIALS = AUTHORED_TERRAIN_MATERIALS.slice(1);
export const TERRAIN_MATERIAL_SLOTS = {
  herbe: GRASS_SLOTS,
  sable: [7, 8, 9, 20],
  neige: [10, 11, 12, 21],
  glace: [13, 14, 15, 22],
} as const satisfies Readonly<Record<TerrainMaterial, readonly [number, number, number, number]>>;

/**
 * The slots the retired thin-ice brush painted, still readable as ordinary ice.
 *
 * Dropping them outright would not have failed anything — it would have sent them down
 * `materialOfSlot`'s grass fallback, quietly turning every authored thin-ice tile into a lawn,
 * with the collision and the appearance both wrong and nothing to point at. Ice is the honest
 * reading: thin ice already looked and slid exactly like it. Pairs with `decodeMap`'s coercion of
 * the `"glace-fine"` material itself.
 */
const RETIRED_THIN_ICE_SLOTS: readonly number[] = [16, 17, 18, 23];
export const CLIFF_WALL_SLOT = 3;
export const CLIFF_WATER_SLOT = 4;
export const CLIFF_WALL_HIGH_2_SLOT = 5;
export const CLIFF_WATER_HIGH_2_SLOT = 6;
export const CLIFF_WALL_SLOTS = [
  CLIFF_WALL_SLOT,
  CLIFF_WATER_SLOT,
  CLIFF_WALL_HIGH_2_SLOT,
  CLIFF_WATER_HIGH_2_SLOT,
] as const;

/**
 * Stable stored groups are east/west, backed by the two native side ramps from the sheet.
 */
const RAMP_GROUPS = [
  { sourceCol: 0, rotationQuarterTurns: 0 }, // climb right
  { sourceCol: 3, rotationQuarterTurns: 0 }, // climb left
] as const;
/**
 * Each official side ramp is a 64×128 asset split across rows 4 and 5. Each half has a 0↔1 and
 * 1↔2 tinted entry, making four ids per stored group.
 */
const RAMP_PARTS = [{ row: 4 }, { row: 5 }] as const;
const RAMP_LEVELS = [0, 1] as const;
export const RAMP_FIXED_TILE_COUNT = RAMP_PARTS.length * RAMP_LEVELS.length * RAMP_GROUPS.length;
export const RAMP_LEVEL_3_FIXED_BASE = 16;

/**
 * The ONE-CELL ramp band: four directions by three transitions, twelve stable ids from 20.
 *
 * The two bands above describe the official 64x128 side asset, which is two cells tall and exists
 * only for a cliff facing east or west. That shape was the AUTHORING model as well as the art, so a
 * bank running east to west had no staircase at all and every ramp cost two cells. Since the terrain
 * became a mesh, a ramp is geometry the renderer builds from a rectangle (`meshStairs`), so neither
 * limit is about art any more: one cell in any of four directions is the same slope, described
 * honestly.
 *
 * The older bands stay exactly where they are. Every stored map holds their ids, and a ramp that
 * silently changed shape under an author's feet would be worse than the limitation it removes.
 */
export const RAMP_ONE_CELL_DIRECTIONS = ["east", "west", "south", "north"] as const;
export const RAMP_ONE_CELL_LEVELS = [0, 1, 2] as const;
export const RAMP_ONE_CELL_FIXED_BASE = 20;
export const RAMP_ONE_CELL_FIXED_COUNT =
  RAMP_ONE_CELL_DIRECTIONS.length * RAMP_ONE_CELL_LEVELS.length;

/** The stable id of a one-cell ramp, or -1 for a direction/level pair outside the band. */
export function oneCellRampFixedIndex(
  direction: (typeof RAMP_ONE_CELL_DIRECTIONS)[number],
  lowLevel: number,
): number {
  const facing = RAMP_ONE_CELL_DIRECTIONS.indexOf(direction);
  const level = (RAMP_ONE_CELL_LEVELS as readonly number[]).indexOf(lowLevel);
  if (facing < 0 || level < 0) return -1;
  return RAMP_ONE_CELL_FIXED_BASE + facing * RAMP_ONE_CELL_LEVELS.length + level;
}

/** The direction and transition a one-cell ramp id encodes, or null for any other id. */
export function oneCellRampDescriptor(
  index: number,
): { direction: (typeof RAMP_ONE_CELL_DIRECTIONS)[number]; lowLevel: number } | null {
  if (
    !Number.isSafeInteger(index) ||
    index < RAMP_ONE_CELL_FIXED_BASE ||
    index >= RAMP_ONE_CELL_FIXED_BASE + RAMP_ONE_CELL_FIXED_COUNT
  ) {
    return null;
  }
  const offset = index - RAMP_ONE_CELL_FIXED_BASE;
  const direction = RAMP_ONE_CELL_DIRECTIONS[Math.floor(offset / RAMP_ONE_CELL_LEVELS.length)];
  const lowLevel = RAMP_ONE_CELL_LEVELS[offset % RAMP_ONE_CELL_LEVELS.length];
  return direction === undefined || lowLevel === undefined ? null : { direction, lowLevel };
}

/** Stored fixed ids in these stable bands are passable staircase cells. */
export function isRampFixedIndex(index: number): boolean {
  return (
    Number.isSafeInteger(index) &&
    ((index >= 0 && index < RAMP_FIXED_TILE_COUNT) ||
      (index >= RAMP_LEVEL_3_FIXED_BASE && index < RAMP_LEVEL_3_FIXED_BASE + 4) ||
      oneCellRampDescriptor(index) !== null)
  );
}

/** A middle cliff-face cell repeated along an edge. The source faces south (high ground north);
 * rotations make the other three orientations without inventing a second transform channel. */
const CLIFF_FACE = {
  atlas: ATLAS,
  col: 6,
  row: 4,
  passable: false,
  priority: "below",
} as const;
export const CLIFF_FACE_FIXED_BASE = RAMP_FIXED_TILE_COUNT;
export const CLIFF_FACE_FIXED_LEVEL_STRIDE = 4;

// Adding a second tileset, or growing `autotiles`/`fixed` here past what pushes an id's digit
// width past 4, moves `MAX_MAP_JSON_BYTES` (server/index.ts) — its comment derives the cap from
// this tileset's largest id.
export const TINY_SWORDS_TILESET: Tileset = {
  id: TINY_SWORDS_TILESET_ID,
  autotiles: [
    {
      atlas: ATLAS,
      origin: { col: 0, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      renderLevel: 0,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      renderLevel: 1,
      tint: RAISED_1_TINT,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      renderLevel: 2,
      tint: RAISED_2_TINT,
    },
    // The guide supplies two cliff rows per elevation: row 4 meets walkable terrain, row 5 meets
    // water. Repeating them for level 2 also lets the renderer put each face above the shadow cast
    // by that elevation, instead of flattening both cliff heights into one layer.
    {
      atlas: ATLAS,
      origin: { col: 5, row: 4 },
      kind: "run4",
      passable: false,
      priority: "below",
      renderLevel: 1,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 5 },
      kind: "run4",
      passable: false,
      priority: "below",
      renderLevel: 1,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 4 },
      kind: "run4",
      passable: false,
      priority: "below",
      renderLevel: 2,
      tint: RAISED_1_TINT,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 5 },
      kind: "run4",
      passable: false,
      priority: "below",
      renderLevel: 2,
      tint: RAISED_1_TINT,
    },
    // HD-2D terrain materials are encoded in the same stable tile-id space as elevation. The
    // retired 2D path may show the shared grass source for these slots, but the shipped editor and
    // game compile the material below and render their dedicated terrain atlas.
    ...EXTRA_TERRAIN_MATERIALS.flatMap(() => [
      {
        atlas: ATLAS,
        origin: { col: 0, row: 0 },
        kind: "edge16" as const,
        passable: true,
        priority: "below" as const,
        renderLevel: 0 as const,
      },
      {
        atlas: ATLAS,
        origin: { col: 5, row: 0 },
        kind: "edge16" as const,
        passable: true,
        priority: "below" as const,
        renderLevel: 1 as const,
        tint: RAISED_1_TINT,
      },
      {
        atlas: ATLAS,
        origin: { col: 5, row: 0 },
        kind: "edge16" as const,
        passable: true,
        priority: "below" as const,
        renderLevel: 2 as const,
        tint: RAISED_2_TINT,
      },
    ]),
    // Appended after every existing slot so persisted authored tile ids remain stable. The order
    // mirrors AUTHORED_TERRAIN_MATERIALS and therefore yields the declared slots 19 through 23.
    ...AUTHORED_TERRAIN_MATERIALS.map(() => ({
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16" as const,
      passable: true,
      priority: "below" as const,
      renderLevel: 3 as const,
      tint: RAISED_3_TINT,
    })),
  ],
  // Pixel Frog's two native stairs are atlas (0,4)+(0,5), climbing right, and
  // (3,4)+(3,5), climbing left. West keeps its dedicated source instead of mirroring pixels.
  // Tint follows the lower level, so a 1↔2 stair belongs visually to level 1.
  fixed: [
    ...RAMP_GROUPS.flatMap((group) =>
      RAMP_PARTS.flatMap((part) =>
        RAMP_LEVELS.map((lowLevel) => {
          return {
            atlas: ATLAS,
            col: group.sourceCol,
            row: part.row,
            passable: true,
            priority: "below" as const,
            renderLevel: (lowLevel + 1) as 1 | 2,
            ...(lowLevel === 1 ? { tint: RAISED_1_TINT } : {}),
            rotationQuarterTurns: group.rotationQuarterTurns,
          };
        }),
      ),
    ),
    ...([1, 2] as const).flatMap((renderLevel) =>
      ([0, 1, 2, 3] as const).map((rotationQuarterTurns) => ({
        ...CLIFF_FACE,
        renderLevel,
        ...(renderLevel === 2 ? { tint: RAISED_1_TINT } : {}),
        rotationQuarterTurns,
        // Every blocking elevation boundary must stay visible. Hiding the side/back rotations left
        // a full authored cell of apparently empty ground that collision correctly refused.
      })),
    ),
    // Appended after the stable cliff band: east high/low, then west high/low, for 2↔3 stairs.
    ...RAMP_GROUPS.flatMap((group) =>
      RAMP_PARTS.map((part) => ({
        atlas: ATLAS,
        col: group.sourceCol,
        row: part.row,
        passable: true,
        priority: "below" as const,
        renderLevel: 3 as const,
        tint: RAISED_2_TINT,
        rotationQuarterTurns: group.rotationQuarterTurns,
      })),
    ),
    // The one-cell band, ids 20..31. The SLOPE is geometry `meshStairs` builds from the compiled
    // ramp rectangle, so these entries exist to make the cell passable and to give the editor
    // something to draw in its palette; the source cell is the official ramp's upper half, rotated
    // to face the right way.
    ...RAMP_ONE_CELL_DIRECTIONS.flatMap((direction) =>
      RAMP_ONE_CELL_LEVELS.map((lowLevel) => ({
        atlas: ATLAS,
        col: direction === "west" || direction === "north" ? 3 : 0,
        row: 4,
        passable: true,
        priority: "below" as const,
        renderLevel: Math.min(3, lowLevel + 1) as 1 | 2 | 3,
        ...(lowLevel === 1 ? { tint: RAISED_1_TINT } : {}),
        ...(lowLevel === 2 ? { tint: RAISED_2_TINT } : {}),
        rotationQuarterTurns: (direction === "south" ? 1 : direction === "north" ? 3 : 0) as
          | 0
          | 1
          | 3,
      })),
    ),
  ],
};

const BY_ID = new Map<string, Tileset>([[TINY_SWORDS_TILESET_ID, TINY_SWORDS_TILESET]]);

export function tilesetById(id: string): Tileset | null {
  return BY_ID.get(id) ?? null;
}

/** Which elevation level a ground slot stands at, or -1 for anything that is not grass. */
export function elevationOfSlot(slot: number): number {
  for (const material of AUTHORED_TERRAIN_MATERIALS) {
    const level = (TERRAIN_MATERIAL_SLOTS[material] as readonly number[]).indexOf(slot);
    if (level >= 0) return level;
  }
  return -1;
}

/** The physical/visual material encoded by an authored ground slot. Non-ground legacy slots keep
 * the historical grass fallback; their elevation is still rejected separately above. */
export function materialOfSlot(slot: number): TerrainMaterial {
  for (const material of AUTHORED_TERRAIN_MATERIALS) {
    if ((TERRAIN_MATERIAL_SLOTS[material] as readonly number[]).includes(slot)) return material;
  }
  if (RETIRED_THIN_ICE_SLOTS.includes(slot)) return "glace";
  return "herbe";
}

export function terrainSlot(material: TerrainMaterial, level: number): number | null {
  return TERRAIN_MATERIAL_SLOTS[material][level as 0 | 1 | 2 | 3] ?? null;
}

/**
 * The highest authored elevation: ground plus three plateaus.
 *
 * This is not a preference, it is where the model runs out. A cell's level IS its index into
 * `TERRAIN_MATERIAL_SLOTS`, which holds exactly four slots per material, and three more tables are
 * per-level in the same way: the raised tints above, the cliff faces (`CLIFF_WALL_SLOT` /
 * `CLIFF_WALL_HIGH_2_SLOT`) and the ramp art `tile-brush.ts` indexes by `StairsLowLevel` (`0 | 1 |
 * 2`). Raising this number alone would return `null` from `terrainSlot` and paint nothing.
 *
 * A taller range therefore costs four things, none of them here: ground art per new level, a tint
 * per new level, cliff faces for the new drops, and ramps for the new transitions. The relative
 * brushes are what make a taller range USABLE once that art exists, and they are worth having on
 * this range meanwhile.
 */
export const MAX_TERRAIN_LEVEL = GRASS_SLOTS.length - 1;
