import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createUnderground } from "../src/hd2d/underground.js";

function textures(): TextureRegistry {
  return {
    async decode() {},
    get: () => new THREE.Texture(),
    urls: () => [],
    dispose() {},
  };
}

describe("underground liquid rendering", () => {
  it("uses the animated emissive lava surface instead of a static terrain atlas tile", () => {
    const map: MapData = {
      version: 1,
      size: 3,
      levelHeight: 0.9,
      waterLevel: -0.05,
      levels: Array.from({ length: 9 }, () => 0),
      materials: Array.from({ length: 9 }, () => "herbe" as const),
      colliders: [],
      spawns: [],
      elements: [],
      events: [],
      underground: {
        levels: [
          {
            depth: 1,
            style: "volcano",
            cells: [{ col: 1, row: 1, length: 1 }],
            terrain: [{ col: 1, row: 1, length: 1, material: "lave" }],
          },
        ],
        stairs: [],
      },
    };
    const underground = createUnderground(map, textures());
    const lava = underground.group.getObjectByName("underground-terrain-1-lave") as
      | THREE.InstancedMesh
      | undefined;
    expect(lava?.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    const material = lava?.material as THREE.MeshStandardMaterial;
    expect(material.emissiveIntensity).toBeGreaterThan(0.7);
    const before = material.map?.offset.x ?? 0;

    underground.update(1);

    expect(material.map?.offset.x).toBeGreaterThan(before);
    underground.dispose();
  });
});
