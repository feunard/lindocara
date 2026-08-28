import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createInteriorShell } from "../src/hd2d/interior-shell.js";

const map: MapData = {
  version: 1,
  environment: "interior",
  interiorShell: { style: "castle" },
  size: 2,
  levelHeight: 0.5,
  waterLevel: -0.05,
  levels: [0, 0, 0, 0],
  materials: ["sable", "sable", "sable", "sable"],
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

function registry(): TextureRegistry {
  const texture = new THREE.Texture();
  return {
    get: () => texture,
    decode: async () => {},
    urls: () => [],
    dispose: () => texture.dispose(),
  };
}

describe("interior shell visual", () => {
  it("opens the camera-facing side and follows quarter-turns", () => {
    const visual = createInteriorShell(map, registry());
    expect(visual.group.getObjectByName("south-full")?.visible).toBe(false);
    expect(visual.group.getObjectByName("south-cutaway")?.visible).toBe(true);
    expect(visual.group.getObjectByName("east-full")?.visible).toBe(true);

    visual.setCameraYaw(Math.PI / 2);
    expect(visual.group.getObjectByName("south-full")?.visible).toBe(true);
    expect(visual.group.getObjectByName("east-full")?.visible).toBe(false);
    expect(visual.group.getObjectByName("east-cutaway")?.visible).toBe(true);
    visual.dispose();
  });

  it("allocates no meshes for an exterior map", () => {
    const visual = createInteriorShell({ ...map, environment: "exterior" }, registry());
    expect(visual.group.children).toHaveLength(0);
    visual.dispose();
  });

  it("allocates no walls when the map contains no matching structural floor", () => {
    const visual = createInteriorShell(
      { ...map, materials: ["herbe", "herbe", "herbe", "herbe"] },
      registry(),
    );
    expect(visual.group.getObjectByName("north-wall")).toBeUndefined();
    visual.dispose();
  });

  it("instances persisted inner-room walls in the same directional batches", () => {
    const outer = createInteriorShell(map, registry());
    const nested = createInteriorShell(
      {
        ...map,
        interiorShell: { style: "castle", innerWalls: [{ col: 0, row: 0, length: 1 }] },
      },
      registry(),
    );
    const wallInstances = (group: THREE.Group): number => {
      let count = 0;
      group.traverse((object) => {
        if (object instanceof THREE.InstancedMesh && object.name.endsWith("-wall")) {
          count += object.count;
        }
      });
      return count;
    };
    expect(wallInstances(nested.group)).toBeGreaterThan(wallInstances(outer.group));
    outer.dispose();
    nested.dispose();
  });
});
