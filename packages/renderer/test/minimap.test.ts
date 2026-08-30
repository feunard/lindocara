import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { PLAYER_VISIBILITY_RADIUS } from "@lindocara/engine/interest.js";
import {
  type BakedWorldKey,
  bakeTerrain,
  clampToRing,
  colorForCell,
  MINIMAP_TEXELS_PER_TILE,
  MINIMAP_WORLD_RADIUS,
  projectToMinimap,
  projectToWorldMap,
  sameBakedWorld,
} from "@lindocara/renderer/minimap.js";
import { describe, expect, it } from "vitest";

const SIZE = 200;
/** Tile units, grid centre as origin — deliberately off-centre and negative on one axis, so a
 *  projection that quietly assumed a top-left origin could not pass by accident. */
const CENTER = { x: 6, z: -4 };

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
    const east = { x: CENTER.x + MINIMAP_WORLD_RADIUS, z: CENTER.z };
    const point = projectToMinimap(east, CENTER, SIZE);
    expect(point.x).toBeCloseTo(SIZE, 5);
    expect(point.y).toBeCloseTo(SIZE / 2, 5);
    expect(point.inside).toBe(true);
  });

  it("reports a point beyond the radius as outside, so it is not drawn", () => {
    const far = { x: CENTER.x + MINIMAP_WORLD_RADIUS + 1, z: CENTER.z };
    expect(projectToMinimap(far, CENTER, SIZE).inside).toBe(false);
  });

  it("shifts the grid's origin, so the world is not drawn a half-map out", () => {
    // Not just the scale: the ORIGIN. A grid coordinate runs `-size/2`..`+size/2` and the image
    // runs 0..width, so a projection that only divided by `world.size` would typecheck, keep the
    // right aspect ratio, and put the whole world in the bottom-right quadrant of the map.
    const world = { size: 64 };
    const size = { width: 600, height: 400 };

    expect(projectToWorldMap({ x: -32, z: 0 }, world, size).x).toBeCloseTo(0, 5);
    expect(projectToWorldMap({ x: 0, z: 0 }, world, size).x).toBeCloseTo(size.width / 2, 5);
    expect(projectToWorldMap({ x: 32, z: 0 }, world, size).x).toBeCloseTo(size.width, 5);

    // The same shift on the second ground axis, which the image draws downward.
    expect(projectToWorldMap({ x: 0, z: -32 }, world, size).y).toBeCloseTo(0, 5);
    expect(projectToWorldMap({ x: 0, z: 0 }, world, size).y).toBeCloseTo(size.height / 2, 5);
    expect(projectToWorldMap({ x: 0, z: 32 }, world, size).y).toBeCloseTo(size.height, 5);
  });

  it("maps the grid's corners onto the image's corners", () => {
    const world = { size: 48 };
    const size = { width: 600, height: 337.5 };
    expect(projectToWorldMap({ x: -24, z: -24 }, world, size)).toEqual({
      x: 0,
      y: 0,
      inside: true,
    });
    expect(projectToWorldMap({ x: 24, z: 24 }, world, size)).toEqual({
      x: 600,
      y: 337.5,
      inside: true,
    });
  });
});

describe("corpse ring clamp", () => {
  // A sign error here walks a ghost the wrong way across the whole grid. Pin all four.
  const cases = [
    { name: "east", target: { x: CENTER.x + 30, z: CENTER.z }, angle: 0 },
    { name: "south", target: { x: CENTER.x, z: CENTER.z + 30 }, angle: Math.PI / 2 },
    { name: "west", target: { x: CENTER.x - 30, z: CENTER.z }, angle: Math.PI },
    { name: "north", target: { x: CENTER.x, z: CENTER.z - 30 }, angle: -Math.PI / 2 },
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
    const ring = clampToRing({ x: CENTER.x + 30, z: CENTER.z - 30 }, CENTER, SIZE);
    const radius = Math.hypot(ring.x - SIZE / 2, ring.y - SIZE / 2);
    expect(radius).toBeCloseTo(SIZE / 2, 5);
  });

  it("reports a corpse within the radius as inside, so a skull is drawn instead of an arrow", () => {
    const near = { x: CENTER.x + 1, z: CENTER.z + 1 };
    const ring = clampToRing(near, CENTER, SIZE);
    expect(ring.inside).toBe(true);
    expect(Math.hypot(ring.x - SIZE / 2, ring.y - SIZE / 2)).toBeLessThan(SIZE / 2);
  });
});

