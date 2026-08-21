import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  cameraFocusSurface,
  editorGroundPickPoint,
  terrainAtlasKey,
  terrainGroupFor,
  waterPlaneKey,
} from "../src/hd2d/scene.js";

describe("editor ground picking", () => {
  it("keeps roof clicks in place and pulls wall clicks into the building footprint", () => {
    expect(editorGroundPickPoint({ x: 2.25, z: 3.5 }, { x: 0, y: 1, z: 0 }, true)).toEqual({
      x: 2.25,
      z: 3.5,
    });
    expect(editorGroundPickPoint({ x: 2, z: 3.5 }, { x: -1, y: 0, z: 0 }, true)).toEqual({
      x: 2.5,
      z: 3.5,
    });
  });

  it("keeps terrain cliff clicks on the low exterior cell", () => {
    expect(editorGroundPickPoint({ x: 2, z: 3.5 }, { x: -1, y: 0, z: 0 }, false)).toEqual({
      x: 1.5,
      z: 3.5,
    });
  });
});

/**
 * An atlas whose only job is to exist: `meshTerrain` reads `cols`/`rows`/`block`/`wallRow`/`tilePx`
 * to compute UVs and never touches the pixels, so an undecoded `THREE.Texture` is enough — which is
 * what lets this suite run in jsdom without a GL context. Same move as
 * `packages/hd2d/test/terrain-mesh.test.ts`.
 */
function atlas(): TerrainAtlas {
  return {
    texture: new THREE.Texture(),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  };
}

/** Every atlas key the scene can ask for, so a test never fails on a missing entry. */
function allAtlases(): Record<string, TerrainAtlas> {
  return {
    lvl0: atlas(),
    lvl1: atlas(),
    lvl2: atlas(),
    lvl3: atlas(),
    sable: atlas(),
    neige: atlas(),
    glace: atlas(),
  };
}

/** A square map from a row-major list of `[level, material]` cells — `null` level means water. */
function mapOf(
  size: number,
  cells: readonly (readonly [number | null, TerrainMaterial])[],
): MapData {
  return {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: cells.map(([level]) => level),
    materials: cells.map(([, material]) => material),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

function ground(size: number, material: TerrainMaterial = "herbe", level = 0): MapData {
  return mapOf(
    size,
    Array.from({ length: size * size }, () => [level, material] as const),
  );
}

/** Vertices of the horizontal (normal +Y) quads only — the cell tops, excluding every cliff wall. */
function topVertices(group: THREE.Group): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const position = child.geometry.getAttribute("position");
    const normal = child.geometry.getAttribute("normal");
    for (let k = 0; k < position.count; k++) {
      if (normal.getY(k) < 0.999) continue;
      out.push({ x: position.getX(k), y: position.getY(k), z: position.getZ(k) });
    }
  }
  return out;
}

