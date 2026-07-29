import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import { isWalkable, type TerrainGeometry } from "@lindocara/engine/game.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import {
  planShadowDance,
  type ShadowDanceCandidate,
} from "@lindocara/server/world/rogue-shadow-dance-system.js";
import { noColliders } from "@lindocara/testing/tiles.js";
import { describe, expect, it } from "vitest";

const OPEN_TILES = {
  cols: 12,
  rows: 8,
  kinds: Array.from({ length: 96 }, () => "grass" as const),
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

const radius = () => 14;

describe("authoritative Shadow Dance planning", () => {
  it("starts on the nearest live target and chains from each previous target", () => {
    const candidates: ShadowDanceCandidate[] = [
      { id: "dead", x: 70, y: 128, deadUntil: 2_000 },
      { id: "far-from-origin", x: 400, y: 128, deadUntil: 0 },
      { id: "first", x: 128, y: 128, deadUntil: 0 },
      { id: "next", x: 260, y: 128, deadUntil: 0 },
    ];
    const result = planShadowDance({ x: 32, y: 128 }, candidates, 180, 5, 1_000, terrain(), radius);
    expect(result).toMatchObject({
      ok: true,
      plan: {
        primaryTargetId: "first",
        strikes: [{ targetId: "first" }, { targetId: "next" }, { targetId: "far-from-origin" }],
      },
    });
  });

  it("uses an id-stable tie break and never selects one target twice", () => {
    const candidates: ShadowDanceCandidate[] = [
      { id: "z", x: 128, y: 96, deadUntil: 0 },
      { id: "a", x: 128, y: 160, deadUntil: 0 },
      { id: "third", x: 240, y: 128, deadUntil: 0 },
    ];
    const result = planShadowDance({ x: 64, y: 128 }, candidates, 260, 5, 1_000, terrain(), radius);
    if (!result.ok) throw new Error("expected a Shadow Dance route");
    expect(result.plan.primaryTargetId).toBe("a");
    expect(new Set(result.plan.strikes.map((strike) => strike.targetId)).size).toBe(
      result.plan.strikes.length,
    );
    expect(result.plan.strikes).toHaveLength(3);
  });

  it("stops before a wall-crossing transition and keeps every landing walkable", () => {
    const geometry = terrain([{ x: 300, y: 0, width: 16, height: 512 }]);
    const result = planShadowDance(
      { x: 64, y: 128 },
      [
        { id: "near", x: 180, y: 128, deadUntil: 0 },
        { id: "across-wall", x: 380, y: 128, deadUntil: 0 },
      ],
      260,
      5,
      1_000,
      geometry,
      radius,
    );
    expect(result).toMatchObject({
      ok: true,
      plan: { strikes: [{ targetId: "near" }] },
    });
    if (!result.ok) throw new Error("expected a wall-bounded route");
    expect(
      result.plan.strikes.every((strike) => isWalkable(strike.landing, PLAYER_SIZE, geometry)),
    ).toBe(true);
  });

  it("fails cleanly when every visible first landing is sealed", () => {
    const geometry = terrain([
      { x: 205, y: 140, width: 8, height: 8 },
      { x: 174, y: 176, width: 8, height: 8 },
      { x: 174, y: 104, width: 8, height: 8 },
    ]);
    expect(
      planShadowDance(
        { x: 64, y: 128 },
        [{ id: "sealed", x: 160, y: 128, deadUntil: 0 }],
        360,
        5,
        1_000,
        geometry,
        radius,
      ),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("caps a dense chain at five strikes", () => {
    const candidates = Array.from({ length: 7 }, (_, index) => ({
      id: `target-${index}`,
      x: 96 + index * 70,
      y: 128,
      deadUntil: 0,
    }));
    const result = planShadowDance({ x: 32, y: 128 }, candidates, 360, 5, 1_000, terrain(), radius);
    if (!result.ok) throw new Error("expected a dense Shadow Dance route");
    expect(result.plan.strikes).toHaveLength(5);
  });
});