describe("minimap colour", () => {
  const MATERIALS: TerrainMaterial[] = [
    "sable",
    "herbe",
    "neige",
    "glace",
    "parquet",
    "lino-gris",
    "lino-jaune",
    "carrelage-beige",
  ];

  it("gives every ground material its own colour", () => {
    const colors = MATERIALS.map((material) => colorForCell(material, 0));
    expect(new Set(colors).size).toBe(MATERIALS.length);
    for (const color of colors) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("draws water and land differently, so a shoreline is legible at a glance", () => {
    // Water is the absence of ground — a `null` level — and it overrides the material entirely,
    // which is why the same material reads differently on either side of the shore.
    expect(colorForCell("herbe", null)).not.toBe(colorForCell("herbe", 0));
  });

  // The minimap exists to be trusted. Elevation is what the old tile world called an obstacle: if
  // a plateau paints exactly like the flat field beside it, a player will plan a route into a cliff.
  it("does not paint raised ground the same as the flat ground beside it", () => {
    expect(colorForCell("herbe", 1)).not.toBe(colorForCell("herbe", 0));
    expect(colorForCell("herbe", 2)).not.toBe(colorForCell("herbe", 1));
  });
});

/** A square map from row-major levels and materials — `null` is water. Nothing authored: the bake
 *  reads terrain only. */
function mapOf(
  size: number,
  levels: readonly (number | null)[],
  materials: readonly TerrainMaterial[],
): MapData {
  return {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: [...levels],
    materials: [...materials],
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

describe("bakeTerrain", () => {
  /** The centre texel of cell `(i, j)`, so an assertion never lands on a cell boundary. */
  function texelOf(i: number): number {
    return i * MINIMAP_TEXELS_PER_TILE + MINIMAP_TEXELS_PER_TILE / 2;
  }

  // A 2x2 map: one water cell and three grounds, two of them different materials and one raised.
  const levels = [null, 0, 1, 0];
  const materials: TerrainMaterial[] = ["herbe", "herbe", "herbe", "sable"];
  const map = mapOf(2, levels, materials);

  it("bakes one square of texels per cell", () => {
    const bake = bakeTerrain(map);
    expect(bake.width).toBe(2 * MINIMAP_TEXELS_PER_TILE);
    expect(bake.height).toBe(2 * MINIMAP_TEXELS_PER_TILE);
  });

  it("paints a water cell as water and a ground cell as its own material", () => {
    const bake = bakeTerrain(map);
    // Cell (0, 0) has no ground: water wins over whatever material sits in the parallel grid.
    expect(bake.colorAt(texelOf(0), texelOf(0))).toBe(colorForCell("herbe", null));
    // Cell (1, 0) is flat grass, cell (0, 1) is grass one tier up, cell (1, 1) is sand — three
    // colours, none of them the water one.
    expect(bake.colorAt(texelOf(1), texelOf(0))).toBe(colorForCell("herbe", 0));
    expect(bake.colorAt(texelOf(0), texelOf(1))).toBe(colorForCell("herbe", 1));
    expect(bake.colorAt(texelOf(1), texelOf(1))).toBe(colorForCell("sable", 0));
  });

  // This is the regression the old zone-keyed bake carried: it resolved terrain from an id and so
  // painted one map's ground over another's. `bakeTerrain` is handed the room's OWN decoded
  // heightfield, so two maps of identical footprint must still bake differently.
  it("reflects the map it was given, not another map of the same footprint", () => {
    const other = mapOf(2, [0, 0, 0, 0], ["neige", "neige", "neige", "neige"]);
    const mine = bakeTerrain(map);
    const theirs = bakeTerrain(other);

    // The water cell of one is solid snow in the other — a bake reading the wrong map would show
    // a swimmable hole as walkable ground.
    expect(theirs.colorAt(texelOf(0), texelOf(0))).toBe(colorForCell("neige", 0));
    expect(mine.colorAt(texelOf(0), texelOf(0))).not.toBe(theirs.colorAt(texelOf(0), texelOf(0)));
  });
});

describe("sameBakedWorld", () => {
  const base: BakedWorldKey = {
    zoneId: "verdant-reach",
    revision: 0,
    size: 64,
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
    expect(sameBakedWorld(base, { ...base, size: 32 })).toBe(false);
  });

  it("does not reuse a texture after a map revision changes", () => {
    expect(sameBakedWorld(base, { ...base, revision: 1 })).toBe(false);
  });

  it("reuses the texture when only non-baked welcome data changes", () => {
    const first = { ...base, zoneNameKey: "zone.verdant_reach.name", obstacles: [] };
    const reconnected = {
      ...base,
      zoneNameKey: "zone.renamed.name",
      obstacles: [{ x: 100, z: 100, width: 50, height: 50 }],
    };
    expect(sameBakedWorld(first, reconnected)).toBe(true);
  });
});
