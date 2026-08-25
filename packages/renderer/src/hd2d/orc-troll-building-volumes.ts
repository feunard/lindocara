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

interface OrcPalette {
  bark: THREE.Material;
  barkDark: THREE.Material;
  log: THREE.Material;
  logLight: THREE.Material;
  hide: THREE.Material;
  hideDark: THREE.Material;
  moss: THREE.Material;
  rock: THREE.Material;
  rockDark: THREE.Material;
  iron: THREE.Material;
  ironDark: THREE.Material;
  bone: THREE.Material;
  rope: THREE.Material;
  ember: THREE.Material;
  fire: THREE.Material;
  soot: THREE.Material;
}

const ROOT_BARK: PixelCrop = {
  x: 62,
  y: 68,
  width: 252,
  height: 214,
  sourceWidth: 384,
  sourceHeight: 320,
};
const ROOT_HEARTWOOD: PixelCrop = {
  x: 112,
  y: 105,
  width: 154,
  height: 143,
  sourceWidth: 384,
  sourceHeight: 320,
};
const TROLL_HIDE: PixelCrop = {
  x: 104,
  y: 52,
  width: 205,
  height: 220,
  sourceWidth: 4608,
  sourceHeight: 384,
};

function textureOf(material: THREE.Material): THREE.Texture | null {
  return material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshStandardMaterial
    ? material.map
    : null;
}

function sampledTexture(source: THREE.Texture | null, crop?: PixelCrop): THREE.Texture | null {
  if (!source) return null;
  let texture: THREE.Texture;
  if (
    crop &&
    typeof document !== "undefined" &&
    typeof HTMLImageElement !== "undefined" &&
    source.image instanceof HTMLImageElement
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Orc material crop requires a 2D canvas context");
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
  }
  if (crop && !(texture instanceof THREE.CanvasTexture)) {
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

function surface(
  source: THREE.Texture | null,
  color: number,
  crop?: PixelCrop,
  emissive = 0x000000,
): THREE.MeshLambertMaterial {
  const map = sampledTexture(source, crop);
  const material = new THREE.MeshLambertMaterial({
    color,
    map,
    emissive: emissive === 0 ? new THREE.Color(color).multiplyScalar(map ? 0.13 : 0.06) : emissive,
    emissiveIntensity: emissive === 0 ? 1 : 0.72,
    flatShading: true,
  });
  if (map) material.userData.lindocaraOwnedMap = true;
  return material;
}

function orcPalette(materials: FactionBuildingMaterials): OrcPalette {
  const root = materials.factionPrimary ?? textureOf(materials.wood);
  const troll = materials.factionDetail ?? root;
  return {
    bark: surface(root, 0xb17a55, ROOT_BARK),
    barkDark: surface(root, 0x725468, ROOT_HEARTWOOD),
    log: surface(root, 0xd69a61, ROOT_HEARTWOOD),
    logLight: surface(root, 0xf0c27c, ROOT_HEARTWOOD),
    hide: surface(troll, 0xc56558, TROLL_HIDE),
    hideDark: surface(troll, 0x754250, TROLL_HIDE),
    moss: surface(troll, 0x77975a, TROLL_HIDE),
    rock: surface(root, 0x84858b, ROOT_BARK),
    rockDark: surface(root, 0x4b4e5d, ROOT_HEARTWOOD),
    iron: surface(null, 0x6e7680),
    ironDark: surface(null, 0x343946),
    bone: surface(null, 0xe0c991),
    rope: surface(null, 0xc69a5a),
    ember: surface(null, 0xffc04c, undefined, 0xff8a20),
    fire: surface(null, 0xff7136, undefined, 0xff3e18),
    soot: surface(null, 0x292b35),
  };
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
  if (outline) {
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 34),
      new THREE.LineBasicMaterial({ color: 0x252839, transparent: true, opacity: 0.58 }),
    );
    line.name = "orc-troll-silhouette-line";
    mesh.add(line);
  }
  root.add(mesh);
  return mesh;
}

function roundedShape(width: number, height: number, radius: number): THREE.Shape {
  const x = width / 2;
  const y = height / 2;
  const r = Math.min(radius, x * 0.44, y * 0.44);
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  return shape;
}

function block(
  root: THREE.Object3D,
  name: string,
  size: Size3,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
  bevel = 0.035,
  outline = false,
): THREE.Mesh {
  const [width, height, depth] = size;
  const geometry = new THREE.ExtrudeGeometry(roundedShape(width, height, bevel * 1.4), {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 3,
  });
  geometry.translate(0, 0, -depth / 2);
  return part(root, name, geometry, material, at, rotation, outline);
}

function cylinder(
  root: THREE.Object3D,
  name: string,
  top: number,
  bottom: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  segments = 8,
  rotation: Point3 = [0, 0, 0],
  outline = false,
): THREE.Mesh {
  return part(
    root,
    name,
    new THREE.CylinderGeometry(top, bottom, height, segments, 1),
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
    new THREE.DodecahedronGeometry(radius, 1),
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
  return part(
    root,
    name,
    new THREE.ConeGeometry(radius, height, 9),
    material,
    at,
    rotation,
    outline,
  );
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
  return part(root, name, new THREE.TorusGeometry(radius, tube, 6, 16), material, at, rotation);
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
  const mesh = part(
    root,
    name,
    new THREE.CylinderGeometry(radius * 0.86, radius, delta.length(), 7),
    material,
    [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    [0, 0, 0],
    outline,
  );
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function rope(
  root: THREE.Object3D,
  name: string,
  from: Point3,
  to: Point3,
  sag: number,
  material: THREE.Material,
): void {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const middle = start.clone().add(end).multiplyScalar(0.5);
  middle.y -= sag;
  part(
    root,
    name,
    new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, middle, end), 10, 0.022, 5),
    material,
    [0, 0, 0],
  );
}

function boulder(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  radius: number,
  palette: OrcPalette,
  scale: Point3 = [1, 1, 1],
  dark = false,
): THREE.Mesh {
  const rock = part(
    root,
    name,
    new THREE.DodecahedronGeometry(radius, 0),
    dark ? palette.rockDark : palette.rock,
    at,
    [0.08, at[0] * 0.37, -0.05],
  );
  rock.scale.set(...scale);
  return rock;
}

function stoneRing(
  root: THREE.Object3D,
  name: string,
  radiusX: number,
  radiusZ: number,
  count: number,
  palette: OrcPalette,
  y = 0.1,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    boulder(
      root,
      name,
      [Math.sin(angle) * radiusX, y + (index % 2) * 0.035, Math.cos(angle) * radiusZ],
      0.16 + (index % 3) * 0.016,
      palette,
      [1.2, 0.72, 0.92],
      index % 4 === 0,
    );
  }
}

