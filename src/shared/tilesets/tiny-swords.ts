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
import type { Tileset } from "../tileset.js";

export const TINY_SWORDS_TILESET_ID = "tiny-swords";

const ATLAS = "tilemap-color1";

/**
 * Elevation shading, as a multiplicative tint. The wireframe darkens raised ground with a CSS
 * `brightness()` filter; a tint is the same multiply and is what PixiJS already spends per sprite.
 * Its `saturate()` companion has no tint equivalent and is dropped — the brightness step is what
 * reads as height.
 */
const RAISED_1_TINT = 0xdbdbdb;
const RAISED_2_TINT = 0xb8b8b8;

/** Autotile slots, in declaration order. The indices are the contract; the array below matches. */
export const GRASS_SLOTS: readonly [number, number, number] = [0, 1, 2];
export const CLIFF_WALL_SLOT = 3;

// Adding a second tileset, or growing `autotiles`/`fixed` here past what pushes an id's digit
// width past 4, moves `MAX_MAP_JSON_BYTES` (server/index.ts) — its comment derives the cap from
// this tileset's largest id.
export const TINY_SWORDS_TILESET: Tileset = {
  id: TINY_SWORDS_TILESET_ID,
  autotiles: [
    { atlas: ATLAS, origin: { col: 0, row: 0 }, kind: "edge16", passable: true, priority: "below" },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      tint: RAISED_1_TINT,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      tint: RAISED_2_TINT,
    },
    // The wall is drawn into the cell below its owner and is the reason three-level elevation needs
    // no directional passage: a cliff face is simply a cell you cannot walk into.
    { atlas: ATLAS, origin: { col: 5, row: 4 }, kind: "run4", passable: false, priority: "below" },
  ],
  fixed: [
    // Ramps: the only passable cells that join two elevation levels.
    { atlas: ATLAS, col: 0, row: 4, passable: true, priority: "below" },
    { atlas: ATLAS, col: 0, row: 5, passable: true, priority: "below" },
    { atlas: ATLAS, col: 3, row: 4, passable: true, priority: "below" },
    { atlas: ATLAS, col: 3, row: 5, passable: true, priority: "below" },
  ],
};

const BY_ID = new Map<string, Tileset>([[TINY_SWORDS_TILESET_ID, TINY_SWORDS_TILESET]]);

export function tilesetById(id: string): Tileset | null {
  return BY_ID.get(id) ?? null;
}

/** Which elevation level a ground slot stands at, or -1 for anything that is not grass. */
export function elevationOfSlot(slot: number): number {
  const level = GRASS_SLOTS.indexOf(slot);
  return level;
}
