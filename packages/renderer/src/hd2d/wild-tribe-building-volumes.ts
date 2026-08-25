import type { BuildingVolumeDimensions } from "@lindocara/engine/buildings.js";
import type { FactionBuildingArchetype } from "@lindocara/engine/faction-buildings.js";
import * as THREE from "three";

import type { FactionBuildingMaterials } from "./faction-building-volumes.js";

type Point3 = readonly [number, number, number];
type Size3 = readonly [number, number, number];

interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

interface WildPalette {
  cave: THREE.Material;
  caveDark: THREE.Material;
  moss: THREE.Material;
  mossLight: THREE.Material;
  reed: THREE.Material;
  reedDark: THREE.Material;
  leaf: THREE.Material;
  leafBright: THREE.Material;
  lizard: THREE.Material;
  lizardDark: THREE.Material;
  sun: THREE.Material;
  clay: THREE.Material;
  clayDark: THREE.Material;
  water: THREE.Material;
  ember: THREE.Material;
  smoke: THREE.Material;
}

const CAVE_STONE: PixelCrop = {
  x: 18,
  y: 34,
  width: 168,
  height: 148,
  sourceWidth: 1536,
  sourceHeight: 192,
};
const CAVE_MOSS: PixelCrop = {
  x: 42,
  y: 18,
  width: 126,
  height: 92,
  sourceWidth: 1536,
  sourceHeight: 192,
};
const LIZARD_SKIN: PixelCrop = {
  x: 58,
  y: 28,
  width: 102,
  height: 144,
  sourceWidth: 1344,
  sourceHeight: 192,
};

function textureOf(material: THREE.Material): THREE.Texture | null {
  return material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshStandardMaterial
    ? material.map
    : null;
}

function sampledTexture(source: THREE.Texture | null, crop: PixelCrop): THREE.Texture | null {
  if (!source) return null;
  let texture: THREE.Texture;
  if (
    typeof document !== "undefined" &&
    typeof HTMLImageElement !== "undefined" &&
    source.image instanceof HTMLImageElement
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Wild-tribe material crop requires a 2D canvas context");
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, crop.width, crop.height);
    context.drawImage(
      source.image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = source.clone();
    texture.offset.set(crop.x / crop.sourceWidth, 1 - (crop.y + crop.height) / crop.sourceHeight);
    texture.repeat.set(crop.width / crop.sourceWidth, crop.height / crop.sourceHeight);
  }
  texture.wrapS =
    texture instanceof THREE.CanvasTexture ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT =
    texture instanceof THREE.CanvasTexture ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function surface(source: THREE.Texture | null, color: number, crop: PixelCrop): THREE.Material {
  const map = sampledTexture(source, crop);
  const material = new THREE.MeshLambertMaterial({
    color,
    map,
    emissive: new THREE.Color(color).multiplyScalar(map ? 0.14 : 0.055),
    flatShading: true,
  });
  if (map) material.userData.lindocaraOwnedMap = true;
  return material;
}

function wildPalette(materials: FactionBuildingMaterials): WildPalette {
  const cave = materials.factionPrimary ?? textureOf(materials.stone);
  const lizard = materials.factionDetail ?? textureOf(materials.foliage);
  return {
    cave: surface(cave, 0x789a94, CAVE_STONE),
    caveDark: surface(cave, 0x415a68, CAVE_STONE),
    moss: surface(cave, 0x78a848, CAVE_MOSS),
    mossLight: surface(cave, 0xc2d94e, CAVE_MOSS),
    reed: surface(cave, 0xc09b55, CAVE_MOSS),
    reedDark: surface(cave, 0x765f4b, CAVE_STONE),
    leaf: surface(lizard, 0x27986f, LIZARD_SKIN),
    leafBright: surface(lizard, 0xaacc3a, LIZARD_SKIN),
    lizard: surface(lizard, 0x35bba1, LIZARD_SKIN),
    lizardDark: surface(lizard, 0x315371, LIZARD_SKIN),
    sun: surface(lizard, 0xf1d33e, LIZARD_SKIN),
    clay: surface(cave, 0xb86e50, CAVE_STONE),
    clayDark: surface(cave, 0x714b58, CAVE_STONE),
    water: surface(lizard, 0x56bfc0, LIZARD_SKIN),
    ember: surface(lizard, 0xef7741, LIZARD_SKIN),
    smoke: surface(cave, 0x36384b, CAVE_STONE),
  };
}

function roundedGeometry(width: number, height: number, depth: number, radius = 0.07) {
  const r = Math.min(radius, width / 3, height / 3);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 + r, -height / 2);
  shape.lineTo(width / 2 - r, -height / 2);
  shape.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + r);
  shape.lineTo(width / 2, height / 2 - r);
  shape.quadraticCurveTo(width / 2, height / 2, width / 2 - r, height / 2);
  shape.lineTo(-width / 2 + r, height / 2);
  shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - r);
  shape.lineTo(-width / 2, -height / 2 + r);
  shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + r, -height / 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: Math.min(r * 0.38, depth * 0.16),
    bevelThickness: Math.min(r * 0.28, depth * 0.1),
    curveSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function part(
  root: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  at: Point3,
  rotation: Point3 = [0, 0, 0],
  outline = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  if (outline) {
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 32),
      new THREE.LineBasicMaterial({ color: 0x203743, transparent: true, opacity: 0.72 }),
    );
    line.name = "wild-tribe-silhouette-line";
    line.renderOrder = 2;
    mesh.add(line);
  }
  return mesh;
}

function block(
  root: THREE.Object3D,
  name: string,
  size: Size3,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
  radius = 0.05,
  outline = false,
): THREE.Mesh {
  return part(root, name, roundedGeometry(...size, radius), material, at, rotation, outline);
}

