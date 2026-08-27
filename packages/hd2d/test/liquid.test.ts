import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createHd2dContext } from "../src/context.js";
import { heightFieldFromGrid } from "../src/terrain/height-field-from-grid.js";
import { createLiquidTerrain, liquidFallPlacements } from "../src/terrain/liquid.js";

function texture(): THREE.DataTexture {
  const value = new THREE.DataTexture(new Uint8Array([255, 120, 20, 255]), 1, 1);
  value.needsUpdate = true;
  return value;
}

describe("liquidFallPlacements", () => {
  it("merges adjacent elevated liquid edges into one animated sheet", () => {
    const field = heightFieldFromGrid({
      size: 3,
      levels: [0, 0, 0, 0, null, null, 0, 0, 0],
      materials: Array(9).fill("herbe"),
      liquids: [null, null, null, null, "lava", "lava", null, null, null],
      liquidLevels: [null, null, null, null, 2, 2, null, null, null],
      materialKey: (material) => material,
    });

    const falls = liquidFallPlacements(field, 0.5, -0.08);
    expect(falls).toContainEqual({
      kind: "lava",
      x: 0.5,
      z: -0.5,
      width: 2,
      topY: 1,
      bottomY: 0,
      facing: "north",
    });
    expect(falls).toContainEqual({
      kind: "lava",
      x: 0.5,
      z: 0.5,
      width: 2,
      topY: 1,
      bottomY: 0,
      facing: "south",
    });
  });

  it("does not create a fall towards an equal or higher surface", () => {
    const field = heightFieldFromGrid({
      size: 2,
      levels: [null, 2, 0, 0],
      materials: Array(4).fill("herbe"),
      liquids: ["water", null, null, null],
      liquidLevels: [2, null, null, null],
      materialKey: (material) => material,
    });

    expect(liquidFallPlacements(field, 0.5, -0.08)).not.toContainEqual(
      expect.objectContaining({ facing: "east" }),
    );
  });
});

describe("createLiquidTerrain", () => {
  it("builds pickable surfaces and derived falls without lava rings", () => {
    const field = heightFieldFromGrid({
      size: 3,
      levels: [0, 0, 0, 0, null, null, 0, null, null],
      materials: Array(9).fill("herbe"),
      liquids: [null, null, null, null, "water", "lava", null, "lava", "lava"],
      liquidLevels: [null, null, null, null, 1, 2, null, 2, 2],
      materialKey: (material) => material,
    });
    const water = texture();
    const lava = texture();
    const ctx = createHd2dContext();
    const liquids = createLiquidTerrain(ctx, field, {
      levelHeight: 0.5,
      waterLevel: -0.08,
      waterTexture: water,
      lavaTexture: lava,
    });

    expect(liquids.surfaces).toHaveLength(2);
    expect(
      liquids.surfaces
        .map((mesh) => mesh.userData.liquidSurface as string)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["lava", "water"]);
    expect(liquids.group.children.length).toBeGreaterThan(liquids.surfaces.length);
    expect(liquids.group.children.some((child) => child instanceof THREE.Points)).toBe(false);
    expect(() => liquids.update(1 / 60)).not.toThrow();

    liquids.dispose();
    ctx.dispose();
    water.dispose();
    lava.dispose();
  });
});
