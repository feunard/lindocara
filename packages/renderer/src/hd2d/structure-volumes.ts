import type { BuildingDimensions } from "@lindocara/engine/buildings.js";
import {
  type ElementOrientation,
  type ElementRotation,
  elementRotationDegrees,
} from "@lindocara/engine/element-orientation.js";
import * as THREE from "three";

import type { NativeStaticVisual } from "./building-volumes.js";

export type StructureVolumeKind =
  | "cave-wall"
  | "castle-wall"
  | "timber-wall"
  | "cave-ceiling"
  | "castle-ceiling"
  | "timber-ceiling";

const STRUCTURE_DIMENSIONS: Record<StructureVolumeKind, BuildingDimensions> = {
  "cave-wall": { width: 3, depth: 0.8 },
  "castle-wall": { width: 3, depth: 0.75 },
  "timber-wall": { width: 3, depth: 0.65 },
  "cave-ceiling": { width: 3, depth: 3 },
  "castle-ceiling": { width: 3, depth: 3 },
  "timber-ceiling": { width: 3, depth: 3 },
};

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function outlined<T extends THREE.Mesh>(mesh: T, opacity = 0.86): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const ink = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 24),
    new THREE.LineBasicMaterial({ color: 0x191922, transparent: true, opacity }),
  );
  ink.name = "ink-outline";
  ink.renderOrder = 3;
  mesh.add(ink);
  return mesh;
}

function box(
  root: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = outlined(new THREE.Mesh(new THREE.BoxGeometry(...size), material));
  mesh.name = name;
  mesh.position.set(...at);
  root.add(mesh);
  return mesh;
}

function caveRock(
  root: THREE.Object3D,
  name: string,
  at: readonly [number, number, number],
  scale: readonly [number, number, number],
  material: THREE.Material,
  rotation: readonly [number, number, number],
): void {
  const rock = outlined(new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), material));
  rock.name = name;
  rock.position.set(...at);
  rock.scale.set(...scale);
  rock.rotation.set(...rotation);
  root.add(rock);
}

function buildCaveWall(root: THREE.Group): void {
  const stone = new THREE.MeshLambertMaterial({ color: 0x566165, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2f3438, flatShading: true });
  const brown = new THREE.MeshLambertMaterial({ color: 0x655345, flatShading: true });
  box(root, "cave-wall-core", [2.92, 2.5, 0.54], [0, 1.25, 0], dark);
  const rows = [0.3, 0.78, 1.3, 1.84, 2.34] as const;
  for (const [row, y] of rows.entries()) {
    const offset = row % 2 === 0 ? 0 : 0.27;
    for (let column = -2; column <= 2; column += 1) {
      const x = column * 0.58 + offset;
      if (x > 1.52) continue;
      caveRock(
        root,
        "cave-wall-rock",
        [x, y, 0.29 + ((row + column + 8) % 3) * 0.025],
        [0.7, 0.5 + ((row + column + 7) % 2) * 0.08, 0.34],
        (row + column) % 3 === 0 ? brown : stone,
        [0.08 * ((column + 3) % 2), 0.13 * (row % 3), 0.06 * column],
      );
    }
  }
  for (const x of [-1.34, 1.34]) {
    caveRock(root, "cave-wall-pillar", [x, 1.25, -0.1], [0.5, 1.48, 0.52], dark, [0, 0.2, 0]);
  }
}

function buildCastleWall(root: THREE.Group): void {
  const mortar = new THREE.MeshLambertMaterial({ color: 0x4d5056, flatShading: true });
  const stone = new THREE.MeshLambertMaterial({ color: 0x899097, flatShading: true });
  const light = new THREE.MeshLambertMaterial({ color: 0xabb0b1, flatShading: true });
  const moss = new THREE.MeshLambertMaterial({ color: 0x66705a, flatShading: true });
  box(root, "castle-wall-core", [2.96, 2.58, 0.54], [0, 1.29, 0], mortar);
  for (let row = 0; row < 5; row += 1) {
    const y = 0.28 + row * 0.5;
    const offset = row % 2 === 0 ? 0 : 0.3;
    for (let column = -2; column <= 2; column += 1) {
      const x = column * 0.6 + offset;
      if (x > 1.5) continue;
      const block = box(
        root,
        "castle-dressed-stone",
        [0.55, 0.42, 0.25],
        [x, y, 0.38],
        (row + column + 9) % 5 === 0 ? light : stone,
      );
      block.rotation.z = ((row * 7 + column * 3) % 3) * 0.006 - 0.006;
    }
  }
  for (const x of [-1.35, 1.35]) {
    box(root, "castle-buttress", [0.34, 2.78, 0.74], [x, 1.39, -0.02], light);
    box(root, "castle-buttress-foot", [0.56, 0.3, 1.02], [x, 0.15, -0.08], stone);
  }
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2]) {
    box(root, "castle-capstone", [0.52, 0.22, 0.82], [x, 2.69, 0], stone);
  }
  box(root, "castle-moss-seam", [1.1, 0.05, 0.06], [-0.62, 1.01, 0.53], moss);
}

