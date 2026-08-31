import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { undergroundColliders } from "@lindocara/engine/underground.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  cameraDistanceBeforeTerrain,
  cameraFocusSurface,
  editorGroundPickPoint,
  heightFieldFor,
  stairMaterialKeyFor,
  surfaceAccessPreviewAt,
  terrainAtlasKey,
  terrainGroupFor,
  undergroundStairVisible,
  waterPlaneKey,
} from "../src/hd2d/scene.js";

describe("surface access preview", () => {
  const map = (liquid: "water" | "lava" | null, level: number | null = 0): MapData => ({
    version: 1,
    size: 1,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: [level],
    materials: ["herbe"],
    liquids: [liquid],
    liquidLevels: [liquid ? 0 : null],
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  });

  it("keeps deep rooms hidden below surface water and lava", () => {
    expect(surfaceAccessPreviewAt(map("water"), 0, 0)).toBe(false);
    expect(surfaceAccessPreviewAt(map("lava"), 0, 0)).toBe(false);
    expect(surfaceAccessPreviewAt(map(null, null), 0, 0)).toBe(false);
    expect(surfaceAccessPreviewAt(map(null), 0, 0)).toBe(true);
  });
});

describe("camera focus over underground rooms", () => {
  it.each([
    { label: "level-zero", liquidLevel: 0 },
    { label: "raised", liquidLevel: 3 },
  ])("keeps the camera on a $label surface liquid above a basement", ({ liquidLevel }) => {
    const underground = {
      levels: [
        {
          depth: 1,
          style: "cave" as const,
          cells: [{ col: 1, row: 1, length: 1 }],
        },
      ],
      stairs: [],
    };
    const platforms = undergroundColliders(underground, 3);
    const query = createTerrainQuery({
      size: 3,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => null,
      kindAt: () => null,
      liquidAt: () => "water",
      liquidLevelAt: () => liquidLevel,
      liquidAtElevation: (_col, _row, elevation) => (elevation > -0.6 ? "water" : null),
      waterLevelAtElevation: (_col, _row, elevation) =>
        elevation > -0.6 ? liquidLevel * 0.9 : null,
      platforms,
    });
    const liquidSurface = liquidLevel * 0.9;

    expect(query.surfaceAt?.(0, 0, liquidSurface + 0.02)).not.toBe(liquidSurface);
    expect(cameraFocusSurface(query, -0.05, 0, 0, liquidSurface)).toBeCloseTo(liquidSurface);
  });

  it("still follows a finite platform above the same liquid column", () => {
    const query = createTerrainQuery({
      size: 1,
      levelHeight: 0.9,
      waterLevel: -0.05,
      at: () => null,
      kindAt: () => null,
      liquidAt: () => "water",
      liquidLevelAt: () => 0,
      platforms: [{ x: -0.5, z: -0.5, w: 1, h: 1, bottom: 1.62, top: 1.8 }],
    });

    expect(cameraFocusSurface(query, -0.05, 0, 0, 1.8)).toBeCloseTo(1.8);
  });
});

describe("underground stair visibility", () => {
  it("keeps a surface-to-depth-16 flight visible from every crossed level", () => {
    expect(undergroundStairVisible(16, 0, [null])).toBe(true);
    for (let depth = 1; depth <= 16; depth += 1) {
      expect(undergroundStairVisible(16, 0, [depth])).toBe(true);
    }
    expect(undergroundStairVisible(16, 0, [])).toBe(false);
  });

  it("does not leak a deep flight into unrelated storeys", () => {
    expect(undergroundStairVisible(8, 3, [2])).toBe(false);
    expect(undergroundStairVisible(8, 3, [3])).toBe(true);
    expect(undergroundStairVisible(8, 3, [6])).toBe(true);
    expect(undergroundStairVisible(8, 3, [9])).toBe(false);
  });

  it("keeps a ground-to-upper-floor flight visible only across its signed storeys", () => {
    expect(undergroundStairVisible(0, -4, [null])).toBe(true);
    for (let depth = -1; depth >= -4; depth -= 1) {
      expect(undergroundStairVisible(0, -4, [depth])).toBe(true);
    }
    expect(undergroundStairVisible(0, -4, [-5])).toBe(false);
    expect(undergroundStairVisible(0, -4, [1])).toBe(false);
  });
});