function cylinder(
  root: THREE.Object3D,
  name: string,
  top: number,
  bottom: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  segments = 9,
  rotation: Point3 = [0, 0, 0],
  outline = false,
): THREE.Mesh {
  return part(
    root,
    name,
    new THREE.CylinderGeometry(top, bottom, height, segments),
    material,
    at,
    rotation,
    outline,
  );
}

function sphere(
  root: THREE.Object3D,
  name: string,
  radius: number,
  scale: Point3,
  at: Point3,
  material: THREE.Material,
  outline = false,
): THREE.Mesh {
  const mesh = part(
    root,
    name,
    new THREE.IcosahedronGeometry(radius, 1),
    material,
    at,
    [0, 0, 0],
    outline,
  );
  mesh.scale.set(...scale);
  return mesh;
}

function cone(
  root: THREE.Object3D,
  name: string,
  radius: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
  outline = false,
): THREE.Mesh {
  return cylinder(root, name, 0, radius, height, at, material, 7, rotation, outline);
}

function torus(
  root: THREE.Object3D,
  name: string,
  radius: number,
  tube: number,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [Math.PI / 2, 0, 0],
  arc = Math.PI * 2,
  outline = false,
): THREE.Mesh {
  return part(
    root,
    name,
    new THREE.TorusGeometry(radius, tube, 5, 16, arc),
    material,
    at,
    rotation,
    outline,
  );
}