function boulderWall(
  root: THREE.Object3D,
  name: string,
  width: number,
  height: number,
  z: number,
  palette: OrcPalette,
  doorGap = 0.5,
): void {
  const courses = Math.max(3, Math.round(height / 0.28));
  const columns = Math.max(7, Math.round(width / 0.32));
  for (let course = 0; course < courses; course += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -width / 2 + ((column + 0.5) * width) / columns + (course % 2) * 0.08;
      if (Math.abs(x) < doorGap / 2 && course < courses - 1) continue;
      boulder(
        root,
        name,
        [x, 0.15 + course * (height / courses), z + ((column + course) % 2) * 0.025],
        0.18,
        palette,
        [1.12, 0.76, 0.84],
        (column + course) % 5 === 0,
      );
    }
  }
}

function logWall(
  root: THREE.Object3D,
  name: string,
  width: number,
  height: number,
  z: number,
  palette: OrcPalette,
  doorGap = 0.52,
): void {
  const count = Math.max(7, Math.round(width / 0.2));
  for (let index = 0; index < count; index += 1) {
    const x = -width / 2 + ((index + 0.5) * width) / count;
    if (Math.abs(x) < doorGap / 2) continue;
    const h = height * (0.93 + (index % 3) * 0.035);
    beam(
      root,
      name,
      [x, 0, z],
      [x + ((index % 3) - 1) * 0.025, h, z],
      0.082,
      index % 3 === 0 ? palette.logLight : palette.log,
    );
  }
  beam(root, `${name}-sill`, [-width / 2, 0.1, z], [width / 2, 0.1, z], 0.07, palette.barkDark);
  beam(
    root,
    `${name}-plate`,
    [-width / 2, height * 0.9, z],
    [width / 2, height * 0.9, z],
    0.07,
    palette.barkDark,
  );
}

function plateRoof(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  palette: OrcPalette,
  hide = false,
): void {
  const rows = 5;
  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row += 1) {
      const t = (row + 0.5) / rows;
      const x = side * width * (0.5 - t * 0.25);
      const y = eaveY + t * rise;
      block(
        root,
        `${name}-overlapping-plate`,
        [width / (rows * 1.55), 0.075, depth * (1.04 + (row % 2) * 0.035)],
        [x, y, 0],
        hide ? (row % 2 === 0 ? palette.hide : palette.hideDark) : palette.log,
        [0, 0, side * -Math.atan2(rise, width / 2)],
        0.025,
      );
    }
  }
  beam(
    root,
    `${name}-ridge-log`,
    [0, eaveY + rise, -depth * 0.57],
    [0, eaveY + rise, depth * 0.57],
    0.085,
    palette.logLight,
    true,
  );
  for (const z of [-depth * 0.46, 0, depth * 0.46]) {
    beam(
      root,
      `${name}-roof-rib-left`,
      [-width * 0.52, eaveY, z],
      [0, eaveY + rise, z],
      0.048,
      palette.barkDark,
    );
    beam(
      root,
      `${name}-roof-rib-right`,
      [0, eaveY + rise, z],
      [width * 0.52, eaveY, z],
      0.048,
      palette.barkDark,
    );
  }
}

function door(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  width: number,
  height: number,
  palette: OrcPalette,
  y = 0,
): void {
  block(
    root,
    `${name}-recess`,
    [width + 0.18, height + 0.12, 0.12],
    [x, y + height / 2, z],
    palette.soot,
    [0, 0, 0],
    0.06,
    true,
  );
  for (let plank = 0; plank < 5; plank += 1) {
    const plankWidth = width / 5;
    block(
      root,
      name,
      [plankWidth * 0.92, height, 0.12],
      [x - width / 2 + plankWidth * (plank + 0.5), y + height / 2, z + 0.08],
      plank % 2 === 0 ? palette.hideDark : palette.barkDark,
      [0, 0, (plank - 2) * 0.008],
      0.018,
    );
  }
  beam(
    root,
    `${name}-iron-bar`,
    [x - width * 0.43, y + height * 0.58, z + 0.16],
    [x + width * 0.43, y + height * 0.58, z + 0.16],
    0.035,
    palette.iron,
  );
  torus(
    root,
    `${name}-ring`,
    0.065,
    0.016,
    [x + width * 0.24, y + height * 0.48, z + 0.19],
    palette.iron,
  );
}

function stair(
  root: THREE.Object3D,
  name: string,
  x: number,
  frontZ: number,
  width: number,
  height: number,
  steps: number,
  palette: OrcPalette,
): void {
  for (let index = 0; index < steps; index += 1) {
    block(
      root,
      name,
      [width, height / steps, 0.27],
      [x, ((index + 0.5) * height) / steps, frontZ - index * 0.21],
      index % 2 === 0 ? palette.log : palette.logLight,
      [0, 0, 0],
      0.03,
    );
  }
}