describe("heightFieldFor liquids", () => {
  it("turns implicit interior water into black void while preserving volcanic lava", () => {
    const source: MapData = {
      version: 1,
      environment: "interior",
      size: 2,
      levelHeight: 0.5,
      waterLevel: -0.05,
      levels: [0, null, null, 0],
      materials: ["herbe", "herbe", "lave", "herbe"],
      liquids: [null, "water", "lava", null],
      liquidLevels: [null, null, 0, null],
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };
    const field = heightFieldFor(source);
    expect(field.liquidAt?.(1, 0)).toBeNull();
    expect(field.liquidLevelAt?.(1, 0)).toBeNull();
    expect(field.liquidAt?.(0, 1)).toBe("lava");
    expect(field.liquidLevelAt?.(0, 1)).toBe(0);
  });

  it("themes only the structural floor and leaves every other interior terrain intact", () => {
    const source: MapData = {
      version: 1,
      environment: "interior",
      interiorShell: { style: "volcano" },
      size: 1,
      levelHeight: 0.5,
      waterLevel: -0.05,
      levels: [0],
      materials: ["volcan"],
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };
    expect(heightFieldFor(source).materialAt(0, 0)).toBe("volcan-ground");
    expect(heightFieldFor({ ...source, materials: ["herbe"] }).materialAt(0, 0)).toBe("lvl0");
    expect(
      heightFieldFor({
        ...source,
        interiorShell: { style: "castle" },
        materials: ["sable"],
      }).materialAt(0, 0),
    ).toBe("montagne-ground");
    expect(
      heightFieldFor({
        ...source,
        interiorShell: { style: "timber" },
        materials: ["sable"],
      }).materialAt(0, 0),
    ).toBe("interior");
  });

  it("recovers a legacy level-zero pool enclosed by structural floor", () => {
    const source: MapData = {
      version: 1,
      environment: "interior",
      interiorShell: { style: "volcano" },
      size: 3,
      levelHeight: 0.5,
      waterLevel: -0.05,
      levels: [0, 0, 0, 0, null, 0, 0, 0, 0],
      materials: [
        "volcan",
        "volcan",
        "volcan",
        "volcan",
        "herbe",
        "volcan",
        "volcan",
        "volcan",
        "volcan",
      ],
      liquids: [null, null, null, null, "water", null, null, null, null],
      liquidLevels: [null, null, null, null, null, null, null, null, null],
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };
    const field = heightFieldFor(source);
    expect(field.liquidAt?.(1, 1)).toBe("water");
    expect(field.liquidLevelAt?.(1, 1)).toBe(0);
  });

  it.each([-2, -1, 0, 1, 2])(
    "keeps explicitly painted interior water visible at elevation %i even on an open edge",
    (level) => {
      const source: MapData = {
        version: 1,
        environment: "interior",
        interiorShell: { style: "volcano" },
        size: 1,
        levelHeight: 0.5,
        waterLevel: -0.05,
        levels: [null],
        materials: ["herbe"],
        liquids: ["water"],
        liquidLevels: [level],
        colliders: [],
        spawns: [],
        elements: [],
        events: [],
      };

      const field = heightFieldFor(source);
      expect(field.liquidAt?.(0, 0)).toBe("water");
      expect(field.liquidLevelAt?.(0, 0)).toBe(level);
    },
  );

  it("takes each staircase atlas from the terrain of its high landing", () => {
    const source = mapOf(3, [
      [0, "herbe"],
      [0, "herbe"],
      [0, "herbe"],
      [0, "herbe"],
      [0, "herbe"],
      [1, "montagne"],
      [0, "herbe"],
      [0, "herbe"],
      [0, "herbe"],
    ]);
    const ramp = { x: -0.5, z: -0.5, width: 1, depth: 1, direction: "east", lowLevel: 0 } as const;
    expect(stairMaterialKeyFor(source, ramp)).toBe("montagne-raised");
    expect(
      stairMaterialKeyFor(
        {
          ...source,
          environment: "interior",
          interiorShell: { style: "castle" },
          materials: source.materials.map((_material, index) => (index === 5 ? "sable" : "herbe")),
        },
        ramp,
      ),
    ).toBe("montagne-raised");
  });

  it("keeps authored water and lava out of the ground mesh at their own tiers", () => {
    const source: MapData = {
      version: 1,
      size: 2,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: [0, null, null, 1],
      materials: ["herbe", "herbe", "lave", "herbe"],
      liquids: [null, "water", "lava", null],
      liquidLevels: [null, 2, 3, null],
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };

    const field = heightFieldFor(source);
    expect(field.levelAt(1, 0)).toBeNull();
    expect(field.levelAt(0, 1)).toBeNull();
    expect(field.liquidAt?.(1, 0)).toBe("water");
    expect(field.liquidAt?.(0, 1)).toBe("lava");
    expect(field.liquidLevelAt?.(1, 0)).toBe(2);
    expect(field.liquidLevelAt?.(0, 1)).toBe(3);
  });

  it("draws a volcanic ground rim around lava instead of a water shoreline", () => {
    const source: MapData = {
      version: 1,
      size: 3,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: [0, 0, 0, 0, null, 0, 0, 0, 0],
      materials: Array.from({ length: 9 }, () => "herbe"),
      liquids: [null, null, null, null, "lava", null, null, null, null],
      liquidLevels: [null, null, null, null, 0, null, null, null, null],
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
    };

    const field = heightFieldFor(source);
    expect(field.materialAt(1, 0)).toBe("volcan-ground");
    expect(field.materialAt(0, 1)).toBe("volcan-ground");
    expect(field.materialAt(2, 1)).toBe("volcan-ground");
    expect(field.materialAt(1, 2)).toBe("volcan-ground");
    // Diagonal ground is not part of the one-cell cardinal rim.
    expect(field.materialAt(0, 0)).toBe("lvl0");

    const waterField = heightFieldFor({
      ...source,
      liquids: [null, null, null, null, "water", null, null, null, null],
    });
    expect(waterField.materialAt(1, 0)).toBe("lvl0");
  });
});