function beam(
  root: THREE.Object3D,
  name: string,
  from: Point3,
  to: Point3,
  radius: number,
  material: THREE.Material,
  outline = false,
): THREE.Mesh {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const delta = end.clone().sub(start);
  const mesh = cylinder(
    root,
    name,
    radius * 0.82,
    radius,
    delta.length(),
    [0, 0, 0],
    material,
    7,
    [0, 0, 0],
    outline,
  );
  mesh.position.copy(start.add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function reedBundle(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: WildPalette,
  lean = 0,
): void {
  for (let stalk = 0; stalk < 6; stalk += 1) {
    const dx = ((stalk % 3) - 1) * 0.035;
    const dz = (Math.floor(stalk / 3) - 0.5) * 0.04;
    beam(
      root,
      name,
      [x + dx, 0, z + dz],
      [x + dx + lean, height * (0.9 + (stalk % 3) * 0.05), z + dz],
      0.022,
      stalk % 2 ? palette.reed : palette.reedDark,
    );
    cone(
      root,
      `${name}-seed-head`,
      0.035,
      0.17,
      [x + dx + lean, height + 0.06 + (stalk % 3) * 0.04, z + dz],
      stalk % 2 ? palette.mossLight : palette.reed,
    );
  }
}

function boulder(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  radius: number,
  palette: WildPalette,
  mossy = false,
  outline = false,
): void {
  sphere(
    root,
    name,
    radius,
    [1.25, 0.72, 0.95],
    at,
    mossy ? palette.cave : palette.caveDark,
    outline,
  );
  if (mossy) {
    sphere(
      root,
      `${name}-moss-cap`,
      radius * 0.72,
      [1.2, 0.22, 0.85],
      [at[0], at[1] + radius * 0.55, at[2]],
      palette.moss,
    );
  }
}

function stoneRing(
  root: THREE.Object3D,
  name: string,
  radiusX: number,
  radiusZ: number,
  count: number,
  palette: WildPalette,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    boulder(
      root,
      name,
      [Math.sin(angle) * radiusX, 0.12 + (index % 2) * 0.025, Math.cos(angle) * radiusZ],
      0.15 + (index % 3) * 0.012,
      palette,
      index % 4 === 0,
    );
  }
}

function leafPetal(
  root: THREE.Object3D,
  name: string,
  centre: Point3,
  length: number,
  width: number,
  angle: number,
  palette: WildPalette,
  bright = false,
  outline = false,
): void {
  const x = centre[0] + Math.sin(angle) * length * 0.32;
  const z = centre[2] + Math.cos(angle) * length * 0.32;
  const leaf = sphere(
    root,
    name,
    width,
    [0.72, 0.18, length / width],
    [x, centre[1], z],
    bright ? palette.leafBright : palette.leaf,
    outline,
  );
  leaf.rotation.y = angle;
  beam(
    root,
    `${name}-vein`,
    centre,
    [
      centre[0] + Math.sin(angle) * length * 0.72,
      centre[1] - 0.03,
      centre[2] + Math.cos(angle) * length * 0.72,
    ],
    0.018,
    bright ? palette.sun : palette.reedDark,
  );
}

function leafCanopy(
  root: THREE.Object3D,
  name: string,
  y: number,
  radius: number,
  count: number,
  palette: WildPalette,
): void {
  for (let index = 0; index < count; index += 1)
    leafPetal(
      root,
      name,
      [0, y + (index % 2) * 0.055, 0],
      radius,
      radius * 0.3,
      (index / count) * Math.PI * 2,
      palette,
      index % 3 === 0,
      index % 6 === 0,
    );
  sphere(
    root,
    `${name}-crown`,
    radius * 0.18,
    [1, 0.5, 1],
    [0, y + 0.12, 0],
    palette.mossLight,
    true,
  );
}

function reedGableRoof(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  palette: WildPalette,
): void {
  for (let slat = 0; slat < 13; slat += 1) {
    const z = -depth * 0.47 + (slat / 12) * depth * 0.94;
    beam(
      root,
      name,
      [-width * 0.5, eaveY, z],
      [0, eaveY + rise, z],
      0.035,
      slat % 2 ? palette.reed : palette.reedDark,
      slat === 0,
    );
    beam(
      root,
      name,
      [width * 0.5, eaveY, z],
      [0, eaveY + rise, z],
      0.035,
      slat % 2 ? palette.reedDark : palette.reed,
      slat === 12,
    );
  }
  beam(
    root,
    `${name}-ridge`,
    [0, eaveY + rise, -depth * 0.54],
    [0, eaveY + rise, depth * 0.54],
    0.065,
    palette.mossLight,
    true,
  );
  for (const side of [-1, 1]) {
    for (let tie = 0; tie < 5; tie += 1) {
      beam(
        root,
        `${name}-woven-tie`,
        [side * width * (0.08 + tie * 0.09), eaveY + rise * (0.84 - tie * 0.16), -depth * 0.5],
        [side * width * (0.08 + tie * 0.09), eaveY + rise * (0.84 - tie * 0.16), depth * 0.5],
        0.016,
        tie % 2 ? palette.leafBright : palette.leaf,
      );
    }
  }
}

function leanReedAwning(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  y: number,
  palette: WildPalette,
): void {
  for (let strip = 0; strip < 11; strip += 1) {
    const x = -width * 0.46 + (strip / 10) * width * 0.92;
    block(
      root,
      name,
      [width * 0.075, 0.055, depth],
      [x, y + x * 0.08, 0],
      strip % 3 === 0 ? palette.moss : strip % 2 ? palette.reed : palette.reedDark,
      [0.04, 0, -0.09],
      0.025,
      strip === 0 || strip === 10,
    );
  }
  for (const z of [-depth * 0.48, depth * 0.48]) {
    beam(
      root,
      `${name}-edge-pole`,
      [-width * 0.5, y - width * 0.04, z],
      [width * 0.5, y + width * 0.04, z],
      0.045,
      palette.reedDark,
      true,
    );
  }
}

function wovenFan(
  root: THREE.Object3D,
  name: string,
  width: number,
  height: number,
  z: number,
  palette: WildPalette,
): void {
  for (let panel = 0; panel < 9; panel += 1) {
    const angle = -1.05 + panel * 0.2625;
    const x = Math.sin(angle) * width * 0.42;
    const y = height * (0.66 + Math.cos(angle) * 0.28);
    beam(
      root,
      `${name}-rib`,
      [0, 0.18, z],
      [x, y, z],
      0.035,
      panel % 2 ? palette.reed : palette.reedDark,
      panel === 0 || panel === 8,
    );
    block(
      root,
      name,
      [width * 0.14, height * 0.42, 0.055],
      [x, y * 0.78, z + 0.03],
      panel % 3 === 0 ? palette.sun : panel % 3 === 1 ? palette.leaf : palette.clay,
      [0, 0, -angle * 0.4],
      0.08,
      panel === 4,
    );
    torus(
      root,
      `${name}-binding`,
      0.055,
      0.014,
      [x, y * 0.57, z + 0.07],
      palette.lizardDark,
      [0, 0, 0],
    );
  }
}

function shellTile(
  root: THREE.Object3D,
  name: string,
  angle: number,
  radius: number,
  y: number,
  palette: WildPalette,
  layer: number,
): void {
  const x = Math.sin(angle) * radius;
  const z = Math.cos(angle) * radius;
  block(
    root,
    name,
    [0.42 - layer * 0.035, 0.18, 0.5 - layer * 0.04],
    [x, y, z],
    layer % 2 ? palette.clay : palette.cave,
    [0, angle, (layer % 2 ? -1 : 1) * 0.07],
    0.1,
    layer === 3 && angle === 0,
  );
  sphere(
    root,
    `${name}-boss`,
    0.055,
    [1, 0.55, 1],
    [x, y + 0.1, z],
    layer % 2 ? palette.sun : palette.mossLight,
  );
}

function carvedMask(
  root: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  z: number,
  scale: number,
  palette: WildPalette,
): void {
  sphere(root, name, 0.28 * scale, [0.78, 1.25, 0.35], [x, y, z], palette.lizard, true);
  for (const side of [-1, 1]) {
    sphere(
      root,
      `${name}-eye-rim`,
      0.075 * scale,
      [1.2, 0.8, 0.45],
      [x + side * 0.11 * scale, y + 0.07 * scale, z + 0.1],
      palette.sun,
    );
    sphere(
      root,
      `${name}-eye`,
      0.035 * scale,
      [1, 1, 0.5],
      [x + side * 0.11 * scale, y + 0.07 * scale, z + 0.13],
      palette.caveDark,
    );
    cone(
      root,
      `${name}-crest`,
      0.055 * scale,
      0.27 * scale,
      [x + side * 0.17 * scale, y + 0.3 * scale, z],
      side > 0 ? palette.leafBright : palette.mossLight,
      [0, 0, side * -0.42],
    );
  }
  for (let tooth = 0; tooth < 5; tooth += 1)
    cone(
      root,
      `${name}-tooth`,
      0.027 * scale,
      0.13 * scale,
      [x - 0.12 * scale + tooth * 0.06 * scale, y - 0.21 * scale, z + 0.12],
      palette.sun,
      [Math.PI, 0, 0],
    );
  torus(
    root,
    `${name}-jaw`,
    0.19 * scale,
    0.035 * scale,
    [x, y - 0.11 * scale, z + 0.08],
    palette.lizardDark,
    [0, 0, 0],
    Math.PI,
    false,
  );
}

function sunTotem(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: WildPalette,
): void {
  cylinder(
    root,
    name,
    0.065,
    0.1,
    height,
    [x, height / 2, z],
    palette.reedDark,
    8,
    [0, 0, 0],
    true,
  );
  torus(
    root,
    `${name}-sun-ring`,
    0.22,
    0.04,
    [x, height * 0.83, z],
    palette.sun,
    [0, 0, 0],
    Math.PI * 2,
    true,
  );
  sphere(root, `${name}-sun-heart`, 0.11, [1, 1, 0.6], [x, height * 0.83, z + 0.02], palette.ember);
  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (ray / 8) * Math.PI * 2;
    cone(
      root,
      `${name}-sun-ray`,
      0.035,
      0.2,
      [x + Math.cos(angle) * 0.3, height * 0.83 + Math.sin(angle) * 0.3, z],
      ray % 2 ? palette.mossLight : palette.sun,
      [0, 0, angle - Math.PI / 2],
    );
  }
}

