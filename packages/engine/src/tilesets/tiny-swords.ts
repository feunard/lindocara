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

/** Autotile slots, in declaration order. The indices are the contract; the array below matches. */
export const GRASS_SLOTS: readonly [number, number, number] = [0, 1, 2];
export const CLIFF_WALL_SLOT = 3;

const RAMP_BANKS = [
  { atlas: ATLAS, col: 0, row: 4, side: "left" },
  { atlas: ATLAS, col: 0, row: 5, side: "left" },
  { atlas: ATLAS, col: 3, row: 4, side: "right" },
  { atlas: ATLAS, col: 3, row: 5, side: "right" },
] as const;

const RAMP_ROTATIONS = [0, 1, 2, 3] as const;
export const RAMP_FIXED_TILE_COUNT = RAMP_BANKS.length * RAMP_ROTATIONS.length;
const RAMP_BANK_OFFSET_PX = 16;

/** Rotate a source-space offset into the destination cell alongside its ramp bank. */
function rotatedOffset(
  x: number,
  y: number,
  turns: (typeof RAMP_ROTATIONS)[number],
): { x: number; y: number } {
  if (turns === 1) return { x: -y, y: x };
  if (turns === 2) return { x: -x, y: -y };
  if (turns === 3) return { x: y, y: -x };
  return { x, y };
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
  // Ramps are the only passable fixtures that visually join two elevation levels. The source sheet
  // leaves two whole atlas cells between its banks, producing a 256px-wide gateway at native scale.
  // In the editor that read as a building-sized object, so each bank is compressed to half a cell
  // and pulled to the outside of a compact 2x2 stamp. The centre stays a 64px visible passage. Four
  // groups of ids rotate both the art and its destination-space offset, so the frozen id still owns
  // complete appearance + collision truth.
  fixed: [
    ...RAMP_ROTATIONS.flatMap((rotationQuarterTurns) =>
      RAMP_BANKS.map((bank) => {
        const offset = rotatedOffset(
          bank.side === "left" ? -RAMP_BANK_OFFSET_PX : RAMP_BANK_OFFSET_PX,
          0,
          rotationQuarterTurns,
        );
        return {
          atlas: bank.atlas,
          col: bank.col,
          row: bank.row,
          passable: true,
          priority: "below" as const,
          rotationQuarterTurns,
          drawScaleX: 0.5,
          drawOffsetX: offset.x,
          drawOffsetY: offset.y,
        };
      }),
    ),
    ...RAMP_ROTATIONS.map((rotationQuarterTurns) => ({
      ...CLIFF_FACE,
      rotationQuarterTurns,
    })),
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
