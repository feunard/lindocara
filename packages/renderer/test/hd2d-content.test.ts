import type { BuildingArchetype } from "@lindocara/engine/buildings.js";
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
import {
  shouldStartWorldEventTextureLoad,
  staticAssetSpec,
  worldEventContentVisualKey,
  worldEventStaticPresentation,
} from "../src/hd2d/game-renderer.js";
import { AUTHORED_PICK_SURFACE, HD2D_CAMERA } from "../src/hd2d/scene.js";
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

function buildingArt(archetype: BuildingArchetype): StaticSpriteArt {
  return art({
    cols: 1,
    rows: 1,
    buildingVolume: {
      archetype,
      state: "standing",
      wall: new THREE.Texture(),
      roof: new THREE.Texture(),
      stone: new THREE.Texture(),
      blueStone: new THREE.Texture(),
      wood: new THREE.Texture(),
      roofColor: 0x4da9c7,
    },
  });
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

  it("makes pickup levitation intrinsic while preserving explicit height overrides", () => {
    const pickup = {
      id: "pickup",
      col: 2,
      row: 3,
      graphicAssetId: "resource.lindocara-pickup.speed-boost",
      onTop: false,
      moveSpeed: 3,
      moveFrequency: 2,
      moveAnimation: false,
      directionFixed: false,
    };
    const defaultKey = worldEventContentVisualKey([pickup], []);

    expect(worldEventStaticPresentation(pickup)).toEqual({
      elevationOffset: 0.55,
      floating: true,
    });
    expect(worldEventContentVisualKey([{ ...pickup, floating: true }], [])).toBe(defaultKey);
    expect(worldEventContentVisualKey([{ ...pickup, elevationOffset: 0.55 }], [])).toBe(defaultKey);
    expect(worldEventContentVisualKey([{ ...pickup, elevationOffset: 0.9 }], [])).not.toBe(
      defaultKey,
    );
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

  it("shows a proportional health bar as soon as a destructible building is damaged", () => {
    const map = flatMap(4, {
      events: [
        {
          id: "building-1",
          x: 0.5,
          z: 0.5,
          graphicAssetId: "building",
          health: { value: 225, max: 900, visible: true },
        } as HeightfieldEvent & {
          health: { value: number; max: number; visible: boolean };
        },
      ],
    });
    const scene = sceneFor(map);
    placeStaticContent(createHd2dContext(), scene, map, resolverFor({ building: art() }));

    const bar = scene.root.children.find(
      (child): child is THREE.Group => child instanceof THREE.Group && child.renderOrder === 70,
    );
    expect(bar?.visible).toBe(true);
    const fill = bar?.children[1];
    expect(fill?.scale.x).toBeCloseTo(0.25);
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

  it("bobs a floating event around its authored elevation without horizontal drift", () => {
    const pickup = art({ cols: 1, rows: 1, foot: 0.2 });
    const map = flatMap(4);
    const scene = sceneFor(map);
    const ctx = createHd2dContext();
    const content = placeStaticContent(ctx, scene, map, resolverFor({ pickup }));
    content.syncEvents([
      {
        id: "floating-pickup",
        x: 0.5,
        z: -0.5,
        graphicAssetId: "pickup",
        elevationOffset: 1.5,
        floating: true,
      },
    ]);
    const mesh = meshes(scene.root)[0];
    if (!mesh) throw new Error("floating pickup was not placed");
    const authoredVisualY = 1.5 - footOffsetOf(ctx, pickup);
    expect(mesh.position.y).toBeCloseTo(authoredVisualY, 6);

    const heights = [0, 450, 900, 1_350].map((now) => {
      content.update(now);
      expect(mesh.position.x).toBe(0.5);
      expect(mesh.position.z).toBe(-0.5);
      return mesh.position.y;
    });
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.3);
    expect(heights.every((height) => Math.abs(height - authoredVisualY) <= 0.301)).toBe(true);
    content.dispose();
  });

  it("updates one harvested event without rebuilding every other resource billboard", () => {
    const npc = art();
    const stump = art({ cols: 1, height: 1 });
    const events = [
      { id: "a", x: -1.5, z: -1.5, graphicAssetId: "npc" },
      { id: "b", x: 0.5, z: -1.5, graphicAssetId: "npc" },
    ];
    const map = flatMap(4, { events });
    const scene = sceneFor(map);
    const content = placeStaticContent(
      createHd2dContext(),
      scene,
      map,
      resolverFor({ npc, stump }),
    );
    const firstEvent = events[0];
    const secondEvent = events[1];
    if (!firstEvent || !secondEvent) throw new Error("event fixtures missing");
    const untouched = meshes(scene.root).find((mesh) => mesh.position.x === 0.5);
    if (!untouched) throw new Error("untouched resource missing");

    content.syncEvents([{ ...firstEvent, graphicAssetId: "stump" }, secondEvent]);

    expect(meshes(scene.root)).toHaveLength(2);
    expect(meshes(scene.root).find((mesh) => mesh.position.x === 0.5)).toBe(untouched);
    content.dispose();
  });

  it("updates only changed authored scenery and preserves every untouched visual", () => {
    const tree = art();
    const rock = art({ height: 1 });
    const elements = [
      { assetId: "tree", x: -1.5, z: -1.5 },
      { assetId: "tree", x: 0.5, z: -1.5 },
    ];
    const map = flatMap(4, { elements });
    const scene = sceneFor(map);
    const resolve = resolverFor({ tree, rock });
    const content = placeStaticContent(createHd2dContext(), scene, map, resolve);
    const untouched = meshes(scene.root).find((mesh) => mesh.position.x === 0.5);
    if (!untouched) throw new Error("untouched scenery missing");

    content.syncElements(
      [{ assetId: "rock", x: -0.5, z: -1.5 }, elements[1] as HeightfieldElement],
      resolve,
    );

    expect(meshes(scene.root)).toHaveLength(2);
    expect(meshes(scene.root).find((mesh) => mesh.position.x === 0.5)).toBe(untouched);
    expect(meshes(scene.root).some((mesh) => mesh.position.x === -0.5)).toBe(true);
    content.dispose();
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
  it("renders high-resolution movement pickups at collectible scale", () => {
    const bonus = staticAssetSpec("resource.lindocara-pickup.speed-boost");
    const malus = staticAssetSpec("resource.lindocara-pickup.speed-slow");
    expect(bonus).toMatchObject({
      height: 1.05,
      aspect: 1,
      companions: [
        {
          url: "/assets/lindocara/hd2d/pickups/buff-sparkles.png",
          twinkle: { durationMs: 1_250 },
        },
      ],
    });
    expect(malus).toMatchObject({
      companions: [{ url: "/assets/lindocara/hd2d/pickups/debuff-sparkles.png" }],
    });
  });

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
      animationDurationMs: 2_800,
      renderLayer: "canopy",
    });
    expect(spec?.url).toContain("Tree3");
  });

  it("keeps all four free-pack tree wind strips animated", () => {
    for (const tree of ["tree1", "tree2", "tree3", "tree4"]) {
      expect(staticAssetSpec(`resource.terrain-resources-wood-trees.${tree}`)).toMatchObject({
        cols: 8,
        rows: 1,
        animationDurationMs: tree === "tree1" ? 2_200 : 2_800,
        renderLayer: "canopy",
      });
    }
  });

  it("keeps the canonical water-rock family animated", () => {
    for (const variant of ["01", "02", "03", "04"]) {
      expect(
        staticAssetSpec(`decoration.terrain-decorations-rocks-in-the-water.water-rocks-${variant}`),
      ).toMatchObject({
        cols: 16,
        rows: 1,
        animationDurationMs: 1_400,
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

  it("uses orthographic generated previews for native building volumes", () => {
    expect(staticAssetSpec("building.buildings-blue-buildings.house1")).toMatchObject({
      url: "/assets/lindocara/hd2d/buildings/house-front.png",
      height: 198 / 64,
      aspect: 199 / 198,
      foot: 0,
      buildingVolume: {
        archetype: "house",
        state: "standing",
        stoneUrl: "/assets/lindocara/hd2d/buildings/cream-stone.png",
        blueStoneUrl: "/assets/lindocara/hd2d/buildings/blue-stone.png",
      },
    });
    expect(staticAssetSpec("building.lindocara.windmill")).toMatchObject({
      url: "/assets/lindocara/hd2d/buildings/windmill-front.png",
      height: 224 / 64,
      aspect: 210 / 224,
      foot: 0,
      buildingVolume: { archetype: "windmill", state: "standing" },
    });
    const destroyed = staticAssetSpec("building.factions-knights-buildings-house.house-destroyed");
    expect(destroyed?.buildingVolume).toMatchObject({ archetype: "house", state: "destroyed" });
  });

  it("rotates the complete world volume from authored orientation", () => {
    const building = buildingArt("house");
    const rearMap = flatMap(4, {
      elements: [{ assetId: "building", x: 0, z: 0, orientation: 2 }],
    });
    const rearScene = sceneFor(rearMap);
    placeStaticContent(createHd2dContext(), rearScene, rearMap, resolverFor({ building }));
    const rear = rearScene.root.getObjectByName("building-house-standing");
    expect(rear?.rotation.y).toBeCloseTo(-Math.PI);
    expect(rear?.userData[AUTHORED_PICK_SURFACE]).toBe("building");

    const leftMap = flatMap(4, {
      elements: [{ assetId: "building", x: 0, z: 0, orientation: 3 }],
    });
    const leftScene = sceneFor(leftMap);
    placeStaticContent(createHd2dContext(), leftScene, leftMap, resolverFor({ building }));
    const left = leftScene.root.getObjectByName("building-house-standing");
    expect(left?.rotation.y).toBeCloseTo((-3 * Math.PI) / 2);
  });

  it("passes authored dimensions into every native building volume", () => {
    const building = buildingArt("house");
    const map = flatMap(12, {
      elements: [
        {
          assetId: "building",
          x: 0,
          z: 1,
          building: { width: 5, depth: 3.125 },
        },
      ],
    });
    const scene = sceneFor(map);
    placeStaticContent(createHd2dContext(), scene, map, resolverFor({ building }));
    const visual = scene.root.getObjectByName("building-house-standing");
    const architecture = visual?.getObjectByName("native-architecture");
    if (!architecture) throw new Error("resized native building missing");
    const bounds = new THREE.Box3().setFromObject(architecture);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThanOrEqual(4.9);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThanOrEqual(3.05);
  });

  it("turns the native windmill rotor continuously without camera-facing art", () => {
    const windmill = buildingArt("windmill");
    const map = flatMap(4, {
      elements: [{ assetId: "windmill", x: 0, z: 0, orientation: 1 }],
    });
    const scene = sceneFor(map);
    const content = placeStaticContent(createHd2dContext(), scene, map, resolverFor({ windmill }));
    const body = scene.root.getObjectByName("building-windmill-standing");
    const rotor = body?.getObjectByName("windmill-rotor");
    if (!rotor) throw new Error("expected native windmill rotor");
    expect(body?.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(rotor.rotation.z).toBe(0);
    content.update(1_000);
    expect(rotor.rotation.z).toBeCloseTo(0.27);
  });

  it("replaces both legacy bridge sprites with native 3D bridges", () => {
    expect(staticAssetSpec("terrain.bridge.wood.horizontal")).toMatchObject({
      bridgeOrientation: "horizontal",
    });
    expect(staticAssetSpec("terrain.bridge.wood.vertical")).toMatchObject({
      bridgeOrientation: "vertical",
    });
  });

  it("passes compiled dimensions and centre coordinates into a resized native bridge", () => {
    const bridge = art({ bridgeOrientation: "horizontal" });
    const map = flatMap(12, {
      elements: [
        {
          assetId: "bridge",
          x: 1.5,
          z: -0.5,
          bridge: { length: 7, width: 2 },
        },
      ],
    });
    const scene = sceneFor(map);
    placeStaticContent(createHd2dContext(), scene, map, resolverFor({ bridge }));

    const visual = scene.root.getObjectByName("bridge-horizontal");
    expect(visual?.position).toMatchObject({ x: 1.5, z: -0.5 });
    const deck = visual?.getObjectByName("walkable-deck");
    if (!(deck instanceof THREE.Group)) throw new Error("resized bridge deck missing");
    const bounds = new THREE.Box3().setFromObject(deck);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(7, 1);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.85);
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

  it("keeps Update 010 variants on one stable tree with only a gentle slow sway", () => {
    const spec = staticAssetSpec("resource.resources-trees.tree-1");
    expect(spec).toMatchObject({
      cols: 1,
      rows: 1,
      sway: { amplitudeRadians: THREE.MathUtils.degToRad(0.28), durationMs: 9_000 },
      height: 3,
      aspect: 1,
      uvRect: {
        offsetX: 0,
        offsetY: 2 / 3,
        repeatX: 1 / 4,
        repeatY: 1 / 3,
      },
    });
    for (const alias of [2, 3, 4, 5, 6]) {
      expect(staticAssetSpec(`resource.resources-trees.tree-${alias}`)).toMatchObject({
        cols: 1,
        rows: 1,
        sway: { durationMs: 9_000 },
      });
    }
  });

  it("refuses an id the catalogue does not answer to", () => {
    expect(staticAssetSpec("not-in-the-catalogue")).toBeNull();
    expect(staticAssetSpec("")).toBeNull();
  });
});
