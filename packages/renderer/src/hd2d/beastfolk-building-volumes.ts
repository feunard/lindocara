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

interface BeastPalette {
  fur: THREE.Material;
  furDark: THREE.Material;
  muzzle: THREE.Material;
  hide: THREE.Material;
  hideDark: THREE.Material;
  wicker: THREE.Material;
  wickerLight: THREE.Material;
  bone: THREE.Material;
  boneShade: THREE.Material;
  claw: THREE.Material;
  stone: THREE.Material;
  stoneDark: THREE.Material;
  herb: THREE.Material;
  moon: THREE.Material;
  ember: THREE.Material;
  soot: THREE.Material;
}

const GNOLL_FUR: PixelCrop = {
  x: 32,
  y: 30,
  width: 118,
  height: 88,
  sourceWidth: 1152,
  sourceHeight: 128,
};
const GNOLL_MUZZLE: PixelCrop = {
  x: 78,
  y: 46,
  width: 60,
  height: 54,
  sourceWidth: 1152,
  sourceHeight: 128,
};
const GNOLL_BONES: PixelCrop = {
  x: 1,
  y: 6,
  width: 252,
  height: 54,
  sourceWidth: 256,
  sourceHeight: 64,
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
    if (!context) throw new Error("Beastfolk material crop requires a 2D canvas context");
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

function beastPalette(materials: FactionBuildingMaterials): BeastPalette {
  const gnoll = materials.factionPrimary ?? textureOf(materials.cloth);
  const bones = materials.factionDetail ?? textureOf(materials.bone);
  return {
    fur: surface(gnoll, 0xd3ad52, GNOLL_FUR),
    furDark: surface(gnoll, 0x56516f, GNOLL_FUR),
    muzzle: surface(gnoll, 0xffde6f, GNOLL_MUZZLE),
    hide: surface(gnoll, 0xa96e55, GNOLL_FUR),
    hideDark: surface(gnoll, 0x69465d, GNOLL_FUR),
    wicker: surface(gnoll, 0x806450, GNOLL_FUR),
    wickerLight: surface(gnoll, 0xb88755, GNOLL_MUZZLE),
    bone: surface(bones, 0xf2deb0, GNOLL_BONES),
    boneShade: surface(bones, 0xb7a0a1, GNOLL_BONES),
    claw: surface(bones, 0x6a6680, GNOLL_BONES),
    stone: surface(gnoll, 0x88828e, GNOLL_FUR),
    stoneDark: surface(gnoll, 0x49485b, GNOLL_FUR),
    herb: surface(gnoll, 0x71874f, GNOLL_MUZZLE),
    moon: surface(gnoll, 0xf3ca63, GNOLL_MUZZLE),
    ember: surface(gnoll, 0xed794b, GNOLL_MUZZLE),
    soot: surface(gnoll, 0x2b2d3e, GNOLL_FUR),
  };
}

function roundedGeometry(width: number, height: number, depth: number, radius = 0.08) {
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
    bevelSize: Math.min(r * 0.42, depth * 0.18),
    bevelThickness: Math.min(r * 0.3, depth * 0.12),
    curveSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function addPart(
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
      new THREE.LineBasicMaterial({ color: 0x29283b, transparent: true, opacity: 0.72 }),
    );
    line.name = "beastfolk-silhouette-line";
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
  radius = 0.055,
  outline = false,
): THREE.Mesh {
  return addPart(root, name, roundedGeometry(...size, radius), material, at, rotation, outline);
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
  return addPart(
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
  const mesh = addPart(
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
  return addPart(
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

function boneRib(
  root: THREE.Object3D,
  name: string,
  from: Point3,
  to: Point3,
  palette: BeastPalette,
  heavy = false,
): void {
  const radius = heavy ? 0.07 : 0.045;
  beam(root, name, from, to, radius, palette.bone, heavy);
  sphere(root, `${name}-joint`, radius * 1.5, [1.2, 0.8, 1], from, palette.boneShade);
  sphere(root, `${name}-joint`, radius * 1.5, [1.2, 0.8, 1], to, palette.boneShade);
  const end = new THREE.Vector3(...to);
  const start = new THREE.Vector3(...from);
  const direction = end.clone().sub(start).normalize();
  const tip = end.clone().addScaledVector(direction, heavy ? 0.24 : 0.15);
  beam(root, `${name}-claw-tip`, to, [tip.x, tip.y, tip.z], radius * 0.55, palette.claw);
}

function hidePanel(
  root: THREE.Object3D,
  name: string,
  width: number,
  height: number,
  at: Point3,
  rotation: Point3,
  material: THREE.Material,
  palette: BeastPalette,
  outline = false,
): void {
  block(root, name, [width, height, 0.055], at, material, rotation, 0.12, outline);
  for (const x of [-width * 0.42, width * 0.42]) {
    for (const y of [-height * 0.4, height * 0.4]) {
      sphere(
        root,
        `${name}-lashing`,
        0.035,
        [1, 0.7, 0.6],
        [at[0] + x, at[1] + y, at[2] + 0.045],
        palette.boneShade,
      );
    }
  }
  beam(
    root,
    `${name}-stitched-seam`,
    [at[0] - width * 0.38, at[1] + height * 0.08, at[2] + 0.06],
    [at[0] + width * 0.38, at[1] - height * 0.05, at[2] + 0.06],
    0.012,
    palette.bone,
  );
}

function pawPost(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: BeastPalette,
): void {
  cylinder(root, name, 0.12, 0.16, height, [x, height / 2, z], palette.wicker, 8, [0, 0, 0], true);
  sphere(root, `${name}-pad`, 0.17, [1.25, 0.55, 0.9], [x, height + 0.05, z], palette.furDark);
  for (let toe = 0; toe < 4; toe += 1) {
    const toeX = x + (toe - 1.5) * 0.085;
    sphere(root, `${name}-toe`, 0.065, [0.9, 0.65, 1], [toeX, height + 0.16, z], palette.muzzle);
    cone(root, `${name}-claw`, 0.035, 0.15, [toeX, height + 0.27, z], palette.claw);
  }
}

function wovenDeck(
  root: THREE.Object3D,
  name: string,
  radiusX: number,
  radiusZ: number,
  y: number,
  palette: BeastPalette,
): void {
  cylinder(
    root,
    name,
    radiusX,
    radiusX * 1.04,
    0.14,
    [0, y, 0],
    palette.wicker,
    14,
    [0, 0, 0],
    true,
  );
  for (let spoke = 0; spoke < 12; spoke += 1) {
    const angle = (spoke / 12) * Math.PI * 2;
    beam(
      root,
      `${name}-spoke`,
      [0, y + 0.09, 0],
      [Math.sin(angle) * radiusX * 0.94, y + 0.09, Math.cos(angle) * radiusZ * 0.94],
      0.022,
      spoke % 2 ? palette.wicker : palette.wickerLight,
    );
  }
}

function stoneRing(
  root: THREE.Object3D,
  name: string,
  radiusX: number,
  radiusZ: number,
  count: number,
  palette: BeastPalette,
  y = 0.12,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    sphere(
      root,
      name,
      0.16 + (index % 3) * 0.018,
      [1.35, 0.58, 0.9],
      [Math.sin(angle) * radiusX, y + (index % 2) * 0.025, Math.cos(angle) * radiusZ],
      index % 4 === 0 ? palette.stoneDark : palette.stone,
    );
  }
}

function firePit(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: BeastPalette,
): void {
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    sphere(
      root,
      `${name}-stone`,
      0.105 * scale,
      [1, 0.7, 1],
      [x + Math.sin(angle) * 0.29 * scale, 0.08, z + Math.cos(angle) * 0.29 * scale],
      index % 2 ? palette.stone : palette.stoneDark,
    );
  }
  for (const turn of [-0.55, 0.55]) {
    cylinder(
      root,
      `${name}-charred-log`,
      0.045 * scale,
      0.06 * scale,
      0.55 * scale,
      [x, 0.16, z],
      palette.soot,
      7,
      [Math.PI / 2, 0, turn],
    );
  }
  cone(
    root,
    name,
    0.21 * scale,
    0.62 * scale,
    [x, 0.39 * scale, z],
    palette.ember,
    [0, 0, 0],
    true,
  );
}

function stair(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  width: number,
  height: number,
  steps: number,
  palette: BeastPalette,
): void {
  for (let step = 0; step < steps; step += 1) {
    const progress = (step + 1) / steps;
    block(
      root,
      name,
      [width, 0.11, 0.27],
      [x, progress * height - 0.05, z + (step - steps / 2) * 0.24],
      step % 2 ? palette.wicker : palette.wickerLight,
      [0, (step % 2 ? -1 : 1) * 0.025, 0],
      0.025,
    );
  }
}

function boneTotem(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: BeastPalette,
): void {
  beam(root, name, [x, 0, z], [x, height, z], 0.065, palette.bone, true);
  for (let tier = 0; tier < 3; tier += 1) {
    const y = height * (0.34 + tier * 0.22);
    sphere(
      root,
      `${name}-mask`,
      0.15 - tier * 0.015,
      [1.2, 0.82, 0.62],
      [x, y, z + 0.04],
      tier % 2 ? palette.fur : palette.muzzle,
    );
    for (const side of [-1, 1]) {
      cone(root, `${name}-ear`, 0.055, 0.2, [x + side * 0.14, y + 0.1, z], palette.furDark, [
        0,
        0,
        side * -0.55,
      ]);
      sphere(
        root,
        `${name}-eye`,
        0.025,
        [1, 1, 0.6],
        [x + side * 0.055, y + 0.025, z + 0.14],
        palette.moon,
      );
    }
  }
  for (const side of [-1, 1])
    boneRib(
      root,
      `${name}-crown`,
      [x, height * 0.88, z],
      [x + side * 0.28, height * 1.08, z],
      palette,
    );
}

function supplies(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  palette: BeastPalette,
): void {
  cylinder(root, `${name}-basket`, 0.2, 0.14, 0.38, [x, 0.19, z], palette.wicker, 10);
  torus(root, `${name}-basket-rim`, 0.2, 0.022, [x, 0.38, z], palette.wickerLight);
  for (let item = 0; item < 5; item += 1) {
    sphere(
      root,
      `${name}-bundle`,
      0.055,
      [0.8, 1.4, 0.8],
      [x - 0.12 + item * 0.06, 0.47 + (item % 2) * 0.04, z],
      item % 2 ? palette.herb : palette.muzzle,
    );
  }
}

function hideLodge(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  const ridge = s.wallHeight + s.roofHeight * 0.72;
  wovenDeck(root, "hide-lodge-raised-floor", s.width * 0.45, s.depth * 0.4, 0.28, palette);
  for (const z of [-s.depth * 0.34, 0, s.depth * 0.34]) {
    boneRib(root, "hide-lodge-rib", [-s.width * 0.44, 0.28, z], [0, ridge, z], palette, true);
    boneRib(root, "hide-lodge-rib", [s.width * 0.44, 0.28, z], [0, ridge, z], palette, true);
  }
  for (const side of [-1, 1]) {
    hidePanel(
      root,
      "hide-lodge-roof-pelt",
      s.width * 0.58,
      s.depth * 0.85,
      [side * s.width * 0.22, s.wallHeight * 0.82, 0],
      [Math.PI / 2, side * -0.64, Math.PI / 2],
      side > 0 ? palette.hide : palette.fur,
      palette,
      true,
    );
  }
  hidePanel(
    root,
    "hide-lodge-door-flap",
    s.width * 0.34,
    s.wallHeight * 0.62,
    [0, s.wallHeight * 0.33, s.depth * 0.44],
    [0, 0, 0],
    palette.hideDark,
    palette,
  );
  for (const side of [-1, 1])
    pawPost(
      root,
      "hide-lodge-paw-finial",
      side * s.width * 0.34,
      s.depth * 0.39,
      s.wallHeight * 0.7,
      palette,
    );
  firePit(root, "hide-lodge-family-hearth", 0, -s.depth * 0.18, 0.62, palette);
  stair(root, "hide-lodge-entry-steps", 0, s.depth * 0.58, s.width * 0.38, 0.28, 3, palette);
  supplies(root, "hide-lodge-supplies", -s.width * 0.36, s.depth * 0.3, palette);
}

function elevatedNest(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  const floorY = s.wallHeight * 0.62;
  for (let support = 0; support < 7; support += 1) {
    const angle = (support / 7) * Math.PI * 2;
    beam(
      root,
      "nest-crooked-stilt",
      [Math.sin(angle) * s.width * 0.42, 0, Math.cos(angle) * s.depth * 0.38],
      [Math.sin(angle + 0.18) * s.width * 0.3, floorY, Math.cos(angle + 0.18) * s.depth * 0.27],
      0.075,
      support % 2 ? palette.wicker : palette.wickerLight,
      support % 3 === 0,
    );
  }
  wovenDeck(root, "elevated-nest-basket-floor", s.width * 0.4, s.depth * 0.37, floorY, palette);
  for (let ring = 0; ring < 4; ring += 1) {
    torus(
      root,
      "elevated-nest-woven-rim",
      s.width * (0.37 - ring * 0.035),
      0.04,
      [0, floorY + 0.14 + ring * 0.18, 0],
      ring % 2 ? palette.wickerLight : palette.wicker,
      [Math.PI / 2, 0, ring * 0.08],
      Math.PI * 2,
      ring === 3,
    );
  }
  for (let rib = 0; rib < 10; rib += 1) {
    const angle = (rib / 10) * Math.PI * 2;
    boneRib(
      root,
      "elevated-nest-canopy-rib",
      [Math.sin(angle) * s.width * 0.35, floorY + 0.45, Math.cos(angle) * s.depth * 0.32],
      [
        Math.sin(angle) * s.width * 0.18,
        s.wallHeight + s.roofHeight * 0.82,
        Math.cos(angle) * s.depth * 0.16,
      ],
      palette,
      rib % 5 === 0,
    );
  }
  for (let patch = 0; patch < 5; patch += 1) {
    const angle = (patch / 5) * Math.PI * 2;
    hidePanel(
      root,
      "elevated-nest-canopy-patch",
      s.width * 0.28,
      s.roofHeight * 0.58,
      [
        Math.sin(angle) * s.width * 0.22,
        s.wallHeight + s.roofHeight * 0.36,
        Math.cos(angle) * s.depth * 0.2,
      ],
      [0.1, angle, angle * 0.05],
      patch % 2 ? palette.fur : palette.hide,
      palette,
    );
  }
  stair(
    root,
    "elevated-nest-ladder",
    s.width * 0.32,
    s.depth * 0.34,
    s.width * 0.24,
    floorY,
    5,
    palette,
  );
  supplies(root, "elevated-nest-gathering-basket", -s.width * 0.3, -s.depth * 0.28, palette);
}

function councilTotems(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: BeastPalette,
): void {
  const floorY = 0.24;
  wovenDeck(root, "council-totems-fan-dais", s.width * 0.46, s.depth * 0.42, floorY, palette);
  for (let seat = 0; seat < 7; seat += 1) {
    const angle = -1.18 + seat * 0.39;
    const x = Math.sin(angle) * s.width * 0.36;
    const z = Math.cos(angle) * s.depth * 0.3;
    block(
      root,
      "council-totems-seat",
      [0.42, 0.22 + (seat % 2) * 0.06, 0.34],
      [x, 0.33, z],
      seat === 3 ? palette.fur : palette.wicker,
      [0, angle, 0],
      0.09,
    );
    boneRib(root, "council-totems-seat-back", [x - 0.14, 0.42, z], [x - 0.14, 0.78, z], palette);
    boneRib(root, "council-totems-seat-back", [x + 0.14, 0.42, z], [x + 0.14, 0.78, z], palette);
  }
  boneTotem(
    root,
    "council-totems-alpha",
    0,
    -s.depth * 0.32,
    s.wallHeight + s.roofHeight * 0.9,
    palette,
  );
  for (const side of [-1, 1])
    boneTotem(
      root,
      "council-totems-elder",
      side * s.width * 0.38,
      -s.depth * 0.23,
      s.wallHeight * 0.95,
      palette,
    );
  for (let rib = 0; rib < 5; rib += 1) {
    const x = -s.width * 0.42 + rib * s.width * 0.21;
    boneRib(
      root,
      "council-totems-canopy-fan",
      [x, 0.2, -s.depth * 0.4],
      [x * 0.4, s.wallHeight + s.roofHeight * 0.44, -s.depth * 0.16],
      palette,
      rib === 0 || rib === 4,
    );
  }
  for (const side of [-1, 1])
    hidePanel(
      root,
      "council-totems-alpha-pelt",
      s.width * 0.38,
      s.roofHeight * 0.52,
      [side * s.width * 0.2, s.wallHeight + s.roofHeight * 0.12, -s.depth * 0.22],
      [0.16, 0, side * 0.14],
      side > 0 ? palette.hide : palette.furDark,
      palette,
      true,
    );
  firePit(root, "council-totems-speaking-fire", 0, s.depth * 0.22, 0.68, palette);
  for (const side of [-1, 1]) {
    torus(
      root,
      "council-totems-moon-gong",
      0.22,
      0.045,
      [side * s.width * 0.29, s.wallHeight * 0.72, s.depth * 0.18],
      side > 0 ? palette.moon : palette.bone,
      [0, 0, 0],
      Math.PI * 1.55,
      true,
    );
  }
}

function moonfangDen(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  stoneRing(root, "moonfang-den-crescent-foundation", s.width * 0.45, s.depth * 0.41, 30, palette);
  for (const side of [-1, 1]) {
    const towerX = side * s.width * 0.3;
    cylinder(
      root,
      "moonfang-den-fang-tower",
      s.width * 0.16,
      s.width * 0.2,
      s.wallHeight * 0.92,
      [towerX, s.wallHeight * 0.46, -s.depth * 0.08],
      side > 0 ? palette.stone : palette.stoneDark,
      11,
      [0, 0, 0],
      true,
    );
    for (let course = 0; course < 4; course += 1) {
      for (let tooth = 0; tooth < 5; tooth += 1) {
        const angle = -0.9 + tooth * 0.45;
        sphere(
          root,
          "moonfang-den-tower-masonry",
          0.13,
          [1.25, 0.68, 0.9],
          [
            towerX + Math.sin(angle) * s.width * 0.16,
            0.18 + course * s.wallHeight * 0.21,
            -s.depth * 0.08 + Math.cos(angle) * s.depth * 0.17,
          ],
          (course + tooth) % 3 ? palette.stone : palette.stoneDark,
        );
      }
    }
    torus(
      root,
      "moonfang-den-crescent-horn",
      s.width * 0.2,
      0.065,
      [towerX, s.wallHeight * 1.05, -s.depth * 0.08],
      palette.bone,
      [0, (side * Math.PI) / 2, 0],
      Math.PI * 1.45,
      true,
    );
    pawPost(root, "moonfang-den-watch-paw", towerX, -s.depth * 0.08, s.wallHeight * 1.12, palette);
  }
  block(
    root,
    "moonfang-den-tunnel",
    [s.width * 0.43, s.wallHeight * 0.6, s.depth * 0.76],
    [0, s.wallHeight * 0.3, 0],
    palette.furDark,
    [0, 0, 0],
    0.24,
    true,
  );
  for (let arch = 0; arch < 7; arch += 1) {
    const angle = -Math.PI / 2 + (arch / 6) * Math.PI;
    sphere(
      root,
      "moonfang-den-jaw-gate",
      0.12,
      [1, 0.8, 0.8],
      [
        Math.cos(angle) * s.width * 0.23,
        s.wallHeight * 0.28 + Math.sin(angle) * s.wallHeight * 0.32,
        s.depth * 0.4,
      ],
      arch % 2 ? palette.boneShade : palette.bone,
    );
    cone(
      root,
      "moonfang-den-gate-tooth",
      0.05,
      0.22,
      [
        Math.cos(angle) * s.width * 0.2,
        s.wallHeight * 0.3 + Math.sin(angle) * s.wallHeight * 0.25,
        s.depth * 0.5,
      ],
      palette.claw,
      [Math.PI, 0, 0],
    );
  }
  hidePanel(
    root,
    "moonfang-den-command-curtain",
    s.width * 0.32,
    s.wallHeight * 0.48,
    [0, s.wallHeight * 0.3, s.depth * 0.48],
    [0, 0, 0],
    palette.hideDark,
    palette,
  );
  stair(root, "moonfang-den-command-stairs", 0, s.depth * 0.6, s.width * 0.34, 0.2, 3, palette);
}

function huntersRun(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  const pathZ = [-s.depth * 0.34, -s.depth * 0.1, s.depth * 0.14, s.depth * 0.38] as const;
  for (const [gate, z] of pathZ.entries()) {
    boneRib(
      root,
      "hunters-run-obstacle-arch",
      [-s.width * 0.34, 0, z],
      [-s.width * 0.12, s.wallHeight * (0.58 + gate * 0.06), z],
      palette,
      gate === 3,
    );
    boneRib(
      root,
      "hunters-run-obstacle-arch",
      [s.width * 0.34, 0, z],
      [s.width * 0.12, s.wallHeight * (0.58 + gate * 0.06), z],
      palette,
      gate === 3,
    );
    beam(
      root,
      "hunters-run-crossbar",
      [-s.width * 0.12, s.wallHeight * (0.58 + gate * 0.06), z],
      [s.width * 0.12, s.wallHeight * (0.58 + gate * 0.06), z],
      0.04,
      gate % 2 ? palette.wickerLight : palette.bone,
    );
  }
  for (let post = 0; post < 7; post += 1) {
    const x = -s.width * 0.4 + post * s.width * 0.13;
    pawPost(
      root,
      "hunters-run-slalom-paw",
      x,
      -s.depth * 0.46 + (post % 2) * s.depth * 0.16,
      s.wallHeight * 0.48,
      palette,
    );
  }
  const blindY = s.wallHeight * 0.72;
  wovenDeck(root, "hunters-run-lookout-blind", s.width * 0.2, s.depth * 0.16, blindY, palette);
  for (const side of [-1, 1])
    beam(
      root,
      "hunters-run-blind-stilt",
      [side * s.width * 0.17, 0, -s.depth * 0.34],
      [side * s.width * 0.15, blindY, -s.depth * 0.34],
      0.055,
      palette.wicker,
    );
  hidePanel(
    root,
    "hunters-run-blind-screen",
    s.width * 0.34,
    s.wallHeight * 0.34,
    [0, blindY + 0.18, -s.depth * 0.28],
    [0, 0, 0],
    palette.herb,
    palette,
    true,
  );
  stair(
    root,
    "hunters-run-blind-ladder",
    s.width * 0.22,
    -s.depth * 0.23,
    s.width * 0.18,
    blindY,
    5,
    palette,
  );
  for (let ring = 0; ring < 3; ring += 1) {
    torus(
      root,
      "hunters-run-leaping-ring",
      0.2 + ring * 0.035,
      0.035,
      [s.width * (0.13 + ring * 0.13), s.wallHeight * (0.42 + ring * 0.1), s.depth * 0.27],
      ring % 2 ? palette.bone : palette.moon,
      [0, 0, 0],
      Math.PI * 2,
      ring === 2,
    );
  }
  boneTotem(
    root,
    "hunters-run-trophy-marker",
    s.width * 0.42,
    s.depth * 0.35,
    s.wallHeight * 0.92,
    palette,
  );
}

function clawArena(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  const triangle = [
    [0, 0, -s.depth * 0.43],
    [-s.width * 0.43, 0, s.depth * 0.34],
    [s.width * 0.43, 0, s.depth * 0.34],
  ] as const satisfies readonly Point3[];
  for (let edge = 0; edge < 3; edge += 1) {
    const from = triangle[edge] ?? triangle[0];
    const to = triangle[(edge + 1) % 3] ?? triangle[0];
    for (let segment = 0; segment < 8; segment += 1) {
      const t = segment / 8;
      const x = from[0] + (to[0] - from[0]) * t;
      const z = from[2] + (to[2] - from[2]) * t;
      sphere(
        root,
        "claw-arena-triangular-wall",
        0.14,
        [1.25, 0.65, 0.9],
        [x, 0.1 + (segment % 2) * 0.025, z],
        segment % 3 ? palette.stone : palette.stoneDark,
      );
    }
  }
  for (const [x, , z] of triangle)
    pawPost(root, "claw-arena-corner-paw", x, z, s.wallHeight * 0.92, palette);
  const dummy = new THREE.Group();
  dummy.name = "claw-arena-sparring-beast";
  root.add(dummy);
  sphere(dummy, "claw-arena-dummy-body", 0.32, [1, 1.35, 0.8], [0, 0.58, 0], palette.furDark, true);
  sphere(dummy, "claw-arena-dummy-head", 0.22, [1.15, 0.9, 0.9], [0, 1.08, 0], palette.fur);
  torus(dummy, "claw-arena-dummy-collar", 0.2, 0.045, [0, 0.87, 0], palette.boneShade);
  for (const side of [-1, 1]) {
    boneRib(dummy, "claw-arena-dummy-arm", [side * 0.18, 0.72, 0], [side * 0.52, 0.92, 0], palette);
    cone(dummy, "claw-arena-dummy-ear", 0.07, 0.23, [side * 0.17, 1.28, 0], palette.hideDark, [
      0,
      0,
      side * -0.45,
    ]);
  }
  for (let stand = 0; stand < 3; stand += 1) {
    const angle = (stand / 3) * Math.PI * 2;
    const x = Math.sin(angle) * s.width * 0.3;
    const z = Math.cos(angle) * s.depth * 0.25;
    block(
      root,
      "claw-arena-spectator-bench",
      [s.width * 0.32, 0.14, 0.25],
      [x, 0.32, z],
      stand % 2 ? palette.wicker : palette.wickerLight,
      [0, angle, 0],
      0.04,
    );
    for (const side of [-1, 1])
      boneRib(
        root,
        "claw-arena-bench-leg",
        [x + side * 0.22, 0, z],
        [x + side * 0.22, 0.3, z],
        palette,
      );
  }
  firePit(root, "claw-arena-ritual-brazier", 0, s.depth * 0.46, 0.48, palette);
}

function packCommons(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  stoneRing(root, "pack-commons-gathering-circle", s.width * 0.43, s.depth * 0.4, 26, palette);
  firePit(root, "pack-commons-pack-fire", 0, 0, 1.08, palette);
  block(
    root,
    "pack-commons-sharing-table",
    [s.width * 0.48, 0.14, 0.32],
    [0, 0.36, s.depth * 0.22],
    palette.wickerLight,
    [0, 0, 0],
    0.08,
    true,
  );
  for (let den = 0; den < 5; den += 1) {
    const angle = (den / 5) * Math.PI * 2;
    const x = Math.sin(angle) * s.width * 0.33;
    const z = Math.cos(angle) * s.depth * 0.31;
    const group = new THREE.Group();
    group.name = "pack-commons-family-den";
    group.position.set(x, 0, z);
    group.rotation.y = angle;
    root.add(group);
    sphere(
      group,
      "pack-commons-den-shell",
      0.3,
      [1.35, 0.75, 1],
      [0, 0.24, 0],
      den % 2 ? palette.fur : palette.hide,
      den === 0,
    );
    torus(
      group,
      "pack-commons-den-mouth",
      0.13,
      0.04,
      [0, 0.23, 0.28],
      palette.bone,
      [0, 0, 0],
      Math.PI * 2,
    );
    for (let rib = 0; rib < 4; rib += 1)
      boneRib(
        group,
        "pack-commons-den-rib",
        [-0.25 + rib * 0.16, 0.04, -0.12],
        [-0.18 + rib * 0.12, 0.51, 0],
        palette,
      );
    beam(
      root,
      "pack-commons-family-path",
      [x * 0.38, 0.05, z * 0.38],
      [x * 0.82, 0.05, z * 0.82],
      0.025,
      den % 2 ? palette.wickerLight : palette.boneShade,
    );
    supplies(root, "pack-commons-family-basket", x * 1.12, z * 1.12, palette);
  }
  boneTotem(
    root,
    "pack-commons-story-pole",
    0,
    -s.depth * 0.43,
    s.wallHeight + s.roofHeight * 0.72,
    palette,
  );
}

function healersCanopy(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: BeastPalette,
): void {
  const trunkY = s.wallHeight * 0.74;
  beam(root, "healers-canopy-living-trunk", [0, 0, 0], [0, trunkY, 0], 0.16, palette.wicker, true);
  for (let branch = 0; branch < 8; branch += 1) {
    const angle = (branch / 8) * Math.PI * 2;
    const x = Math.sin(angle) * s.width * 0.42;
    const z = Math.cos(angle) * s.depth * 0.37;
    beam(
      root,
      "healers-canopy-branch",
      [0, trunkY * 0.68, 0],
      [x, trunkY + (branch % 2) * 0.12, z],
      0.065,
      branch % 2 ? palette.wicker : palette.wickerLight,
      branch % 4 === 0,
    );
    hidePanel(
      root,
      "healers-canopy-leaf-pelt",
      s.width * 0.32,
      s.roofHeight * 0.48,
      [x * 0.82, trunkY + s.roofHeight * 0.24, z * 0.82],
      [Math.PI / 2, angle, 0],
      branch % 2 ? palette.herb : palette.hide,
      palette,
    );
    for (let herb = 0; herb < 3; herb += 1) {
      beam(
        root,
        "healers-canopy-hanging-herb",
        [x * 0.76 + herb * 0.04, trunkY + 0.03, z * 0.76],
        [x * 0.76 + herb * 0.04, trunkY - 0.3 - herb * 0.05, z * 0.76],
        0.012,
        palette.boneShade,
      );
      sphere(
        root,
        "healers-canopy-herb-bundle",
        0.065,
        [0.7, 1.45, 0.7],
        [x * 0.76 + herb * 0.04, trunkY - 0.36 - herb * 0.05, z * 0.76],
        herb % 2 ? palette.herb : palette.muzzle,
      );
    }
  }
  for (let table = 0; table < 4; table += 1) {
    const angle = (table / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.sin(angle) * s.width * 0.27;
    const z = Math.cos(angle) * s.depth * 0.23;
    block(
      root,
      "healers-canopy-remedy-table",
      [0.62, 0.14, 0.34],
      [x, 0.4, z],
      table % 2 ? palette.wicker : palette.bone,
      [0, angle, 0],
      0.05,
    );
    supplies(root, "healers-canopy-remedy-basket", x * 1.2, z * 1.2, palette);
  }
  boneTotem(root, "healers-canopy-antler-sign", 0, -s.depth * 0.4, s.wallHeight * 0.92, palette);
}

function tannersWalk(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  block(
    root,
    "tanners-walk-drainage-floor",
    [s.width * 0.92, 0.16, s.depth * 0.8],
    [0, 0.08, 0],
    palette.stoneDark,
    [0, 0, 0],
    0.08,
    true,
  );
  for (let bay = 0; bay < 4; bay += 1) {
    const x = -s.width * 0.36 + bay * s.width * 0.24;
    for (const z of [-s.depth * 0.31, s.depth * 0.31])
      boneRib(
        root,
        "tanners-walk-rack-post",
        [x, 0.12, z],
        [x, s.wallHeight * 0.9, z],
        palette,
        bay === 0 || bay === 3,
      );
    beam(
      root,
      "tanners-walk-rack-top",
      [x - s.width * 0.1, s.wallHeight * 0.82, 0],
      [x + s.width * 0.1, s.wallHeight * 0.82, 0],
      0.045,
      palette.wicker,
    );
    hidePanel(
      root,
      "tanners-walk-stretched-hide",
      s.width * 0.19,
      s.wallHeight * 0.52,
      [x, s.wallHeight * 0.48, 0],
      [0, 0, (bay % 2 ? -1 : 1) * 0.05],
      bay % 3 === 0 ? palette.fur : bay % 3 === 1 ? palette.hide : palette.furDark,
      palette,
      bay === 1,
    );
  }
  for (let vat = 0; vat < 4; vat += 1) {
    const x = -s.width * 0.32 + vat * s.width * 0.22;
    cylinder(
      root,
      "tanners-walk-curing-vat",
      0.25,
      0.22,
      0.42,
      [x, 0.22, -s.depth * 0.32],
      vat % 2 ? palette.wicker : palette.wickerLight,
      10,
    );
    torus(root, "tanners-walk-vat-rim", 0.25, 0.03, [x, 0.44, -s.depth * 0.32], palette.boneShade);
    sphere(
      root,
      "tanners-walk-vat-liquid",
      0.19,
      [1, 0.08, 1],
      [x, 0.45, -s.depth * 0.32],
      vat % 2 ? palette.herb : palette.hideDark,
    );
  }
  for (let table = 0; table < 3; table += 1) {
    const x = -s.width * 0.25 + table * s.width * 0.25;
    block(
      root,
      "tanners-walk-scraping-table",
      [s.width * 0.2, 0.14, 0.42],
      [x, 0.44, s.depth * 0.32],
      palette.wicker,
      [0, 0, 0],
      0.04,
    );
    for (const side of [-1, 1])
      beam(
        root,
        "tanners-walk-table-leg",
        [x + side * s.width * 0.07, 0.1, s.depth * 0.32],
        [x + side * s.width * 0.07, 0.39, s.depth * 0.32],
        0.032,
        palette.bone,
      );
    beam(
      root,
      "tanners-walk-scraper",
      [x - 0.18, 0.55, s.depth * 0.3],
      [x + 0.16, 0.55, s.depth * 0.3],
      0.018,
      palette.claw,
    );
  }
  boneTotem(
    root,
    "tanners-walk-trade-sign",
    s.width * 0.44,
    s.depth * 0.33,
    s.wallHeight * 0.88,
    palette,
  );
}

function boneGranary(root: THREE.Group, s: BuildingVolumeDimensions, palette: BeastPalette): void {
  const podY = s.wallHeight * 0.78;
  for (let stilt = 0; stilt < 6; stilt += 1) {
    const angle = (stilt / 6) * Math.PI * 2;
    boneRib(
      root,
      "bone-granary-splayed-stilt",
      [Math.sin(angle) * s.width * 0.34, 0, Math.cos(angle) * s.depth * 0.31],
      [Math.sin(angle) * s.width * 0.23, podY, Math.cos(angle) * s.depth * 0.21],
      palette,
      stilt % 3 === 0,
    );
  }
  sphere(
    root,
    "bone-granary-woven-pod",
    s.width * 0.36,
    [1, 1.05, s.depth / s.width],
    [0, podY + s.wallHeight * 0.26, 0],
    palette.wicker,
    true,
  );
  for (let ring = 0; ring < 7; ring += 1)
    torus(
      root,
      "bone-granary-basket-course",
      s.width * (0.33 - Math.abs(3 - ring) * 0.025),
      0.027,
      [0, podY - 0.04 + ring * 0.15, 0],
      ring % 2 ? palette.wickerLight : palette.wicker,
    );
  for (let rib = 0; rib < 10; rib += 1) {
    const angle = (rib / 10) * Math.PI * 2;
    boneRib(
      root,
      "bone-granary-pod-rib",
      [Math.sin(angle) * s.width * 0.33, podY + 0.08, Math.cos(angle) * s.depth * 0.3],
      [
        Math.sin(angle) * s.width * 0.2,
        podY + s.wallHeight * 0.78,
        Math.cos(angle) * s.depth * 0.18,
      ],
      palette,
      rib % 5 === 0,
    );
  }
  torus(
    root,
    "bone-granary-loading-hatch",
    s.width * 0.14,
    0.045,
    [0, podY + s.wallHeight * 0.3, s.depth * 0.34],
    palette.bone,
    [0, 0, 0],
    Math.PI * 2,
    true,
  );
  hidePanel(
    root,
    "bone-granary-hatch-cover",
    s.width * 0.25,
    s.wallHeight * 0.28,
    [0, podY + s.wallHeight * 0.3, s.depth * 0.39],
    [0, 0, 0],
    palette.hideDark,
    palette,
  );
  stair(root, "bone-granary-loading-stair", 0, s.depth * 0.45, s.width * 0.28, podY, 6, palette);
  const craneX = -s.width * 0.42;
  pawPost(
    root,
    "bone-granary-loading-crane",
    craneX,
    -s.depth * 0.18,
    s.wallHeight * 1.28,
    palette,
  );
  boneRib(
    root,
    "bone-granary-crane-arm",
    [craneX, s.wallHeight * 1.16, -s.depth * 0.18],
    [craneX + 0.65, s.wallHeight * 1.16, -s.depth * 0.18],
    palette,
    true,
  );
  beam(
    root,
    "bone-granary-crane-rope",
    [craneX + 0.58, s.wallHeight * 1.14, -s.depth * 0.18],
    [craneX + 0.58, 0.42, -s.depth * 0.18],
    0.018,
    palette.boneShade,
  );
  supplies(root, "bone-granary-hoisted-basket", craneX + 0.58, -s.depth * 0.18, palette);
  for (let sack = 0; sack < 6; sack += 1)
    sphere(
      root,
      "bone-granary-grain-sack",
      0.13,
      [0.8, 1.3, 0.72],
      [s.width * 0.27 + (sack % 3) * 0.18, 0.17 + Math.floor(sack / 3) * 0.18, -s.depth * 0.3],
      sack % 2 ? palette.hide : palette.fur,
    );
}

export function buildBeastfolkBuildingVolume(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  materials: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  const palette = beastPalette(materials);
  switch (archetype) {
    case "housing-a":
      hideLodge(root, size, palette);
      break;
    case "housing-b":
      elevatedNest(root, size, palette);
      break;
    case "command-a":
      councilTotems(root, size, palette);
      break;
    case "command-b":
      moonfangDen(root, size, palette);
      break;
    case "training-a":
      huntersRun(root, size, palette);
      break;
    case "training-b":
      clawArena(root, size, palette);
      break;
    case "community-a":
      packCommons(root, size, palette);
      break;
    case "community-b":
      healersCanopy(root, size, palette);
      break;
    case "daily-life-a":
      tannersWalk(root, size, palette);
      break;
    case "daily-life-b":
      boneGranary(root, size, palette);
      break;
  }
}
