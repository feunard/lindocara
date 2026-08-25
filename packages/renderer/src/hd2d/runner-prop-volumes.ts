import type { BuildingDimensions } from "@lindocara/engine/buildings.js";
import {
  type ElementOrientation,
  type ElementRotation,
  elementRotationDegrees,
} from "@lindocara/engine/element-orientation.js";
import * as THREE from "three";

import type { NativeStaticVisual } from "./building-volumes.js";

export type RunnerPropKind =
  | "spike-trap"
  | "push-trap"
  | "launch-trap"
  | "barricade"
  | "goblin-barricade"
  | "orc-barricade";

const PROP_HEIGHTS: Record<RunnerPropKind, number> = {
  "spike-trap": 0.56,
  "push-trap": 1.12,
  "launch-trap": 0.78,
  barricade: 1.48,
  "goblin-barricade": 0.94,
  "orc-barricade": 2.62,
};

const PROP_DIMENSIONS: Record<RunnerPropKind, BuildingDimensions> = {
  "spike-trap": { width: 1.5, depth: 1.5 },
  "push-trap": { width: 1.75, depth: 1.5 },
  "launch-trap": { width: 1.6, depth: 1.6 },
  barricade: { width: 2.75, depth: 1.125 },
  "goblin-barricade": { width: 2.5, depth: 1.05 },
  "orc-barricade": { width: 3.25, depth: 1.45 },
};

export function runnerPropHeight(kind: RunnerPropKind, dimensions?: BuildingDimensions): number {
  const native = PROP_DIMENSIONS[kind];
  const scale = dimensions
    ? Math.sqrt((dimensions.width / native.width) * (dimensions.depth / native.depth))
    : 1;
  return PROP_HEIGHTS[kind] * scale;
}

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

function outlined<T extends THREE.Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const ink = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 26),
    new THREE.LineBasicMaterial({ color: 0x172033, transparent: true, opacity: 0.9 }),
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

function beamBetween(
  root: THREE.Object3D,
  name: string,
  from: THREE.Vector3,
  to: THREE.Vector3,
  thickness: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = to.clone().sub(from);
  const mesh = outlined(
    new THREE.Mesh(new THREE.BoxGeometry(direction.length(), thickness, depth), material),
  );
  mesh.name = name;
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
  root.add(mesh);
  return mesh;
}

function fastener(
  root: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): void {
  const bolt = outlined(
    new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.045, 8), material),
  );
  bolt.name = "iron-fastener";
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(x, y, z);
  root.add(bolt);
}

function buildSpikeTrap(root: THREE.Group): void {
  const wood = new THREE.MeshLambertMaterial({ color: 0x92572f, flatShading: true });
  const woodEdge = new THREE.MeshLambertMaterial({ color: 0x60361f, flatShading: true });
  const iron = new THREE.MeshLambertMaterial({ color: 0xa9b4bd, flatShading: true });
  const ironDark = new THREE.MeshLambertMaterial({ color: 0x4d5964, flatShading: true });

  box(root, "trap-bed", [1.16, 0.06, 1.16], [0, 0.03, 0], ironDark);
  box(root, "trap-frame", [1.42, 0.16, 0.2], [0, 0.1, -0.61], wood);
  box(root, "trap-frame", [1.42, 0.16, 0.2], [0, 0.1, 0.61], wood);
  box(root, "trap-frame", [0.2, 0.16, 1.02], [-0.61, 0.1, 0], woodEdge);
  box(root, "trap-frame", [0.2, 0.16, 1.02], [0.61, 0.1, 0], woodEdge);

  const coordinates = [-0.38, 0, 0.38] as const;
  for (const x of coordinates) {
    for (const z of coordinates) {
      const spike = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.52, 6), iron));
      spike.name = "trap-spike";
      spike.position.set(x, 0.34, z);
      spike.rotation.y = (x - z) * 0.24;
      root.add(spike);
    }
  }
}

