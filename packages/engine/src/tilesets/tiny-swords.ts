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

/**
 * The tint of any raised level, as a grey multiply.
 *
 * Three named constants were enough while the range stopped at three plateaus. A range that goes on
 * needs a RULE rather than a table, and this is the one the three constants already describe: each
 * level is about 88% as bright as the one below it. Levels 1 to 3 keep their exact historical
 * values so nothing already authored changes shade, and the floor keeps a deep level from going
 * black, which reads as a hole rather than as high ground.
 */
const RAISED_TINT_FLOOR = 0x4a;
/**
 * How much darker each level BELOW zero is than the one above it.
 *
 * Steeper than the 0.88 the raised levels climb by, and deliberately so: a pit is in its own
 * shadow, and a sunken level tinted on the raised curve would read as a plateau seen from above.
 * The same floor applies, for the same reason -- past it the ground stops being ground and reads
 * as a hole in the map.
 */
const SUNKEN_TINT_STEP = 0.79;
function sunkenTint(depth: number): number {
  const channel = Math.max(RAISED_TINT_FLOOR, Math.round(0xff * SUNKEN_TINT_STEP ** depth));
  return channel * 0x010101;
}

function raisedTint(level: number): number | undefined {
  if (level <= 0) return undefined;
  if (level === 1) return RAISED_1_TINT;
  if (level === 2) return RAISED_2_TINT;
  if (level === 3) return RAISED_3_TINT;
  const channel = Math.max(RAISED_TINT_FLOOR, Math.round(0x96 * 0.88 ** (level - 3)));
  return channel * 0x010101;
}

/**
 * The highest authored elevation. Eleven levels: the ground plus ten plateaus.
 *
 * Reachable WITHOUT a migration, and that is why it stops here rather than higher. A cell's level
 * is its index into `TERRAIN_MATERIAL_SLOTS`, whose entries are slots in the tileset's `autotiles`
 * array, and the id space reserves `AUTOTILE_SLOTS` (64) of those. Eleven levels across four
 * materials plus the four cliff-wall slots comes to 52; a twelfth level would not fit, and raising
 * the reservation moves `FIXED_BASE`, which renumbers every stored fixed tile in every saved map.
 */
export const TERRAIN_LEVELS = 11;

/**
 * How far ground may sink BELOW zero: three levels, and the number is the slot budget, not a taste.
 *
 * 52 of the 64 reserved slots were declared, leaving exactly twelve, which is three levels across
 * four materials. A fourth sunken level is the sixteenth slot that does not exist, and buying it
 * means raising `AUTOTILE_SLOTS`, which moves `FIXED_BASE`, which reinterprets every stored fixed
 * id in every saved map -- a ramp id would decode as an autotile. That is a format migration with a
 * stored-format version behind it, and it is worth doing the day a fourth level is worth having;
 * it is not worth doing to reach it.
 *
 * The reservation is now exactly full (64 of 64 declared), so the next level in EITHER direction
 * pays that price.
 */
export const SUNKEN_TERRAIN_LEVELS = 3;

/**
 * One slot per level, as a TUPLE rather than an array, and that is not a formality: every reader
 * indexes it by a level, and a plain array under `noUncheckedIndexedAccess` would make each of
 * those reads optional and push a `?? 0` fallback into a dozen call sites that have no business
 * inventing a slot. The length is `TERRAIN_LEVELS`, which a test pins.
 */
export type TerrainLevelSlots = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Autotile slots, in declaration order. The indices are the contract; the array below matches.
 *  Levels 0-3 keep their historical slots exactly (0, 1, 2 and 19 for grass); 4 and up are appended
 *  after every other declared slot, so no stored id changed meaning. */
export const GRASS_SLOTS: TerrainLevelSlots = [0, 1, 2, 19, 24, 28, 32, 36, 40, 44, 48];
export const AUTHORED_TERRAIN_MATERIALS = [
  "herbe",
  "sable",
  "neige",
  "glace",
] as const satisfies readonly TerrainMaterial[];
const EXTRA_TERRAIN_MATERIALS = AUTHORED_TERRAIN_MATERIALS.slice(1);
export const TERRAIN_MATERIAL_SLOTS = {
  herbe: GRASS_SLOTS,
  sable: [7, 8, 9, 20, 25, 29, 33, 37, 41, 45, 49],
  neige: [10, 11, 12, 21, 26, 30, 34, 38, 42, 46, 50],
  glace: [13, 14, 15, 22, 27, 31, 35, 39, 43, 47, 51],
} as const satisfies Readonly<Record<TerrainMaterial, TerrainLevelSlots>>;