describe("editor ground picking", () => {
  /** A cliff at x = 2 whose west foot stands on the ground and whose east top is `top` up. */
  const cliff =
    (top: number) =>
    (x: number): number | null =>
      x < 2 ? 0 : top;

  it("keeps roof clicks in place and pulls wall clicks into the building footprint", () => {
    expect(editorGroundPickPoint({ x: 2.25, y: 3, z: 3.5 }, { x: 0, y: 1, z: 0 }, true)).toEqual({
      x: 2.25,
      z: 3.5,
    });
    expect(editorGroundPickPoint({ x: 2, y: 1.5, z: 3.5 }, { x: -1, y: 0, z: 0 }, true)).toEqual({
      x: 2.5,
      z: 3.5,
    });
  });

  it("keeps terrain cliff clicks on the low exterior cell when no terrain is offered", () => {
    // The pure form, and the fallback inside `pickGround` when the query has nothing to say: the
    // foot is the answer that has always been given, so a caller with no heightfield keeps it.
    expect(editorGroundPickPoint({ x: 2, y: 1.5, z: 3.5 }, { x: -1, y: 0, z: 0 }, false)).toEqual({
      x: 1.5,
      z: 3.5,
    });
  });

  it("keeps the complete visible face attached to its plateau cell", () => {
    const tall = cliff(9);
    const wall = { x: 2, z: 3.5 };
    const outward = { x: -1, y: 0, z: 0 };

    expect(editorGroundPickPoint({ ...wall, y: 0.4 }, outward, false, tall)).toEqual({
      x: 2.5,
      z: 3.5,
    });
    expect(editorGroundPickPoint({ ...wall, y: 8.6 }, outward, false, tall)).toEqual({
      x: 2.5,
      z: 3.5,
    });
  });

  it("does the same across a one-level cliff", () => {
    const shallow = cliff(0.9);
    expect(
      editorGroundPickPoint({ x: 2, y: 0.1, z: 3.5 }, { x: -1, y: 0, z: 0 }, false, shallow),
    ).toEqual({ x: 2.5, z: 3.5 });
  });

  it("leaves a building wall alone even with terrain to consult", () => {
    // `onBuilding` means "select the architecture you clicked", which is a different question from
    // "which ground did you mean" and must not start depending on the terrain behind it.
    expect(
      editorGroundPickPoint({ x: 2, y: 8.6, z: 3.5 }, { x: -1, y: 0, z: 0 }, true, cliff(9)),
    ).toEqual({ x: 2.5, z: 3.5 });
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

/**
 * The half of quest #26's M1 that the pure-function tests take on faith: that a cliff really is a
 * vertical quad whose outward normal points at the low side, that a ray striking it high really
 * does report a high `y`, and that the rule then answers the plateau rather than the foot.
 *
 * Raycasting is CPU geometry, so this runs in jsdom against the SAME mesh the editor picks against.
 * What it does not cover is `pickGround`'s own intersect ordering, which needs a live scene.
 */
describe("picking a real cliff face", () => {
  const SIZE = 8;
  const LEVEL_HEIGHT = 0.9;
  const PLATEAU = 10;
  /** Cols 0-3 sit on the ground, cols 4-7 stand ten levels up: one 9.0-tall face at world x = 0. */
  const hillside = (): MapData =>
    mapOf(
      SIZE,
      Array.from(
        { length: SIZE * SIZE },
        (_unused, index) => [index % SIZE >= 4 ? PLATEAU : 0, "herbe"] as const,
      ),
    );

  /** Fire at a point on the face and resolve it the way `pickGround` does. */
  const pickAt = (group: THREE.Group, faceY: number): { x: number; z: number } | null => {
    const origin = new THREE.Vector3(-4, faceY + 2, 0.5);
    const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(4, -2, 0).normalize(), 0, 100);
    for (const hit of raycaster.intersectObject(group, true)) {
      const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
      if (!normal) continue;
      return editorGroundPickPoint(hit.point, normal, false, (x) =>
        x < 0 ? 0 : PLATEAU * LEVEL_HEIGHT,
      );
    }
    return null;
  };

  it("answers the same plateau cell over the whole visible face", () => {
    const ctx = createHd2dContext();
    const { group } = terrainGroupFor(ctx, hillside(), allAtlases());
    group.updateMatrixWorld(true);

    // The face spans y 0..9. Both rays reach x = 0 without meeting the low ground first.
    const high = pickAt(group, 8);
    const low = pickAt(group, 0.5);
    if (!high || !low) throw new Error("the pointer ray missed the cliff entirely");

    // World x maps to a column as `floor(x + size / 2)`, so 4 is the plateau.
    expect(Math.floor(high.x + SIZE / 2)).toBe(4);
    expect(Math.floor(low.x + SIZE / 2)).toBe(4);
    expect(high.x).toBeCloseTo(low.x, 6);
  });
});

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
    expect(terrainAtlasKey("parquet", 0)).toBe("parquet");
    expect(terrainAtlasKey("lino-gris", 0)).toBe("lino-gris");
    expect(terrainAtlasKey("lino-jaune", 4)).toBe("lino-jaune");
    expect(terrainAtlasKey("carrelage-beige", -3)).toBe("carrelage-beige");
    // A pit floor takes a RAISED sheet: level 0's group carries the painted shore line, because
    // level 0 is what borders the sea, and a dry pit borders its own walls on every side.
    expect(terrainAtlasKey("herbe", -1)).toBe("lvl1");
    expect(terrainAtlasKey("herbe", -3)).toBe("lvl1");

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

  it("cuts surface terrain above stairs and direct shafts", () => {
    const ctx = createHd2dContext();
    const map: MapData = {
      ...ground(4),
      underground: {
        levels: [{ depth: 1, style: "cave", cells: [{ col: 0, row: 0, length: 4 }] }],
        stairs: [{ depth: 1, col: 0, row: 0, direction: "east", length: 2, width: 1 }],
        shafts: [
          { col: 3, row: 3, width: 1, length: 1, depth: 1 },
          { col: 2, row: 2, width: 1, length: 1, fromDepth: 1, depth: 2 },
        ],
      },
    };
    const cut = terrainGroupFor(ctx, map, allAtlases());
    expect(topVertices(cut.group)).toHaveLength((16 - 3) * 4);
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

  it("follows the hero's real elevation while airborne over a crevasse", () => {
    const map = {
      ...ground(3),
      levels: [2, 2, 2, 2, -2, 2, 2, 2, 2],
    };
    const query = createTerrainQuery(mapToQuerySource(map));

    const lowerTerrain = query.heightAt(0, 0);
    expect(lowerTerrain).not.toBeNull();
    expect(cameraFocusSurface(query, map.waterLevel, 0, 0, 1.35, true)).toBe(1.35);
    expect(cameraFocusSurface(query, map.waterLevel, 0, 0, 1.35, false)).toBe(lowerTerrain);
  });

  it("follows every point of a deep stair instead of snapping between storeys", () => {
    const deepRamp = {
      x: -9,
      z: -0.5,
      width: 18,
      depth: 1,
      direction: "east" as const,
      lowLevel: -6,
      lowHeight: -14.4,
      highHeight: 0,
    };
    const map = { ...ground(24), ramps: [deepRamp] };
    const query = createTerrainQuery(mapToQuerySource(map));
    const samples = Array.from({ length: 19 }, (_unused, index) => {
      const x = deepRamp.x + index;
      const expected = deepRamp.lowHeight + (index / 18) * -deepRamp.lowHeight;
      return cameraFocusSurface(query, map.waterLevel, x, 0, expected);
    });

    expect(samples[0]).toBeCloseTo(-14.4);
    expect(samples.at(-1)).toBeCloseTo(0);
    for (let index = 1; index < samples.length; index += 1) {
      expect((samples[index] ?? 0) - (samples[index - 1] ?? 0)).toBeCloseTo(0.8);
    }
  });

  it("pulls the orbit camera in front of raised terrain behind its target", () => {
    const size = 16;
    const clear = ground(size);
    const blocked = {
      ...clear,
      levels: clear.levels.map((level, index) =>
        Math.floor(index / size) === size / 2 + 2 ? 10 : level,
      ),
    };
    const target = { x: 0, y: 1.2, z: 0 };
    const offset = { x: 0, y: 24.6, z: 31.5 };
    const distance = 40;

    expect(
      cameraDistanceBeforeTerrain(
        createTerrainQuery(mapToQuerySource(clear)),
        target,
        offset,
        distance,
      ),
    ).toBe(distance);
    expect(
      cameraDistanceBeforeTerrain(
        createTerrainQuery(mapToQuerySource(blocked)),
        target,
        offset,
        distance,
      ),
    ).toBeLessThan(distance);
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