function basket(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  palette: WildPalette,
): void {
  cylinder(root, name, 0.2, 0.15, 0.34, [x, 0.17, z], palette.reed, 10);
  torus(root, `${name}-rim`, 0.2, 0.025, [x, 0.34, z], palette.reedDark);
  for (let item = 0; item < 5; item += 1)
    sphere(
      root,
      `${name}-produce`,
      0.055,
      [0.8, 1.2, 0.8],
      [x - 0.12 + item * 0.06, 0.41 + (item % 2) * 0.04, z],
      item % 2 ? palette.mossLight : palette.clay,
    );
}

function firePit(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: WildPalette,
): void {
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    boulder(
      root,
      `${name}-stone`,
      [x + Math.sin(angle) * 0.26 * scale, 0.07, z + Math.cos(angle) * 0.26 * scale],
      0.09 * scale,
      palette,
      false,
    );
  }
  for (const angle of [-0.65, 0.65])
    cylinder(
      root,
      `${name}-charred-log`,
      0.04,
      0.055,
      0.5 * scale,
      [x, 0.14, z],
      palette.smoke,
      7,
      [Math.PI / 2, 0, angle],
    );
  cone(root, name, 0.2 * scale, 0.58 * scale, [x, 0.34 * scale, z], palette.ember, [0, 0, 0], true);
}

function stair(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  width: number,
  height: number,
  count: number,
  palette: WildPalette,
): void {
  for (let step = 0; step < count; step += 1) {
    const p = (step + 1) / count;
    block(
      root,
      name,
      [width, 0.12, 0.28],
      [x, p * height - 0.05, z + (step - count / 2) * 0.24],
      step % 2 ? palette.cave : palette.caveDark,
      [0, (step % 2 ? -1 : 1) * 0.025, 0],
      0.04,
    );
  }
}

function reedHouse(root: THREE.Group, s: BuildingVolumeDimensions, palette: WildPalette): void {
  const floorY = 0.3;
  block(
    root,
    "reed-house-curved-dock",
    [s.width * 0.92, 0.16, s.depth * 0.8],
    [0, floorY, 0],
    palette.reedDark,
    [0, 0, 0],
    0.14,
    true,
  );
  for (const x of [-s.width * 0.4, -s.width * 0.13, s.width * 0.13, s.width * 0.4])
    for (const z of [-s.depth * 0.34, s.depth * 0.34])
      beam(
        root,
        "reed-house-water-stilt",
        [x * 1.08, 0, z * 1.06],
        [x, floorY, z],
        0.055,
        palette.reedDark,
      );
  for (let bundle = 0; bundle < 14; bundle += 1) {
    const angle = (bundle / 14) * Math.PI * 2;
    if (Math.cos(angle) > 0.72) continue;
    reedBundle(
      root,
      "reed-house-bundled-wall",
      Math.sin(angle) * s.width * 0.4,
      Math.cos(angle) * s.depth * 0.34,
      s.wallHeight * (0.72 + (bundle % 3) * 0.06),
      palette,
      Math.sin(angle) * 0.05,
    );
  }
  reedGableRoof(
    root,
    "reed-house-layered-thatch-roof",
    s.width * 1.02,
    s.depth * 0.94,
    s.wallHeight * 0.78,
    s.roofHeight * 0.78,
    palette,
  );
  block(
    root,
    "reed-house-door",
    [s.width * 0.3, s.wallHeight * 0.58, 0.08],
    [0, floorY + s.wallHeight * 0.3, s.depth * 0.37],
    palette.clayDark,
    [0, 0, 0],
    0.12,
  );
  carvedMask(
    root,
    "reed-house-family-mask",
    0,
    floorY + s.wallHeight * 0.72,
    s.depth * 0.44,
    0.6,
    palette,
  );
  stair(root, "reed-house-dock-steps", 0, s.depth * 0.55, s.width * 0.32, floorY, 3, palette);
  basket(root, "reed-house-fishing-basket", -s.width * 0.38, s.depth * 0.32, palette);
}

function turtleShellHut(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: WildPalette,
): void {
  const shellY = s.wallHeight * 0.42;
  sphere(
    root,
    "turtle-shell-hut-dome",
    s.width * 0.42,
    [1, 0.72, s.depth / s.width],
    [0, shellY, 0],
    palette.caveDark,
    true,
  );
  for (let layer = 0; layer < 4; layer += 1) {
    const count = 7 - layer;
    for (let tile = 0; tile < count; tile += 1)
      shellTile(
        root,
        "turtle-shell-hut-carapace-tile",
        (tile / count) * Math.PI * 2 + layer * 0.22,
        s.width * (0.34 - layer * 0.045),
        shellY + layer * s.wallHeight * 0.16,
        palette,
        layer,
      );
  }
  for (const side of [-1, 1]) {
    for (const z of [-s.depth * 0.27, s.depth * 0.25])
      sphere(
        root,
        "turtle-shell-hut-splayed-foot",
        0.22,
        [1.35, 0.45, 0.78],
        [side * s.width * 0.39, 0.13, z],
        palette.moss,
      );
  }
  torus(
    root,
    "turtle-shell-hut-round-door",
    s.width * 0.15,
    0.055,
    [0, s.wallHeight * 0.35, s.depth * 0.39],
    palette.sun,
    [0, 0, 0],
    Math.PI * 2,
    true,
  );
  block(
    root,
    "turtle-shell-hut-door-leaf",
    [s.width * 0.25, s.wallHeight * 0.42, 0.08],
    [0, s.wallHeight * 0.34, s.depth * 0.42],
    palette.lizardDark,
    [0, 0, 0],
    0.14,
  );
  for (const side of [-1, 1])
    reedBundle(
      root,
      "turtle-shell-hut-reed-clump",
      side * s.width * 0.43,
      -s.depth * 0.25,
      s.wallHeight * 0.72,
      palette,
      side * 0.08,
    );
  firePit(root, "turtle-shell-hut-cooking-fire", s.width * 0.28, s.depth * 0.3, 0.45, palette);
  basket(root, "turtle-shell-hut-storage", -s.width * 0.3, s.depth * 0.3, palette);
}

