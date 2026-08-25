import type { BuildingFaction, BuildingVolumeDimensions } from "@lindocara/engine/buildings.js";
import type { FactionBuildingArchetype } from "@lindocara/engine/faction-buildings.js";
import * as THREE from "three";

import { buildGoblinBuildingVolume } from "./goblin-building-volumes.js";

/**
 * The non-human packs deliberately do not share a generic hall. Each entry below is its own
 * composition made from the textures and low-poly primitives already shipped by Lindocara. The
 * faction gives the architectural language; the archetype chooses one unmistakable silhouette.
 */

export interface FactionBuildingMaterials {
  wall: THREE.Material;
  stone: THREE.Material;
  stoneShade: THREE.Material;
  wood: THREE.Material;
  deck: THREE.Material;
  outline: THREE.Material;
  blue: THREE.Material;
  roof: THREE.Material;
  window: THREE.Material;
  canvas: THREE.Material;
  metal: THREE.Material;
  accent: THREE.Material;
  bone: THREE.Material;
  cloth: THREE.Material;
  foliage: THREE.Material;
  factionPrimary?: THREE.Texture | undefined;
  factionDetail?: THREE.Texture | undefined;
}

type NonHumanFaction = Exclude<BuildingFaction, "human">;
type Point3 = readonly [number, number, number];
type Size3 = readonly [number, number, number];

export const FACTION_BUILDING_DESIGN_NAMES = {
  goblin: {
    "housing-a": "crooked-hut",
    "housing-b": "fungus-burrow",
    "command-a": "boss-den",
    "command-b": "scrap-keep",
    "training-a": "stab-yard",
    "training-b": "sling-range",
    "community-a": "feast-shack",
    "community-b": "shaman-hollow",
    "daily-life-a": "tinker-shed",
    "daily-life-b": "scavenger-store",
  },
  "orc-troll": {
    "housing-a": "orc-longhouse",
    "housing-b": "troll-rock-hut",
    "command-a": "warchief-hall",
    "command-b": "skull-fort",
    "training-a": "war-pit",
    "training-b": "boulder-range",
    "community-a": "clan-hearth",
    "community-b": "smoke-lodge",
    "daily-life-a": "war-forge",
    "daily-life-b": "beast-pen",
  },
  beastfolk: {
    "housing-a": "hide-lodge",
    "housing-b": "elevated-nest",
    "command-a": "totem-hall",
    "command-b": "moon-den",
    "training-a": "hunter-ring",
    "training-b": "claw-yard",
    "community-a": "communal-hollow",
    "community-b": "healer-hut",
    "daily-life-a": "tannery",
    "daily-life-b": "gatherer-store",
  },
  "wild-tribe": {
    "housing-a": "reed-hut",
    "housing-b": "hide-tent",
    "command-a": "ancestor-hall",
    "command-b": "bone-tower",
    "training-a": "spear-circle",
    "training-b": "trial-pit",
    "community-a": "fire-lodge",
    "community-b": "spirit-hut",
    "daily-life-a": "drying-house",
    "daily-life-b": "craft-shelter",
  },
} as const satisfies Record<NonHumanFaction, Record<FactionBuildingArchetype, string>>;

function outlined<T extends THREE.Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const ink = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 24),
    new THREE.LineBasicMaterial({ color: 0x161c2e, transparent: true, opacity: 0.92 }),
  );
  ink.name = "ink-outline";
  ink.renderOrder = 3;
  mesh.add(ink);
  return mesh;
}

function part(
  root: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  at: Point3,
  rotation: Point3 = [0, 0, 0],
): THREE.Mesh {
  const value = outlined(new THREE.Mesh(geometry, material));
  value.name = name;
  value.position.set(...at);
  value.rotation.set(...rotation);
  root.add(value);
  return value;
}

function box(
  root: THREE.Object3D,
  name: string,
  size: Size3,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
): THREE.Mesh {
  return part(root, name, new THREE.BoxGeometry(...size), material, at, rotation);
}

function cylinder(
  root: THREE.Object3D,
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  segments = 10,
): THREE.Mesh {
  return part(
    root,
    name,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    at,
  );
}

function cone(
  root: THREE.Object3D,
  name: string,
  radius: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
  segments = 9,
): THREE.Mesh {
  return part(root, name, new THREE.ConeGeometry(radius, height, segments), material, at, rotation);
}

function sphere(
  root: THREE.Object3D,
  name: string,
  radius: number,
  scale: Point3,
  at: Point3,
  material: THREE.Material,
  segments = 10,
): THREE.Mesh {
  const value = part(
    root,
    name,
    new THREE.SphereGeometry(radius, segments, Math.max(6, Math.floor(segments * 0.7))),
    material,
    at,
  );
  value.scale.set(...scale);
  return value;
}

function torus(
  root: THREE.Object3D,
  name: string,
  radius: number,
  tube: number,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [Math.PI / 2, 0, 0],
): THREE.Mesh {
  return part(root, name, new THREE.TorusGeometry(radius, tube, 7, 16), material, at, rotation);
}

function beam(
  root: THREE.Object3D,
  name: string,
  from: Point3,
  to: Point3,
  thickness: number,
  material: THREE.Material,
  segments = 7,
): THREE.Mesh {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const value = outlined(
    new THREE.Mesh(
      new THREE.CylinderGeometry(thickness, thickness * 1.08, direction.length(), segments),
      material,
    ),
  );
  value.name = name;
  value.position.copy(start).add(end).multiplyScalar(0.5);
  value.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  root.add(value);
  return value;
}

function gableRoof(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  baseY: number,
  height: number,
  material: THREE.Material,
  tilt = 0,
  trim: THREE.Material = material,
): void {
  const half = width / 2 + 0.14;
  const slope = Math.hypot(half, height);
  const angle = Math.atan2(height, half);
  const holder = new THREE.Group();
  holder.name = name;
  holder.rotation.z = tilt;
  root.add(holder);
  for (const side of [-1, 1]) {
    box(
      holder,
      `${name}-slope`,
      [slope, 0.11, depth + 0.28],
      [(side * half) / 2, baseY + height / 2, 0],
      material,
      [0, 0, side * -angle],
    );
  }
  const ridge = cylinder(
    holder,
    `${name}-ridge`,
    0.055,
    0.055,
    depth + 0.38,
    [0, baseY + height + 0.04, 0],
    trim,
    8,
  );
  ridge.rotation.x = Math.PI / 2;
  for (const z of [-depth / 2 - 0.15, depth / 2 + 0.15]) {
    beam(holder, `${name}-fascia`, [-half, baseY, z], [0, baseY + height, z], 0.045, trim);
    beam(holder, `${name}-fascia`, [half, baseY, z], [0, baseY + height, z], 0.045, trim);
  }
}

function leanRoof(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  y: number,
  material: THREE.Material,
  pitch = 0.18,
  trim: THREE.Material = material,
): void {
  const holder = new THREE.Group();
  holder.name = name;
  root.add(holder);
  box(holder, `${name}-panel`, [width, 0.11, depth], [0, y, 0], material, [0, 0, pitch]);
  for (const x of [-width / 2, width / 2]) {
    box(
      holder,
      `${name}-edge`,
      [0.065, 0.08, depth + 0.08],
      [x, y + x * Math.tan(pitch), 0],
      trim,
      [0, 0, pitch],
    );
  }
  for (const z of [-depth / 2, depth / 2]) {
    box(holder, `${name}-edge`, [width + 0.08, 0.065, 0.065], [0, y, z], trim, [0, 0, pitch]);
  }
}

function door(
  root: THREE.Object3D,
  x: number,
  z: number,
  height: number,
  width: number,
  m: FactionBuildingMaterials,
  name = "faction-door",
): void {
  box(root, `${name}-shadow`, [width + 0.14, height + 0.12, 0.08], [x, height / 2, z], m.outline);
  box(root, name, [width, height, 0.12], [x, height / 2, z + 0.05], m.blue);
  for (const offset of [-0.28, 0, 0.28]) {
    box(
      root,
      `${name}-plank`,
      [0.025, height * 0.88, 0.025],
      [x + offset * width, height / 2, z + 0.12],
      m.outline,
    );
  }
  for (const side of [-1, 1]) {
    box(
      root,
      `${name}-jamb`,
      [0.09, height + 0.18, 0.12],
      [x + side * (width / 2 + 0.055), height / 2, z + 0.08],
      m.wood,
    );
  }
  box(root, `${name}-lintel`, [width + 0.28, 0.11, 0.13], [x, height + 0.08, z + 0.08], m.wood);
  box(root, `${name}-threshold`, [width + 0.24, 0.1, 0.24], [x, 0.05, z + 0.08], m.stoneShade);
  for (const y of [height * 0.3, height * 0.68]) {
    box(
      root,
      `${name}-hinge`,
      [width * 0.42, 0.045, 0.035],
      [x - width * 0.22, y, z + 0.14],
      m.metal,
    );
  }
  torus(
    root,
    `${name}-handle`,
    0.045,
    0.014,
    [x + width * 0.27, height * 0.46, z + 0.15],
    m.metal,
    [0, 0, 0],
  );
}