function buildTimberWall(root: THREE.Group): void {
  const plaster = new THREE.MeshLambertMaterial({ color: 0xd9c9a7, flatShading: true });
  const plasterShade = new THREE.MeshLambertMaterial({ color: 0xb9a782, flatShading: true });
  const timber = new THREE.MeshLambertMaterial({ color: 0x66452f, flatShading: true });
  const timberLight = new THREE.MeshLambertMaterial({ color: 0x8a6040, flatShading: true });
  const stone = new THREE.MeshLambertMaterial({ color: 0x74716a, flatShading: true });
  box(root, "timber-wall-core", [2.92, 2.42, 0.38], [0, 1.21, 0], plasterShade);
  for (const x of [-0.92, 0, 0.92]) {
    box(root, "timber-wall-panel", [0.78, 0.94, 0.08], [x, 0.68, 0.23], plaster);
    box(root, "timber-wall-panel", [0.78, 0.87, 0.08], [x, 1.78, 0.23], plaster);
  }
  for (const x of [-1.42, -0.47, 0.47, 1.42]) {
    box(root, "timber-wall-post", [0.18, 2.55, 0.32], [x, 1.275, 0.26], timber);
  }
  for (const y of [0.16, 1.22, 2.42]) {
    box(root, "timber-wall-rail", [2.98, 0.2, 0.34], [0, y, 0.25], timberLight);
  }
  for (const [x, rotation] of [
    [-0.94, -0.68],
    [0.94, 0.68],
  ] as const) {
    const brace = box(root, "timber-wall-brace", [0.16, 1.38, 0.3], [x, 0.7, 0.31], timber);
    brace.rotation.z = rotation;
  }
  for (let index = 0; index < 7; index++) {
    const x = -1.27 + index * 0.42;
    const footing = box(
      root,
      "timber-wall-footing",
      [0.38, 0.25 + (index % 2) * 0.05, 0.52],
      [x, 0.13, 0.02],
      index % 3 === 0 ? plasterShade : stone,
    );
    footing.rotation.y = ((index % 3) - 1) * 0.035;
  }
}

function buildCaveCeiling(root: THREE.Group): void {
  const stone = new THREE.MeshLambertMaterial({
    color: 0x4c575b,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
  const dark = new THREE.MeshLambertMaterial({ color: 0x30363a, flatShading: true });
  const brown = new THREE.MeshLambertMaterial({ color: 0x635247, flatShading: true });
  box(root, "cave-ceiling-slab", [2.96, 0.42, 2.96], [0, 1.56, 0], stone);
  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
    for (const z of [-1.1, -0.55, 0, 0.55, 1.1]) {
      caveRock(
        root,
        "cave-ceiling-underside-rock",
        [x, 1.34 - ((Math.abs(x + z) * 10) % 2) * 0.025, z],
        [0.62, 0.28, 0.62],
        (Math.round((x - z) * 10) + 20) % 4 === 0 ? brown : dark,
        [0.12 * z, 0.15 * x, 0.08 * (x - z)],
      );
      caveRock(
        root,
        "cave-ceiling-crown-rock",
        [x, 1.8 + ((Math.abs(x - z) * 10) % 3) * 0.018, z],
        [0.62, 0.22, 0.62],
        (Math.round((x + z) * 10) + 20) % 4 === 0 ? brown : stone,
        [-0.08 * z, -0.12 * x, 0.07 * (x + z)],
      );
    }
  }
  for (const [x, z, length] of [
    [-1.08, -0.8, 0.22],
    [0.85, -0.92, 0.18],
    [-0.48, 0.9, 0.2],
    [1.12, 0.72, 0.16],
  ] as const) {
    const tooth = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.1, length, 7), stone));
    tooth.name = "cave-ceiling-stalactite";
    tooth.position.set(x, 1.31 - length / 2, z);
    root.add(tooth);
  }
}

