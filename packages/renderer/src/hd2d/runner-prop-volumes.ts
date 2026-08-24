import {
  type ElementOrientation,
  type ElementRotation,
  elementRotationDegrees,
} from "@lindocara/engine/element-orientation.js";
import * as THREE from "three";

import type { NativeStaticVisual } from "./building-volumes.js";

export type RunnerPropKind = "spike-trap" | "barricade";

const PROP_HEIGHTS: Record<RunnerPropKind, number> = {
  "spike-trap": 0.56,
  barricade: 1.48,
};

export function runnerPropHeight(kind: RunnerPropKind): number {
  return PROP_HEIGHTS[kind];
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

/** A native low-poly prop: every face occupies world space, receives the scene light and remains
 * stable while the HD-2D camera orbits. The authored point is the centre of its ground contact. */
export function makeRunnerPropVolume(
  kind: RunnerPropKind,
  orientation: ElementOrientation = 0,
  rotation?: ElementRotation,
): NativeStaticVisual {
  const group = new THREE.Group();
  group.name = `runner-prop-${kind}`;
  group.rotation.y = THREE.MathUtils.degToRad(
    -elementRotationDegrees({ orientation, ...(rotation === undefined ? {} : { rotation }) }),
  );
  if (kind === "spike-trap") buildSpikeTrap(group);
  else buildBarricade(group);

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