function windowPart(
  root: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  m: FactionBuildingMaterials,
  scale = 1,
): void {
  box(root, "faction-window", [0.38 * scale, 0.44 * scale, 0.07], [x, y, z], m.window);
  box(root, "window-crossbar", [0.47 * scale, 0.055, 0.08], [x, y, z + 0.04], m.wood);
  box(root, "window-crossbar", [0.055, 0.52 * scale, 0.08], [x, y, z + 0.04], m.wood);
}

function banner(
  root: THREE.Object3D,
  x: number,
  z: number,
  height: number,
  m: FactionBuildingMaterials,
  wide = 0.42,
): void {
  cylinder(root, "banner-pole", 0.045, 0.055, height, [x, height / 2, z], m.wood, 7);
  box(
    root,
    "banner-crossbar",
    [wide * 1.25, 0.055, 0.055],
    [x + wide * 0.35, height * 0.92, z],
    m.wood,
  );
  box(
    root,
    "war-banner",
    [wide, height * 0.42, 0.045],
    [x + wide * 0.46, height * 0.7, z],
    m.cloth,
  );
  spike(root, "banner-finial", [x, height + 0.14, z], 0.28, m);
  for (const side of [-1, 1]) {
    cone(
      root,
      "banner-tail",
      wide * 0.14,
      height * 0.2,
      [x + wide * (0.24 + side * 0.17), height * 0.44, z],
      m.cloth,
      [0, 0, Math.PI],
      5,
    );
  }
}

function spike(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  height: number,
  m: FactionBuildingMaterials,
  rotation: Point3 = [0, 0, 0],
): void {
  cone(root, name, height * 0.1, height, at, m.bone, rotation, 7);
}

function weaponSpear(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  m: FactionBuildingMaterials,
  lean = 0,
): void {
  const holder = new THREE.Group();
  holder.name = name;
  holder.position.set(x, 0, z);
  holder.rotation.z = lean;
  root.add(holder);
  cylinder(holder, `${name}-shaft`, 0.035, 0.045, height * 0.82, [0, height * 0.41, 0], m.wood, 7);
  cone(holder, `${name}-head`, 0.1, height * 0.22, [0, height * 0.91, 0], m.metal, [0, 0, 0], 6);
  torus(holder, `${name}-binding`, 0.055, 0.016, [0, height * 0.8, 0], m.cloth);
}

function boulder(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  radius: number,
  m: FactionBuildingMaterials,
): void {
  sphere(root, name, radius, [1, 0.82, 0.94], at, m.stoneShade, 7);
}

function barrel(
  root: THREE.Object3D,
  x: number,
  z: number,
  scale: number,
  m: FactionBuildingMaterials,
): void {
  cylinder(
    root,
    "storage-barrel",
    0.18 * scale,
    0.21 * scale,
    0.42 * scale,
    [x, 0.21 * scale, z],
    m.wood,
    9,
  );
  for (const y of [0.1, 0.32]) {
    cylinder(
      root,
      "barrel-band",
      0.215 * scale,
      0.215 * scale,
      0.04,
      [x, y * scale, z],
      m.metal,
      9,
    );
  }
}

function crate(
  root: THREE.Object3D,
  x: number,
  z: number,
  scale: number,
  m: FactionBuildingMaterials,
): void {
  box(
    root,
    "storage-crate",
    [0.46 * scale, 0.42 * scale, 0.46 * scale],
    [x, 0.21 * scale, z],
    m.deck,
  );
  box(
    root,
    "crate-brace",
    [0.52 * scale, 0.07, 0.05],
    [x, 0.21 * scale, z + 0.255 * scale],
    m.wood,
    [0, 0, 0.65],
  );
  box(
    root,
    "crate-brace",
    [0.52 * scale, 0.07, 0.05],
    [x, 0.21 * scale, z + 0.26 * scale],
    m.wood,
    [0, 0, -0.65],
  );
  for (const side of [-1, 1]) {
    box(
      root,
      "crate-corner",
      [0.055, 0.46 * scale, 0.055],
      [x + side * 0.21 * scale, 0.23 * scale, z + 0.26 * scale],
      m.metal,
    );
  }
}

function target(
  root: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  m: FactionBuildingMaterials,
): void {
  const disc = cylinder(root, "training-target", 0.28, 0.28, 0.07, [x, y, z], m.canvas, 14);
  disc.rotation.x = Math.PI / 2;
  torus(root, "target-ring", 0.18, 0.026, [x, y, z + 0.05], m.accent, [0, 0, 0]);
  beam(root, "target-post", [x, 0, z], [x, y - 0.23, z], 0.055, m.wood);
}

function fire(
  root: THREE.Object3D,
  x: number,
  z: number,
  scale: number,
  m: FactionBuildingMaterials,
): void {
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    boulder(
      root,
      "hearth-stone",
      [x + Math.sin(angle) * 0.32 * scale, 0.1, z + Math.cos(angle) * 0.32 * scale],
      0.12 * scale,
      m,
    );
  }
  for (const angle of [-0.55, 0.55]) {
    box(root, "hearth-log", [0.75 * scale, 0.11, 0.11], [x, 0.17, z], m.wood, [0, angle, 0]);
  }
  cone(
    root,
    "stylized-fire",
    0.23 * scale,
    0.62 * scale,
    [x, 0.42 * scale, z],
    m.accent,
    [0, 0, 0],
    7,
  );
}

function totem(
  root: THREE.Object3D,
  x: number,
  z: number,
  height: number,
  m: FactionBuildingMaterials,
  name = "ritual-totem",
): void {
  cylinder(root, name, 0.08, 0.13, height, [x, height / 2, z], m.wood, 7);
  box(root, `${name}-mask`, [0.36, 0.42, 0.16], [x, height * 0.68, z + 0.06], m.accent);
  for (const eye of [-1, 1]) {
    sphere(
      root,
      `${name}-eye`,
      0.045,
      [1, 1, 0.55],
      [x + eye * 0.09, height * 0.73, z + 0.15],
      m.outline,
      7,
    );
  }
  for (const y of [height * 0.28, height * 0.5]) {
    torus(root, `${name}-binding`, 0.15, 0.022, [x, y, z], m.cloth);
  }
  for (const tooth of [-1, 0, 1]) {
    cone(
      root,
      `${name}-tooth`,
      0.035,
      0.13,
      [x + tooth * 0.075, height * 0.58, z + 0.17],
      m.bone,
      [0, 0, Math.PI],
      5,
    );
  }
  for (const side of [-1, 1]) {
    spike(root, `${name}-horn`, [x + side * 0.25, height * 0.78, z + 0.05], 0.38, m, [
      0,
      0,
      side * -1.08,
    ]);
  }
}

function antlerArch(
  root: THREE.Object3D,
  x: number,
  z: number,
  width: number,
  height: number,
  m: FactionBuildingMaterials,
  name = "antler-arch",
): void {
  for (const side of [-1, 1]) {
    beam(
      root,
      name,
      [x + side * width * 0.48, 0, z],
      [x + side * width * 0.18, height, z],
      0.065,
      m.bone,
    );
    beam(
      root,
      `${name}-branch`,
      [x + side * width * 0.28, height * 0.55, z],
      [x + side * width * 0.48, height * 0.82, z],
      0.045,
      m.bone,
    );
    beam(
      root,
      `${name}-tine`,
      [x + side * width * 0.2, height * 0.76, z],
      [x + side * width * 0.06, height * 1.08, z],
      0.04,
      m.bone,
    );
  }
}

function fenceRun(
  root: THREE.Object3D,
  from: readonly [number, number],
  to: readonly [number, number],
  height: number,
  count: number,
  m: FactionBuildingMaterials,
  name = "fence-post",
): void {
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0 : index / (count - 1);
    const x = THREE.MathUtils.lerp(from[0], to[0], t);
    const z = THREE.MathUtils.lerp(from[1], to[1], t);
    cylinder(root, name, 0.06, 0.09, height, [x, height / 2, z], m.wood, 7);
    spike(root, `${name}-tip`, [x, height + 0.12, z], 0.24, m);
    torus(root, `${name}-binding`, 0.095, 0.018, [x, height * 0.48, z], m.cloth);
  }
  beam(
    root,
    `${name}-rail`,
    [from[0], height * 0.45, from[1]],
    [to[0], height * 0.45, to[1]],
    0.055,
    m.wood,
  );
}

