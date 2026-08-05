import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  planShadowDance,
  type ShadowDanceCandidate,
} from "@lindocara/server/world/rogue-shadow-dance-system.js";
import {
  BODY_RADIUS,
  canStand,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/server/world/terrain-access.js";
import { describe, expect, it } from "vitest";

/** The suite's original PIXEL geometry over `TILE_SIZE`; positions are body centres. */
const t = (pixels: number): number => pixels / TILE_SIZE;

const SIZE = 32;

function terrain(colliders: readonly ColliderRect[] = []): ZoneTerrain {
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: 0.5,
    waterLevel: -0.25,
    levels: new Array(SIZE * SIZE).fill(0),
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders: [...colliders],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/** A wall written in the suite's pixel frame. */
function wall(x: number, z: number, width: number, height: number): ColliderRect {
  return { x: t(x), z: t(z), w: t(width), h: t(height) };
}

const radius = () => t(14);

describe("authoritative Shadow Dance planning", () => {
  it("starts on the nearest live target and chains from each previous target", () => {
    const candidates: ShadowDanceCandidate[] = [
      { id: "dead", x: t(70), z: t(128), deadUntil: 2_000 },
      { id: "far-from-origin", x: t(400), z: t(128), deadUntil: 0 },
      { id: "first", x: t(128), z: t(128), deadUntil: 0 },
      { id: "next", x: t(260), z: t(128), deadUntil: 0 },
    ];
    const result = planShadowDance(
      { x: t(32), y: 0, z: t(128) },
      candidates,
      t(180),
      5,
      1_000,
      terrain(),
      radius,
    );
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
      { id: "z", x: t(128), z: t(96), deadUntil: 0 },
      { id: "a", x: t(128), z: t(160), deadUntil: 0 },
      { id: "third", x: t(240), z: t(128), deadUntil: 0 },
    ];
    const result = planShadowDance(
      { x: t(64), y: 0, z: t(128) },
      candidates,
      t(260),
      5,
      1_000,
      terrain(),
      radius,
    );
    if (!result.ok) throw new Error("expected a Shadow Dance route");
    expect(result.plan.primaryTargetId).toBe("a");
    expect(new Set(result.plan.strikes.map((strike) => strike.targetId)).size).toBe(
      result.plan.strikes.length,
    );
    expect(result.plan.strikes).toHaveLength(3);
  });

  it("stops before a wall-crossing transition and keeps every landing walkable", () => {
    const geometry = terrain([wall(300, 0, 16, 512)]);
    const result = planShadowDance(
      { x: t(64), y: 0, z: t(128) },
      [
        { id: "near", x: t(180), z: t(128), deadUntil: 0 },
        { id: "across-wall", x: t(380), z: t(128), deadUntil: 0 },
      ],
      t(260),
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
      result.plan.strikes.every((strike) =>
        canStand(geometry, strike.landing.x, strike.landing.z, BODY_RADIUS, 0),
      ),
    ).toBe(true);
  });

  it("fails cleanly when every visible first landing is sealed", () => {
    const geometry = terrain([wall(205, 140, 8, 8), wall(174, 176, 8, 8), wall(174, 104, 8, 8)]);
    expect(
      planShadowDance(
        { x: t(64), y: 0, z: t(128) },
        [{ id: "sealed", x: t(160), z: t(128), deadUntil: 0 }],
        t(360),
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
      x: t(96 + index * 70),
      z: t(128),
      deadUntil: 0,
    }));
    const result = planShadowDance(
      { x: t(32), y: 0, z: t(128) },
      candidates,
      t(360),
      5,
      1_000,
      terrain(),
      radius,
    );
    if (!result.ok) throw new Error("expected a dense Shadow Dance route");
    expect(result.plan.strikes).toHaveLength(5);
  });

  it("fills a sparse Thousand Cuts route with bounded returns to the primary target", () => {
    const result = planShadowDance(
      { x: t(32), y: 0, z: t(128) },
      [{ id: "boss", x: t(128), z: t(128), deadUntil: 0 }],
      t(360),
      5,
      1_000,
      terrain(),
      radius,
      { repeatPrimary: true },
    );
    if (!result.ok) throw new Error("expected a single-target Thousand Cuts route");
    expect(result.plan.strikes).toHaveLength(5);
    expect(result.plan.strikes.map((strike) => strike.targetId)).toEqual(
      Array.from({ length: 5 }, () => "boss"),
    );
    expect(result.plan.strikes.map((strike) => strike.repeated ?? false)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
  });
});
