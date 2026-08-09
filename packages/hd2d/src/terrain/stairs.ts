import * as THREE from "three";

export interface StairRampGeometry {
  x: number;
  z: number;
  width: number;
  depth: number;
  direction: "east" | "west";
  lowLevel: number;
}

export interface MeshStairsOptions {
  levelHeight: number;
  steps?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  lift?: number;
}

/** Builds actual treads, not a tilted plane. Collision deliberately stays smooth in engine so a
 *  60 Hz body cannot snag on eight microscopic risers; both representations share this footprint. */
export function meshStairs(
  ramps: readonly StairRampGeometry[],
  options: MeshStairsOptions,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "terrain-stairs";
  const steps = Math.max(2, Math.round(options.steps ?? 8));
  const opacity = options.opacity ?? 1;
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xa9a17f,
    roughness: 0.92,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  const geometries: THREE.BufferGeometry[] = [];
  for (const ramp of ramps) {
    const baseY = ramp.lowLevel * options.levelHeight + (options.lift ?? 0.006);
    const stepWidth = ramp.width / steps;
    for (let index = 0; index < steps; index += 1) {
      const progress = (index + 1) / steps;
      const height = progress * options.levelHeight;
      const visualIndex = ramp.direction === "east" ? index : steps - 1 - index;
      const geometry = new THREE.BoxGeometry(stepWidth, height, ramp.depth);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        ramp.x + (visualIndex + 0.5) * stepWidth,
        baseY + height / 2,
        ramp.z + ramp.depth / 2,
      );
      mesh.castShadow = opacity >= 1;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return {
    group,
    dispose(): void {
      group.removeFromParent();
      group.clear();
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}