function ringPosts(
  root: THREE.Object3D,
  radiusX: number,
  radiusZ: number,
  count: number,
  height: number,
  m: FactionBuildingMaterials,
  name: string,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const x = Math.sin(angle) * radiusX;
    const z = Math.cos(angle) * radiusZ;
    cylinder(
      root,
      name,
      0.06,
      0.095,
      height * (0.88 + (index % 3) * 0.06),
      [x, height / 2, z],
      m.wood,
      7,
    );
    torus(root, `${name}-binding`, 0.095, 0.018, [x, height * 0.54, z], m.cloth);
  }
}

function roofedBox(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  wallHeight: number,
  roofHeight: number,
  m: FactionBuildingMaterials,
  wallMaterial: THREE.Material = m.wall,
  tilt = 0,
): THREE.Group {
  const volume = new THREE.Group();
  volume.name = `${name}-volume`;
  root.add(volume);
  box(volume, `${name}-foundation`, [width + 0.12, 0.16, depth + 0.12], [0, 0.08, 0], m.stoneShade);
  box(volume, `${name}-shell`, [width, wallHeight, depth], [0, wallHeight / 2, 0], wallMaterial);
  for (const x of [-width / 2 + 0.06, width / 2 - 0.06]) {
    for (const z of [-depth / 2 - 0.035, depth / 2 + 0.035]) {
      box(volume, `${name}-corner-post`, [0.11, wallHeight, 0.11], [x, wallHeight / 2, z], m.wood);
    }
  }
  for (const z of [-depth / 2 - 0.04, depth / 2 + 0.04]) {
    box(volume, `${name}-wall-band`, [width, 0.1, 0.08], [0, wallHeight * 0.68, z], m.wood);
  }
  gableRoof(volume, `${name}-roof`, width, depth, wallHeight, roofHeight, m.roof, tilt, m.wood);
  return volume;
}

function orcLonghouse(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  roofedBox(
    root,
    "orc-longhouse",
    s.width * 0.96,
    s.depth * 0.76,
    s.wallHeight * 0.8,
    s.roofHeight,
    m,
    m.stoneShade,
  );
  for (const x of [-s.width * 0.43, -s.width * 0.22, 0, s.width * 0.22, s.width * 0.43]) {
    beam(
      root,
      "longhouse-rib-left",
      [x, 0, -s.depth * 0.36],
      [x, s.wallHeight + s.roofHeight * 0.72, 0],
      0.085,
      m.wood,
    );
    beam(
      root,
      "longhouse-rib-right",
      [x, 0, s.depth * 0.36],
      [x, s.wallHeight + s.roofHeight * 0.72, 0],
      0.085,
      m.wood,
    );
  }
  door(root, 0, s.depth * 0.39, s.wallHeight * 0.72, 0.72, m, "longhouse-gate");
  for (const side of [-1, 1])
    spike(
      root,
      "longhouse-horn",
      [side * 0.28, s.wallHeight + s.roofHeight * 0.95, s.depth * 0.37],
      0.65,
      m,
      [Math.PI / 2, 0, side * 0.5],
    );
}

function orcTrollRockHut(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.38;
  sphere(
    root,
    "troll-rock-dome",
    radius,
    [1.18, 0.9, 1.08],
    [0, s.wallHeight * 0.48, 0],
    m.stone,
    8,
  );
  for (let ring = 0; ring < 3; ring += 1) {
    const count = 7 - ring;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + ring * 0.24;
      boulder(
        root,
        "troll-masonry-boulder",
        [
          Math.sin(angle) * radius * (0.9 - ring * 0.18),
          0.28 + ring * 0.35,
          Math.cos(angle) * radius * (0.9 - ring * 0.18),
        ],
        0.27 - ring * 0.035,
        m,
      );
    }
  }
  door(root, 0, radius * 0.98, s.wallHeight * 0.58, 0.56, m, "troll-stone-door");
  cylinder(
    root,
    "rock-hut-smoke-pipe",
    0.15,
    0.19,
    s.roofHeight * 0.82,
    [-radius * 0.42, s.wallHeight + s.roofHeight * 0.25, -radius * 0.2],
    m.metal,
    7,
  );
}

function orcWarchiefHall(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(
    root,
    "warchief-great-hall",
    [s.width * 0.84, s.wallHeight * 0.72, s.depth * 0.78],
    [0, s.wallHeight * 0.36, 0],
    m.stoneShade,
  );
  gableRoof(
    root,
    "warchief-a-frame",
    s.width * 0.95,
    s.depth * 0.9,
    s.wallHeight * 0.72,
    s.roofHeight * 1.2,
    m.roof,
  );
  for (const x of [-s.width * 0.42, s.width * 0.42]) {
    cylinder(
      root,
      "great-hall-column",
      0.13,
      0.19,
      s.wallHeight * 1.05,
      [x, s.wallHeight * 0.52, s.depth * 0.36],
      m.wood,
      8,
    );
    banner(root, x, s.depth * 0.42, s.wallHeight + s.roofHeight * 0.8, m, 0.55);
  }
  door(root, 0, s.depth * 0.41, s.wallHeight * 0.78, 0.95, m, "warchief-gate");
  antlerArch(
    root,
    0,
    s.depth * 0.48,
    s.width * 0.34,
    s.wallHeight + s.roofHeight * 0.8,
    m,
    "warchief-horn-crown",
  );
  box(root, "warchief-stair", [s.width * 0.34, 0.18, 0.42], [0, 0.09, s.depth * 0.53], m.stone);
}

function orcSkullFort(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(
    root,
    "skull-fort-core",
    [s.width * 0.72, s.wallHeight * 0.76, s.depth * 0.72],
    [0, s.wallHeight * 0.38, 0],
    m.stone,
  );
  for (const x of [-s.width * 0.38, s.width * 0.38])
    for (const z of [-s.depth * 0.35, s.depth * 0.35]) {
      cylinder(
        root,
        "skull-fort-tower",
        s.width * 0.13,
        s.width * 0.15,
        s.wallHeight * 0.92,
        [x, s.wallHeight * 0.46, z],
        m.stoneShade,
        8,
      );
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2;
        spike(
          root,
          "tower-crown-spike",
          [
            x + Math.sin(angle) * s.width * 0.13,
            s.wallHeight + 0.18,
            z + Math.cos(angle) * s.width * 0.13,
          ],
          0.48,
          m,
        );
      }
    }
  door(root, 0, s.depth * 0.38, s.wallHeight * 0.62, 0.82, m, "skull-fort-gate");
  sphere(
    root,
    "gate-skull",
    0.28,
    [1, 0.82, 0.55],
    [0, s.wallHeight * 0.78, s.depth * 0.43],
    m.bone,
    8,
  );
  for (const x of [-0.11, 0.11])
    sphere(
      root,
      "skull-eye",
      0.055,
      [1, 1, 0.5],
      [x, s.wallHeight * 0.82, s.depth * 0.57],
      m.outline,
      6,
    );
  box(
    root,
    "fort-rampart",
    [s.width * 0.78, 0.2, s.depth * 0.78],
    [0, s.wallHeight * 0.8, 0],
    m.metal,
  );
}

function orcWarPit(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  torus(
    root,
    "war-pit-stone-ring",
    Math.min(s.width, s.depth) * 0.34,
    0.18,
    [0, 0.13, 0],
    m.stoneShade,
  );
  ringPosts(root, s.width * 0.43, s.depth * 0.42, 12, s.wallHeight * 0.7, m, "war-pit-post");
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = Math.sin(angle) * s.width * 0.3;
    const z = Math.cos(angle) * s.depth * 0.3;
    weaponSpear(root, "pit-weapon", x, z, 1.08, m, Math.sin(angle) * 0.14);
  }
  box(
    root,
    "spectator-platform",
    [s.width * 0.38, 0.16, s.depth * 0.28],
    [-s.width * 0.28, 0.42, -s.depth * 0.34],
    m.deck,
  );
  banner(root, -s.width * 0.42, -s.depth * 0.4, s.wallHeight + s.roofHeight * 0.65, m);
  banner(root, s.width * 0.42, -s.depth * 0.4, s.wallHeight + s.roofHeight * 0.65, m);
}

