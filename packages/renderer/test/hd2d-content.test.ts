import type {
  HeightfieldElement,
  HeightfieldEvent,
  MapData,
} from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { billboardHeight } from "@lindocara/hd2d/billboard.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BillboardScene } from "../src/hd2d/billboards.js";
import { HD2D_CAMERA } from "../src/hd2d/scene.js";
import type { StaticSpriteArt } from "../src/hd2d/static-content.js";
import { placeStaticContent } from "../src/hd2d/static-content.js";

/** A square map from a row-major list of levels — `null` is water. Same shape as the billboard
 *  suite's `mapOf`, plus the two authored collections this suite is about. */
function mapOf(
  size: number,
  levels: readonly (number | null)[],
  authored: { elements?: readonly HeightfieldElement[]; events?: readonly HeightfieldEvent[] } = {},
): MapData {
  return {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: [...levels],
    materials: levels.map(() => "herbe" as TerrainMaterial),
    colliders: [],
    spawns: [],
    elements: authored.elements ?? [],
    events: authored.events ?? [],
  };
}

/** A `size`x`size` map, entirely ground at level 0. */
function flatMap(
  size: number,
  authored: { elements?: readonly HeightfieldElement[]; events?: readonly HeightfieldEvent[] } = {},
): MapData {
  return mapOf(
    size,
    Array.from({ length: size * size }, () => 0),
    authored,
  );
}

function sceneFor(map: MapData): BillboardScene & { root: THREE.Scene } {
  return {
    root: new THREE.Scene(),
    query: createTerrainQuery(mapToQuerySource(map)),
    size: map.size,
    waterLevel: map.waterLevel,
  };
}

/**
 * A texture with no bytes in it: `makeBillboard` clones it and drives its `offset`/`repeat`, and a
 * static placement never even reads `image` — the sheet's geometry comes from the catalogue through
 * `StaticSpriteArt`, not from the pixels. Which is what lets this suite run in jsdom without a GL
 * context, the same move as `hd2d-billboards.test.ts`.
 */
function art(overrides: Partial<StaticSpriteArt> = {}): StaticSpriteArt {
  return {
    texture: new THREE.Texture(),
    cols: 8,
    rows: 1,
    // A Tiny Swords tree: a 192px frame at 64 to the tile, standing 22px up its own frame.
    height: 3,
    aspect: 1,
    foot: 22 / 192,
    ...overrides,
  };
}

/** Resolves exactly the ids it was given, `null` for anything else — the adapter's job, reduced to
 *  what these tests need. */
function resolverFor(known: Record<string, StaticSpriteArt>) {
  return (assetId: string): StaticSpriteArt | null => known[assetId] ?? null;
}

/** Every mesh currently parented to the scene root — one per placed billboard. */
function meshes(root: THREE.Object3D): THREE.Mesh[] {
  return root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
}

/** How far below the ground a billboard's mesh origin sits, given the art it was built from. */
function footOffsetOf(ctx: ReturnType<typeof createHd2dContext>, sprite: StaticSpriteArt): number {
  return (
    (sprite.foot ?? 0) *
    billboardHeight({
      height: sprite.height,
      pitch: HD2D_CAMERA.pitch,
      stretch: ctx.config.spriteStretch,
    })
  );
}