function skull(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  scale: number,
  palette: OrcPalette,
): void {
  sphere(root, name, 0.16 * scale, [0.9, 1, 0.72], at, palette.bone);
  for (const side of [-1, 1]) {
    sphere(
      root,
      `${name}-eye`,
      0.037 * scale,
      [1, 0.75, 0.45],
      [at[0] + side * 0.055 * scale, at[1] + 0.025 * scale, at[2] + 0.11 * scale],
      palette.soot,
    );
    cone(
      root,
      `${name}-tusk`,
      0.026 * scale,
      0.16 * scale,
      [at[0] + side * 0.068 * scale, at[1] - 0.13 * scale, at[2] + 0.07 * scale],
      palette.bone,
      [0, 0, side * 0.08],
    );
  }
  block(
    root,
    `${name}-jaw`,
    [0.17 * scale, 0.07 * scale, 0.1 * scale],
    [at[0], at[1] - 0.12 * scale, at[2] + 0.035 * scale],
    palette.bone,
    [0, 0, 0],
    0.02,
  );
}

function banner(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  top: number,
  palette: OrcPalette,
): void {
  beam(root, `${name}-pole`, [x, 0, z], [x, top, z], 0.034, palette.ironDark);
  block(
    root,
    name,
    [0.32, 0.58, 0.035],
    [x + 0.18, top - 0.34, z],
    palette.hide,
    [0, 0, -0.04],
    0.025,
  );
  skull(root, `${name}-badge`, [x + 0.18, top - 0.34, z + 0.035], 0.44, palette);
}

function firePit(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: OrcPalette,
): void {
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    boulder(
      root,
      `${name}-stone`,
      [x + Math.sin(angle) * 0.28 * scale, 0.09, z + Math.cos(angle) * 0.24 * scale],
      0.12 * scale,
      palette,
      [1.15, 0.72, 0.9],
      index % 3 === 0,
    );
  }
  for (const angle of [-0.7, 0.7]) {
    beam(
      root,
      `${name}-fuel`,
      [x - 0.24 * scale, 0.16, z + Math.sin(angle) * 0.08],
      [x + 0.24 * scale, 0.16, z - Math.sin(angle) * 0.08],
      0.052 * scale,
      palette.barkDark,
    );
  }
  cone(root, name, 0.18 * scale, 0.55 * scale, [x, 0.42 * scale, z], palette.fire, [0, 0, 0], true);
  cone(
    root,
    `${name}-ember`,
    0.1 * scale,
    0.34 * scale,
    [x, 0.36 * scale, z + 0.02],
    palette.ember,
  );
}

function weaponRack(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  palette: OrcPalette,
): void {
  beam(root, `${name}-left`, [x - 0.3, 0, z], [x - 0.3, 0.72, z], 0.045, palette.barkDark);
  beam(root, `${name}-right`, [x + 0.3, 0, z], [x + 0.3, 0.72, z], 0.045, palette.barkDark);
  beam(root, `${name}-bar`, [x - 0.35, 0.54, z], [x + 0.35, 0.54, z], 0.04, palette.log);
  for (let index = 0; index < 4; index += 1) {
    const weaponX = x - 0.24 + index * 0.16;
    beam(
      root,
      name,
      [weaponX, 0.12, z + 0.02],
      [weaponX + (index % 2 ? 0.09 : -0.09), 0.92, z + 0.02],
      0.022,
      palette.ironDark,
    );
    cone(
      root,
      `${name}-blade`,
      0.045,
      0.22,
      [weaponX + (index % 2 ? 0.11 : -0.11), 1.01, z + 0.02],
      palette.iron,
      [0, 0, index % 2 ? -0.12 : 0.12],
    );
  }
}

function barrel(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  palette: OrcPalette,
  scale = 1,
): void {
  cylinder(
    root,
    name,
    0.19 * scale,
    0.21 * scale,
    0.5 * scale,
    [x, 0.25 * scale, z],
    palette.bark,
    10,
  );
  for (const y of [0.08, 0.42])
    torus(
      root,
      `${name}-band`,
      0.205 * scale,
      0.025 * scale,
      [x, y * scale, z],
      palette.iron,
      [0, 0, 0],
    );
}

function crate(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  palette: OrcPalette,
  scale = 1,
): void {
  block(
    root,
    name,
    [0.48 * scale, 0.42 * scale, 0.46 * scale],
    [x, 0.21 * scale, z],
    palette.log,
    [0, 0, 0],
    0.035,
  );
  for (const side of [-1, 1])
    beam(
      root,
      `${name}-brace`,
      [x - 0.19 * scale, 0.05 * scale, z + side * 0.24 * scale],
      [x + 0.19 * scale, 0.38 * scale, z + side * 0.24 * scale],
      0.025 * scale,
      palette.barkDark,
    );
}

function chimney(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: OrcPalette,
): void {
  for (let index = 0; index < 7; index += 1) {
    boulder(
      root,
      name,
      [x + (index % 2 ? 0.04 : -0.04), (index + 0.5) * (height / 7), z],
      0.19,
      palette,
      [1.1 - index * 0.025, 0.74, 0.9],
      index % 3 === 0,
    );
  }
  torus(root, `${name}-cap`, 0.23, 0.035, [x, height + 0.04, z], palette.iron, [0, 0, 0]);
}