function orcBoulderRange(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(
    root,
    "boulder-ramp",
    [s.width * 0.38, 0.18, s.depth * 0.86],
    [-s.width * 0.2, s.wallHeight * 0.38, 0],
    m.deck,
    [-0.34, 0, 0],
  );
  for (const x of [-s.width * 0.38, -s.width * 0.02]) {
    beam(
      root,
      "boulder-ramp-rail",
      [x, 0.08, s.depth * 0.42],
      [x + s.width * 0.27, s.wallHeight * 0.72, -s.depth * 0.42],
      0.045,
      m.metal,
    );
  }
  for (const z of [-s.depth * 0.18, s.depth * 0.08, s.depth * 0.34]) {
    box(root, "range-distance-marker", [0.09, 0.52, 0.09], [s.width * 0.06, 0.26, z], m.wood);
    box(root, "range-distance-flag", [0.28, 0.2, 0.04], [s.width * 0.14, 0.42, z], m.cloth);
  }
  for (const [x, z, scale] of [
    [-0.24, 0.25, 0.3],
    [0.22, 0.18, 0.38],
    [0.28, -0.28, 0.27],
    [-0.05, -0.3, 0.22],
  ] as const)
    boulder(root, "range-boulder", [s.width * x, scale, s.depth * z], scale, m);
  box(
    root,
    "boulder-catch-wall",
    [s.width * 0.9, s.wallHeight * 0.72, 0.22],
    [0, s.wallHeight * 0.36, -s.depth * 0.42],
    m.stone,
  );
  for (const x of [-s.width * 0.36, 0, s.width * 0.36])
    spike(root, "catch-wall-spike", [x, s.wallHeight * 0.92, -s.depth * 0.42], 0.55, m);
  cylinder(
    root,
    "range-watch-post",
    0.3,
    0.34,
    s.wallHeight * 0.92,
    [s.width * 0.36, s.wallHeight * 0.46, s.depth * 0.25],
    m.stoneShade,
    8,
  );
  banner(root, s.width * 0.36, s.depth * 0.25, s.wallHeight + s.roofHeight, m, 0.35);
  torus(
    root,
    "boulder-hoist-wheel",
    0.26,
    0.055,
    [s.width * 0.36, s.wallHeight * 0.72, s.depth * 0.55],
    m.metal,
    [0, 0, 0],
  );
  beam(
    root,
    "boulder-hoist-arm",
    [s.width * 0.36, s.wallHeight * 0.55, s.depth * 0.25],
    [s.width * 0.36, s.wallHeight * 1.05, s.depth * 0.52],
    0.065,
    m.wood,
  );
}

function orcClanHearth(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.4;
  cylinder(
    root,
    "clan-roundhouse",
    radius * 0.94,
    radius,
    s.wallHeight * 0.72,
    [0, s.wallHeight * 0.36, 0],
    m.stoneShade,
    12,
  );
  torus(root, "roundhouse-log-ring", radius * 0.97, 0.09, [0, s.wallHeight * 0.48, 0], m.wood);
  cone(
    root,
    "clan-hearth-roof",
    radius * 1.12,
    s.roofHeight,
    [0, s.wallHeight * 0.72 + s.roofHeight / 2, 0],
    m.roof,
    [0, 0, 0],
    12,
  );
  cylinder(
    root,
    "central-smoke-stack",
    0.18,
    0.24,
    s.roofHeight * 1.15,
    [0, s.wallHeight + s.roofHeight * 0.72, 0],
    m.metal,
    8,
  );
  door(root, 0, radius + 0.05, s.wallHeight * 0.58, 0.7, m, "clan-hearth-door");
  for (const angle of [-0.7, 0, 0.7])
    box(
      root,
      "clan-bench",
      [0.75, 0.15, 0.28],
      [Math.sin(angle) * radius * 0.7, 0.28, Math.cos(angle) * radius * 0.7],
      m.deck,
      [0, angle, 0],
    );
}

function orcSmokeLodge(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.38;
  sphere(
    root,
    "smoke-lodge-dome",
    radius,
    [1.08, 0.82, 1.08],
    [0, s.wallHeight * 0.48, 0],
    m.stoneShade,
    10,
  );
  for (const [x, z, height] of [
    [-0.42, -0.18, 1],
    [0.35, -0.24, 0.78],
    [0.08, 0.05, 1.18],
  ] as const) {
    cylinder(
      root,
      "smoke-chimney",
      0.12,
      0.18,
      s.roofHeight * height,
      [s.width * x, s.wallHeight + s.roofHeight * height * 0.35, s.depth * z],
      m.metal,
      7,
    );
    cylinder(
      root,
      "chimney-cap",
      0.2,
      0.2,
      0.08,
      [s.width * x, s.wallHeight + s.roofHeight * height * 0.82, s.depth * z],
      m.outline,
      7,
    );
  }
  door(root, 0, radius * 1.02, s.wallHeight * 0.6, 0.62, m, "smoke-lodge-door");
  for (let index = 0; index < 6; index += 1)
    boulder(
      root,
      "smoke-lodge-foundation",
      [
        Math.sin((index / 6) * Math.PI * 2) * radius,
        0.16,
        Math.cos((index / 6) * Math.PI * 2) * radius,
      ],
      0.18,
      m,
    );
}

function orcWarForge(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(
    root,
    "forge-stone-shop",
    [s.width * 0.55, s.wallHeight * 0.82, s.depth * 0.78],
    [-s.width * 0.2, s.wallHeight * 0.41, 0],
    m.stone,
  );
  leanRoof(
    root,
    "forge-iron-roof",
    s.width * 0.64,
    s.depth * 0.88,
    s.wallHeight * 0.92,
    m.metal,
    0.18,
    m.wood,
  );
  root.getObjectByName("forge-iron-roof")?.position.setX(-s.width * 0.18);
  box(
    root,
    "open-forge-bay-floor",
    [s.width * 0.34, 0.14, s.depth * 0.72],
    [s.width * 0.3, 0.07, 0],
    m.stoneShade,
  );
  box(
    root,
    "forge-furnace-back",
    [s.width * 0.3, s.wallHeight * 0.62, 0.16],
    [s.width * 0.3, s.wallHeight * 0.31, -s.depth * 0.32],
    m.stone,
  );
  box(
    root,
    "forge-furnace-mouth",
    [s.width * 0.16, s.wallHeight * 0.3, 0.08],
    [s.width * 0.3, s.wallHeight * 0.25, -s.depth * 0.22],
    m.accent,
  );
  for (const x of [s.width * 0.16, s.width * 0.44]) {
    for (const z of [-s.depth * 0.28, s.depth * 0.28]) {
      beam(root, "forge-bay-post", [x, 0, z], [x, s.wallHeight * 0.76, z], 0.065, m.wood);
    }
  }
  leanRoof(
    root,
    "forge-bay-canopy",
    s.width * 0.38,
    s.depth * 0.76,
    s.wallHeight * 0.82,
    m.roof,
    -0.12,
    m.metal,
  );
  root.getObjectByName("forge-bay-canopy")?.position.setX(s.width * 0.3);
  fire(root, s.width * 0.28, -s.depth * 0.12, 0.75, m);
  for (const x of [-s.width * 0.28, 0, s.width * 0.27])
    cylinder(
      root,
      "forge-smokestack",
      0.12,
      0.18,
      s.wallHeight * (0.75 + x / s.width),
      [x, s.wallHeight + 0.2, -s.depth * 0.22],
      m.metal,
      7,
    );
  box(root, "forge-anvil", [0.6, 0.2, 0.28], [s.width * 0.24, 0.55, s.depth * 0.26], m.metal);
  box(root, "anvil-base", [0.22, 0.44, 0.22], [s.width * 0.24, 0.28, s.depth * 0.26], m.stoneShade);
  door(root, -s.width * 0.2, s.depth * 0.4, s.wallHeight * 0.62, 0.58, m, "forge-shop-door");
  windowPart(root, -s.width * 0.37, s.wallHeight * 0.56, s.depth * 0.4, m, 0.7);
  for (const x of [-0.16, 0.05, 0.24]) {
    weaponSpear(root, "forge-finished-weapon", x, s.depth * 0.36, 0.84, m, x * 0.25);
  }
}

function orcBeastPen(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  fenceRun(
    root,
    [-s.width * 0.48, -s.depth * 0.44],
    [s.width * 0.48, -s.depth * 0.44],
    s.wallHeight * 0.72,
    9,
    m,
    "beast-pen-log",
  );
  fenceRun(
    root,
    [-s.width * 0.48, -s.depth * 0.44],
    [-s.width * 0.48, s.depth * 0.44],
    s.wallHeight * 0.72,
    7,
    m,
    "beast-pen-log",
  );
  fenceRun(
    root,
    [s.width * 0.48, -s.depth * 0.44],
    [s.width * 0.48, s.depth * 0.44],
    s.wallHeight * 0.72,
    7,
    m,
    "beast-pen-log",
  );
  const shelter = roofedBox(
    root,
    "pen-shelter",
    s.width * 0.42,
    s.depth * 0.48,
    s.wallHeight * 0.55,
    s.roofHeight * 0.68,
    m,
    m.stoneShade,
  );
  shelter.position.set(-s.width * 0.25, 0, s.depth * 0.2);
  box(
    root,
    "pen-gate",
    [s.width * 0.36, s.wallHeight * 0.62, 0.12],
    [s.width * 0.25, s.wallHeight * 0.31, s.depth * 0.44],
    m.metal,
  );
  for (const z of [-0.22, 0.18])
    box(root, "feeding-trough", [s.width * 0.38, 0.25, 0.32], [0, 0.2, s.depth * z], m.deck);
}

