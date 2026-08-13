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
import { shouldStartWorldEventTextureLoad, staticAssetSpec } from "../src/hd2d/game-renderer.js";
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

describe("world-event texture loading", () => {
  it("does not restart the same in-flight request on every render frame", () => {
    expect(shouldStartWorldEventTextureLoad("tree|rock", "", false)).toBe(true);
    expect(shouldStartWorldEventTextureLoad("tree|rock", "tree|rock", false)).toBe(false);
    expect(shouldStartWorldEventTextureLoad("tree|rock", "", true)).toBe(false);
    expect(shouldStartWorldEventTextureLoad("tree|gold", "tree|rock", false)).toBe(true);
  });
});

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

  it("gives coplanar overlapping scenery a stable depth order without biasing other rows", () => {
    const map = flatMap(4, {
      elements: [
        { assetId: "tree", x: -0.25, z: 0.5 },
        { assetId: "tree", x: 0.25, z: 0.5 },
        { assetId: "tree", x: 0, z: 1.5 },
      ],
    });
    const scene = sceneFor(map);
    placeStaticContent(createHd2dContext(), scene, map, resolverFor({ tree: art() }));
    const [first, overlapping, otherRow] = meshes(scene.root);
    if (!first || !overlapping || !otherRow) throw new Error("expected three scenery billboards");
    const materialOf = (mesh: THREE.Mesh): THREE.Material =>
      Array.isArray(mesh.material) ? (mesh.material[0] as THREE.Material) : mesh.material;
    expect(materialOf(first).polygonOffset).toBe(false);
    expect(materialOf(overlapping)).toMatchObject({
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    expect(materialOf(otherRow).polygonOffset).toBe(false);
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

  it("warns once per unresolved asset id, not once per placement", () => {
    const map = flatMap(4, {
      elements: [
        { assetId: "not-in-the-catalogue", x: -1.5, z: -1.5 },
        { assetId: "not-in-the-catalogue", x: -0.5, z: -1.5 },
        { assetId: "also-missing", x: 0.5, z: -1.5 },
      ],
    });
    const scene = sceneFor(map);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      placeStaticContent(createHd2dContext(), scene, map, resolverFor({}));
      // Two ids, two lines — not three. A map dressed entirely out of assets this build cannot
      // draw must not bury the console under one line per prop.
      expect(warn).toHaveBeenCalledTimes(2);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(
        lines.some((line) => line.includes("not-in-the-catalogue") && line.includes("2")),
      ).toBe(true);
      expect(lines.some((line) => line.includes("also-missing") && line.includes("1"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    expect(meshes(scene.root)).toHaveLength(0);
  });
});

/**
 * The ADAPTER's half of the resolution, over the real frozen catalogue. It is a pure function and
 * the one place the geometry arithmetic AND the refusals live, so a catalogue edit that would stand
 * a tree in the ground fails here rather than on screen.
 */
describe("staticAssetSpec", () => {
  it("reads a catalogue sheet's grid, scale and ground line", () => {
    // `tree3` is a 192x192 frame repeated 8 times along x, its measured ground line 22px up.
    const spec = staticAssetSpec("resource.terrain-resources-wood-trees.tree3");
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({
      cols: 8,
      rows: 1,
      // 192px at 64 to the tile: three tiles tall, square, standing on 22/192 of its own frame.
      height: 3,
      aspect: 1,
      foot: 22 / 192,
      animationDurationMs: 960,
      renderLayer: "canopy",
    });
    expect(spec?.url).toContain("Tree3");
  });

  it("keeps all three native tree wind strips animated", () => {
    for (const tree of ["tree1", "tree2", "tree3"]) {
      expect(staticAssetSpec(`resource.terrain-resources-wood-trees.${tree}`)).toMatchObject({
        cols: 8,
        rows: 1,
        animationDurationMs: 960,
        renderLayer: "canopy",
      });
    }
  });

  it("classifies authored clouds as camera-independent sky art", () => {
    expect(staticAssetSpec("decoration.terrain-decorations-clouds.clouds-01")).toMatchObject({
      renderLayer: "sky",
    });
    expect(
      staticAssetSpec("decoration.terrain-decorations-clouds.clouds-01")?.renderMode,
    ).toBeUndefined();
  });

  it("classifies Tiny Swords buildings as ordinary billboards", () => {
    expect(staticAssetSpec("building.buildings-blue-buildings.house1")?.renderMode).toBeUndefined();
  });

  it("places cloud art as a fixed three-card volume above the map", () => {
    const cloud = art({
      cols: 1,
      height: 2,
      aspect: 2,
      foot: 0,
      renderLayer: "sky",
      renderMode: "cloud-volume",
    });
    const map = flatMap(4, {
      elements: [{ assetId: "cloud", x: 0.5, z: -0.5 }],
    });
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const content = placeStaticContent(ctx, scene, map, resolverFor({ cloud }));
    const [mesh] = meshes(scene.root);
    if (!mesh) throw new Error("expected one cloud volume");

    expect(mesh.geometry.getAttribute("position").count).toBe(12);
    expect(mesh.position.y).toBeGreaterThan(map.levelHeight);
    expect(ctx.billboards()).toHaveLength(0);
    const rotation = mesh.rotation.y;
    ctx.setYaw(Math.PI / 2);
    expect(mesh.rotation.y).toBe(rotation);
    content.update(2_500);
    expect(mesh.position.x).not.toBeCloseTo(0.5);
  });

  it("keeps a building fixed while the camera yaw changes", () => {
    const building = art({
      cols: 1,
      height: 3,
      aspect: 1.4,
      foot: 0.1,
      renderMode: "fixed-volume",
    });
    const map = flatMap(4, {
      elements: [{ assetId: "building", x: -0.5, z: 0.5 }],
    });
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    placeStaticContent(ctx, scene, map, resolverFor({ building }));
    const [mesh] = meshes(scene.root);
    if (!mesh) throw new Error("expected one building volume");

    expect(mesh.geometry.getAttribute("position").count).toBe(8);
    expect(mesh.position.y + building.height * (building.foot ?? 0)).toBeCloseTo(0);
    expect(ctx.billboards()).toHaveLength(0);
    ctx.setYaw(Math.PI / 2);
    expect(mesh.rotation.y).toBe(0);
  });

  it("frames an asset cropped out of a shared sheet", () => {
    // The six Update-010 trees all live in one 768x576 image, each an `editor.sourceRect` of it. A
    // The adapter derives the shared image extent from its sibling catalogue entries and hands the
    // normalized crop to the domain-free billboard rather than drawing all six trees as one sprite.
    const spec = staticAssetSpec("resource.resources-trees.tree-1");
    expect(spec).toMatchObject({
      cols: 1,
      rows: 1,
      height: 3,
      aspect: 1,
      uvRect: {
        offsetX: 0,
        repeatX: 1 / 4,
        repeatY: 1 / 3,
      },
    });
    expect(spec?.uvRect?.offsetY).toBeCloseTo(2 / 3);
  });

  it("refuses an id the catalogue does not answer to", () => {
    expect(staticAssetSpec("not-in-the-catalogue")).toBeNull();
    expect(staticAssetSpec("")).toBeNull();
  });
});