function buildCastleCeiling(root: THREE.Group): void {
  const stone = new THREE.MeshLambertMaterial({ color: 0x858b91, flatShading: true });
  const light = new THREE.MeshLambertMaterial({ color: 0xa8adaf, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a4e55, flatShading: true });
  box(root, "castle-ceiling-slab", [2.96, 0.34, 2.96], [0, 1.67, 0], stone);
  for (let row = -2; row <= 2; row += 1) {
    const offset = row % 2 === 0 ? 0 : 0.28;
    for (let column = -2; column <= 2; column += 1) {
      const x = column * 0.58 + offset;
      if (x > 1.48) continue;
      const tile = box(
        root,
        "castle-ceiling-top-stone",
        [0.53, 0.08, 0.52],
        [x, 1.88, row * 0.58],
        (row + column + 8) % 4 === 0 ? light : stone,
      );
      tile.rotation.y = ((row * 5 + column * 3) % 3) * 0.008 - 0.008;
    }
  }
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2]) {
    box(root, "castle-ceiling-rib", [0.16, 0.2, 2.92], [x, 1.45, 0], light);
  }
  for (const z of [-1.2, -0.6, 0, 0.6, 1.2]) {
    box(root, "castle-ceiling-course", [2.92, 0.1, 0.1], [0, 1.48, z], dark);
  }
  for (const [x, z] of [
    [-1.22, -1.22],
    [1.22, -1.22],
    [-1.22, 1.22],
    [1.22, 1.22],
  ] as const) {
    box(root, "castle-ceiling-corner-boss", [0.34, 0.28, 0.34], [x, 1.39, z], light);
  }
}

function buildTimberCeiling(root: THREE.Group): void {
  const plaster = new THREE.MeshLambertMaterial({ color: 0xcbbd9e, flatShading: true });
  const timber = new THREE.MeshLambertMaterial({ color: 0x62422d, flatShading: true });
  const timberLight = new THREE.MeshLambertMaterial({ color: 0x8c6342, flatShading: true });
  const iron = new THREE.MeshLambertMaterial({ color: 0x35383c, flatShading: true });
  box(root, "timber-ceiling-core", [2.96, 0.3, 2.96], [0, 1.6, 0], plaster);
  for (let index = 0; index < 7; index++) {
    const x = -1.32 + index * 0.44;
    const plank = box(
      root,
      "timber-ceiling-plank",
      [0.41, 0.1, 2.9],
      [x, 1.79 + (index % 2) * 0.012, 0],
      index % 3 === 0 ? timberLight : timber,
    );
    plank.rotation.y = ((index % 3) - 1) * 0.006;
  }
  for (const z of [-1.22, -0.42, 0.42, 1.22]) {
    box(root, "timber-ceiling-beam", [2.98, 0.22, 0.2], [0, 1.37, z], timber);
    for (const x of [-1.22, 0, 1.22]) {
      box(root, "timber-ceiling-iron", [0.1, 0.045, 0.24], [x, 1.245, z], iron);
    }
  }
  for (const x of [-1.38, 1.38]) {
    box(root, "timber-ceiling-edge", [0.18, 0.34, 2.98], [x, 1.58, 0], timberLight);
  }
}

export function makeStructureVolume(
  kind: StructureVolumeKind,
  orientation: ElementOrientation = 0,
  rotation?: ElementRotation,
  dimensions?: BuildingDimensions,
): NativeStaticVisual {
  const group = new THREE.Group();
  group.name = `structure-${kind}`;
  group.rotation.y = THREE.MathUtils.degToRad(
    -elementRotationDegrees({ orientation, ...(rotation === undefined ? {} : { rotation }) }),
  );
  const model = new THREE.Group();
  model.name = `structure-${kind}-model`;
  const native = STRUCTURE_DIMENSIONS[kind];
  const size = dimensions ?? native;
  const verticalScale = Math.sqrt((size.width / native.width) * (size.depth / native.depth));
  model.position.z = -size.depth / 2;
  model.scale.set(size.width / native.width, verticalScale, size.depth / native.depth);
  group.add(model);

  if (kind === "cave-wall") buildCaveWall(model);
  else if (kind === "castle-wall") buildCastleWall(model);
  else if (kind === "timber-wall") buildTimberWall(model);
  else if (kind === "cave-ceiling") buildCaveCeiling(model);
  else if (kind === "castle-ceiling") buildCastleCeiling(model);
  else buildTimberCeiling(model);

  return {
    mesh: group,
    placeAt(x, y, z) {
      group.position.set(x, y, z);
    },
    setFrame() {},
    update() {},
    dispose() {
      group.removeFromParent();
      disposeObject(group);
    },
  };
}