function beastHideLodge(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const ridgeY = s.wallHeight + s.roofHeight * 0.8;
  for (const z of [-s.depth * 0.42, 0, s.depth * 0.42]) {
    beam(root, "hide-lodge-a-frame", [-s.width * 0.44, 0, z], [0, ridgeY, z], 0.075, m.bone);
    beam(root, "hide-lodge-a-frame", [s.width * 0.44, 0, z], [0, ridgeY, z], 0.075, m.bone);
  }
  gableRoof(
    root,
    "stretched-hide-roof",
    s.width * 0.92,
    s.depth * 0.9,
    s.wallHeight * 0.1,
    ridgeY,
    m.cloth,
  );
  box(
    root,
    "hide-lodge-back",
    [s.width * 0.78, s.wallHeight * 0.62, 0.08],
    [0, s.wallHeight * 0.31, -s.depth * 0.4],
    m.wall,
  );
  door(root, 0, s.depth * 0.43, s.wallHeight * 0.66, 0.58, m, "hide-flap");
  antlerArch(root, 0, s.depth * 0.48, s.width * 0.5, s.wallHeight * 1.08, m);
}

function beastElevatedNest(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const platformY = s.wallHeight * 0.58;
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = Math.sin(angle) * s.width * 0.32;
    const z = Math.cos(angle) * s.depth * 0.32;
    beam(root, "nest-tree-stilt", [x * 1.25, 0, z * 1.25], [x, platformY, z], 0.11, m.wood);
  }
  cylinder(
    root,
    "nest-platform",
    s.width * 0.38,
    s.width * 0.42,
    0.18,
    [0, platformY, 0],
    m.deck,
    12,
  );
  torus(root, "woven-nest-rim", s.width * 0.34, 0.13, [0, platformY + 0.18, 0], m.wood);
  cone(
    root,
    "leaf-nest-canopy",
    s.width * 0.38,
    s.roofHeight,
    [0, platformY + s.roofHeight * 0.68, 0],
    m.foliage,
    [0, 0, 0],
    12,
  );
  for (const angle of [0.2, 1.5, 2.8, 4.2, 5.4])
    beam(
      root,
      "nest-branch",
      [Math.sin(angle) * s.width * 0.3, platformY, Math.cos(angle) * s.depth * 0.3],
      [
        Math.sin(angle) * s.width * 0.48,
        platformY + s.roofHeight * 0.65,
        Math.cos(angle) * s.depth * 0.48,
      ],
      0.055,
      m.wood,
    );
  beam(
    root,
    "nest-ladder",
    [-0.24, 0, s.depth * 0.42],
    [-0.24, platformY, s.depth * 0.32],
    0.055,
    m.wood,
  );
  beam(
    root,
    "nest-ladder",
    [0.24, 0, s.depth * 0.42],
    [0.24, platformY, s.depth * 0.32],
    0.055,
    m.wood,
  );
  for (let index = 1; index < 6; index += 1) {
    const y = (platformY * index) / 6;
    box(root, "nest-ladder-rung", [0.54, 0.045, 0.055], [0, y, s.depth * 0.38], m.wood);
  }
  for (const y of [platformY + 0.08, platformY + 0.24]) {
    torus(root, "nest-woven-band", s.width * 0.34, 0.035, [0, y, 0], m.cloth);
  }
  for (const side of [-1, 1]) {
    cylinder(
      root,
      "nest-hanging-basket",
      0.14,
      0.19,
      0.3,
      [side * s.width * 0.34, platformY - 0.12, s.depth * 0.08],
      m.deck,
      9,
    );
    beam(
      root,
      "basket-rope",
      [side * s.width * 0.34, platformY, s.depth * 0.08],
      [side * s.width * 0.34, platformY - 0.28, s.depth * 0.08],
      0.018,
      m.cloth,
    );
  }
}

function beastTotemHall(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(root, "totem-hall-platform", [s.width * 0.92, 0.18, s.depth * 0.82], [0, 0.09, 0], m.deck);
  for (const x of [-s.width * 0.4, -s.width * 0.2, 0, s.width * 0.2, s.width * 0.4]) {
    antlerArch(root, x, 0, s.width * 0.18, s.wallHeight + s.roofHeight * 0.85, m, "hall-rib");
  }
  box(
    root,
    "totem-hall-hide-canopy",
    [s.width * 0.88, 0.12, s.depth * 0.72],
    [0, s.wallHeight + s.roofHeight * 0.58, 0],
    m.cloth,
    [0, 0, 0.08],
  );
  for (const x of [-s.width * 0.3, 0, s.width * 0.3])
    totem(root, x, s.depth * 0.28, s.wallHeight * (x === 0 ? 1.05 : 0.82), m, "council-totem");
  banner(root, -s.width * 0.45, -s.depth * 0.3, s.wallHeight + s.roofHeight, m, 0.34);
  banner(root, s.width * 0.45, -s.depth * 0.3, s.wallHeight + s.roofHeight, m, 0.34);
}

function beastMoonDen(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.38;
  sphere(
    root,
    "moon-den-dome",
    radius,
    [1.15, 0.9, 1.08],
    [0, s.wallHeight * 0.48, 0],
    m.stoneShade,
    12,
  );
  torus(
    root,
    "moon-crescent-outer",
    radius * 0.92,
    0.1,
    [0, s.wallHeight + s.roofHeight * 0.42, 0],
    m.bone,
    [0, 0, 0],
  );
  sphere(
    root,
    "moon-crescent-cut",
    radius * 0.75,
    [1, 1, 0.35],
    [radius * 0.28, s.wallHeight + s.roofHeight * 0.42, 0.08],
    m.outline,
    12,
  );
  door(root, 0, radius * 1.02, s.wallHeight * 0.62, 0.62, m, "moon-den-door");
  for (const side of [-1, 1]) {
    antlerArch(
      root,
      side * radius * 0.62,
      radius * 0.78,
      radius * 0.7,
      s.wallHeight * 0.92,
      m,
      "moon-antler",
    );
    sphere(
      root,
      "moon-orb",
      0.13,
      [1, 1, 1],
      [side * radius * 0.72, s.wallHeight + s.roofHeight * 0.25, radius * 0.62],
      m.accent,
      8,
    );
  }
}

function beastHunterRing(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  ringPosts(root, s.width * 0.43, s.depth * 0.4, 10, s.wallHeight * 0.88, m, "hunter-trophy-post");
  torus(root, "hunter-ring-deck", Math.min(s.width, s.depth) * 0.34, 0.11, [0, 0.12, 0], m.deck);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    antlerArch(
      root,
      Math.sin(angle) * s.width * 0.38,
      Math.cos(angle) * s.depth * 0.36,
      s.width * 0.18,
      s.wallHeight * 0.72,
      m,
      "hunter-trophy",
    );
  }
  target(root, 0, 0.75, -s.depth * 0.28, m);
  box(root, "hunter-weapon-rack", [s.width * 0.45, 0.14, 0.18], [0, 0.72, s.depth * 0.38], m.wood);
  for (const x of [-0.42, -0.14, 0.14, 0.42])
    weaponSpear(root, "hunter-spear", x, s.depth * 0.38, 1.12, m, x * 0.22);
}

function beastClawYard(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const points = [
    [0, -s.depth * 0.42],
    [-s.width * 0.43, s.depth * 0.36],
    [s.width * 0.43, s.depth * 0.36],
  ] as const;
  for (let index = 0; index < 3; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % 3];
    if (!from || !to) continue;
    fenceRun(root, from, to, s.wallHeight * 0.62, 5, m, "triangular-yard-post");
  }
  for (const [x, z] of points) {
    for (const offset of [-0.12, 0, 0.12])
      spike(root, "giant-claw", [x + offset, s.wallHeight * 0.68, z], s.wallHeight * 0.92, m, [
        0,
        0,
        offset * 2.4,
      ]);
  }
  cylinder(
    root,
    "claw-yard-dummy",
    0.14,
    0.18,
    s.wallHeight * 0.8,
    [0, s.wallHeight * 0.4, 0],
    m.wood,
    8,
  );
  box(root, "dummy-arms", [s.width * 0.38, 0.1, 0.1], [0, s.wallHeight * 0.58, 0], m.wood);
  sphere(root, "dummy-head", 0.2, [1, 1, 1], [0, s.wallHeight * 0.92, 0], m.bone, 8);
}