function buildPushTrap(root: THREE.Group): void {
  const wood = new THREE.MeshLambertMaterial({ color: 0x7e4d2c, flatShading: true });
  const iron = new THREE.MeshLambertMaterial({ color: 0x66737d, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd35c35, flatShading: true });
  box(root, "push-bed", [1.62, 0.12, 1.32], [0, 0.06, 0], wood);
  box(root, "push-rail", [0.15, 0.18, 1.18], [-0.68, 0.2, 0], iron);
  box(root, "push-rail", [0.15, 0.18, 1.18], [0.68, 0.2, 0], iron);
  for (const x of [-0.48, 0, 0.48]) {
    const spring = outlined(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 5, 8), iron));
    spring.name = "push-spring";
    spring.position.set(x, 0.34, -0.25);
    spring.rotation.x = Math.PI / 2;
    root.add(spring);
  }
  const plate = box(root, "push-plate", [1.35, 0.72, 0.16], [0, 0.62, 0.28], accent);
  plate.rotation.x = -0.16;
  for (const x of [-0.5, 0, 0.5]) fastener(root, x, 0.62, 0.375, iron);
  beamBetween(
    root,
    "push-trigger",
    new THREE.Vector3(-0.5, 0.17, -0.54),
    new THREE.Vector3(0.5, 0.17, -0.54),
    0.1,
    0.1,
    accent,
  );
}

function buildLaunchTrap(root: THREE.Group): void {
  const wood = new THREE.MeshLambertMaterial({ color: 0x80502d, flatShading: true });
  const iron = new THREE.MeshLambertMaterial({ color: 0x697681, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd9a83e, flatShading: true });
  box(root, "launch-bed", [1.48, 0.12, 1.48], [0, 0.06, 0], wood);
  const platform = outlined(
    new THREE.Mesh(new THREE.CylinderGeometry(0.59, 0.68, 0.12, 10), accent),
  );
  platform.name = "launch-platform";
  platform.position.y = 0.52;
  root.add(platform);
  for (const [x, z] of [
    [-0.45, -0.45],
    [0.45, -0.45],
    [-0.45, 0.45],
    [0.45, 0.45],
  ] as const) {
    const spring = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.42, 7), iron));
    spring.name = "launch-spring";
    spring.position.set(x, 0.29, z);
    root.add(spring);
  }
  for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const arrow = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 6), accent));
    arrow.name = "launch-arrow";
    arrow.rotation.z = Math.PI;
    arrow.rotation.y = rotation;
    arrow.position.set(Math.sin(rotation) * 0.78, 0.26, Math.cos(rotation) * 0.78);
    root.add(arrow);
  }
}

function buildBarricade(root: THREE.Group): void {
  const wood = new THREE.MeshLambertMaterial({ color: 0x91572f, flatShading: true });
  const woodLight = new THREE.MeshLambertMaterial({ color: 0xb47743, flatShading: true });
  const woodDark = new THREE.MeshLambertMaterial({ color: 0x5d351f, flatShading: true });
  const iron = new THREE.MeshLambertMaterial({ color: 0x8796a3, flatShading: true });

  for (const x of [-0.92, 0.92]) {
    box(root, "ground-skid", [0.25, 0.14, 1.08], [x, 0.07, 0.02], woodDark);
    box(root, "upright-post", [0.2, 1.24, 0.2], [x, 0.71, 0], wood);
    beamBetween(
      root,
      "rear-brace",
      new THREE.Vector3(x, 0.9, -0.04),
      new THREE.Vector3(x, 0.16, -0.48),
      0.16,
      0.16,
      woodDark,
    );
  }
  box(root, "ground-crossbar", [2.25, 0.16, 0.18], [0, 0.14, 0.08], woodDark);
  beamBetween(
    root,
    "crossed-plank",
    new THREE.Vector3(-1.27, 0.37, 0.1),
    new THREE.Vector3(1.27, 1.25, 0.1),
    0.27,
    0.15,
    woodLight,
  );
  beamBetween(
    root,
    "crossed-plank",
    new THREE.Vector3(1.27, 0.4, 0.16),
    new THREE.Vector3(-1.27, 1.2, 0.16),
    0.27,
    0.15,
    wood,
  );
  box(root, "barricade-plank", [2.68, 0.25, 0.15], [0, 0.77, 0.2], woodLight).rotation.z = -0.035;

  for (const [x, y] of [
    [-0.92, 0.72],
    [0, 0.77],
    [0.92, 0.8],
    [-0.46, 0.65],
    [0.46, 0.65],
  ] as const) {
    fastener(root, x, y, 0.295, iron);
  }
}