function orcLonghouse(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const bodyY = s.wallHeight * 0.82;
  block(
    root,
    "orc-longhouse-keel",
    [s.width * 0.94, 0.2, s.depth * 0.86],
    [0, 0.1, 0],
    palette.rockDark,
    [0, 0, 0],
    0.08,
    true,
  );
  logWall(
    root,
    "orc-longhouse-front-log-wall",
    s.width * 0.86,
    bodyY,
    s.depth * 0.36,
    palette,
    0.58,
  );
  logWall(root, "orc-longhouse-back-log-wall", s.width * 0.86, bodyY, -s.depth * 0.36, palette, 0);
  for (const x of [-s.width * 0.42, -s.width * 0.16, s.width * 0.16, s.width * 0.42]) {
    beam(
      root,
      "orc-longhouse-rib",
      [x, 0, -s.depth * 0.4],
      [x * 0.88, bodyY + s.roofHeight * 0.82, 0],
      0.085,
      palette.barkDark,
      true,
    );
    beam(
      root,
      "orc-longhouse-rib",
      [x * 0.88, bodyY + s.roofHeight * 0.82, 0],
      [x, 0, s.depth * 0.4],
      0.085,
      palette.barkDark,
      true,
    );
  }
  plateRoof(
    root,
    "orc-longhouse-hide-roof",
    s.width * 0.98,
    s.depth * 0.88,
    bodyY * 0.88,
    s.roofHeight * 0.82,
    palette,
    true,
  );
  door(root, "orc-longhouse-door", 0, s.depth * 0.39, 0.58, bodyY * 0.78, palette);
  for (const side of [-1, 1]) {
    beam(
      root,
      "orc-longhouse-door-tusk",
      [side * 0.4, 0, s.depth * 0.48],
      [side * 0.27, bodyY * 0.92, s.depth * 0.5],
      0.06,
      palette.bone,
      true,
    );
    cone(
      root,
      "orc-longhouse-door-tusk-tip",
      0.075,
      0.32,
      [side * 0.23, bodyY * 1.06, s.depth * 0.5],
      palette.bone,
      [0, 0, side * -0.2],
    );
  }
  chimney(
    root,
    "orc-longhouse-smoke-stack",
    -s.width * 0.28,
    -s.depth * 0.18,
    bodyY + s.roofHeight * 0.75,
    palette,
  );
  barrel(root, "orc-longhouse-ale-barrel", s.width * 0.42, s.depth * 0.29, palette, 0.9);
  crate(root, "orc-longhouse-firewood-crate", -s.width * 0.42, s.depth * 0.28, palette, 0.78);
  stair(root, "orc-longhouse-step", 0, s.depth * 0.63, 0.82, 0.2, 2, palette);
}

function trollRockHut(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const radiusX = s.width * 0.43;
  const radiusZ = s.depth * 0.42;
  stoneRing(root, "troll-hut-foundation", radiusX, radiusZ, 20, palette);
  for (let course = 0; course < 5; course += 1) {
    const count = 12 - course;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + course * 0.12;
      if (Math.cos(angle) > 0.72 && course < 3) continue;
      boulder(
        root,
        "troll-hut-cyclopean-shell",
        [
          Math.sin(angle) * radiusX * (1 - course * 0.08),
          0.2 + course * 0.29,
          Math.cos(angle) * radiusZ * (1 - course * 0.08),
        ],
        0.24,
        palette,
        [1.18, 0.86, 1],
        (index + course) % 5 === 0,
      );
    }
  }
  const crownY = s.wallHeight + s.roofHeight * 0.5;
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    beam(
      root,
      "troll-hut-root-crown",
      [Math.sin(angle) * radiusX * 1.12, s.wallHeight * 0.58, Math.cos(angle) * radiusZ * 1.08],
      [
        Math.sin(angle) * radiusX * 0.25,
        crownY + (index % 2) * 0.08,
        Math.cos(angle) * radiusZ * 0.25,
      ],
      0.095,
      index % 2 ? palette.bark : palette.barkDark,
      true,
    );
  }
  sphere(
    root,
    "troll-hut-moss-cap",
    Math.min(radiusX, radiusZ) * 0.82,
    [1.1, 0.28, 1],
    [0, crownY, 0],
    palette.moss,
    true,
  );
  door(root, "troll-hut-cave-door", 0, radiusZ * 0.96, 0.58, s.wallHeight * 0.58, palette);
  for (const side of [-1, 1])
    boulder(
      root,
      "troll-hut-door-jamb",
      [side * 0.4, 0.34, radiusZ],
      0.3,
      palette,
      [0.82, 1.28, 0.72],
      true,
    );
  skull(root, "troll-hut-warning-skull", [0, s.wallHeight * 0.82, radiusZ + 0.08], 0.8, palette);
  firePit(root, "troll-hut-cook-fire", radiusX * 1.18, radiusZ * 0.2, 0.78, palette);
  barrel(root, "troll-hut-root-tub", -radiusX * 1.12, radiusZ * 0.28, palette, 0.85);
}

function warchiefHall(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const dais = s.wallHeight * 0.18;
  block(
    root,
    "warchief-hall-dais",
    [s.width * 0.98, dais, s.depth * 0.9],
    [0, dais / 2, 0],
    palette.rockDark,
    [0, 0, 0],
    0.1,
    true,
  );
  boulderWall(
    root,
    "warchief-hall-stone-back",
    s.width * 0.84,
    s.wallHeight * 0.76,
    -s.depth * 0.34,
    palette,
    0,
  );
  for (const x of [-s.width * 0.4, -s.width * 0.14, s.width * 0.14, s.width * 0.4]) {
    beam(
      root,
      "warchief-hall-trunk-column",
      [x, dais, s.depth * 0.3],
      [x * 0.92, dais + s.wallHeight * 0.9, s.depth * 0.26],
      0.11,
      palette.log,
      true,
    );
    torus(
      root,
      "warchief-hall-column-band",
      0.13,
      0.03,
      [x, dais + s.wallHeight * 0.48, s.depth * 0.29],
      palette.iron,
      [0, 0, 0],
    );
  }
  plateRoof(
    root,
    "warchief-hall-armoured-roof",
    s.width,
    s.depth * 0.86,
    dais + s.wallHeight * 0.72,
    s.roofHeight * 0.96,
    palette,
    true,
  );
  door(root, "warchief-hall-gate", 0, s.depth * 0.42, 0.78, s.wallHeight * 0.72, palette, dais);
  for (const side of [-1, 1]) {
    const baseX = side * s.width * 0.26;
    beam(
      root,
      "warchief-horn-throne",
      [baseX, dais + 0.12, s.depth * 0.5],
      [side * s.width * 0.42, dais + s.wallHeight * 0.92, s.depth * 0.52],
      0.1,
      palette.bone,
      true,
    );
    cone(
      root,
      "warchief-horn-throne-tip",
      0.13,
      0.62,
      [side * s.width * 0.47, dais + s.wallHeight * 1.06, s.depth * 0.52],
      palette.bone,
      [0, 0, side * -0.48],
      true,
    );
    banner(
      root,
      "warchief-hall-war-banner",
      side * s.width * 0.48,
      -s.depth * 0.18,
      s.wallHeight + s.roofHeight * 0.95,
      palette,
    );
  }
  skull(
    root,
    "warchief-hall-crown",
    [0, s.wallHeight + s.roofHeight * 0.68, s.depth * 0.3],
    1.45,
    palette,
  );
  stair(root, "warchief-hall-grand-stair", 0, s.depth * 0.78, 1.22, dais, 3, palette);
  for (const x of [-s.width * 0.3, s.width * 0.3])
    firePit(root, "warchief-hall-brazier", x, s.depth * 0.5, 0.52, palette);
}

