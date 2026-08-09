import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

describe("meshStairs", () => {
  it("builds eight real treads over the exact authored ramp footprint", () => {
    const built = meshStairs(
      [{ x: -1, z: -1, width: 1, depth: 2, direction: "east", lowLevel: 1 }],
      { levelHeight: 0.9, lift: 0 },
    );
    const steps = built.group.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(steps).toHaveLength(8);
    expect(Math.min(...steps.map((step) => step.position.x))).toBeGreaterThan(-1);
    expect(Math.max(...steps.map((step) => step.position.x))).toBeLessThan(0);
    expect(Math.max(...steps.map((step) => step.position.y + 0.45))).toBeGreaterThan(1.7);
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });
});
