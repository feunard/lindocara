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

/**
 * The whole cast draws at the pack's own scale.
 *
 * This was 0.7 while guards, monsters and authored NPCs drew at 1.0 — so a hero stood a head shorter
 * than the captain he was talking to, and 43% shorter than the goblin swinging at him. It is the same
 * mistake `enemy-art.ts` documents for the bestiary, and that the deleted `renderer.ts` documented
 * for the unit frame:
 * Tiny Swords is already in proportion with itself, and shrinking ONE class of sprite is what breaks
 * it. A hero's body is 79x89px on 64px tiles here — about 1.2 x 1.4 tiles, which is the proportion
 * the pack's own promo art draws a knight at.
 *
 * The seam stays a function so a future per-player effect (a shrink hex, a mounted hero) has a home,
 * but there is no longer a constant class of sprite drawn smaller than the world it stands in.
 */
export const PLAYER_RENDER_SCALE = 1;
export const GAME_CAMERA_ZOOM = 0.8;

/** Tiny Swords hero pixels begin around y=-60 once their native frame is grounded. Keep the
 * nameplate and six-pixel health bar entirely above that silhouette instead of covering its head. */
export const PLAYER_VISIBLE_TOP_Y = -60;
export const PLAYER_LABEL_Y = -72;
export const PLAYER_HEALTH_BAR_Y = -68;

/** Every living avatar and corpse uses one scale, regardless of which client is looking at it. */
export function playerRenderScale(_playerId: string, _selfId: string | null): number {
  return PLAYER_RENDER_SCALE;
}

/**
 * **NOTHING CALLS THESE THREE TODAY.** `gameCameraScale`, `cameraAxisOffset` and
 * `elevatedCameraAxisOffset` were the deleted PixiJS renderer's camera placement, and the HD-2D
 * camera (`hd2d/scene.ts`'s `focusOn`/`render`) does not apply them: it follows its target with no
 * bound clamping at all. `world-view.test.ts` still asserts them, so the suite reports green
 * coverage over a clamp the game does not run — the tests are pinning a rule, not a behaviour.
 *
 * They are kept rather than deleted because the rules are the expensive part and they were measured
 * once already; the HD-2D camera is expected to adopt them. Read the marker at `scene.ts`'s
 * `focusOn` and `docs/hd2d-rendering.md`'s "What `renderer.ts` knew" before wiring them in.
 */
export function gameCameraScale(viewportWidth: number, viewportHeight: number): number {
  const fitted = Math.min(viewportWidth / 1220, viewportHeight / 700);
  return Math.max(
    0.9 * GAME_CAMERA_ZOOM,
    Math.min(3.2 * GAME_CAMERA_ZOOM, fitted * GAME_CAMERA_ZOOM),
  );
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

/**
 * Vertical camera placement with an authored elevation cue.
 *
 * **The ordering is the whole point, and it is a rule, not a description of what runs today** (see
 * the note above `gameCameraScale`: no camera calls this). The ordinary camera is clamped to map
 * bounds FIRST; the elevation rise is then applied as a small screen-space look-up offset, so a
 * staircase near the north edge still moves the view. Folding the rise into `cameraCoordinate`
 * before the clamp makes the clamp erase it completely — that was a real bug, once.
 */
export function elevatedCameraAxisOffset(
  viewportSize: number,
  worldSize: number,
  scale: number,
  cameraCoordinate: number,
  elevationRise: number,
): number {
  return cameraAxisOffset(viewportSize, worldSize, scale, cameraCoordinate) + elevationRise * scale;
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