function skullFort(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const bodyHeight = s.wallHeight * 0.72;
  block(
    root,
    "skull-fort-foundation",
    [s.width * 0.94, 0.2, s.depth * 0.88],
    [0, 0.1, 0],
    palette.rockDark,
    [0, 0, 0],
    0.1,
    true,
  );
  boulderWall(
    root,
    "skull-fort-front-masonry",
    s.width * 0.88,
    bodyHeight,
    s.depth * 0.4,
    palette,
    0.7,
  );
  boulderWall(
    root,
    "skull-fort-rear-masonry",
    s.width * 0.88,
    bodyHeight,
    -s.depth * 0.4,
    palette,
    0,
  );
  for (const side of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const x = side * s.width * 0.39;
      const z = zSide * s.depth * 0.34;
      cylinder(
        root,
        "skull-fort-tower",
        0.3,
        0.36,
        s.wallHeight,
        [x, s.wallHeight / 2, z],
        palette.rockDark,
        9,
        [0, 0, 0],
        true,
      );
      for (let merlon = 0; merlon < 5; merlon += 1) {
        const angle = (merlon / 5) * Math.PI * 2;
        block(
          root,
          "skull-fort-battlement",
          [0.18, 0.28, 0.16],
          [x + Math.sin(angle) * 0.31, s.wallHeight + 0.11, z + Math.cos(angle) * 0.31],
          palette.iron,
          [0, angle, 0],
          0.025,
        );
      }
      cone(
        root,
        "skull-fort-tower-spike",
        0.1,
        0.5,
        [x, s.wallHeight + 0.48, z],
        palette.ironDark,
        [0, 0, 0],
        true,
      );
    }
  }
  block(
    root,
    "skull-fort-wall-walk",
    [s.width * 0.76, 0.14, s.depth * 0.72],
    [0, bodyHeight + 0.06, 0],
    palette.log,
    [0, 0, 0],
    0.045,
    true,
  );
  door(root, "skull-fort-jaw-gate", 0, s.depth * 0.47, 0.72, bodyHeight * 0.76, palette);
  skull(root, "skull-fort-gate-skull", [0, bodyHeight * 0.9, s.depth * 0.49], 1.45, palette);
  for (let tooth = -3; tooth <= 3; tooth += 1)
    cone(
      root,
      "skull-fort-jaw-tooth",
      0.045,
      0.26,
      [tooth * 0.1, bodyHeight * 0.57, s.depth * 0.53],
      palette.bone,
      [Math.PI, 0, 0],
    );
  stair(root, "skull-fort-gate-ramp", 0, s.depth * 0.78, 1.02, 0.24, 3, palette);
  rope(
    root,
    "skull-fort-hoist-chain",
    [-0.34, bodyHeight * 0.92, s.depth * 0.55],
    [0.34, bodyHeight * 0.92, s.depth * 0.55],
    0.12,
    palette.iron,
  );
}

function warPit(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const radiusX = s.width * 0.43;
  const radiusZ = s.depth * 0.4;
  stoneRing(root, "war-pit-sunken-ring", radiusX, radiusZ, 28, palette, 0.11);
  stoneRing(root, "war-pit-inner-curb", radiusX * 0.72, radiusZ * 0.68, 20, palette, 0.04);
  block(
    root,
    "war-pit-packed-floor",
    [s.width * 0.68, 0.08, s.depth * 0.55],
    [0, 0.03, 0],
    palette.barkDark,
    [0, 0, 0],
    0.08,
  );
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const x = Math.sin(angle) * radiusX * 1.02;
    const z = Math.cos(angle) * radiusZ * 1.02;
    beam(
      root,
      "war-pit-palisade",
      [x, 0.12, z],
      [x * 1.03, 0.72 + (index % 2) * 0.12, z * 1.03],
      0.055,
      palette.log,
      index % 2 === 0,
    );
    cone(
      root,
      "war-pit-palisade-tip",
      0.07,
      0.28,
      [x * 1.03, 0.88 + (index % 2) * 0.12, z * 1.03],
      palette.ironDark,
    );
  }
  const armoury = new THREE.Group();
  armoury.name = "war-pit-armoury";
  armoury.position.set(-s.width * 0.32, 0, -s.depth * 0.18);
  root.add(armoury);
  block(
    armoury,
    "war-pit-armoury-body",
    [0.78, 0.62, 0.64],
    [0, 0.31, 0],
    palette.bark,
    [0, 0, 0],
    0.06,
    true,
  );
  plateRoof(armoury, "war-pit-armoury-roof", 0.95, 0.78, 0.56, 0.32, palette, true);
  weaponRack(root, "war-pit-weapon-rack", s.width * 0.33, -s.depth * 0.28, palette);
  firePit(root, "war-pit-victory-fire", s.width * 0.28, s.depth * 0.3, 0.58, palette);
  banner(
    root,
    "war-pit-standard",
    -s.width * 0.47,
    s.depth * 0.12,
    s.wallHeight + s.roofHeight * 0.74,
    palette,
  );
}

