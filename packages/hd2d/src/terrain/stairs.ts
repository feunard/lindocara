import * as THREE from "three";
import type { TerrainAtlas } from "./atlas.js";

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
  /** Tiny Swords terrain atlas containing the native east/west stair strips. */
  atlas: TerrainAtlas;
  steps?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  lift?: number;
}

function stairUvRect(atlas: TerrainAtlas, direction: StairRampGeometry["direction"]) {
  const col = direction === "east" ? 0 : 3;
  const insetU = 0.5 / (atlas.cols * atlas.tilePx);
  const insetV = 0.5 / (atlas.rows * atlas.tilePx);
  return {
    u0: col / atlas.cols + insetU,
    u1: (col + 1) / atlas.cols - insetU,
    v0: 1 - 6 / atlas.rows + insetV,
    v1: 1 - 4 / atlas.rows - insetV,
  };
}

function mapTopUv(
  geometry: THREE.BoxGeometry,
  rect: ReturnType<typeof stairUvRect>,
  slice: number,
  slices: number,
): void {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const top = geometry.groups[2];
  if (!index || !top) return;
  for (let offset = top.start; offset < top.start + top.count; offset += 1) {
    const vertex = index.getX(offset);
    const localU = uv.getX(vertex);
    const localV = uv.getY(vertex);
    const progress = (slice + localU) / slices;
    uv.setXY(
      vertex,
      THREE.MathUtils.lerp(rect.u0, rect.u1, progress),
      THREE.MathUtils.lerp(rect.v0, rect.v1, localV),
    );
  }
  uv.needsUpdate = true;
}

/** Builds real treads carrying Pixel Frog's dedicated stair pixels. Collision deliberately stays
 * smooth in engine so a 60 Hz body cannot snag on eight microscopic risers. */
export function meshStairs(
  ramps: readonly StairRampGeometry[],
  options: MeshStairsOptions,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "terrain-stairs";
  const steps = Math.max(2, Math.round(options.steps ?? 8));
  const opacity = options.opacity ?? 1;
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xa9a17f,
    roughness: 0.92,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide,
  });
  const stairMaterial = new THREE.MeshLambertMaterial({
    map: options.atlas.texture,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const geometries: THREE.BufferGeometry[] = [];
  for (const ramp of ramps) {
    const uvRect = stairUvRect(options.atlas, ramp.direction);
    const baseY = ramp.lowLevel * options.levelHeight + (options.lift ?? 0.006);
    const stepWidth = ramp.width / steps;
    for (let index = 0; index < steps; index += 1) {
      const progress = (index + 1) / steps;
      const height = progress * options.levelHeight;
      const visualIndex = ramp.direction === "east" ? index : steps - 1 - index;
      const geometry = new THREE.BoxGeometry(stepWidth, height, ramp.depth);
      mapTopUv(geometry, uvRect, index, steps);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, [
        sideMaterial,
        sideMaterial,
        stairMaterial,
        sideMaterial,
        sideMaterial,
        sideMaterial,
      ]);
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
      sideMaterial.dispose();
      stairMaterial.dispose();
    },
  };
}