/**
 * The slots the retired thin-ice brush painted, still readable as ordinary ice.
 *
 * Dropping them outright would not have failed anything — it would have sent them down
 * `materialOfSlot`'s grass fallback, quietly turning every authored thin-ice tile into a lawn,
 * with the collision and the appearance both wrong and nothing to point at. Ice is the honest
 * reading: thin ice already looked and slid exactly like it. Pairs with `decodeMap`'s coercion of
 * the `"glace-fine"` material itself.
 */
/**
 * One slot per SUNKEN level, depth 1 first, in the same four-material order as the raised tables.
 *
 * These are the last twelve slots of the reservation (52 through 63), appended after every other
 * declaration for the reason every band here is appended: a slot is an INDEX into the `autotiles`
 * array, so inserting anywhere else renumbers stored ids.
 *
 * A SEPARATE table rather than a longer `TERRAIN_MATERIAL_SLOTS` with a bias, because the raised
 * tables are indexed BY LEVEL by every reader in the codebase. Adding a bias would have made every
 * one of those reads wrong in a way the compiler could not see, to save one branch in
 * `terrainSlot`.
 */
export type SunkenLevelSlots = readonly [number, number, number];
export const SUNKEN_MATERIAL_SLOTS = {
  herbe: [52, 56, 60],
  sable: [53, 57, 61],
  neige: [54, 58, 62],
  glace: [55, 59, 63],
} as const satisfies Readonly<Record<TerrainMaterial, SunkenLevelSlots>>;

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
/** Every transition a one-cell ramp may join: 0↔1 up to (`TERRAIN_LEVELS` - 2)↔(last). */
export const RAMP_ONE_CELL_LEVELS: readonly number[] = Array.from(
  { length: TERRAIN_LEVELS - 1 },
  (_unused, level) => level,
);
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
    // The RETIRED thin-ice material's three base slots (16, 17, 18), declared as ordinary ice.
    //
    // They are not decoration and they are not dead weight: a slot is an INDEX into this array, so
    // the blocks below start wherever this one ends. Thin ice was retired by removing its material
    // from `AUTHORED_TERRAIN_MATERIALS` (af434a16, 2026-08-11), which shortened every generated
    // block and slid the level-3 block from 19..23 down to 16..19, while
    // `TERRAIN_MATERIAL_SLOTS`, and therefore every map ever saved, went on naming 19, 20, 21, 22.
    // Sand, snow and ice at level 3 have referenced undeclared slots ever since. Nothing failed
    // loudly because the terrain is a mesh built from the heightfield's levels and materials, not
    // from tile art.
    //
    // Restoring the three entries puts every later slot back where the tables say it is, and it
    // costs nothing: a stored thin-ice tile draws as the ice it always looked like, which is the
    // same reading `RETIRED_THIN_ICE_SLOTS` gives it in `materialOfSlot`.
    ...([0, 1, 2] as const).map((level) => ({
      atlas: ATLAS,
      origin: { col: level === 0 ? 0 : 5, row: 0 },
      kind: "edge16" as const,
      passable: true,
      priority: "below" as const,
      renderLevel: level,
      ...(level === 0 ? {} : { tint: level === 1 ? RAISED_1_TINT : RAISED_2_TINT }),
    })),
    // Appended after every existing slot so persisted authored tile ids remain stable. The order
    // mirrors AUTHORED_TERRAIN_MATERIALS and therefore yields the declared slots 19 through 22,
    // with 23 the retired thin ice's own level 3: the five-material shape this band was written
    // for, and the one the tables have always described.
    ...AUTHORED_TERRAIN_MATERIALS.map(() => ({
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16" as const,
      passable: true,
      priority: "below" as const,
      renderLevel: 3 as const,
      tint: RAISED_3_TINT,
    })),
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16" as const,
      passable: true,
      priority: "below" as const,
      renderLevel: 3 as const,
      tint: RAISED_3_TINT,
    },
    // Levels 4 and up, one block of four materials per level, appended for the same reason: a
    // stored id must never change meaning. They reuse the raised sheet and the level-3 render layer
    // and differ only by tint, which is the honest answer to a range this tall: the renderer's own
    // atlas lookup clamps at its four palettes, so bespoke art per level would be four sheets the
    // sheet-picker cannot reach. `TERRAIN_MATERIAL_SLOTS` lists the slots this yields.
    ...Array.from({ length: TERRAIN_LEVELS - 4 }, (_unused, index) => index + 4).flatMap(
      (level) => {
        const tint = raisedTint(level) ?? RAISED_3_TINT;
        return AUTHORED_TERRAIN_MATERIALS.map(() => ({
          atlas: ATLAS,
          origin: { col: 5, row: 0 },
          kind: "edge16" as const,
          passable: true,
          priority: "below" as const,
          renderLevel: 3 as const,
          tint,
        }));
      },
    ),
    // The sunken levels, depth 1 to 3: slots 52 through 63, the last of the reservation. They are
    // the SAME ground as level 0 -- walkable, of their material, and dry -- drawn on the lowest
    // render band and darkened by depth, since what tells a pit from a plateau is the wall between
    // them and the shadow inside it, not a different sheet.
    ...Array.from({ length: SUNKEN_TERRAIN_LEVELS }, (_unused, index) => index + 1).flatMap(
      (depth) =>
        AUTHORED_TERRAIN_MATERIALS.map(() => ({
          atlas: ATLAS,
          origin: { col: 0, row: 0 },
          kind: "edge16" as const,
          passable: true,
          priority: "below" as const,
          renderLevel: 0 as const,
          tint: sunkenTint(depth),
        })),
    ),
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