function boulderRange(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const deckY = s.wallHeight * 0.46;
  block(
    root,
    "boulder-range-throwing-deck",
    [s.width * 0.56, 0.18, s.depth * 0.72],
    [-s.width * 0.2, deckY, 0],
    palette.log,
    [0, 0, 0],
    0.06,
    true,
  );
  for (const x of [-s.width * 0.43, -s.width * 0.17, s.width * 0.08])
    for (const z of [-s.depth * 0.29, s.depth * 0.29])
      beam(
        root,
        "boulder-range-deck-pile",
        [x, 0, z],
        [x, deckY, z],
        0.075,
        palette.barkDark,
        true,
      );
  stair(root, "boulder-range-deck-stair", -s.width * 0.2, s.depth * 0.55, 0.9, deckY, 4, palette);
  for (let lane = 0; lane < 3; lane += 1) {
    const x = s.width * (0.18 + lane * 0.14);
    const z = -s.depth * 0.26 + lane * s.depth * 0.25;
    beam(
      root,
      "boulder-range-target-post",
      [x, 0, z],
      [x, s.wallHeight * 0.78, z],
      0.055,
      palette.barkDark,
    );
    torus(
      root,
      "boulder-range-target-ring",
      0.25 - lane * 0.025,
      0.05,
      [x, s.wallHeight * 0.62, z],
      lane === 1 ? palette.hide : palette.iron,
      [0, Math.PI / 2, 0],
    );
    sphere(
      root,
      "boulder-range-target-boss",
      0.09,
      [0.55, 1, 1],
      [x - 0.035, s.wallHeight * 0.62, z],
      palette.bone,
    );
  }
  for (let index = 0; index < 8; index += 1)
    boulder(
      root,
      "boulder-range-ammunition",
      [-s.width * 0.4 + (index % 3) * 0.24, 0.17 + Math.floor(index / 3) * 0.22, -s.depth * 0.34],
      0.18 + (index % 2) * 0.03,
      palette,
      [1, 1, 1],
      index % 4 === 0,
    );
  const mastX = -s.width * 0.44;
  beam(
    root,
    "boulder-range-hoist-mast",
    [mastX, 0, -s.depth * 0.25],
    [mastX, s.wallHeight * 1.22, -s.depth * 0.25],
    0.075,
    palette.log,
    true,
  );
  beam(
    root,
    "boulder-range-hoist-arm",
    [mastX, s.wallHeight * 1.15, -s.depth * 0.25],
    [mastX + 0.65, s.wallHeight * 1.15, -s.depth * 0.25],
    0.07,
    palette.logLight,
    true,
  );
  torus(
    root,
    "boulder-range-hoist-wheel",
    0.15,
    0.03,
    [mastX + 0.55, s.wallHeight * 1.08, -s.depth * 0.25],
    palette.iron,
    [0, 0, 0],
  );
  rope(
    root,
    "boulder-range-hoist-rope",
    [mastX + 0.55, s.wallHeight * 1.08, -s.depth * 0.25],
    [mastX + 0.55, 0.3, -s.depth * 0.25],
    0,
    palette.rope,
  );
  for (let rail = 0; rail < 6; rail += 1) {
    const z = -s.depth * 0.3 + rail * s.depth * 0.12;
    beam(
      root,
      "boulder-range-safety-rail-post",
      [-s.width * 0.5, deckY, z],
      [-s.width * 0.5, deckY + 0.42, z],
      0.035,
      palette.barkDark,
    );
  }
  for (const z of [-s.depth * 0.3, s.depth * 0.3]) {
    beam(
      root,
      "boulder-range-safety-rail",
      [-s.width * 0.5, deckY + 0.38, z],
      [s.width * 0.04, deckY + 0.38, z],
      0.04,
      palette.logLight,
    );
  }
  for (let cradle = 0; cradle < 3; cradle += 1) {
    const z = -s.depth * 0.32 + cradle * s.depth * 0.32;
    beam(
      root,
      "boulder-range-ammunition-cradle",
      [-s.width * 0.48, 0.08, z - 0.16],
      [-s.width * 0.3, 0.38, z],
      0.035,
      palette.bark,
    );
    beam(
      root,
      "boulder-range-ammunition-cradle",
      [-s.width * 0.12, 0.08, z - 0.16],
      [-s.width * 0.3, 0.38, z],
      0.035,
      palette.bark,
    );
  }
  for (let brace = 0; brace < 3; brace += 1) {
    beam(
      root,
      "boulder-range-hoist-brace",
      [mastX - 0.15 + brace * 0.15, s.wallHeight * (0.18 + brace * 0.18), -s.depth * 0.25],
      [mastX + 0.4, s.wallHeight * (0.5 + brace * 0.18), -s.depth * 0.25],
      0.032,
      brace === 1 ? palette.iron : palette.barkDark,
    );
  }
  for (let marker = 0; marker < 6; marker += 1) {
    cone(
      root,
      "boulder-range-lane-marker",
      0.07,
      0.36 + (marker % 2) * 0.12,
      [s.width * (0.08 + marker * 0.075), 0.18, -s.depth * 0.44],
      marker % 2 ? palette.bone : palette.ironDark,
    );
  }
}

