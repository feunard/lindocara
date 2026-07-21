import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";
import {
  cameraAxisOffset,
  GAME_CAMERA_ZOOM,
  gameCameraScale,
  PLAYER_RENDER_SCALE,
  playerRenderScale,
  tileWindowForBounds,
} from "../src/client/game/world-view.js";

describe("multizone camera geometry", () => {
  it("renders every hero 30% smaller and zooms every client out by 20%", () => {
    expect(PLAYER_RENDER_SCALE).toBe(0.7);
    expect(GAME_CAMERA_ZOOM).toBe(0.8);
    expect(gameCameraScale(1220, 700)).toBe(0.8);
    expect(gameCameraScale(2440, 1400)).toBe(1.6);
    expect(playerRenderScale("hero", "hero")).toBe(PLAYER_RENDER_SCALE);
    expect(playerRenderScale("party-member", "hero")).toBe(PLAYER_RENDER_SCALE);
  });

  it("centres a zone that is smaller than the viewport", () => {
    expect(cameraAxisOffset(1280, 640, 1, 160)).toBe(320);
    expect(cameraAxisOffset(720, 480, 1, 160)).toBe(120);
  });

  it("clamps a large zone to both viewport edges", () => {
    expect(cameraAxisOffset(1280, 8000, 1, 0)).toBe(0);
    expect(cameraAxisOffset(1280, 8000, 1, 8000)).toBe(-6720);
  });

  it("uses the active zone dimensions for small and future large tilemaps", () => {
    expect(
      tileWindowForBounds({ left: 0, top: 0, right: 1280, bottom: 720 }, 640, 480, TILE_SIZE),
    ).toEqual({ startX: 0, startY: 0, columns: 10, rows: 8 });

    const large = tileWindowForBounds(
      { left: 7420, top: 4400, right: 8000, bottom: 5000 },
      8000,
      5000,
      TILE_SIZE,
    );
    expect(large.startX).toBe(7360);
    expect(large.startX + large.columns * TILE_SIZE).toBeGreaterThanOrEqual(8000);
    expect(large.startY + large.rows * TILE_SIZE).toBeGreaterThanOrEqual(5000);
  });
});