function ancestorZiggurat(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: WildPalette,
): void {
  for (let tier = 0; tier < 4; tier += 1) {
    const width = s.width * (0.96 - tier * 0.16);
    const depth = s.depth * (0.92 - tier * 0.14);
    const y = 0.13 + tier * 0.28;
    block(
      root,
      "ancestor-ziggurat-stepped-temple",
      [width, 0.26, depth],
      [0, y, -tier * 0.04],
      tier % 2 ? palette.caveDark : palette.cave,
      [0, 0, 0],
      0.07,
      tier === 0 || tier === 3,
    );
    for (let stone = 0; stone < 12; stone += 1) {
      const angle = (stone / 12) * Math.PI * 2;
      boulder(
        root,
        "ancestor-ziggurat-edge-masonry",
        [Math.sin(angle) * width * 0.47, y + 0.15, -tier * 0.04 + Math.cos(angle) * depth * 0.45],
        0.105,
        palette,
        (stone + tier) % 4 === 0,
      );
    }
  }
  const altarY = 1.18;
  for (const side of [-1, 1])
    reedBundle(
      root,
      "ancestor-ziggurat-canopy-column",
      side * s.width * 0.26,
      -s.depth * 0.18,
      s.wallHeight * 0.9,
      palette,
      side * -0.04,
    );
  leafCanopy(
    root,
    "ancestor-ziggurat-sacred-canopy",
    s.wallHeight * 0.88,
    s.width * 0.34,
    5,
    palette,
  );
  carvedMask(
    root,
    "ancestor-ziggurat-great-ancestor-mask",
    0,
    altarY + s.wallHeight * 0.5,
    -s.depth * 0.2,
    1.55,
    palette,
  );
  block(
    root,
    "ancestor-ziggurat-offering-altar",
    [s.width * 0.42, 0.28, s.depth * 0.28],
    [0, altarY + 0.14, s.depth * 0.12],
    palette.clay,
    [0, 0, 0],
    0.08,
    true,
  );
  for (const side of [-1, 1])
    firePit(
      root,
      "ancestor-ziggurat-sacred-brazier",
      side * s.width * 0.32,
      s.depth * 0.22,
      0.42,
      palette,
    );
  stair(
    root,
    "ancestor-ziggurat-processional-stairs",
    0,
    s.depth * 0.58,
    s.width * 0.32,
    1.05,
    6,
    palette,
  );
}

function sunwatchSpire(root: THREE.Group, s: BuildingVolumeDimensions, palette: WildPalette): void {
  for (let course = 0; course < 8; course += 1) {
    const count = 7 - Math.floor(course / 3);
    for (let stone = 0; stone < count; stone += 1) {
      const angle = (stone / count) * Math.PI * 2 + course * 0.24;
      boulder(
        root,
        "sunwatch-spire-spiral-masonry",
        [
          Math.sin(angle) * s.width * (0.29 - course * 0.012),
          0.18 + course * s.wallHeight * 0.13,
          Math.cos(angle) * s.depth * (0.26 - course * 0.01),
        ],
        0.18 - course * 0.008,
        palette,
        (course + stone) % 5 === 0,
        course === 7 && stone === 0,
      );
    }
  }
  const deckY = s.wallHeight * 1.08;
  cylinder(
    root,
    "sunwatch-spire-lookout-deck",
    s.width * 0.34,
    s.width * 0.3,
    0.18,
    [0, deckY, 0],
    palette.reedDark,
    14,
    [0, 0, 0],
    true,
  );
  for (let post = 0; post < 8; post += 1) {
    const angle = (post / 8) * Math.PI * 2;
    reedBundle(
      root,
      "sunwatch-spire-lookout-reeds",
      Math.sin(angle) * s.width * 0.3,
      Math.cos(angle) * s.depth * 0.27,
      s.wallHeight * 0.48,
      palette,
      Math.sin(angle) * 0.04,
    );
  }
  leafCanopy(
    root,
    "sunwatch-spire-lookout-canopy",
    deckY + s.roofHeight * 0.54,
    s.width * 0.3,
    5,
    palette,
  );
  sunTotem(root, "sunwatch-spire-great-sun-disc", 0, 0, s.wallHeight + s.roofHeight * 1.4, palette);
  stair(
    root,
    "sunwatch-spire-spiral-entry",
    s.width * 0.28,
    s.depth * 0.28,
    s.width * 0.24,
    deckY,
    7,
    palette,
  );
  basket(root, "sunwatch-spire-signal-basket", -s.width * 0.26, s.depth * 0.25, palette);
}