/**
 * What a cell that is not ground at all reads as: water, the void, and off the map.
 *
 * It was -1 until ground could sink, and -1 is now a LEVEL. The replacement is not -4 or -99 but
 * negative infinity, because every use of it is a comparison ("is this neighbour higher than
 * that one") and infinity is the only value that can never be overtaken by a range that grows
 * again. Read it with `isGroundElevation`, never with `< 0`: that test used to mean "not ground"
 * and now means "in a pit".
 */
export const NO_GROUND_ELEVATION = Number.NEGATIVE_INFINITY;

/** Whether an elevation read off a slot is real ground, at any level, sunken ones included. */
export function isGroundElevation(elevation: number): boolean {
  return elevation !== NO_GROUND_ELEVATION;
}

/** Which elevation level a ground slot stands at, or `NO_GROUND_ELEVATION` for anything that is
 *  not authored ground. Sunken slots answer with a NEGATIVE level, which is the whole point. */
export function elevationOfSlot(slot: number): number {
  for (const material of AUTHORED_TERRAIN_MATERIALS) {
    const level = (TERRAIN_MATERIAL_SLOTS[material] as readonly number[]).indexOf(slot);
    if (level >= 0) return level;
    const depth = (SUNKEN_MATERIAL_SLOTS[material] as readonly number[]).indexOf(slot);
    if (depth >= 0) return -(depth + 1);
  }
  return NO_GROUND_ELEVATION;
}

/** The physical/visual material encoded by an authored ground slot. Non-ground legacy slots keep
 * the historical grass fallback; their elevation is still rejected separately above. */
export function materialOfSlot(slot: number): TerrainMaterial {
  for (const material of AUTHORED_TERRAIN_MATERIALS) {
    if ((TERRAIN_MATERIAL_SLOTS[material] as readonly number[]).includes(slot)) return material;
    if ((SUNKEN_MATERIAL_SLOTS[material] as readonly number[]).includes(slot)) return material;
  }
  if (RETIRED_THIN_ICE_SLOTS.includes(slot)) return "glace";
  return "herbe";
}

/** The slot painting `material` at `level`, sunken levels included, or `null` off the range. */
export function terrainSlot(material: TerrainMaterial, level: number): number | null {
  if (level >= 0) return TERRAIN_MATERIAL_SLOTS[material][level] ?? null;
  return SUNKEN_MATERIAL_SLOTS[material][-level - 1] ?? null;
}

/**
 * The highest authored elevation: the ground plus ten plateaus.
 *
 * Derived, never typed by hand: it IS the length of a material's slot table, so the day a level is
 * added or removed there, this follows. `TERRAIN_LEVELS` above records why the table stops where it
 * does, and what a taller or a sunken range would cost.
 *
 * What the range does NOT cost, contrary to an earlier reading of this file: new ground art per
 * level. The renderer's `terrainAtlasKey` clamps to its four palettes and the cliff-face picker
 * clamps at level 2, so everything above three repeats the level-3 look. Repetition is a fair price
 * for a range an author can actually use; eleven bespoke tints and cliff sheets are not.
 */
export const MAX_TERRAIN_LEVEL = GRASS_SLOTS.length - 1;

/**
 * The deepest authored elevation: three levels of dry pit below the ground plane.
 *
 * Derived from the sunken table for the same reason `MAX_TERRAIN_LEVEL` is derived from the raised
 * one. A pit is DRY: it is ordinary ground at a negative level, walkable, of its own material, and
 * it is not the sea. Water remains the absence of ground (`NO_GROUND_ELEVATION`), which is what
 * keeps "there is a hole in the map here" and "the ground here is low" from ever being the same
 * fact.
 */
export const MIN_TERRAIN_LEVEL = -(SUNKEN_MATERIAL_SLOTS.herbe.length as number);