function clanHearth(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const roofY = s.wallHeight * 0.78;
  stoneRing(root, "clan-hearth-foundation", s.width * 0.44, s.depth * 0.4, 24, palette);
  for (const x of [-s.width * 0.4, s.width * 0.4])
    for (const z of [-s.depth * 0.33, s.depth * 0.33]) {
      beam(
        root,
        "clan-hearth-pavilion-post",
        [x, 0, z],
        [x * 0.92, roofY, z * 0.92],
        0.095,
        palette.log,
        true,
      );
      torus(
        root,
        "clan-hearth-post-band",
        0.115,
        0.025,
        [x, roofY * 0.52, z],
        palette.iron,
        [0, 0, 0],
      );
    }
  plateRoof(
    root,
    "clan-hearth-open-roof",
    s.width * 0.98,
    s.depth * 0.86,
    roofY,
    s.roofHeight * 0.82,
    palette,
    true,
  );
  firePit(root, "clan-hearth-great-fire", 0, 0, 1.35, palette);
  for (const side of [-1, 1]) {
    block(
      root,
      "clan-hearth-feast-bench",
      [s.width * 0.72, 0.16, 0.25],
      [0, 0.32, side * s.depth * 0.29],
      palette.log,
      [0, 0, 0],
      0.035,
    );
    for (const x of [-s.width * 0.3, 0, s.width * 0.3])
      beam(
        root,
        "clan-hearth-bench-leg",
        [x, 0.02, side * s.depth * 0.29],
        [x, 0.3, side * s.depth * 0.29],
        0.035,
        palette.barkDark,
      );
  }
  const spitY = 0.72;
  for (const side of [-1, 1])
    beam(
      root,
      "clan-hearth-spit-post",
      [side * 0.48, 0, 0],
      [side * 0.48, spitY + 0.18, 0],
      0.04,
      palette.ironDark,
    );
  beam(root, "clan-hearth-roasting-spit", [-0.58, spitY, 0], [0.58, spitY, 0], 0.026, palette.iron);
  sphere(root, "clan-hearth-roast", 0.18, [1.5, 0.68, 0.72], [0, spitY, 0], palette.hideDark);
  for (const side of [-1, 1])
    banner(
      root,
      "clan-hearth-clan-banner",
      side * s.width * 0.48,
      -s.depth * 0.18,
      s.wallHeight + s.roofHeight * 0.72,
      palette,
    );
}

function smokeLodge(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  block(
    root,
    "smoke-lodge-stone-base",
    [s.width * 0.9, 0.28, s.depth * 0.82],
    [0, 0.14, 0],
    palette.rockDark,
    [0, 0, 0],
    0.09,
    true,
  );
  logWall(
    root,
    "smoke-lodge-front-wall",
    s.width * 0.82,
    s.wallHeight * 0.7,
    s.depth * 0.35,
    palette,
    0.48,
  );
  boulderWall(
    root,
    "smoke-lodge-rear-wall",
    s.width * 0.82,
    s.wallHeight * 0.62,
    -s.depth * 0.35,
    palette,
    0,
  );
  plateRoof(
    root,
    "smoke-lodge-low-roof",
    s.width * 0.94,
    s.depth * 0.86,
    s.wallHeight * 0.62,
    s.roofHeight * 0.58,
    palette,
    false,
  );
  door(root, "smoke-lodge-door", 0, s.depth * 0.39, 0.48, s.wallHeight * 0.54, palette, 0.24);
  for (const x of [-s.width * 0.28, 0, s.width * 0.28])
    chimney(
      root,
      "smoke-lodge-chimney",
      x,
      -s.depth * 0.2,
      s.wallHeight + s.roofHeight * (0.65 + Math.abs(x) * 0.08),
      palette,
    );
  const rack = new THREE.Group();
  rack.name = "smoke-lodge-drying-rack";
  rack.position.set(s.width * 0.34, 0, s.depth * 0.31);
  root.add(rack);
  for (const side of [-1, 1])
    beam(
      rack,
      "smoke-lodge-rack-post",
      [side * 0.32, 0, 0],
      [side * 0.32, 0.95, 0],
      0.04,
      palette.barkDark,
    );
  for (let level = 0; level < 3; level += 1) {
    beam(
      rack,
      "smoke-lodge-rack-bar",
      [-0.36, 0.35 + level * 0.25, 0],
      [0.36, 0.35 + level * 0.25, 0],
      0.03,
      palette.log,
    );
    for (let item = 0; item < 4; item += 1)
      sphere(
        rack,
        "smoke-lodge-dried-meat",
        0.07,
        [0.65, 1.4, 0.5],
        [-0.24 + item * 0.16, 0.25 + level * 0.25, 0],
        palette.hideDark,
      );
  }
  barrel(root, "smoke-lodge-brine-barrel", -s.width * 0.4, s.depth * 0.28, palette, 0.85);
  crate(root, "smoke-lodge-salt-crate", -s.width * 0.22, s.depth * 0.32, palette, 0.68);
}

function warForge(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  block(
    root,
    "war-forge-slag-foundation",
    [s.width * 0.94, 0.2, s.depth * 0.84],
    [0, 0.1, 0],
    palette.rockDark,
    [0, 0, 0],
    0.09,
    true,
  );
  const forgeX = -s.width * 0.2;
  block(
    root,
    "war-forge-furnace",
    [s.width * 0.46, s.wallHeight * 0.68, s.depth * 0.58],
    [forgeX, s.wallHeight * 0.34, -s.depth * 0.08],
    palette.rockDark,
    [0, 0, 0],
    0.1,
    true,
  );
  boulderWall(
    root,
    "war-forge-furnace-masonry",
    s.width * 0.43,
    s.wallHeight * 0.62,
    s.depth * 0.23,
    palette,
    0.48,
  );
  block(
    root,
    "war-forge-mouth",
    [0.48, 0.48, 0.14],
    [forgeX, 0.3, s.depth * 0.25],
    palette.soot,
    [0, 0, 0],
    0.12,
    true,
  );
  sphere(
    root,
    "war-forge-mouth-glow",
    0.15,
    [1.1, 0.8, 0.36],
    [forgeX, 0.27, s.depth * 0.34],
    palette.fire,
  );
  chimney(
    root,
    "war-forge-great-stack",
    forgeX,
    -s.depth * 0.18,
    s.wallHeight + s.roofHeight * 1.05,
    palette,
  );
  const awningX = s.width * 0.28;
  for (const x of [s.width * 0.05, s.width * 0.48])
    for (const z of [-s.depth * 0.28, s.depth * 0.28])
      beam(
        root,
        "war-forge-work-bay-post",
        [x, 0, z],
        [x, s.wallHeight * 0.72, z],
        0.07,
        palette.log,
        true,
      );
  plateRoof(
    root,
    "war-forge-work-bay-roof",
    s.width * 0.54,
    s.depth * 0.72,
    s.wallHeight * 0.68,
    s.roofHeight * 0.44,
    palette,
    false,
  );
  block(
    root,
    "war-forge-anvil",
    [0.48, 0.2, 0.24],
    [awningX, 0.7, s.depth * 0.14],
    palette.iron,
    [0, 0, 0],
    0.05,
    true,
  );
  cylinder(
    root,
    "war-forge-anvil-base",
    0.14,
    0.19,
    0.5,
    [awningX, 0.35, s.depth * 0.14],
    palette.barkDark,
    8,
  );
  for (const side of [-1, 1]) {
    sphere(
      root,
      "war-forge-bellows",
      0.22,
      [1.25, 0.52, 0.75],
      [forgeX + side * 0.34, 0.38, s.depth * 0.31],
      palette.hide,
    );
    beam(
      root,
      "war-forge-bellows-handle",
      [forgeX + side * 0.34, 0.44, s.depth * 0.32],
      [forgeX + side * 0.52, 0.76, s.depth * 0.32],
      0.025,
      palette.ironDark,
    );
  }
  weaponRack(root, "war-forge-finished-weapons", s.width * 0.38, -s.depth * 0.3, palette);
  for (let ingot = 0; ingot < 6; ingot += 1)
    block(
      root,
      "war-forge-ingot",
      [0.18, 0.07, 0.1],
      [s.width * 0.1 + (ingot % 3) * 0.2, 0.08 + Math.floor(ingot / 3) * 0.08, -s.depth * 0.36],
      palette.iron,
      [0, (ingot % 2) * 0.08, 0],
      0.018,
    );
}

