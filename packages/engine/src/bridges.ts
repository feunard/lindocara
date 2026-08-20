/** Shared authoring dimensions for the two native wooden bridge assets. */

export const BRIDGE_ASSET_IDS = {
  horizontal: "terrain.bridge.wood.horizontal",
  vertical: "terrain.bridge.wood.vertical",
} as const;

export type BridgeOrientation = keyof typeof BRIDGE_ASSET_IDS;

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
