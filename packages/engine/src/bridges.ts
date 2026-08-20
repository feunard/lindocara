/** Shared authoring dimensions for the two native wooden bridge assets. */

export const BRIDGE_ASSET_IDS = {
  horizontal: "terrain.bridge.wood.horizontal",
  vertical: "terrain.bridge.wood.vertical",
} as const;

export type BridgeOrientation = keyof typeof BRIDGE_ASSET_IDS;
export type BridgeAssetId = (typeof BRIDGE_ASSET_IDS)[BridgeOrientation];

/**
 * The one bridge the palette offers, and the answer every ambiguous crossing falls back to.
 *
 * Both ids stay real assets: `bridgeAssetIdForCrossing` picks between them at placement, the
 * inspector switches an existing deck from one to the other, and every stored map keeps loading
 * either. Only the second CARD is gone, because two cards described one sheet at two rotations.
 */
export const DEFAULT_BRIDGE_ASSET_ID: BridgeAssetId = BRIDGE_ASSET_IDS.horizontal;

export interface BridgeDimensions {
  /** Cells along the crossing direction. */
  length: number;
  /** Cells between the two side rails. */
  width: number;
}

export const DEFAULT_BRIDGE_DIMENSIONS: BridgeDimensions = { length: 3, width: 1 };
export const MIN_BRIDGE_DIMENSION = 1;
export const MAX_BRIDGE_DIMENSION = 32;
const BRIDGE_DIMENSION_CODE_BASE = MAX_BRIDGE_DIMENSION + 1;

export function bridgeOrientation(assetId: string): BridgeOrientation | null {
  if (assetId === BRIDGE_ASSET_IDS.horizontal) return "horizontal";
  if (assetId === BRIDGE_ASSET_IDS.vertical) return "vertical";
  return null;
}

export function bridgeBaseRotationDegrees(assetId: string): 0 | 90 | null {
  const orientation = bridgeOrientation(assetId);
  return orientation === "horizontal" ? 0 : orientation === "vertical" ? 90 : null;
}

/** Contiguous open cells through `(col, row)` along one axis, the anchor included. Capped at the
 *  longest authorable deck in each direction: an ocean would otherwise be walked to the map edge to
 *  learn what two capped runs already say, which is "this is not a crossing". */
function openRun(
  openAt: (col: number, row: number) => boolean,
  col: number,
  row: number,
  stepCol: number,
  stepRow: number,
): number {
  let run = 1;
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= MAX_BRIDGE_DIMENSION; step += 1) {
      if (!openAt(col + stepCol * direction * step, row + stepRow * direction * step)) break;
      run += 1;
    }
  }
  return run;
}

/**
 * Which bridge belongs on this cell: a deck crosses water the SHORT way. A river running north to
 * south is long down the row axis and narrow across the column axis, so what spans it is a
 * `horizontal` deck; an east-west river is the same argument turned ninety degrees.
 *
 * `openAt` answers "is this cell open water" over the caller's own map, which is what keeps this
 * module free of every map type (and what makes the rule testable without one). It must answer
 * `false` off-map, so the walk stops at the border like it stops at a bank.
 *
 * A dry anchor or a tie (a square pond, the open sea, plain ground) keeps
 * `DEFAULT_BRIDGE_ASSET_ID`. That is deliberately the orientation the palette card previews: a
 * placement made nowhere near water is the one the author was already looking at.
 */
export function bridgeAssetIdForCrossing(
  openAt: (col: number, row: number) => boolean,
  col: number,
  row: number,
): BridgeAssetId {
  if (!openAt(col, row)) return DEFAULT_BRIDGE_ASSET_ID;
  const across = openRun(openAt, col, row, 1, 0);
  const along = openRun(openAt, col, row, 0, 1);
  return across <= along ? BRIDGE_ASSET_IDS.horizontal : BRIDGE_ASSET_IDS.vertical;
}

export function parseBridgeDimensions(value: unknown): BridgeDimensions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { length, width } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(width)) return null;
  if (
    (length as number) < MIN_BRIDGE_DIMENSION ||
    (length as number) > MAX_BRIDGE_DIMENSION ||
    (width as number) < MIN_BRIDGE_DIMENSION ||
    (width as number) > MAX_BRIDGE_DIMENSION
  ) {
    return null;
  }
  return { length: length as number, width: width as number };
}

export function bridgeDimensionsOrDefault(value?: BridgeDimensions): BridgeDimensions {
  return value ?? DEFAULT_BRIDGE_DIMENSIONS;
}

/**
 * Cell-aligned footprint preserving the two catalogue assets' historical anchors. Horizontal
 * bridges are centred on their anchor column and end on its row; vertical bridges are centred on
 * their anchor column by width and end on its row by length.
 */
export function bridgePlacementLayout(element: {
  assetId: string;
  col: number;
  row: number;
  bridge?: BridgeDimensions;
}):
  | (BridgeDimensions & {
      orientation: BridgeOrientation;
      startCol: number;
      startRow: number;
      cols: number;
      rows: number;
    })
  | null {
  const orientation = bridgeOrientation(element.assetId);
  if (!orientation) return null;
  const dimensions = bridgeDimensionsOrDefault(element.bridge);
  if (orientation === "horizontal") {
    return {
      ...dimensions,
      orientation,
      startCol: element.col - Math.floor((dimensions.length - 1) / 2),
      startRow: element.row - dimensions.width + 1,
      cols: dimensions.length,
      rows: dimensions.width,
    };
  }
  return {
    ...dimensions,
    orientation,
    startCol: element.col - Math.floor((dimensions.width - 1) / 2),
    startRow: element.row - dimensions.length + 1,
    cols: dimensions.width,
    rows: dimensions.length,
  };
}

/** Compact database representation in the existing modern element-transform integer. */
export function encodeBridgeDimensions(value?: BridgeDimensions): number {
  if (!value) return 0;
  return value.length * BRIDGE_DIMENSION_CODE_BASE + value.width;
}

/** `undefined` is the legacy/default 3x1 bridge; `null` is malformed durable data. */
export function decodeBridgeDimensions(code: number): BridgeDimensions | undefined | null {
  if (code === 0) return undefined;
  if (!Number.isSafeInteger(code) || code < 0) return null;
  return parseBridgeDimensions({
    length: Math.floor(code / BRIDGE_DIMENSION_CODE_BASE),
    width: code % BRIDGE_DIMENSION_CODE_BASE,
  });
}