function beastPen(root: THREE.Group, s: BuildingVolumeDimensions, palette: OrcPalette): void {
  const radiusX = s.width * 0.44;
  const radiusZ = s.depth * 0.39;
  stoneRing(root, "beast-pen-foundation", radiusX, radiusZ, 22, palette);
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    if (Math.cos(angle) > 0.7) continue;
    const x = Math.sin(angle) * radiusX;
    const z = Math.cos(angle) * radiusZ;
    beam(
      root,
      "beast-pen-heavy-palisade",
      [x, 0, z],
      [x * 1.02, s.wallHeight * (0.62 + (index % 2) * 0.08), z * 1.02],
      0.075,
      palette.log,
      index % 3 === 0,
    );
    cone(
      root,
      "beast-pen-palisade-tip",
      0.085,
      0.3,
      [x * 1.02, s.wallHeight * (0.72 + (index % 2) * 0.08), z * 1.02],
      palette.ironDark,
    );
  }
  for (const side of [-1, 1]) {
    beam(
      root,
      "beast-pen-gate-post",
      [side * 0.46, 0, radiusZ],
      [side * 0.46, s.wallHeight * 0.92, radiusZ],
      0.1,
      palette.logLight,
      true,
    );
    cone(
      root,
      "beast-pen-gate-post-cap",
      0.12,
      0.42,
      [side * 0.46, s.wallHeight * 1.08, radiusZ],
      palette.ironDark,
    );
  }
  const gatehouse = new THREE.Group();
  gatehouse.name = "beast-pen-gatehouse";
  gatehouse.position.set(0, 0, radiusZ);
  root.add(gatehouse);
  block(
    gatehouse,
    "beast-pen-gatehouse-deck",
    [1.22, 0.16, 0.52],
    [0, s.wallHeight * 0.72, 0],
    palette.log,
    [0, 0, 0],
    0.045,
    true,
  );
  plateRoof(
    gatehouse,
    "beast-pen-gatehouse-roof",
    1.35,
    0.7,
    s.wallHeight * 0.82,
    s.roofHeight * 0.42,
    palette,
    true,
  );
  for (let rail = 0; rail < 5; rail += 1)
    beam(
      gatehouse,
      "beast-pen-portcullis",
      [-0.4 + rail * 0.2, 0.05, 0.12],
      [-0.4 + rail * 0.2, s.wallHeight * 0.68, 0.12],
      0.032,
      palette.ironDark,
    );
  block(
    root,
    "beast-pen-feeding-trough",
    [s.width * 0.55, 0.28, 0.36],
    [0, 0.18, -s.depth * 0.2],
    palette.log,
    [0, 0, 0],
    0.05,
  );
  for (let rib = 0; rib < 5; rib += 1)
    block(
      root,
      "beast-pen-trough-rib",
      [0.045, 0.32, 0.4],
      [-s.width * 0.22 + rib * s.width * 0.11, 0.2, -s.depth * 0.2],
      palette.iron,
      [0, 0, 0],
      0.01,
    );
  barrel(root, "beast-pen-water-barrel", -s.width * 0.35, -s.depth * 0.25, palette, 0.92);
  crate(root, "beast-pen-feed-crate", s.width * 0.33, -s.depth * 0.27, palette, 0.8);
  skull(root, "beast-pen-beast-mark", [0, s.wallHeight * 1.05, radiusZ + 0.08], 0.8, palette);
}

export function buildOrcTrollBuildingVolume(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  materials: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  const palette = orcPalette(materials);
  switch (archetype) {
    case "housing-a":
      orcLonghouse(root, size, palette);
      break;
    case "housing-b":
      trollRockHut(root, size, palette);
      break;
    case "command-a":
      warchiefHall(root, size, palette);
      break;
    case "command-b":
      skullFort(root, size, palette);
      break;
    case "training-a":
      warPit(root, size, palette);
      break;
    case "training-b":
      boulderRange(root, size, palette);
      break;
    case "community-a":
      clanHearth(root, size, palette);
      break;
    case "community-b":
      smokeLodge(root, size, palette);
      break;
    case "daily-life-a":
      warForge(root, size, palette);
      break;
    case "daily-life-b":
      beastPen(root, size, palette);
      break;
  }
}