function beastCommunalHollow(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.38;
  cylinder(
    root,
    "communal-sunken-floor",
    radius,
    radius * 1.08,
    0.16,
    [0, 0.08, 0],
    m.stoneShade,
    14,
  );
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    box(
      root,
      "hollow-bench",
      [radius * 0.55, 0.14, 0.24],
      [Math.sin(angle) * radius * 0.68, 0.3, Math.cos(angle) * radius * 0.68],
      m.deck,
      [0, angle, 0],
    );
  }
  for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    beam(
      root,
      "hollow-canopy-post",
      [Math.sin(angle) * radius, 0, Math.cos(angle) * radius],
      [0, s.wallHeight + s.roofHeight * 0.7, 0],
      0.075,
      m.bone,
    );
  }
  cone(
    root,
    "communal-hide-canopy",
    radius * 1.05,
    s.roofHeight * 0.42,
    [0, s.wallHeight + s.roofHeight * 0.5, 0],
    m.cloth,
    [0, 0, 0],
    10,
  );
  fire(root, 0, 0, 0.7, m);
}

function beastHealerHut(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.33;
  cylinder(
    root,
    "healer-round-hut",
    radius * 0.9,
    radius,
    s.wallHeight * 0.72,
    [0, s.wallHeight * 0.36, 0],
    m.wall,
    12,
  );
  sphere(
    root,
    "healer-leaf-roof",
    radius,
    [1.12, 0.46, 1.12],
    [0, s.wallHeight * 0.84, 0],
    m.foliage,
    11,
  );
  door(root, 0, radius + 0.04, s.wallHeight * 0.56, 0.5, m, "healer-door");
  for (const side of [-1, 1]) {
    beam(
      root,
      "herb-drying-frame",
      [side * s.width * 0.42, 0, -s.depth * 0.25],
      [side * s.width * 0.42, s.wallHeight * 0.9, -s.depth * 0.25],
      0.05,
      m.wood,
    );
    beam(
      root,
      "herb-drying-frame",
      [side * s.width * 0.42, s.wallHeight * 0.82, -s.depth * 0.25],
      [side * s.width * 0.12, s.wallHeight * 0.82, -s.depth * 0.25],
      0.05,
      m.wood,
    );
    for (const x of [0.18, 0.28, 0.38])
      sphere(
        root,
        "hanging-herbs",
        0.09,
        [0.7, 1.5, 0.7],
        [side * s.width * x, s.wallHeight * 0.58, -s.depth * 0.25],
        m.foliage,
        7,
      );
  }
  antlerArch(root, 0, radius * 1.05, s.width * 0.48, s.wallHeight * 0.92, m, "healer-antler-door");
}

function beastTannery(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  leanRoof(
    root,
    "tannery-lean-to",
    s.width * 0.42,
    s.depth * 0.86,
    s.wallHeight * 0.88,
    m.foliage,
    0.2,
    m.wood,
  );
  root.getObjectByName("tannery-lean-to")?.position.setX(-s.width * 0.28);
  for (const x of [-s.width * 0.47, -s.width * 0.09]) {
    for (const z of [-s.depth * 0.36, s.depth * 0.36]) {
      beam(
        root,
        "tannery-shelter-post",
        [x, 0, z],
        [x, s.wallHeight * (x < -s.width * 0.3 ? 0.8 : 0.96), z],
        0.055,
        m.wood,
      );
      torus(root, "tannery-post-binding", 0.075, 0.016, [x, s.wallHeight * 0.55, z], m.cloth);
    }
  }
  for (const x of [-s.width * 0.36, 0, s.width * 0.36]) {
    beam(
      root,
      "tanning-frame-left",
      [x - 0.22, 0, s.depth * 0.1],
      [x - 0.22, s.wallHeight, s.depth * 0.1],
      0.05,
      m.wood,
    );
    beam(
      root,
      "tanning-frame-right",
      [x + 0.22, 0, s.depth * 0.1],
      [x + 0.22, s.wallHeight, s.depth * 0.1],
      0.05,
      m.wood,
    );
    box(
      root,
      "stretched-hide",
      [0.38, s.wallHeight * 0.65, 0.045],
      [x, s.wallHeight * 0.55, s.depth * 0.1],
      x === 0 ? m.cloth : m.canvas,
    );
    beam(
      root,
      "tanning-frame-top",
      [x - 0.25, s.wallHeight, s.depth * 0.1],
      [x + 0.25, s.wallHeight, s.depth * 0.1],
      0.045,
      m.wood,
    );
    for (const corner of [-1, 1]) {
      for (const y of [s.wallHeight * 0.3, s.wallHeight * 0.78]) {
        torus(
          root,
          "hide-frame-lashing",
          0.04,
          0.012,
          [x + corner * 0.21, y, s.depth * 0.13],
          m.cloth,
          [0, 0, 0],
        );
      }
    }
  }
  for (const x of [-s.width * 0.3, s.width * 0.3]) barrel(root, x, s.depth * 0.38, 0.9, m);
  box(
    root,
    "tanning-table",
    [s.width * 0.45, 0.14, 0.38],
    [-s.width * 0.22, 0.42, -s.depth * 0.3],
    m.deck,
  );
  box(
    root,
    "tanning-scraper",
    [s.width * 0.28, 0.055, 0.08],
    [-s.width * 0.22, 0.54, -s.depth * 0.3],
    m.bone,
    [0, 0, 0.18],
  );
  for (const x of [-s.width * 0.08, s.width * 0.18]) {
    cylinder(root, "tanning-vat", 0.24, 0.3, 0.34, [x, 0.17, -s.depth * 0.32], m.stoneShade, 10);
    torus(root, "tanning-vat-rim", 0.28, 0.035, [x, 0.34, -s.depth * 0.32], m.wood);
  }
}

function beastGathererStore(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const podPositions = [
    [-0.27, 0.02, 0.36],
    [0.27, -0.12, 0.42],
    [0, 0.28, 0.31],
  ] as const;
  for (const [x, z, radius] of podPositions) {
    const floorY = s.wallHeight * (0.38 + radius * 0.3);
    for (const side of [-1, 1])
      beam(
        root,
        "granary-stilt",
        [s.width * x + side * radius * 0.45, 0, s.depth * z],
        [s.width * x + side * radius * 0.32, floorY, s.depth * z],
        0.065,
        m.wood,
      );
    sphere(
      root,
      "woven-granary-pod",
      radius * 1.18,
      [1.15, 0.95, 1],
      [s.width * x, floorY + radius * 0.78, s.depth * z],
      m.deck,
      9,
    );
    for (const y of [floorY + radius * 0.45, floorY + radius * 0.9]) {
      torus(
        root,
        "granary-weave-band",
        radius * 1.02,
        0.035,
        [s.width * x, y, s.depth * z],
        m.cloth,
      );
    }
    cone(
      root,
      "granary-pod-cap",
      radius * 1.05,
      s.roofHeight * 0.45,
      [s.width * x, floorY + radius * 1.62, s.depth * z],
      m.foliage,
      [0, 0, 0],
      9,
    );
    box(
      root,
      "granary-hatch",
      [radius * 0.56, radius * 0.62, 0.06],
      [s.width * x, floorY + radius * 0.73, s.depth * z + radius * 0.9],
      m.window,
    );
    box(
      root,
      "granary-hatch-frame",
      [radius * 0.68, 0.07, 0.08],
      [s.width * x, floorY + radius * 0.73, s.depth * z + radius * 0.94],
      m.bone,
    );
  }
  box(
    root,
    "gatherer-loading-deck",
    [s.width * 0.78, 0.15, s.depth * 0.28],
    [0, s.wallHeight * 0.42, s.depth * 0.2],
    m.deck,
  );
  for (const x of [-s.width * 0.35, s.width * 0.35])
    beam(
      root,
      "loading-ladder",
      [x, 0, s.depth * 0.36],
      [x, s.wallHeight * 0.42, s.depth * 0.2],
      0.05,
      m.wood,
    );
}

function wildReedHut(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.34;
  cylinder(
    root,
    "reed-hut-core",
    radius * 0.94,
    radius,
    s.wallHeight * 0.78,
    [0, s.wallHeight * 0.39, 0],
    m.foliage,
    14,
  );
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    cylinder(
      root,
      "reed-stalk-wall",
      0.025,
      0.035,
      s.wallHeight * 0.92,
      [Math.sin(angle) * radius, s.wallHeight * 0.46, Math.cos(angle) * radius],
      index % 3 ? m.foliage : m.wood,
      5,
    );
  }
  cone(
    root,
    "reed-cone-roof",
    radius * 1.18,
    s.roofHeight,
    [0, s.wallHeight * 0.78 + s.roofHeight / 2, 0],
    m.roof,
    [0, 0, 0],
    16,
  );
  door(root, 0, radius + 0.04, s.wallHeight * 0.58, 0.48, m, "reed-curtain-door");
  torus(root, "reed-binding", radius * 1.01, 0.035, [0, s.wallHeight * 0.56, 0], m.cloth);
}

