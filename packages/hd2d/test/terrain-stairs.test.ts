import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

describe("meshStairs", () => {
  it("builds eight textured treads over the exact authored ramp footprint", () => {
    const texture = new THREE.Texture();
    const built = meshStairs(
      [{ x: -1, z: -1, width: 1, depth: 2, direction: "east", lowLevel: 1 }],
      {
        levelHeight: 0.9,
        lift: 0,
        atlas: {
          texture,
          cols: 9,
          rows: 6,
          block: "water-edge",
          wallRow: 4,
          tilePx: 64,
        },
      },
    );
    const steps = built.group.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(steps).toHaveLength(8);
    expect(Math.min(...steps.map((step) => step.position.x))).toBeGreaterThan(-1);
    expect(Math.max(...steps.map((step) => step.position.x))).toBeLessThan(0);
    expect(Math.max(...steps.map((step) => step.position.y + 0.45))).toBeGreaterThan(1.7);
    const firstStep = steps[0];
    if (!firstStep) throw new Error("expected authored stair meshes");
    const topMaterial = (firstStep.material as THREE.Material[])[2];
    expect(topMaterial).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect((topMaterial as THREE.MeshLambertMaterial).map).toBe(texture);
    const geometry = firstStep.geometry as THREE.BoxGeometry;
    const top = geometry.groups[2];
    const index = geometry.getIndex();
    const uv = geometry.getAttribute("uv");
    if (!top || !index) throw new Error("expected the first stair tread top face");
    const topUvs = Array.from({ length: top.count }, (_, offset) => {
      const vertex = index.getX(top.start + offset);
      return { u: uv.getX(vertex), v: uv.getY(vertex) };
    });
    const uRange = Math.max(...topUvs.map(({ u }) => u)) - Math.min(...topUvs.map(({ u }) => u));
    const vRange = Math.max(...topUvs.map(({ v }) => v)) - Math.min(...topUvs.map(({ v }) => v));
    // Une seule marche porte toute la LARGEUR 64px de l’asset, mais seulement 1/8 de sa longueur
    // 128px. L’ancien mapping produisait exactement l’inverse et tournait le dessin de 90°.
    expect(uRange).toBeGreaterThan(0.1);
    expect(vRange).toBeLessThan(0.05);
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });
});