function buildGoblinBarricade(root: THREE.Group): void {
  const wood = new THREE.MeshLambertMaterial({ color: 0x655034, flatShading: true });
  const scrap = new THREE.MeshLambertMaterial({ color: 0x677066, flatShading: true });
  const rust = new THREE.MeshLambertMaterial({ color: 0xa94f2d, flatShading: true });
  box(root, "goblin-skid", [2.35, 0.12, 0.9], [0, 0.06, 0], wood);
  for (const [index, x] of [-1, -0.52, -0.05, 0.45, 0.95].entries()) {
    const height = index % 2 === 0 ? 0.82 : 0.64;
    const stake = box(
      root,
      "goblin-scrap-stake",
      [0.28, height, 0.18],
      [x, height / 2, 0],
      index % 3 === 0 ? rust : scrap,
    );
    stake.rotation.z = (index - 2) * 0.055;
  }
  beamBetween(
    root,
    "goblin-lashed-plank",
    new THREE.Vector3(-1.18, 0.26, 0.13),
    new THREE.Vector3(1.18, 0.72, 0.13),
    0.18,
    0.16,
    wood,
  );
}

function buildOrcBarricade(root: THREE.Group): void {
  const wood = new THREE.MeshLambertMaterial({ color: 0x4f3324, flatShading: true });
  const iron = new THREE.MeshLambertMaterial({ color: 0x4e565c, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0x812e26, flatShading: true });
  for (const x of [-1.34, -0.67, 0, 0.67, 1.34]) {
    const post = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 2.2, 7), wood));
    post.name = "orc-log-post";
    post.position.set(x, 1.1, 0);
    root.add(post);
    const spike = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.58, 7), iron));
    spike.name = "orc-iron-spike";
    spike.position.set(x, 2.48, 0);
    root.add(spike);
  }
  box(root, "orc-crossbeam", [3.18, 0.34, 0.34], [0, 0.72, 0.04], iron);
  box(root, "orc-crossbeam", [3.18, 0.3, 0.32], [0, 1.54, 0.04], red);
  for (const x of [-1.34, -0.67, 0, 0.67, 1.34]) fastener(root, x, 1.54, 0.23, iron);
  beamBetween(
    root,
    "orc-ground-brace",
    new THREE.Vector3(-1.5, 0.12, -0.58),
    new THREE.Vector3(-0.95, 1.35, 0),
    0.22,
    0.24,
    wood,
  );
  beamBetween(
    root,
    "orc-ground-brace",
    new THREE.Vector3(1.5, 0.12, -0.58),
    new THREE.Vector3(0.95, 1.35, 0),
    0.22,
    0.24,
    wood,
  );
}

/** A native low-poly prop: every face occupies world space, receives the scene light and remains
 * stable while the HD-2D camera orbits. The authored point is the centre of its ground contact. */
export function makeRunnerPropVolume(
  kind: RunnerPropKind,
  orientation: ElementOrientation = 0,
  rotation?: ElementRotation,
  dimensions?: BuildingDimensions,
): NativeStaticVisual {
  const group = new THREE.Group();
  group.name = `runner-prop-${kind}`;
  group.rotation.y = THREE.MathUtils.degToRad(
    -elementRotationDegrees({ orientation, ...(rotation === undefined ? {} : { rotation }) }),
  );
  const model = new THREE.Group();
  model.name = `runner-prop-${kind}-model`;
  const native = PROP_DIMENSIONS[kind];
  const size = dimensions ?? native;
  const verticalScale = Math.sqrt((size.width / native.width) * (size.depth / native.depth));
  model.position.z = -size.depth / 2;
  model.scale.set(size.width / native.width, verticalScale, size.depth / native.depth);
  group.add(model);
  switch (kind) {
    case "spike-trap":
      buildSpikeTrap(model);
      break;
    case "push-trap":
      buildPushTrap(model);
      break;
    case "launch-trap":
      buildLaunchTrap(model);
      break;
    case "barricade":
      buildBarricade(model);
      break;
    case "goblin-barricade":
      buildGoblinBarricade(model);
      break;
    case "orc-barricade":
      buildOrcBarricade(model);
      break;
  }

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