function wildHideTent(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const ridgeY = s.wallHeight + s.roofHeight * 0.82;
  for (const z of [-s.depth * 0.5, s.depth * 0.5]) {
    beam(root, "tent-pole-left", [-s.width * 0.48, 0, z], [0, ridgeY, z], 0.055, m.wood);
    beam(root, "tent-pole-right", [s.width * 0.48, 0, z], [0, ridgeY, z], 0.055, m.wood);
  }
  beam(
    root,
    "tent-ridge-pole",
    [0, ridgeY, -s.depth * 0.58],
    [0, ridgeY, s.depth * 0.58],
    0.06,
    m.wood,
  );
  gableRoof(root, "painted-hide-tent", s.width, s.depth, 0, ridgeY, m.cloth);
  box(
    root,
    "tent-back-flap",
    [s.width * 0.86, s.wallHeight * 0.82, 0.055],
    [0, s.wallHeight * 0.41, -s.depth * 0.48],
    m.canvas,
  );
  for (const side of [-1, 1])
    banner(root, side * s.width * 0.45, s.depth * 0.5, s.wallHeight * 0.9, m, 0.22);
  fire(root, 0, s.depth * 0.34, 0.42, m);
}

function wildAncestorHall(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(root, "ancestor-hall-dais", [s.width * 0.94, 0.2, s.depth * 0.82], [0, 0.1, 0], m.stoneShade);
  for (const x of [-s.width * 0.4, -s.width * 0.2, 0, s.width * 0.2, s.width * 0.4]) {
    cylinder(
      root,
      "ancestor-column",
      0.09,
      0.14,
      s.wallHeight,
      [x, s.wallHeight / 2, 0],
      m.wood,
      7,
    );
    box(
      root,
      "ancestor-mask",
      [s.width * 0.14, s.wallHeight * 0.34, 0.12],
      [x, s.wallHeight * 0.68, s.depth * 0.08],
      x === 0 ? m.accent : m.bone,
    );
    for (const eye of [-1, 1]) {
      sphere(
        root,
        "ancestor-mask-eye",
        0.035,
        [1, 1, 0.5],
        [x + eye * s.width * 0.035, s.wallHeight * 0.73, s.depth * 0.15],
        m.outline,
        6,
      );
    }
    for (const tooth of [-1, 0, 1]) {
      cone(
        root,
        "ancestor-mask-tooth",
        0.025,
        0.11,
        [x + tooth * s.width * 0.025, s.wallHeight * 0.55, s.depth * 0.15],
        m.bone,
        [0, 0, Math.PI],
        5,
      );
    }
  }
  box(
    root,
    "ancestor-flat-canopy",
    [s.width, 0.14, s.depth * 0.78],
    [0, s.wallHeight + s.roofHeight * 0.32, 0],
    m.roof,
  );
  for (const x of [-s.width * 0.36, 0, s.width * 0.36])
    totem(root, x, s.depth * 0.36, s.wallHeight * (x === 0 ? 1.12 : 0.86), m, "ancestor-effigy");
  antlerArch(
    root,
    0,
    -s.depth * 0.32,
    s.width * 0.5,
    s.wallHeight + s.roofHeight * 0.75,
    m,
    "ancestor-bone-arch",
  );
}

function wildBoneTower(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const topY = s.wallHeight * 0.9;
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = Math.sin(angle) * s.width * 0.34;
    const z = Math.cos(angle) * s.depth * 0.34;
    beam(root, "bone-tower-leg", [x * 1.2, 0, z * 1.2], [x, topY, z], 0.075, m.bone);
    beam(
      root,
      "bone-tower-crossbrace",
      [x * 1.2, 0.22, z * 1.2],
      [-z * 0.9, topY * 0.66, x * 0.9],
      0.045,
      m.bone,
    );
  }
  cylinder(
    root,
    "bone-watch-platform",
    s.width * 0.36,
    s.width * 0.4,
    0.18,
    [0, topY, 0],
    m.deck,
    10,
  );
  const parapet = new THREE.Group();
  parapet.name = "raised-bone-parapet";
  parapet.position.y = topY + 0.12;
  root.add(parapet);
  ringPosts(parapet, s.width * 0.34, s.depth * 0.34, 10, s.roofHeight * 0.92, m, "bone-parapet");
  torus(
    parapet,
    "parapet-binding-ring",
    s.width * 0.34,
    0.055,
    [0, s.roofHeight * 0.5, 0],
    m.cloth,
  );
  cone(
    root,
    "bone-tower-roof",
    s.width * 0.38,
    s.roofHeight,
    [0, topY + s.roofHeight * 0.72, 0],
    m.cloth,
    [0, 0, 0],
    10,
  );
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
    spike(
      root,
      "tower-long-bone",
      [
        Math.sin(angle) * s.width * 0.38,
        topY + s.roofHeight * 0.78,
        Math.cos(angle) * s.depth * 0.38,
      ],
      s.roofHeight * 0.9,
      m,
      [0, 0, angle * 0.08],
    );
  beam(
    root,
    "bone-ladder-left",
    [-0.18, 0, s.depth * 0.4],
    [-0.18, topY, s.depth * 0.34],
    0.04,
    m.wood,
  );
  beam(
    root,
    "bone-ladder-right",
    [0.18, 0, s.depth * 0.4],
    [0.18, topY, s.depth * 0.34],
    0.04,
    m.wood,
  );
  for (let index = 1; index < 8; index += 1) {
    const y = (topY * index) / 8;
    box(root, "bone-ladder-rung", [0.42, 0.045, 0.055], [0, y, s.depth * 0.38], m.wood);
  }
  banner(root, 0, -s.depth * 0.22, topY + s.roofHeight * 1.65, m, 0.3);
}

function wildSpearCircle(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const x = Math.sin(angle) * s.width * 0.42;
    const z = Math.cos(angle) * s.depth * 0.4;
    weaponSpear(
      root,
      "spear-circle-spear",
      x,
      z,
      s.wallHeight * (0.88 + (index % 3) * 0.1),
      m,
      Math.sin(angle) * 0.12,
    );
  }
  torus(
    root,
    "spear-circle-boundary",
    Math.min(s.width, s.depth) * 0.34,
    0.07,
    [0, 0.1, 0],
    m.cloth,
  );
  cylinder(
    root,
    "spear-dummy-body",
    0.13,
    0.18,
    s.wallHeight * 0.74,
    [0, s.wallHeight * 0.37, 0],
    m.wood,
    7,
  );
  sphere(root, "spear-dummy-head", 0.2, [1, 1, 1], [0, s.wallHeight * 0.9, 0], m.bone, 8);
  box(root, "spear-dummy-arms", [s.width * 0.44, 0.09, 0.09], [0, s.wallHeight * 0.66, 0], m.wood);
  target(root, 0, s.wallHeight * 0.58, -0.02, m);
}

function wildTrialPit(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  box(root, "trial-pit-floor", [s.width * 0.78, 0.12, s.depth * 0.72], [0, 0.06, 0], m.stoneShade);
  const corners = [
    [-0.42, -0.4],
    [0.42, -0.4],
    [0.42, 0.4],
    [-0.42, 0.4],
  ] as const;
  for (const [x, z] of corners) {
    cylinder(
      root,
      "trial-pit-obelisk",
      0.14,
      0.22,
      s.wallHeight * 0.95,
      [s.width * x, s.wallHeight * 0.48, s.depth * z],
      m.stone,
      6,
    );
    spike(root, "obelisk-bone-cap", [s.width * x, s.wallHeight + 0.2, s.depth * z], 0.48, m);
  }
  for (let index = 0; index < corners.length; index += 1) {
    const from = corners[index];
    const to = corners[(index + 1) % corners.length];
    if (!from || !to) continue;
    beam(
      root,
      "trial-pit-rope",
      [s.width * from[0], s.wallHeight * 0.55, s.depth * from[1]],
      [s.width * to[0], s.wallHeight * 0.55, s.depth * to[1]],
      0.035,
      m.cloth,
    );
  }
  box(
    root,
    "trial-gate",
    [s.width * 0.3, s.wallHeight * 0.72, 0.1],
    [0, s.wallHeight * 0.36, s.depth * 0.42],
    m.wood,
  );
  fire(root, 0, 0, 0.52, m);
}