describe("static map content", () => {
  it("places one billboard per element at its tile position", () => {
    // A 4x4 map with one raised cell at (2, 1), so one of the two elements stands a level up.
    const levels = Array.from({ length: 16 }, (_, k) => (k === 1 * 4 + 2 ? 1 : 0));
    const tree = art();
    const map = mapOf(4, levels, {
      // Tile units, grid-centred — the scene's OWN space. Unlike an actor's, these coordinates
      // need no bridge conversion, and asserting them against the raw numbers is the point.
      elements: [
        { assetId: "tree", x: -1.5, z: -1.5 },
        { assetId: "tree", x: 0.5, z: -0.5 },
      ],
    });
    const scene = sceneFor(map);
    const ctx = createHd2dContext();

    placeStaticContent(ctx, scene, map, resolverFor({ tree }));

    const placed = meshes(scene.root);
    expect(placed).toHaveLength(2);
    const [low, high] = placed;
    if (!low || !high) throw new Error("expected two billboards");
    const foot = footOffsetOf(ctx, tree);
    expect(low.position.x).toBeCloseTo(-1.5);
    expect(low.position.z).toBeCloseTo(-1.5);
    expect(low.position.y + foot).toBeCloseTo(0);
    expect(high.position.x).toBeCloseTo(0.5);
    expect(high.position.z).toBeCloseTo(-0.5);
    // The ground UNDER the element, not the map's floor: a tree on a plateau stands on it.
    expect(high.position.y + foot).toBeCloseTo(map.levelHeight);
  });

  it("skips an element whose asset id resolves to nothing, and keeps the rest", () => {
    const tree = art();
    const map = flatMap(4, {
      elements: [
        { assetId: "tree", x: -1.5, z: -1.5 },
        { assetId: "not-in-the-catalogue", x: -0.5, z: -1.5 },
        { assetId: "tree", x: 0.5, z: -1.5 },
      ],
    });
    const scene = sceneFor(map);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      // Appearance only: an unknown asset must never be the thing that blanks the world.
      expect(() =>
        placeStaticContent(createHd2dContext(), scene, map, resolverFor({ tree })),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("not-in-the-catalogue");
    } finally {
      warn.mockRestore();
    }

    const placed = meshes(scene.root);
    expect(placed).toHaveLength(2);
    expect(placed.map((mesh) => mesh.position.x)).toEqual([-1.5, 0.5]);
  });

  it("places events with a graphic and ignores those without one", () => {
    const npc = art({ height: 3, foot: 57 / 192 });
    const map = flatMap(4, {
      events: [
        { id: "a", x: -1.5, z: -1.5, graphicAssetId: "npc" },
        // An authored event with no appearance at all: nothing to draw, and NOT an unknown asset —
        // it must be passed over silently rather than warned about.
        { id: "b", x: -0.5, z: -1.5, graphicAssetId: null },
        { id: "c", x: 0.5, z: -1.5, graphicAssetId: "npc" },
      ],
    });
    const scene = sceneFor(map);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      placeStaticContent(createHd2dContext(), scene, map, resolverFor({ npc }));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    const placed = meshes(scene.root);
    expect(placed).toHaveLength(2);
    expect(placed.map((mesh) => mesh.position.x)).toEqual([-1.5, 0.5]);
  });

  it("adds no collider — collision comes only from the terrain", () => {
    const authored = {
      elements: [
        { assetId: "tree", x: -1.5, z: -1.5 },
        { assetId: "tree", x: 0.5, z: -0.5 },
      ],
      events: [{ id: "a", x: -0.5, z: 0.5, graphicAssetId: "tree" }],
    };
    const levels = Array.from({ length: 16 }, (_, k) => (k === 1 * 4 + 2 ? 1 : 0));
    const populated = mapOf(4, levels, authored);
    const bare = mapOf(4, levels);

    // Frozen, so a `push` into the authored collider list throws instead of passing unnoticed:
    // baking a collider under a tree is exactly the regression this pins, and the server is the
    // only baker.
    Object.freeze(populated);
    Object.freeze(populated.colliders);

    const scene = sceneFor(populated);
    placeStaticContent(createHd2dContext(), scene, populated, resolverFor({ tree: art() }));
    expect(meshes(scene.root)).toHaveLength(3);

    // The whole collision surface, sampled the way the movement rule reads it: the ground under a
    // point and the highest ground around a hero-sized disc. Identical to the SAME map without a
    // single element or event on it — the three billboards above changed nothing a hero can bump
    // into, which is what "appearance only" has to mean.
    const sample = (map: MapData): (number | null)[] => {
      const query = createTerrainQuery(mapToQuerySource(map));
      const values: (number | null)[] = [];
      for (let j = 0; j < map.size; j += 1) {
        for (let i = 0; i < map.size; i += 1) {
          const [x, z] = query.cellCenter(i, j);
          values.push(query.heightAt(x, z), query.maxHeightAround(x, z, 0.3));
        }
      }
      return values;
    };
    expect(sample(populated)).toEqual(sample(bare));
    expect(populated.colliders).toEqual([]);
  });
});