function spearDanceCourt(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: WildPalette,
): void {
  stoneRing(root, "spear-dance-court-dance-ring", s.width * 0.44, s.depth * 0.4, 28, palette);
  for (let spear = 0; spear < 14; spear += 1) {
    const angle = (spear / 14) * Math.PI * 2;
    const x = Math.sin(angle) * s.width * 0.38;
    const z = Math.cos(angle) * s.depth * 0.34;
    beam(
      root,
      "spear-dance-court-ceremonial-spear",
      [x, 0.12, z],
      [
        x + Math.sin(angle) * 0.1,
        s.wallHeight * (0.7 + (spear % 3) * 0.08),
        z + Math.cos(angle) * 0.1,
      ],
      0.025,
      spear % 2 ? palette.reed : palette.reedDark,
      spear % 7 === 0,
    );
    cone(
      root,
      "spear-dance-court-spearhead",
      0.055,
      0.23,
      [
        x + Math.sin(angle) * 0.1,
        s.wallHeight * (0.82 + (spear % 3) * 0.08),
        z + Math.cos(angle) * 0.1,
      ],
      spear % 2 ? palette.sun : palette.lizardDark,
    );
    block(
      root,
      "spear-dance-court-streamer",
      [0.2, 0.32, 0.035],
      [x - Math.sin(angle) * 0.04, s.wallHeight * 0.58, z - Math.cos(angle) * 0.04],
      spear % 3 ? palette.leaf : palette.clay,
      [0, angle, (spear % 2 ? -1 : 1) * 0.16],
      0.05,
    );
  }
  sunTotem(root, "spear-dance-court-dance-pole", 0, 0, s.wallHeight + s.roofHeight * 0.9, palette);
  for (let drum = 0; drum < 4; drum += 1) {
    const angle = -1.2 + drum * 0.8;
    const x = Math.sin(angle) * s.width * 0.28;
    const z = s.depth * 0.3 + Math.cos(angle) * s.depth * 0.08;
    cylinder(
      root,
      "spear-dance-court-drum",
      0.18,
      0.2,
      0.34,
      [x, 0.3, z],
      drum % 2 ? palette.clay : palette.clayDark,
      10,
      [Math.PI / 2, 0, angle],
    );
    torus(
      root,
      "spear-dance-court-drum-rim",
      0.19,
      0.025,
      [x, 0.3, z + 0.18],
      palette.sun,
      [0, 0, 0],
    );
  }
  firePit(root, "spear-dance-court-rhythm-fire", 0, -s.depth * 0.24, 0.52, palette);
}

function trialCenote(root: THREE.Group, s: BuildingVolumeDimensions, palette: WildPalette): void {
  stoneRing(root, "trial-cenote-sunken-rim", s.width * 0.45, s.depth * 0.41, 32, palette);
  cylinder(
    root,
    "trial-cenote-water-basin",
    s.width * 0.34,
    s.width * 0.38,
    0.12,
    [0, 0.08, 0],
    palette.water,
    18,
    [0, 0, 0],
    true,
  );
  for (let pillar = 0; pillar < 12; pillar += 1) {
    const angle = (pillar / 12) * Math.PI * 2;
    const x = Math.sin(angle) * s.width * 0.39;
    const z = Math.cos(angle) * s.depth * 0.36;
    boulder(
      root,
      "trial-cenote-cliff-pillar",
      [x, s.wallHeight * (0.2 + (pillar % 4) * 0.08), z],
      0.23,
      palette,
      pillar % 3 === 0,
      pillar % 6 === 0,
    );
    boulder(
      root,
      "trial-cenote-cliff-pillar",
      [x * 1.02, s.wallHeight * (0.42 + (pillar % 3) * 0.08), z * 1.02],
      0.19,
      palette,
      pillar % 4 === 0,
    );
    beam(
      root,
      "trial-cenote-hanging-vine",
      [x, s.wallHeight * 0.72, z],
      [x * 0.82, s.wallHeight * (0.18 + (pillar % 3) * 0.06), z * 0.82],
      0.018,
      pillar % 2 ? palette.leaf : palette.leafBright,
    );
  }
  for (let step = 0; step < 8; step += 1) {
    const angle = -1.3 + step * 0.36;
    boulder(
      root,
      "trial-cenote-stepping-stone",
      [Math.sin(angle) * s.width * 0.27, 0.17 + step * 0.035, Math.cos(angle) * s.depth * 0.24],
      0.16,
      palette,
      step % 2 === 0,
    );
  }
  for (const side of [-1, 1])
    sunTotem(
      root,
      "trial-cenote-guardian-marker",
      side * s.width * 0.39,
      s.depth * 0.34,
      s.wallHeight * 0.82,
      palette,
    );
  carvedMask(
    root,
    "trial-cenote-water-spirit",
    0,
    s.wallHeight * 0.72,
    -s.depth * 0.38,
    0.85,
    palette,
  );
  block(
    root,
    "trial-cenote-carved-offering-altar",
    [s.width * 0.38, 0.3, s.depth * 0.24],
    [0, 0.26, -s.depth * 0.26],
    palette.clay,
    [0, 0, 0],
    0.1,
    true,
  );
  leafPetal(
    root,
    "trial-cenote-offering-raft",
    [0, 0.2, 0],
    s.width * 0.42,
    s.width * 0.13,
    Math.PI / 2,
    palette,
    true,
    true,
  );
}

