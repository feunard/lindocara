import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";
import {
  hasRogueLineOfSight,
  isShadowStepPathClear,
  planShadowReturn,
  planShadowStep,
  type ShadowStepCandidate,
  shadowStepDestination,
} from "@lindocara/server/world/rogue-skill-system.js";
import { noColliders } from "@lindocara/testing/tiles.js";
import { describe, expect, it } from "vitest";

const OPEN_TILES = {
  cols: 8,
  rows: 6,
  kinds: Array.from({ length: 48 }, () => "grass" as const),
};

function terrain(
  colliders: readonly { x: number; y: number; width: number; height: number }[] = [],
): TerrainGeometry {
  return {
    width: OPEN_TILES.cols * 64,
    height: OPEN_TILES.rows * 64,
    spawnPoints: [{ x: 32, y: 128 }],
    safeZone: null,
    obstacles: [],
    tiles: OPEN_TILES,
    colliders:
      colliders.length > 0
        ? colliderIndexFrom(colliders, OPEN_TILES.cols, OPEN_TILES.rows)
        : noColliders(OPEN_TILES),
  };
}

const BODY_RADIUS = 14;
const bodyRadius = () => BODY_RADIUS;

describe("authoritative Shadow Step planning", () => {
  it("selects the nearest living visible enemy with an id-stable tie break", () => {
    const origin = { x: 64, y: 128 };
    const candidates: ShadowStepCandidate[] = [
      { id: "dead", x: 70, y: 128, deadUntil: 2_000 },
      { id: "far", x: 260, y: 128, deadUntil: 0 },
      { id: "z-tie", x: 128, y: 96, deadUntil: 0 },
      { id: "a-tie", x: 128, y: 160, deadUntil: 0 },
    ];
    const result = planShadowStep(origin, candidates, 260, 1_000, terrain(), bodyRadius);
    expect(result).toMatchObject({ ok: true, plan: { targetId: "a-tie" } });
  });

  it("treats a sub-cell collider as opaque during target selection", () => {
    const origin = { x: 32, y: 128 };
    const blocked = { id: "blocked", x: 96, y: 128, deadUntil: 0 };
    const visible = { id: "visible", x: 32, y: 240, deadUntil: 0 };
    const geometry = terrain([{ x: 78, y: 140, width: 8, height: 8 }]);

    expect(hasRogueLineOfSight(origin, blocked, geometry)).toBe(false);
    expect(
      planShadowStep(origin, [blocked, visible], 260, 1_000, geometry, bodyRadius),
    ).toMatchObject({ ok: true, plan: { targetId: "visible" } });
  });

  it("lands behind the target, then uses deterministic lateral fallback", () => {
    const origin = { x: 64, y: 128 };
    const target = { x: 160, y: 128 };
    expect(shadowStepDestination(origin, target, BODY_RADIUS, terrain())).toEqual({
      x: 194,
      y: 128,
    });

    const behindBlocked = terrain([{ x: 205, y: 140, width: 8, height: 8 }]);
    expect(shadowStepDestination(origin, target, BODY_RADIUS, behindBlocked)).toEqual({
      x: 160,
      y: 162,
    });
  });

  it("fails cleanly when behind and both lateral positions are occupied", () => {
    const origin = { x: 64, y: 128 };
    const target = { id: "sealed", x: 160, y: 128, deadUntil: 0 };
    const geometry = terrain([
      { x: 205, y: 140, width: 8, height: 8 },
      { x: 174, y: 176, width: 8, height: 8 },
      { x: 174, y: 104, width: 8, height: 8 },
    ]);
    expect(planShadowStep(origin, [target], 260, 1_000, geometry, bodyRadius)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("sweeps the whole Rogue body and never teleports through an obstacle", () => {
    const geometry = terrain([{ x: 145, y: 64, width: 12, height: 192 }]);
    expect(isShadowStepPathClear({ x: 64, y: 128 }, { x: 220, y: 128 }, geometry)).toBe(false);
  });

  it("validates Shadow Return against expiry and the same swept collision geometry", () => {
    const point = { x: 64, y: 128, expiresAt: 2_000 };
    expect(planShadowReturn({ x: 220, y: 128 }, point, 1_999, terrain())).toEqual({
      ok: true,
      destination: { x: 64, y: 128 },
    });
    expect(planShadowReturn({ x: 220, y: 128 }, point, 2_000, terrain())).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(
      planShadowReturn(
        { x: 220, y: 128 },
        point,
        1_999,
        terrain([{ x: 145, y: 64, width: 12, height: 192 }]),
      ),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("reports no target when every living enemy is out of range or out of sight", () => {
    const origin = { x: 32, y: 128 };
    const geometry = terrain([{ x: 78, y: 120, width: 8, height: 48 }]);
    expect(
      planShadowStep(
        origin,
        [
          { id: "hidden", x: 96, y: 128, deadUntil: 0 },
          { id: "distant", x: 400, y: 128, deadUntil: 0 },
        ],
        260,
        1_000,
        geometry,
        bodyRadius,
      ),
    ).toEqual({ ok: false, reason: "no_target" });
  });
});
