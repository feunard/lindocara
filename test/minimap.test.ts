import { describe, expect, it } from "vitest";
import {
  type BakedWorldKey,
  bakeZoneTerrain,
  clampToRing,
  colorForKind,
  MINIMAP_WORLD_RADIUS,
  projectToMinimap,
  projectToWorldMap,
  sameBakedWorld,
} from "../src/client/game/minimap.js";
import { PLAYER_VISIBILITY_RADIUS } from "../src/shared/interest.js";
import type { TileKind } from "../src/shared/tilemap.js";

const SIZE = 200;
const CENTER = { x: 2000, y: 1000 };

describe("minimap projection", () => {
  it("puts the viewer at the centre of the widget", () => {
    const point = projectToMinimap(CENTER, CENTER, SIZE);
    expect(point).toEqual({ x: 100, y: 100, inside: true });
  });

  it("matches the server's player visibility radius, so it never draws empty space", () => {
    // Pinned to the coupling, not the literal: tuning PLAYER_VISIBILITY_RADIUS must move this
    // with it, so nobody can shrink the server's radius and leave the minimap drawing a ring of
    // empty space where players actually are.
    expect(MINIMAP_WORLD_RADIUS).toBe(PLAYER_VISIBILITY_RADIUS);
  });

  it("maps a point at exactly the radius onto the edge of the circle", () => {
    const east = { x: CENTER.x + MINIMAP_WORLD_RADIUS, y: CENTER.y };
    const point = projectToMinimap(east, CENTER, SIZE);
    expect(point.x).toBeCloseTo(SIZE, 5);
    expect(point.y).toBeCloseTo(SIZE / 2, 5);
    expect(point.inside).toBe(true);
  });

  it("reports a point beyond the radius as outside, so it is not drawn", () => {
    const far = { x: CENTER.x + MINIMAP_WORLD_RADIUS + 1, y: CENTER.y };
    expect(projectToMinimap(far, CENTER, SIZE).inside).toBe(false);
  });

  it("keeps world-map aspect ratio and maps world corners to image corners", () => {
    const world = { width: 4800, height: 2700 };
    const size = { width: 600, height: 337.5 };
    expect(projectToWorldMap({ x: 0, y: 0 }, world, size)).toEqual({ x: 0, y: 0, inside: true });
    expect(projectToWorldMap({ x: 4800, y: 2700 }, world, size)).toEqual({
      x: 600,
      y: 337.5,
      inside: true,
    });
    const middle = projectToWorldMap({ x: 2400, y: 1350 }, world, size);
    expect(middle.x).toBeCloseTo(300, 5);
    expect(middle.y).toBeCloseTo(168.75, 5);
  });
});

describe("corpse ring clamp", () => {
  // A sign error here walks a ghost the wrong way across a 4800x2700 world. Pin all four.
  const cases = [
    { name: "east", target: { x: CENTER.x + 3000, y: CENTER.y }, angle: 0 },
    { name: "south", target: { x: CENTER.x, y: CENTER.y + 3000 }, angle: Math.PI / 2 },
    { name: "west", target: { x: CENTER.x - 3000, y: CENTER.y }, angle: Math.PI },
    { name: "north", target: { x: CENTER.x, y: CENTER.y - 3000 }, angle: -Math.PI / 2 },
  ];

  for (const { name, target, angle } of cases) {
    it(`points at a corpse lying to the ${name}`, () => {
      const ring = clampToRing(target, CENTER, SIZE);
      expect(ring.inside).toBe(false);
      expect(Math.cos(ring.angle)).toBeCloseTo(Math.cos(angle), 5);
      expect(Math.sin(ring.angle)).toBeCloseTo(Math.sin(angle), 5);
    });
  }

  it("lands the arrow on the ring, not somewhere inside it", () => {
    const ring = clampToRing({ x: CENTER.x + 3000, y: CENTER.y - 3000 }, CENTER, SIZE);
    const radius = Math.hypot(ring.x - SIZE / 2, ring.y - SIZE / 2);
    expect(radius).toBeCloseTo(SIZE / 2, 5);
  });

  it("reports a corpse within the radius as inside, so a skull is drawn instead of an arrow", () => {
    const near = { x: CENTER.x + 100, y: CENTER.y + 100 };
    const ring = clampToRing(near, CENTER, SIZE);
    expect(ring.inside).toBe(true);
    expect(Math.hypot(ring.x - SIZE / 2, ring.y - SIZE / 2)).toBeLessThan(SIZE / 2);
  });
});