function rainLodge(root: THREE.Group, s: BuildingVolumeDimensions, palette: WildPalette): void {
  stoneRing(root, "rain-lodge-catchment-ring", s.width * 0.43, s.depth * 0.4, 24, palette);
  const roofY = s.wallHeight * 0.82;
  for (let post = 0; post < 8; post += 1) {
    const angle = (post / 8) * Math.PI * 2;
    reedBundle(
      root,
      "rain-lodge-bundled-column",
      Math.sin(angle) * s.width * 0.38,
      Math.cos(angle) * s.depth * 0.34,
      roofY,
      palette,
      Math.sin(angle) * -0.05,
    );
  }
  leafCanopy(
    root,
    "rain-lodge-umbrella-roof",
    roofY + s.roofHeight * 0.3,
    s.width * 0.72,
    14,
    palette,
  );
  for (let gutter = 0; gutter < 8; gutter += 1) {
    const angle = (gutter / 8) * Math.PI * 2;
    beam(
      root,
      "rain-lodge-leaf-gutter",
      [Math.sin(angle) * s.width * 0.12, roofY + 0.12, Math.cos(angle) * s.depth * 0.1],
      [Math.sin(angle) * s.width * 0.5, roofY - 0.06, Math.cos(angle) * s.depth * 0.46],
      0.028,
      gutter % 2 ? palette.water : palette.reedDark,
    );
  }
  for (let seat = 0; seat < 8; seat += 1) {
    const angle = (seat / 8) * Math.PI * 2;
    block(
      root,
      "rain-lodge-story-seat",
      [0.42, 0.18, 0.28],
      [Math.sin(angle) * s.width * 0.28, 0.3, Math.cos(angle) * s.depth * 0.25],
      seat % 2 ? palette.reed : palette.cave,
      [0, angle, 0],
      0.09,
    );
  }
  for (let jar = 0; jar < 4; jar += 1) {
    const angle = (jar / 4) * Math.PI * 2 + Math.PI / 4;
    cylinder(
      root,
      "rain-lodge-water-jar",
      0.16,
      0.22,
      0.48,
      [Math.sin(angle) * s.width * 0.36, 0.24, Math.cos(angle) * s.depth * 0.32],
      jar % 2 ? palette.clay : palette.clayDark,
      10,
    );
    torus(
      root,
      "rain-lodge-jar-rim",
      0.16,
      0.025,
      [Math.sin(angle) * s.width * 0.36, 0.48, Math.cos(angle) * s.depth * 0.32],
      palette.sun,
    );
  }
  firePit(root, "rain-lodge-central-hearth", 0, 0, 0.72, palette);
  sunTotem(
    root,
    "rain-lodge-weather-vane",
    0,
    -s.depth * 0.37,
    s.wallHeight + s.roofHeight * 0.88,
    palette,
  );
}

function spiritCave(root: THREE.Group, s: BuildingVolumeDimensions, palette: WildPalette): void {
  for (let layer = 0; layer < 5; layer += 1) {
    const count = 10 - layer;
    for (let stone = 0; stone < count; stone += 1) {
      const angle = -Math.PI * 0.82 + (stone / Math.max(count - 1, 1)) * Math.PI * 1.64;
      const radiusX = s.width * (0.44 - layer * 0.035);
      const radiusZ = s.depth * (0.39 - layer * 0.025);
      boulder(
        root,
        "spirit-cave-living-rock-shell",
        [
          Math.sin(angle) * radiusX,
          0.18 + layer * s.wallHeight * 0.17,
          -s.depth * 0.08 + Math.cos(angle) * radiusZ,
        ],
        0.2 - layer * 0.012,
        palette,
        (stone + layer) % 3 === 0,
        layer === 4 && stone === Math.floor(count / 2),
      );
    }
  }
  block(
    root,
    "spirit-cave-shadowed-sanctum",
    [s.width * 0.55, s.wallHeight * 0.62, s.depth * 0.64],
    [0, s.wallHeight * 0.31, -s.depth * 0.04],
    palette.smoke,
    [0, 0, 0],
    0.24,
    true,
  );
  torus(
    root,
    "spirit-cave-rounded-mouth",
    s.width * 0.2,
    0.075,
    [0, s.wallHeight * 0.34, s.depth * 0.35],
    palette.cave,
    [0, 0, 0],
    Math.PI * 2,
    true,
  );
  for (let glyph = 0; glyph < 8; glyph += 1) {
    const angle = (glyph / 8) * Math.PI * 2;
    boulder(
      root,
      "spirit-cave-glyph-stone",
      [Math.sin(angle) * s.width * 0.35, 0.2, s.depth * 0.12 + Math.cos(angle) * s.depth * 0.27],
      0.14,
      palette,
      glyph % 2 === 0,
    );
    torus(
      root,
      "spirit-cave-glowing-glyph",
      0.075,
      0.018,
      [
        Math.sin(angle) * s.width * 0.35,
        0.23,
        s.depth * 0.12 + Math.cos(angle) * s.depth * 0.27 + 0.09,
      ],
      glyph % 2 ? palette.sun : palette.water,
      [0, 0, 0],
      glyph % 3 === 0 ? Math.PI : Math.PI * 2,
    );
  }
  block(
    root,
    "spirit-cave-offering-altar",
    [s.width * 0.4, 0.32, s.depth * 0.28],
    [0, 0.28, s.depth * 0.18],
    palette.clay,
    [0, 0, 0],
    0.1,
  );
  carvedMask(
    root,
    "spirit-cave-oracle-mask",
    0,
    s.wallHeight * 0.72,
    -s.depth * 0.21,
    1.05,
    palette,
  );
  for (const side of [-1, 1])
    reedBundle(
      root,
      "spirit-cave-incense-reeds",
      side * s.width * 0.3,
      s.depth * 0.31,
      s.wallHeight * 0.64,
      palette,
      side * 0.04,
    );
}