describe("the HD-2D scene's terrain", () => {
  it("meshes one group per material atlas present in the map", () => {
    const ctx = createHd2dContext();
    // Three distinct atlas keys across four cells: grass reads its tileset from its LEVEL (the
    // altitude is the hue), sand from its material, and the two grass levels must not share one.
    const map = mapOf(2, [
      [0, "herbe"],
      [1, "herbe"],
      [0, "sable"],
      [0, "herbe"],
    ]);
    expect(terrainAtlasKey("herbe", 0)).toBe("lvl0");
    expect(terrainAtlasKey("herbe", 1)).toBe("lvl1");
    expect(terrainAtlasKey("herbe", 3)).toBe("lvl3");
    expect(terrainAtlasKey("sable", 0)).toBe("sable");

    const { group } = terrainGroupFor(ctx, map, allAtlases());
    const meshes = group.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    const shells = meshes.filter((mesh) => (mesh.material as THREE.Material).polygonOffset);
    expect(meshes.filter((mesh) => !(mesh.material as THREE.Material).polygonOffset)).toHaveLength(
      3,
    );
    expect(shells).toHaveLength(1);
  });

  it("skips water cells rather than meshing them flat", () => {
    const ctx = createHd2dContext();
    const solid = terrainGroupFor(ctx, ground(3), allAtlases());
    // The same grid with its centre cell flooded. `null` is this format's word for water, and water
    // is the water PLANE's business (`createWater`), never a ground quad at the water's height.
    const flooded = mapOf(
      3,
      Array.from({ length: 9 }, (_, k) =>
        k === 4 ? ([null, "herbe"] as const) : ([0, "herbe"] as const),
      ),
    );
    const holed = terrainGroupFor(ctx, flooded, allAtlases());

    expect(topVertices(solid.group)).toHaveLength(9 * 4);
    expect(topVertices(holed.group)).toHaveLength(8 * 4);
    // ...and the hole is where the water is, not somewhere else: nothing is drawn over cell (1, 1).
    const centre = topVertices(holed.group).filter(
      (v) => Math.abs(v.x) < 0.4 && Math.abs(v.z) < 0.4,
    );
    expect(centre).toHaveLength(0);
  });

  it("centres the grid on the world origin, matching createTerrainQuery", () => {
    const ctx = createHd2dContext();
    const size = 4;
    const map = ground(size);
    const { group } = terrainGroupFor(ctx, map, allAtlases());
    const tops = topVertices(group);
    const xs = tops.map((v) => v.x);
    const zs = tops.map((v) => v.z);

    // The grid straddles the origin: the mesher's own convention, and the one collision already
    // reads through `createTerrainQuery`. Drawing it from a top-left origin instead would put every
    // future actor half a map away from the ground under its feet.
    expect(Math.min(...xs)).toBeCloseTo(-size / 2);
    expect(Math.max(...xs)).toBeCloseTo(size / 2);
    expect(Math.min(...zs)).toBeCloseTo(-size / 2);
    expect(Math.max(...zs)).toBeCloseTo(size / 2);

    // Cell by cell, not just at the edges: each cell's four drawn corners bracket exactly the
    // centre `createTerrainQuery` answers for it.
    const query = createTerrainQuery(mapToQuerySource(map));
    for (const [i, j] of [
      [0, 0],
      [1, 2],
      [size - 1, size - 1],
    ] as const) {
      const [cx, cz] = query.cellCenter(i, j);
      // Distinct POSITIONS, not vertex count: adjacent quads each carry their own vertex at a
      // shared corner, so counting vertices would count the neighbours' too.
      const corners = new Set(
        tops
          .filter((v) => Math.abs(v.x - cx) === 0.5 && Math.abs(v.z - cz) === 0.5)
          .map((v) => `${v.x},${v.z}`),
      );
      expect(corners.size).toBe(4);
    }
  });

  it("keeps camera focus on the platform under the hero instead of the lower terrain", () => {
    const map = {
      ...ground(3),
      colliders: [{ x: -0.5, z: -0.5, w: 1, h: 1, top: 1.8 }],
    };
    const query = createTerrainQuery(mapToQuerySource(map));

    expect(query.heightAt(0, 0)).toBe(0);
    expect(cameraFocusSurface(query, map.waterLevel, 0, 0, 1.8)).toBe(1.8);
    // A platform overhead must not pull the camera up before the hero reaches it, and editor focus
    // without a tracked body intentionally remains terrain-based.
    expect(cameraFocusSurface(query, map.waterLevel, 0, 0, 0)).toBe(0);
    expect(cameraFocusSurface(query, map.waterLevel, 0, 0)).toBe(0);
  });
});

describe("waterPlaneKey", () => {
  const map = (size: number, waterLevel: number): MapData =>
    ({ size, waterLevel }) as unknown as MapData;

  // The sea outlives the scene: `Hd2dRenderer` hands one `Water` forward across every rebuild whose
  // key matches, and rebuilds it when it does not. Getting this wrong is not a crash — it is a
  // plane of the wrong extent, or one sitting at the previous map's sea level, both silent.
  it("is the same for two maps whose sea plane is identical", () => {
    expect(waterPlaneKey(map(256, -0.35))).toBe(waterPlaneKey(map(256, -0.35)));
  });

  it("differs when the extent or the sea level does", () => {
    expect(waterPlaneKey(map(256, -0.35))).not.toBe(waterPlaneKey(map(128, -0.35)));
    expect(waterPlaneKey(map(256, -0.35))).not.toBe(waterPlaneKey(map(256, 0)));
  });

  // The key must state the PLANE's extent, not the grid's: `createWater` is called with
  // `map.size * 3`, and a key that dropped the factor would still be correct today and wrong the
  // day that factor changes on one side only.
  it("states the plane's own extent, three times the grid", () => {
    expect(waterPlaneKey(map(256, 0))).toContain("768");
  });
});