describe("minimap colour", () => {
  it("gives every tile kind its own colour", () => {
    const kinds: TileKind[] = ["grass", "forest", "building", "water", "bridge", "plateau"];
    const colors = kinds.map((kind) => colorForKind(kind));
    expect(new Set(colors).size).toBeGreaterThan(1);
    for (const color of colors) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("draws water and land differently, so a shoreline is legible at a glance", () => {
    expect(colorForKind("water")).not.toBe(colorForKind("grass"));
  });

  // The minimap exists to be trusted. If it paints a forest as walkable grass, a player will
  // plan a route through a wall.
  it("does not paint a forest the same as open grass", () => {
    expect(colorForKind("forest")).not.toBe(colorForKind("grass"));
  });
});

describe("bakeZoneTerrain", () => {
  // This is the regression: mmo-test-zone is a real, player-reachable zone (10x8 tiles) behind
  // the verdant-gate portal, but the minimap bake used to hardcode VERDANT_REACH_TERRAIN.tiles
  // regardless of which zone the welcome described. Measured directly (not assumed): world
  // (160,160) — mmo-test-zone's own spawn point — is Verdant Reach's row 2 / col 2, a `forest`
  // cell there, but `grass` in mmo-test-zone's own grid. A bake that resolved the wrong zone's
  // tiles from `zoneId` here would paint a real, walkable spawn as solid, impassable-looking
  // forest — exactly what shipped.
  it("never paints Verdant Reach's terrain over another zone", () => {
    const verdantBake = bakeZoneTerrain("verdant-reach", 4800, 2700);
    const testZoneBake = bakeZoneTerrain("mmo-test-zone", 640, 480);

    // texel (20, 20) * MINIMAP_TEXTURE_SCALE(8) = world (160, 160).
    expect(verdantBake.colorAt(20, 20)).toBe(colorForKind("forest"));
    expect(testZoneBake.colorAt(20, 20)).toBe(colorForKind("grass"));
    expect(testZoneBake.colorAt(20, 20)).not.toBe(verdantBake.colorAt(20, 20));
  });

  // Measured: world (352, 216) is `water` in mmo-test-zone's own grid — the room's one real
  // obstacle — but `grass` at the same raw coordinate in Verdant Reach's much larger map. The
  // old hardcoded bake would have shown this spot as open grass, same as everywhere else, and the
  // obstacle would never appear.
  it("paints mmo-test-zone's one real obstacle", () => {
    const testZoneBake = bakeZoneTerrain("mmo-test-zone", 640, 480);

    // texel (44, 27) * MINIMAP_TEXTURE_SCALE(8) = world (352, 216).
    expect(testZoneBake.colorAt(44, 27)).toBe(colorForKind("water"));
  });
});

describe("sameBakedWorld", () => {
  const base: BakedWorldKey = {
    zoneId: "verdant-reach",
    revision: 0,
    width: 4800,
    height: 2700,
  };

  it("is true for two welcomes describing the identical zone, even as different object instances", () => {
    const identical: BakedWorldKey = {
      ...base,
    };
    expect(sameBakedWorld(base, identical)).toBe(true);
  });

  it("does not share a texture between different zone ids with identical dimensions", () => {
    expect(sameBakedWorld(base, { ...base, zoneId: "mmo-test-zone" })).toBe(false);
  });

  it("is false when the footprint differs", () => {
    expect(sameBakedWorld(base, { ...base, width: 640 })).toBe(false);
    expect(sameBakedWorld(base, { ...base, height: 480 })).toBe(false);
  });

  it("does not reuse a texture after a map revision changes", () => {
    expect(sameBakedWorld(base, { ...base, revision: 1 })).toBe(false);
  });

  it("reuses the texture when only non-baked welcome data changes", () => {
    const first = { ...base, zoneNameKey: "zone.verdant_reach.name", obstacles: [] };
    const reconnected = {
      ...base,
      zoneNameKey: "zone.renamed.name",
      obstacles: [{ x: 100, y: 100, width: 50, height: 50 }],
    };
    expect(sameBakedWorld(first, reconnected)).toBe(true);
  });
});