function dryingWharf(root: THREE.Group, s: BuildingVolumeDimensions, palette: WildPalette): void {
  const deckY = 0.38;
  for (let slat = 0; slat < 15; slat += 1)
    block(
      root,
      "drying-wharf-deck-slat",
      [s.width * 0.92, 0.09, s.depth * 0.045],
      [0, deckY, -s.depth * 0.38 + slat * s.depth * 0.055],
      slat % 2 ? palette.reed : palette.reedDark,
      [0, ((slat % 3) - 1) * 0.018, 0],
      0.018,
      slat === 0,
    );
  for (const x of [-s.width * 0.4, -s.width * 0.13, s.width * 0.13, s.width * 0.4])
    for (const z of [-s.depth * 0.36, s.depth * 0.36])
      beam(
        root,
        "drying-wharf-water-pile",
        [x * 1.06, 0, z * 1.08],
        [x, deckY, z],
        0.055,
        palette.reedDark,
      );
  for (let rack = 0; rack < 4; rack += 1) {
    const x = -s.width * 0.34 + rack * s.width * 0.23;
    for (const z of [-s.depth * 0.25, s.depth * 0.24])
      reedBundle(root, "drying-wharf-rack-post", x, z, s.wallHeight * 0.8, palette);
    beam(
      root,
      "drying-wharf-rack-crossbar",
      [x - s.width * 0.1, s.wallHeight * 0.75, 0],
      [x + s.width * 0.1, s.wallHeight * 0.75, 0],
      0.035,
      palette.reedDark,
    );
    for (let food = 0; food < 5; food += 1) {
      beam(
        root,
        "drying-wharf-food-cord",
        [x - 0.12 + food * 0.06, s.wallHeight * 0.7, 0],
        [x - 0.12 + food * 0.06, s.wallHeight * (0.48 - (food % 2) * 0.06), 0],
        0.01,
        palette.lizardDark,
      );
      sphere(
        root,
        "drying-wharf-smoked-food",
        0.065,
        [0.65, 1.45, 0.5],
        [x - 0.12 + food * 0.06, s.wallHeight * (0.43 - (food % 2) * 0.06), 0],
        food % 2 ? palette.clay : palette.lizard,
      );
    }
  }
  for (const side of [-1, 1]) {
    firePit(
      root,
      "drying-wharf-smoke-brazier",
      side * s.width * 0.27,
      -s.depth * 0.18,
      0.45,
      palette,
    );
    basket(root, "drying-wharf-catch-basket", side * s.width * 0.37, s.depth * 0.3, palette);
  }
  leanReedAwning(
    root,
    "drying-wharf-long-weather-awning",
    s.width * 0.82,
    s.depth * 0.68,
    s.wallHeight * 0.88,
    palette,
  );
  stair(root, "drying-wharf-landing-steps", 0, s.depth * 0.54, s.width * 0.3, deckY, 4, palette);
}

function weaversWorkshop(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: WildPalette,
): void {
  cylinder(
    root,
    "weavers-workshop-round-floor",
    s.width * 0.45,
    s.width * 0.48,
    0.16,
    [0, 0.12, 0],
    palette.reedDark,
    16,
    [0, 0, 0],
    true,
  );
  const roofY = s.wallHeight * 0.86;
  for (let post = 0; post < 8; post += 1) {
    const angle = (post / 8) * Math.PI * 2;
    reedBundle(
      root,
      "weavers-workshop-fan-column",
      Math.sin(angle) * s.width * 0.4,
      Math.cos(angle) * s.depth * 0.36,
      roofY,
      palette,
      Math.sin(angle) * -0.08,
    );
  }
  wovenFan(
    root,
    "weavers-workshop-coloured-fan",
    s.width * 0.92,
    roofY + s.roofHeight * 0.6,
    -s.depth * 0.28,
    palette,
  );
  for (let loom = 0; loom < 4; loom += 1) {
    const angle = (loom / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.sin(angle) * s.width * 0.25;
    const z = Math.cos(angle) * s.depth * 0.22;
    for (const side of [-1, 1])
      beam(
        root,
        "weavers-workshop-loom-frame",
        [x + side * 0.24, 0.22, z],
        [x + side * 0.24, s.wallHeight * 0.72, z],
        0.035,
        palette.reedDark,
      );
    beam(
      root,
      "weavers-workshop-loom-top",
      [x - 0.27, s.wallHeight * 0.7, z],
      [x + 0.27, s.wallHeight * 0.7, z],
      0.035,
      palette.reed,
    );
    for (let thread = 0; thread < 7; thread += 1)
      beam(
        root,
        "weavers-workshop-coloured-warp",
        [x - 0.2 + thread * 0.067, 0.3, z + 0.01],
        [x - 0.2 + thread * 0.067, s.wallHeight * 0.66, z + 0.01],
        0.009,
        thread % 3 === 0 ? palette.sun : thread % 3 === 1 ? palette.lizard : palette.clay,
      );
    block(
      root,
      "weavers-workshop-woven-panel",
      [0.44, s.wallHeight * 0.28, 0.035],
      [x, s.wallHeight * 0.48, z + 0.02],
      loom % 2 ? palette.leaf : palette.clay,
      [0, angle, 0],
      0.04,
    );
  }
  for (let pot = 0; pot < 5; pot += 1) {
    const x = -s.width * 0.3 + pot * s.width * 0.15;
    cylinder(
      root,
      "weavers-workshop-dye-pot",
      0.16,
      0.21,
      0.32,
      [x, 0.18, s.depth * 0.33],
      pot % 2 ? palette.clay : palette.clayDark,
      10,
    );
    torus(
      root,
      "weavers-workshop-dye-pot-rim",
      0.16,
      0.024,
      [x, 0.34, s.depth * 0.33],
      pot % 3 === 0 ? palette.sun : pot % 3 === 1 ? palette.water : palette.leafBright,
    );
  }
  basket(root, "weavers-workshop-reed-basket", -s.width * 0.4, -s.depth * 0.28, palette);
  basket(root, "weavers-workshop-dyed-fibre-basket", s.width * 0.4, -s.depth * 0.28, palette);
  sunTotem(
    root,
    "weavers-workshop-craft-sign",
    0,
    -s.depth * 0.4,
    s.wallHeight + s.roofHeight * 0.72,
    palette,
  );
}

export function buildWildTribeBuildingVolume(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  materials: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  const palette = wildPalette(materials);
  switch (archetype) {
    case "housing-a":
      reedHouse(root, size, palette);
      break;
    case "housing-b":
      turtleShellHut(root, size, palette);
      break;
    case "command-a":
      ancestorZiggurat(root, size, palette);
      break;
    case "command-b":
      sunwatchSpire(root, size, palette);
      break;
    case "training-a":
      spearDanceCourt(root, size, palette);
      break;
    case "training-b":
      trialCenote(root, size, palette);
      break;
    case "community-a":
      rainLodge(root, size, palette);
      break;
    case "community-b":
      spiritCave(root, size, palette);
      break;
    case "daily-life-a":
      dryingWharf(root, size, palette);
      break;
    case "daily-life-b":
      weaversWorkshop(root, size, palette);
      break;
  }
}
