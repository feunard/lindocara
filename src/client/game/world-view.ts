export interface WorldBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TileWindow {
  startX: number;
  startY: number;
  columns: number;
  rows: number;
}

export function cameraAxisOffset(
  viewportSize: number,
  worldSize: number,
  scale: number,
  cameraCoordinate: number,
): number {
  const scaledWorldSize = worldSize * scale;
  if (scaledWorldSize <= viewportSize) return (viewportSize - scaledWorldSize) / 2;
  const desired = viewportSize / 2 - cameraCoordinate * scale;
  return Math.min(0, Math.max(viewportSize - scaledWorldSize, desired));
}

export function tileWindowForBounds(
  bounds: WorldBounds,
  worldWidth: number,
  worldHeight: number,
  tileSize: number,
): TileWindow {
  const startX = Math.max(0, Math.floor(bounds.left / tileSize) * tileSize);
  const startY = Math.max(0, Math.floor(bounds.top / tileSize) * tileSize);
  const endX = Math.min(worldWidth, Math.ceil(bounds.right / tileSize) * tileSize);
  const endY = Math.min(worldHeight, Math.ceil(bounds.bottom / tileSize) * tileSize);
  return {
    startX,
    startY,
    columns: Math.max(0, Math.ceil((endX - startX) / tileSize)),
    rows: Math.max(0, Math.ceil((endY - startY) / tileSize)),
  };
}
