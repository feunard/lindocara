import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import { meshStairs, type StairRampGeometry } from "@lindocara/hd2d/terrain/stairs.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

function atlas(): TerrainAtlas {
  return {
    texture: new THREE.Texture(),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    wallRowInWater: 5,
    tilePx: 64,
  };
}

const LEVEL_HEIGHT = 0.9;
const RAMP: StairRampGeometry = {
  x: -1,
  z: -1,
  width: 2,
  depth: 1,
  direction: "east",
  lowLevel: 1,
};

/** Le seul mesh du groupe, ou l'échec du test — la rampe est UN volume, pas une pile d'objets. */
function onlyMesh(group: THREE.Group): THREE.Mesh {
  const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  const first = meshes[0];
  if (meshes.length !== 1 || !first)
    throw new Error(`expected one ramp mesh, got ${meshes.length}`);
  return first;
}

/** Les Y de tous les sommets posés à cette abscisse. */
function heightsAtX(mesh: THREE.Mesh, x: number): number[] {
  const pos = mesh.geometry.getAttribute("position");
  const ys: number[] = [];
  for (let v = 0; v < pos.count; v++) {
    if (Math.abs(pos.getX(v) - x) < 1e-6) ys.push(pos.getY(v));
  }
  return ys;
}

describe("meshStairs", () => {
  it("builds one continuous slope rather than a stack of treads", () => {
    // Eight boxes wearing a side-view sprite across their tops was the old shape: the strip is an
    // elevation, half of it transparent, so slicing it horizontally drew neither a tread nor a
    // slope. The collision under it (`rampSampleAt`) was a smooth ramp the whole time.
    const built = meshStairs([RAMP], { levelHeight: LEVEL_HEIGHT, lift: 0, atlasFor: atlas });
    expect(onlyMesh(built.group)).toBeInstanceOf(THREE.Mesh);
    built.dispose();
  });

  it("agrees with the height rampSampleAt walks the hero up", () => {
    const built = meshStairs([RAMP], { levelHeight: LEVEL_HEIGHT, lift: 0, atlasFor: atlas });
    const mesh = onlyMesh(built.group);
    // `east` climbs towards +x: the low edge sits at `lowLevel`, the high edge one level above it.
    expect(Math.min(...heightsAtX(mesh, RAMP.x))).toBeCloseTo(RAMP.lowLevel * LEVEL_HEIGHT, 6);
    expect(Math.max(...heightsAtX(mesh, RAMP.x + RAMP.width))).toBeCloseTo(
      (RAMP.lowLevel + 1) * LEVEL_HEIGHT,
      6,
    );
    built.dispose();
  });

  it("climbs the other way when the ramp faces west", () => {
    const built = meshStairs([{ ...RAMP, direction: "west" }], {
      levelHeight: LEVEL_HEIGHT,
      lift: 0,
      atlasFor: atlas,
    });
    const mesh = onlyMesh(built.group);
    expect(Math.max(...heightsAtX(mesh, RAMP.x))).toBeCloseTo(
      (RAMP.lowLevel + 1) * LEVEL_HEIGHT,
      6,
    );
    expect(Math.min(...heightsAtX(mesh, RAMP.x + RAMP.width))).toBeCloseTo(
      RAMP.lowLevel * LEVEL_HEIGHT,
      6,
    );
    built.dispose();
  });

  it("stays inside the authored footprint on the depth axis", () => {
    const built = meshStairs([RAMP], { levelHeight: LEVEL_HEIGHT, lift: 0, atlasFor: atlas });
    const pos = onlyMesh(built.group).geometry.getAttribute("position");
    for (let v = 0; v < pos.count; v++) {
      expect(pos.getZ(v)).toBeGreaterThanOrEqual(RAMP.z - 1e-6);
      expect(pos.getZ(v)).toBeLessThanOrEqual(RAMP.z + RAMP.depth + 1e-6);
    }
    built.dispose();
  });

  it("asks for the atlas of the bank it climbs TO", () => {
    // Grass reads its tileset from its altitude — the pack ships five hues — so a ramp climbing 1
    // to 2 drawn with level 0's sheet is the wrong green. The plateau you walk off is the hue the
    // eye compares the slope against.
    const asked: number[] = [];
    const built = meshStairs([RAMP], {
      levelHeight: LEVEL_HEIGHT,
      atlasFor: (level) => {
        asked.push(level);
        return atlas();
      },
    });
    expect(asked).toEqual([RAMP.lowLevel + 1]);
    built.dispose();
  });

  it("carries the atlas texture and a per-vertex colour, like the terrain around it", () => {
    const texture = new THREE.Texture();
    const built = meshStairs([RAMP], {
      levelHeight: LEVEL_HEIGHT,
      atlasFor: () => ({ ...atlas(), texture }),
    });
    const mesh = onlyMesh(built.group);
    const material = mesh.material as THREE.MeshLambertMaterial;
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.map).toBe(texture);
    expect(material.vertexColors).toBe(true);
    expect(mesh.geometry.getAttribute("color")).toBeDefined();
    built.dispose();
  });

  it("releases its geometry on dispose", () => {
    const built = meshStairs([RAMP], { levelHeight: LEVEL_HEIGHT, atlasFor: atlas });
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });
});