function wildFireLodge(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const radius = Math.min(s.width, s.depth) * 0.38;
  fire(root, 0, 0, 0.9, m);
  ringPosts(root, s.width * 0.4, s.depth * 0.38, 8, s.wallHeight * 0.92, m, "fire-lodge-pole");
  cone(
    root,
    "smoke-hole-canopy",
    radius * 1.08,
    s.roofHeight * 0.62,
    [0, s.wallHeight + s.roofHeight * 0.52, 0],
    m.roof,
    [0, 0, 0],
    12,
  );
  cylinder(
    root,
    "smoke-hole",
    radius * 0.28,
    radius * 0.28,
    0.1,
    [0, s.wallHeight + s.roofHeight * 0.82, 0],
    m.outline,
    10,
  );
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    box(
      root,
      "fire-lodge-seat",
      [0.58, 0.14, 0.24],
      [Math.sin(angle) * radius * 0.68, 0.28, Math.cos(angle) * radius * 0.68],
      m.deck,
      [0, angle, 0],
    );
  }
  for (const side of [-1, 1])
    banner(root, side * s.width * 0.4, s.depth * 0.24, s.wallHeight + s.roofHeight * 0.8, m, 0.28);
}

function wildSpiritHut(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const floorY = s.wallHeight * 0.34;
  for (const [x, z] of [
    [-0.32, -0.28],
    [0.32, -0.28],
    [-0.28, 0.3],
    [0.28, 0.3],
  ] as const)
    beam(
      root,
      "spirit-hut-stilt",
      [s.width * x, 0, s.depth * z],
      [s.width * x * 0.9, floorY, s.depth * z],
      0.06,
      m.wood,
    );
  box(root, "spirit-hut-platform", [s.width * 0.72, 0.15, s.depth * 0.68], [0, floorY, 0], m.deck);
  box(
    root,
    "spirit-hut-cabin",
    [s.width * 0.5, s.wallHeight * 0.55, s.depth * 0.52],
    [-s.width * 0.08, floorY + s.wallHeight * 0.28, -s.depth * 0.04],
    m.wall,
    [0, 0, -0.06],
  );
  cone(
    root,
    "spirit-hut-crooked-roof",
    s.width * 0.38,
    s.roofHeight,
    [-s.width * 0.08, floorY + s.wallHeight * 0.55 + s.roofHeight / 2, -s.depth * 0.04],
    m.cloth,
    [0, 0, 0.08],
    8,
  );
  for (const x of [-s.width * 0.45, s.width * 0.43])
    totem(
      root,
      x,
      s.depth * 0.28,
      s.wallHeight + s.roofHeight * (x < 0 ? 0.7 : 1.05),
      m,
      "spirit-pole",
    );
  for (const y of [0.18, 0.36, 0.54])
    box(root, "spirit-ladder-rung", [0.42, 0.055, 0.06], [0, y, s.depth * 0.4], m.wood);
  banner(root, 0, -s.depth * 0.34, s.wallHeight + s.roofHeight * 1.15, m, 0.32);
}

function wildDryingHouse(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  for (const x of [-s.width * 0.44, -s.width * 0.15, s.width * 0.15, s.width * 0.44]) {
    beam(
      root,
      "drying-house-post",
      [x, 0, -s.depth * 0.42],
      [x, s.wallHeight, -s.depth * 0.42],
      0.055,
      m.wood,
    );
    beam(
      root,
      "drying-house-post",
      [x, 0, s.depth * 0.42],
      [x, s.wallHeight, s.depth * 0.42],
      0.055,
      m.wood,
    );
    beam(
      root,
      "drying-house-rail",
      [x, s.wallHeight * 0.78, -s.depth * 0.42],
      [x, s.wallHeight * 0.78, s.depth * 0.42],
      0.04,
      m.wood,
    );
    for (const z of [-s.depth * 0.25, 0, s.depth * 0.25])
      box(
        root,
        "drying-bundle",
        [0.22, s.wallHeight * 0.44, 0.05],
        [x, s.wallHeight * 0.48, z],
        (x + z) % 2 > 0 ? m.foliage : m.cloth,
      );
  }
  leanRoof(
    root,
    "drying-house-reed-roof",
    s.width * 0.96,
    s.depth * 0.95,
    s.wallHeight + s.roofHeight * 0.45,
    m.roof,
    0.12,
  );
  box(root, "drying-prep-table", [s.width * 0.5, 0.15, 0.38], [0, 0.42, s.depth * 0.46], m.deck);
}

function wildCraftShelter(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
): void {
  const canopySpecs = [
    [-0.28, 0.72, 0.48, 0.2],
    [0.25, 0.58, 0.42, -0.16],
    [0, 0.9, 0.32, 0.06],
  ] as const;
  for (const [x, height, width, tilt] of canopySpecs) {
    box(
      root,
      "craft-patchwork-canopy",
      [s.width * width, 0.09, s.depth * 0.72],
      [s.width * x, s.wallHeight * height, 0],
      x === 0 ? m.roof : m.cloth,
      [0, 0, tilt],
    );
    for (const z of [-s.depth * 0.32, s.depth * 0.32])
      beam(
        root,
        "craft-canopy-pole",
        [s.width * x - s.width * width * 0.42, 0, z],
        [s.width * x - s.width * width * 0.42, s.wallHeight * height, z],
        0.045,
        m.wood,
      );
  }
  for (const [x, z] of [
    [-0.28, -0.15],
    [0.25, 0.18],
    [0, 0.34],
  ] as const)
    box(
      root,
      "craft-workbench",
      [s.width * 0.36, 0.14, 0.34],
      [s.width * x, 0.42, s.depth * z],
      m.deck,
    );
  crate(root, -s.width * 0.38, s.depth * 0.38, 0.75, m);
  barrel(root, s.width * 0.38, s.depth * 0.38, 0.75, m);
  totem(root, 0, -s.depth * 0.38, s.wallHeight + s.roofHeight * 0.72, m, "craft-sign");
}

function buildOrc(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  switch (archetype) {
    case "housing-a":
      return orcLonghouse(root, s, m);
    case "housing-b":
      return orcTrollRockHut(root, s, m);
    case "command-a":
      return orcWarchiefHall(root, s, m);
    case "command-b":
      return orcSkullFort(root, s, m);
    case "training-a":
      return orcWarPit(root, s, m);
    case "training-b":
      return orcBoulderRange(root, s, m);
    case "community-a":
      return orcClanHearth(root, s, m);
    case "community-b":
      return orcSmokeLodge(root, s, m);
    case "daily-life-a":
      return orcWarForge(root, s, m);
    case "daily-life-b":
      return orcBeastPen(root, s, m);
  }
}

function buildBeastfolk(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  switch (archetype) {
    case "housing-a":
      return beastHideLodge(root, s, m);
    case "housing-b":
      return beastElevatedNest(root, s, m);
    case "command-a":
      return beastTotemHall(root, s, m);
    case "command-b":
      return beastMoonDen(root, s, m);
    case "training-a":
      return beastHunterRing(root, s, m);
    case "training-b":
      return beastClawYard(root, s, m);
    case "community-a":
      return beastCommunalHollow(root, s, m);
    case "community-b":
      return beastHealerHut(root, s, m);
    case "daily-life-a":
      return beastTannery(root, s, m);
    case "daily-life-b":
      return beastGathererStore(root, s, m);
  }
}

function buildWild(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  m: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  switch (archetype) {
    case "housing-a":
      return wildReedHut(root, s, m);
    case "housing-b":
      return wildHideTent(root, s, m);
    case "command-a":
      return wildAncestorHall(root, s, m);
    case "command-b":
      return wildBoneTower(root, s, m);
    case "training-a":
      return wildSpearCircle(root, s, m);
    case "training-b":
      return wildTrialPit(root, s, m);
    case "community-a":
      return wildFireLodge(root, s, m);
    case "community-b":
      return wildSpiritHut(root, s, m);
    case "daily-life-a":
      return wildDryingHouse(root, s, m);
    case "daily-life-b":
      return wildCraftShelter(root, s, m);
  }
}

export function buildFactionBuildingVolume(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  materials: FactionBuildingMaterials,
  faction: NonHumanFaction,
  archetype: FactionBuildingArchetype,
): void {
  const design = new THREE.Group();
  design.name = `design-${faction}-${FACTION_BUILDING_DESIGN_NAMES[faction][archetype]}`;
  root.add(design);
  switch (faction) {
    case "goblin":
      buildGoblinBuildingVolume(design, size, materials, archetype);
      break;
    case "orc-troll":
      buildOrc(design, size, materials, archetype);
      break;
    case "beastfolk":
      buildBeastfolk(design, size, materials, archetype);
      break;
    case "wild-tribe":
      buildWild(design, size, materials, archetype);
      break;
  }
}
