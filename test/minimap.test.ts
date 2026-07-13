import { describe, expect, it } from "vitest";
import {
  clampToRing,
  groundColor,
  MINIMAP_WORLD_RADIUS,
  projectToMinimap,
  projectToWorldMap,
  terrainColorAt,
  VERDANT_REACH_ZONE_KEY,
} from "../src/client/game/minimap.js";
import type { GroundPalette } from "../src/client/game/world-layout.js";
import { TERRAIN_BLOCKERS } from "../src/shared/game.js";

const SIZE = 200;
const CENTER = { x: 2000, y: 1000 };

describe("minimap projection", () => {
  it("puts the viewer at the centre of the widget", () => {
    const point = projectToMinimap(CENTER, CENTER, SIZE);
    expect(point).toEqual({ x: 100, y: 100, inside: true });
  });

  it("matches the server's player visibility radius, so it never draws empty space", () => {
    expect(MINIMAP_WORLD_RADIUS).toBe(900);
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

describe("ground colour", () => {
  it("resolves every palette to a colour inside the 24-bit range", () => {
    const palettes: GroundPalette[] = ["verdant", "moss", "earth", "stone", "wet"];
    for (const palette of palettes) {
      const color = groundColor({ kind: "grass", palette, tint: 0xffffff, detailChance: 0 });
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("darkens with the tint rather than ignoring it", () => {
    const bright = groundColor({
      kind: "grass",
      palette: "verdant",
      tint: 0xffffff,
      detailChance: 0,
    });
    const dim = groundColor({ kind: "grass", palette: "verdant", tint: 0x808080, detailChance: 0 });
    expect(dim).toBeLessThan(bright);
  });

  it("gives water a fixed colour instead of running it through the palette multiply", () => {
    // Water carries palette "wet" like a wet-grass sample would, but it must not be tinted:
    // two water samples with different tints must still match each other, and must differ
    // from what the multiply path would have produced for the same palette and tint.
    const water = groundColor({ kind: "water", palette: "wet", tint: 0xe1ffff, detailChance: 0 });
    const dimmerWater = groundColor({
      kind: "water",
      palette: "wet",
      tint: 0x808080,
      detailChance: 0,
    });
    expect(water).toBe(dimmerWater);

    const multipliedWet = groundColor({
      kind: "grass",
      palette: "wet",
      tint: 0xe1ffff,
      detailChance: 0,
    });
    expect(water).not.toBe(multipliedWet);
  });
});

describe("zone-correct terrain sampling", () => {
  const world = {
    width: 4800,
    height: 2700,
    obstacles: [{ x: 100, y: 100, width: 50, height: 50 }],
    safeZone: { x: 360, y: 260, width: 1200, height: 920 },
  };

  it("paints an obstacle regardless of zone", () => {
    const inside = terrainColorAt(VERDANT_REACH_ZONE_KEY, world, 120, 120);
    const outside = terrainColorAt(VERDANT_REACH_ZONE_KEY, world, 3000, 2000);
    expect(inside).not.toBe(outside);
    expect(terrainColorAt("zone.mmo_test_zone.name", world, 120, 120)).toBe(inside);
  });

  it("never paints Verdant Reach's terrain over another zone", () => {
    // Deep Gloamwood: rich sampler gives it a forest colour, the plain sampler must not.
    const verdant = terrainColorAt(VERDANT_REACH_ZONE_KEY, world, 3200, 2100);
    const other = terrainColorAt("zone.mmo_test_zone.name", world, 3200, 2100);
    expect(other).not.toBe(verdant);
  });

  it("tints the safe zone on any zone, because sanctuary is server geometry", () => {
    const sanctuary = terrainColorAt("zone.mmo_test_zone.name", world, 900, 700);
    const wild = terrainColorAt("zone.mmo_test_zone.name", world, 3000, 2000);
    expect(sanctuary).not.toBe(wild);
  });

  it("paints a river as water, not as an obstacle, even though the server lists it in obstacles", () => {
    // The server's WorldInfo.obstacles is OBSTACLES, which flattens every TERRAIN_BLOCKERS
    // rect regardless of kind — water included. Anchor this to a real water blocker so the
    // test tracks the actual geometry rather than a coordinate nobody will keep in sync.
    const waterBlocker = TERRAIN_BLOCKERS.find((blocker) => blocker.kind === "water");
    if (!waterBlocker) throw new Error("Expected at least one water terrain blocker");
    const { rect } = waterBlocker;
    const riverWorld = {
      width: 4800,
      height: 2700,
      obstacles: [rect],
      safeZone: { x: 360, y: 260, width: 1200, height: 920 },
    };
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

    const color = terrainColorAt(VERDANT_REACH_ZONE_KEY, riverWorld, point.x, point.y);

    const waterColor = groundColor({
      kind: "water",
      palette: "wet",
      tint: 0xe1ffff,
      detailChance: 0,
    });
    expect(color).toBe(waterColor);
  });
});
