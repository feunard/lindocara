import type { BuildingVolumeDimensions } from "@lindocara/engine/buildings.js";
import type { FactionBuildingArchetype } from "@lindocara/engine/faction-buildings.js";
import * as THREE from "three";

import type { FactionBuildingMaterials } from "./faction-building-volumes.js";

/**
 * Goblin architecture rebuilt from the project's shipped Tiny Swords goblin house/tower language:
 * thick round timber, sewn crimson hides, violet lashings, warm metal and exaggerated silhouettes.
 * Nothing in this file derives from the human hall builders. Small parts deliberately have no ink
 * cage: outlining every primitive was what made the previous pack read like a rough drawing.
 */

type Point3 = readonly [number, number, number];
type Size3 = readonly [number, number, number];

interface GoblinPalette {
  bark: THREE.Material;
  barkDark: THREE.Material;
  timber: THREE.Material;
  timberLight: THREE.Material;
  hide: THREE.Material;
  hideDark: THREE.Material;
  rope: THREE.Material;
  violet: THREE.Material;
  plaster: THREE.Material;
  moss: THREE.Material;
  stone: THREE.Material;
  stoneDark: THREE.Material;
  iron: THREE.Material;
  brass: THREE.Material;
  bone: THREE.Material;
  soot: THREE.Material;
  glass: THREE.Material;
  fire: THREE.Material;
  ember: THREE.Material;
}

function textureOf(material: THREE.Material): THREE.Texture | null {
  return material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshStandardMaterial
    ? material.map
    : null;
}

interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

const HOUSE_HIDE: PixelCrop = {
  x: 27,
  y: 43,
  width: 76,
  height: 55,
  sourceWidth: 128,
  sourceHeight: 192,
};
const HOUSE_TIMBER: PixelCrop = {
  x: 17,
  y: 96,
  width: 94,
  height: 73,
  sourceWidth: 128,
  sourceHeight: 192,
};
const TOWER_LOGS: PixelCrop = {
  x: 89,
  y: 12,
  width: 78,
  height: 49,
  sourceWidth: 1024,
  sourceHeight: 192,
};
const TOWER_HIDE: PixelCrop = {
  x: 80,
  y: 65,
  width: 98,
  height: 39,
  sourceWidth: 1024,
  sourceHeight: 192,
};

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
    if (!context) throw new Error("Goblin material crop requires a 2D canvas context");
    context.imageSmoothingEnabled = false;
    // Transparent pixels surround every hand-painted sprite part. Flatten them to white before
    // tinting so empty atlas space becomes the material's base colour rather than solid black.
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
  const shadowLift =
    emissive === 0 ? new THREE.Color(color).multiplyScalar(map ? 0.16 : 0.08) : emissive;
  const material = new THREE.MeshLambertMaterial({
    color,
    map,
    emissive: shadowLift,
    emissiveIntensity: emissive === 0 ? 1 : 0.72,
    flatShading: true,
  });
  if (map) material.userData.lindocaraOwnedMap = true;
  return material;
}

function goblinPalette(materials: FactionBuildingMaterials): GoblinPalette {
  const house = materials.factionPrimary ?? textureOf(materials.wood);
  const tower = materials.factionDetail ?? house;
  return {
    bark: surface(tower, 0x91643f, TOWER_LOGS),
    barkDark: surface(house, 0x6c5260, HOUSE_TIMBER),
    timber: surface(tower, 0xffd18a, TOWER_LOGS),
    timberLight: surface(tower, 0xffe3ac, TOWER_LOGS),
    hide: surface(house, 0xffc3c4, HOUSE_HIDE),
    hideDark: surface(tower, 0xc48aa0, TOWER_HIDE),
    rope: surface(null, 0xe7c06d),
    violet: surface(null, 0x74496f),
    plaster: surface(house, 0xc7b38c, HOUSE_TIMBER),
    moss: surface(null, 0x778a4f),
    stone: surface(house, 0x918b8d, HOUSE_TIMBER),
    stoneDark: surface(house, 0x5a5865, HOUSE_TIMBER),
    iron: surface(null, 0x4c5263),
    brass: surface(null, 0xd9a44c),
    bone: surface(null, 0xe4d3a6),
    soot: surface(null, 0x252737),
    glass: surface(null, 0xf2ad4e, undefined, 0x8a3b18),
    fire: surface(null, 0xff8435, undefined, 0xff4f19),
    ember: surface(null, 0xffd05b, undefined, 0xff941f),
  };
}

function addOutline(mesh: THREE.Mesh): void {
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 38),
    new THREE.LineBasicMaterial({ color: 0x241c29, transparent: true, opacity: 0.52 }),
  );
  outline.name = "goblin-silhouette-line";
  outline.renderOrder = 2;
  mesh.add(outline);
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
  if (outline) addOutline(mesh);
  root.add(mesh);
  return mesh;
}

function roundedShape(width: number, height: number, radius: number): THREE.Shape {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corner = Math.min(radius, halfWidth * 0.45, halfHeight * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + corner, -halfHeight);
  shape.lineTo(halfWidth - corner, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + corner);
  shape.lineTo(halfWidth, halfHeight - corner);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - corner, halfHeight);
  shape.lineTo(-halfWidth + corner, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - corner);
  shape.lineTo(-halfWidth, -halfHeight + corner);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + corner, -halfHeight);
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
  const geometry = new THREE.ExtrudeGeometry(roundedShape(width, height, bevel * 1.5), {
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
  radiusTop: number,
  radiusBottom: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  segments = 10,
  rotation: Point3 = [0, 0, 0],
  outline = false,
): THREE.Mesh {
  return part(
    root,
    name,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
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
    new THREE.SphereGeometry(radius, 16, 10),
    material,
    at,
    [0, 0, 0],
    outline,
  );
  mesh.scale.set(...scale);
  return mesh;
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
  return part(root, name, new THREE.TorusGeometry(radius, tube, 7, 24), material, at, rotation);
}

function cone(
  root: THREE.Object3D,
  name: string,
  radius: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
  segments = 10,
  outline = false,
): THREE.Mesh {
  return part(
    root,
    name,
    new THREE.ConeGeometry(radius, height, segments),
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
  const mesh = part(
    root,
    name,
    new THREE.CylinderGeometry(radius * 0.88, radius, delta.length(), 9),
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
  radius = 0.018,
): THREE.Mesh {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const middle = start.clone().add(end).multiplyScalar(0.5);
  middle.y -= sag;
  return part(
    root,
    name,
    new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(start, middle, end),
      10,
      radius,
      5,
      false,
    ),
    material,
    [0, 0, 0],
  );
}

function taperedBody(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  height: number,
  at: Point3,
  material: THREE.Material,
  topScale = 0.82,
  topOffset: readonly [number, number] = [0, 0],
): THREE.Mesh {
  const bottomX = width / 2;
  const bottomZ = depth / 2;
  const topX = bottomX * topScale;
  const topZ = bottomZ * topScale;
  const [offsetX, offsetZ] = topOffset;
  const vertices = new Float32Array([
    -bottomX,
    0,
    -bottomZ,
    bottomX,
    0,
    -bottomZ,
    bottomX,
    0,
    bottomZ,
    -bottomX,
    0,
    bottomZ,
    -topX + offsetX,
    height,
    -topZ + offsetZ,
    topX + offsetX,
    height,
    -topZ + offsetZ,
    topX + offsetX,
    height,
    topZ + offsetZ,
    -topX + offsetX,
    height,
    topZ + offsetZ,
  ]);
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const texturedGeometry = geometry.toNonIndexed();
  geometry.dispose();
  const position = texturedGeometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute)) {
    throw new Error("Goblin tapered body requires a direct position buffer");
  }
  const bounds = new THREE.Box3().setFromBufferAttribute(position);
  const extent = bounds.getSize(new THREE.Vector3());
  const uvs: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    a.fromBufferAttribute(position, triangle);
    b.fromBufferAttribute(position, triangle + 1);
    c.fromBufferAttribute(position, triangle + 2);
    normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const point of [a, b, c]) {
      if (Math.abs(normal.y) >= Math.abs(normal.x) && Math.abs(normal.y) >= Math.abs(normal.z)) {
        uvs.push(
          (point.x - bounds.min.x) / Math.max(extent.x, 0.001),
          (point.z - bounds.min.z) / Math.max(extent.z, 0.001),
        );
      } else if (Math.abs(normal.x) > Math.abs(normal.z)) {
        uvs.push(
          (point.z - bounds.min.z) / Math.max(extent.z, 0.001),
          (point.y - bounds.min.y) / Math.max(extent.y, 0.001),
        );
      } else {
        uvs.push(
          (point.x - bounds.min.x) / Math.max(extent.x, 0.001),
          (point.y - bounds.min.y) / Math.max(extent.y, 0.001),
        );
      }
    }
  }
  texturedGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return part(root, name, texturedGeometry, material, at, [0, 0, 0], true);
}

function archedRoof(
  root: THREE.Object3D,
  name: string,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  material: THREE.Material,
  palette: GoblinPalette,
  offsetX = 0,
  offsetZ = 0,
): THREE.Group {
  const roof = new THREE.Group();
  roof.name = name;
  roof.position.set(offsetX, 0, offsetZ);
  root.add(roof);
  const across = 12;
  const along = 4;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let zIndex = 0; zIndex <= along; zIndex += 1) {
    const zT = zIndex / along;
    for (let xIndex = 0; xIndex <= across; xIndex += 1) {
      const xT = xIndex / across;
      const x = (xT - 0.5) * width;
      const z = (zT - 0.5) * depth;
      const arch = Math.sin(xT * Math.PI) ** 0.72;
      const endSag = Math.abs(zT - 0.5) * 0.07;
      vertices.push(x, eaveY + arch * rise - endSag, z);
      // One authored pixel-art patch spans the complete hide panel. Repeating outside the sampled
      // crop would leak into another part of the source sprite instead of repeating the fabric.
      uvs.push(xT, zT);
    }
  }
  for (let zIndex = 0; zIndex < along; zIndex += 1) {
    for (let xIndex = 0; xIndex < across; xIndex += 1) {
      const row = across + 1;
      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const shellMaterial = material.clone();
  shellMaterial.side = THREE.DoubleSide;
  part(roof, `${name}-sewn-hide`, geometry, shellMaterial, [0, 0, 0], [0, 0, 0], true);
  for (let index = 1; index < 6; index += 1) {
    const xT = index / 6;
    const x = (xT - 0.5) * width;
    const y = eaveY + Math.sin(xT * Math.PI) ** 0.72 * rise + 0.025;
    rope(
      roof,
      `${name}-stitched-seam`,
      [x, y, -depth / 2],
      [x, y, depth / 2],
      0.035,
      index % 2 === 0 ? palette.rope : palette.violet,
      0.022,
    );
  }
  beam(
    roof,
    `${name}-ridge-pole`,
    [0, eaveY + rise + 0.02, -depth / 2 - 0.12],
    [0, eaveY + rise + 0.02, depth / 2 + 0.12],
    0.055,
    palette.timberLight,
    true,
  );
  for (const x of [-width / 2, width / 2]) {
    beam(
      roof,
      `${name}-eave-pole`,
      [x, eaveY, -depth / 2 - 0.1],
      [x, eaveY, depth / 2 + 0.1],
      0.052,
      palette.timber,
    );
  }
  for (const [patchIndex, xT, zT, patchScale] of [
    [0, 0.23, 0.3, 0.88],
    [1, 0.62, 0.68, 1],
    [2, 0.78, 0.24, 0.72],
  ] as const) {
    const x = (xT - 0.5) * width;
    const z = (zT - 0.5) * depth;
    const sample = 0.012;
    const roofY = (value: number): number =>
      eaveY + Math.sin(value * Math.PI) ** 0.72 * rise - Math.abs(zT - 0.5) * 0.07;
    const slope = Math.atan2(roofY(xT + sample) - roofY(xT - sample), sample * 2 * width);
    const patchWidth = Math.min(width * 0.19 * patchScale, 0.48);
    const patchDepth = Math.min(depth * 0.24 * patchScale, 0.42);
    block(
      roof,
      `${name}-raised-repair-patch`,
      [patchWidth, 0.026, patchDepth],
      [x, roofY(xT) + 0.035, z],
      patchIndex === 1 ? palette.hide : palette.hideDark,
      [0, 0, slope],
      0.018,
    );
    for (const side of [-1, 1]) {
      sphere(
        roof,
        `${name}-repair-rivet`,
        0.026,
        [1, 0.55, 1],
        [x + side * patchWidth * 0.34, roofY(xT) + 0.058, z],
        palette.brass,
      );
    }
  }
  return roof;
}

function logWall(
  root: THREE.Object3D,
  name: string,
  width: number,
  height: number,
  z: number,
  palette: GoblinPalette,
  gapStart = -0.22,
  gapEnd = 0.22,
): void {
  const count = Math.max(5, Math.round(width / 0.19));
  for (let index = 0; index < count; index += 1) {
    const x = -width / 2 + ((index + 0.5) * width) / count;
    if (x > gapStart && x < gapEnd) continue;
    const lean = ((index % 4) - 1.5) * 0.025;
    const logHeight = height * (0.96 + (index % 3) * 0.018);
    cylinder(
      root,
      name,
      0.075,
      0.088,
      logHeight,
      [x, logHeight / 2, z],
      index % 3 === 0 ? palette.timberLight : palette.timber,
      9,
      [0, 0, lean],
    );
  }
  beam(root, `${name}-sill`, [-width / 2, 0.1, z], [width / 2, 0.1, z], 0.06, palette.barkDark);
  beam(
    root,
    `${name}-plate`,
    [-width / 2, height * 0.88, z],
    [width / 2, height * 0.88, z],
    0.06,
    palette.barkDark,
  );
}

function ropeWrap(
  root: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  z: number,
  radius: number,
  palette: GoblinPalette,
): void {
  for (const offset of [-0.025, 0.025]) {
    torus(root, name, radius, 0.016, [x, y + offset, z], palette.violet, [Math.PI / 2, 0, 0]);
  }
}

function stoneRing(
  root: THREE.Object3D,
  name: string,
  radiusX: number,
  radiusZ: number,
  count: number,
  y: number,
  palette: GoblinPalette,
  offsetX = 0,
  offsetZ = 0,
): void {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radius = 0.14 + (index % 3) * 0.018;
    const stone = part(
      root,
      name,
      new THREE.DodecahedronGeometry(radius, 0),
      index % 4 === 0 ? palette.stoneDark : palette.stone,
      [
        offsetX + Math.sin(angle) * radiusX,
        y + (index % 2) * 0.025,
        offsetZ + Math.cos(angle) * radiusZ,
      ],
      [0, angle, (index % 3) * 0.08],
    );
    stone.scale.set(1.25, 0.72, 0.9);
  }
}

function door(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  width: number,
  height: number,
  palette: GoblinPalette,
  y = 0,
): THREE.Group {
  const entrance = new THREE.Group();
  entrance.name = `${name}-assembly`;
  entrance.position.set(x, y, z);
  root.add(entrance);
  block(
    entrance,
    `${name}-recess`,
    [width + 0.2, height + 0.14, 0.11],
    [0, height / 2, 0],
    palette.soot,
    [0, 0, 0],
    0.08,
    true,
  );
  block(
    entrance,
    `${name}-leaf`,
    [width, height, 0.13],
    [0, height / 2, 0.07],
    palette.hideDark,
    [0, 0, 0],
    0.07,
  );
  for (const offset of [-0.28, 0, 0.28]) {
    block(
      entrance,
      `${name}-plank`,
      [0.035, height * 0.84, 0.035],
      [offset * width, height / 2, 0.16],
      palette.barkDark,
      [0, 0, offset * 0.08],
      0.008,
    );
  }
  for (const side of [-1, 1]) {
    beam(
      entrance,
      `${name}-jamb`,
      [side * (width / 2 + 0.08), 0, 0.03],
      [side * (width / 2 + 0.06), height + 0.13, 0.03],
      0.065,
      palette.timberLight,
      true,
    );
  }
  beam(
    entrance,
    `${name}-lintel`,
    [-width / 2 - 0.16, height + 0.11, 0.03],
    [width / 2 + 0.16, height + 0.13, 0.03],
    0.07,
    palette.timberLight,
    true,
  );
  for (const hingeY of [height * 0.28, height * 0.7]) {
    block(
      entrance,
      `${name}-hinge`,
      [width * 0.38, 0.045, 0.035],
      [-width * 0.22, hingeY, 0.17],
      palette.iron,
      [0, 0, 0],
      0.008,
    );
  }
  torus(
    entrance,
    `${name}-handle`,
    0.045,
    0.012,
    [width * 0.25, height * 0.48, 0.19],
    palette.brass,
    [Math.PI / 2, 0, 0],
  );
  block(
    entrance,
    `${name}-threshold`,
    [width + 0.28, 0.1, 0.28],
    [0, 0.05, 0.12],
    palette.stone,
    [0, 0, 0],
    0.04,
  );
  return entrance;
}

function window(
  root: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  z: number,
  palette: GoblinPalette,
  scale = 1,
): void {
  block(
    root,
    `${name}-recess`,
    [0.4 * scale, 0.46 * scale, 0.08],
    [x, y, z],
    palette.soot,
    [0, 0, 0],
    0.1,
  );
  block(
    root,
    `${name}-glow`,
    [0.29 * scale, 0.33 * scale, 0.035],
    [x, y, z + 0.055],
    palette.glass,
    [0, 0, 0],
    0.08,
  );
  for (const side of [-1, 1]) {
    beam(
      root,
      `${name}-frame`,
      [x + side * 0.2 * scale, y - 0.25 * scale, z + 0.08],
      [x + side * 0.2 * scale, y + 0.25 * scale, z + 0.08],
      0.035,
      palette.timberLight,
    );
  }
  beam(
    root,
    `${name}-frame`,
    [x - 0.24 * scale, y, z + 0.085],
    [x + 0.24 * scale, y, z + 0.085],
    0.035,
    palette.timberLight,
  );
  block(
    root,
    `${name}-eyebrow`,
    [0.56 * scale, 0.08, 0.28],
    [x, y + 0.3 * scale, z + 0.06],
    palette.hide,
    [0.08, 0, 0],
    0.025,
  );
}

function skull(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  scale: number,
  palette: GoblinPalette,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...at);
  group.scale.setScalar(scale);
  root.add(group);
  sphere(group, `${name}-cranium`, 0.18, [1, 1.08, 0.76], [0, 0.08, 0], palette.bone, true);
  block(group, `${name}-jaw`, [0.24, 0.12, 0.18], [0, -0.09, 0.03], palette.bone, [0, 0, 0], 0.04);
  for (const side of [-1, 1]) {
    sphere(group, `${name}-eye`, 0.052, [1, 0.8, 0.45], [side * 0.072, 0.1, 0.13], palette.soot);
    cone(
      group,
      `${name}-tusk`,
      0.035,
      0.22,
      [side * 0.13, -0.14, 0.05],
      palette.bone,
      [0, 0, side * -0.32],
      8,
    );
  }
  return group;
}

function lantern(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  palette: GoblinPalette,
  scale = 1,
): void {
  cylinder(root, `${name}-cage`, 0.1 * scale, 0.12 * scale, 0.25 * scale, at, palette.iron, 8);
  sphere(
    root,
    `${name}-glow`,
    0.085 * scale,
    [1, 1.25, 1],
    [at[0], at[1], at[2] + 0.01],
    palette.ember,
  );
  torus(
    root,
    `${name}-ring`,
    0.1 * scale,
    0.014 * scale,
    [at[0], at[1] + 0.16 * scale, at[2]],
    palette.brass,
    [0, 0, 0],
  );
}

function banner(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: GoblinPalette,
  facing = 0,
): void {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, 0, z);
  group.rotation.y = facing;
  root.add(group);
  beam(group, `${name}-pole`, [0, 0, 0], [0, height, 0], 0.035, palette.timberLight);
  beam(
    group,
    `${name}-crossbar`,
    [0, height * 0.9, 0],
    [0.42, height * 0.9, 0],
    0.03,
    palette.rope,
  );
  block(
    group,
    `${name}-hide`,
    [0.34, height * 0.42, 0.035],
    [0.23, height * 0.68, 0],
    palette.hide,
    [0, 0, -0.08],
    0.035,
    true,
  );
  skull(group, `${name}-badge`, [0.23, height * 0.69, 0.035], 0.45, palette);
  cone(group, `${name}-finial`, 0.055, 0.25, [0, height + 0.1, 0], palette.brass, [0, 0, 0], 8);
}

function barrel(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: GoblinPalette,
): void {
  const height = 0.52 * scale;
  cylinder(
    root,
    `${name}-body`,
    0.2 * scale,
    0.23 * scale,
    height,
    [x, height / 2, z],
    palette.bark,
    12,
  );
  for (const y of [height * 0.22, height * 0.76]) {
    torus(root, `${name}-band`, 0.215 * scale, 0.018 * scale, [x, y, z], palette.iron);
  }
}

function crate(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: GoblinPalette,
): void {
  block(root, `${name}-body`, [0.46, 0.4, 0.42], [x, 0.2, z], palette.bark, [0, 0, 0], 0.035);
  for (const side of [-1, 1]) {
    beam(
      root,
      `${name}-brace`,
      [x - 0.19, 0.05, z + side * 0.22],
      [x + 0.19, 0.35, z + side * 0.22],
      0.025 * scale,
      palette.timberLight,
    );
  }
  for (const xSide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      block(
        root,
        `${name}-corner`,
        [0.055, 0.42, 0.055],
        [x + xSide * 0.2, 0.21, z + zSide * 0.19],
        palette.iron,
        [0, 0, 0],
        0.008,
      );
    }
  }
}

function stair(
  root: THREE.Object3D,
  name: string,
  x: number,
  frontZ: number,
  width: number,
  height: number,
  steps: number,
  palette: GoblinPalette,
): void {
  for (let index = 0; index < steps; index += 1) {
    block(
      root,
      name,
      [width, height / steps, 0.24],
      [x, ((index + 0.5) * height) / steps, frontZ - index * 0.19],
      index % 2 === 0 ? palette.timber : palette.timberLight,
      [0, 0, 0],
      0.025,
    );
  }
}

function chimney(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: GoblinPalette,
): void {
  const courses = 7;
  for (let index = 0; index < courses; index += 1) {
    const y = (index + 0.5) * (height / courses);
    block(
      root,
      name,
      [0.36 - index * 0.012, height / courses + 0.025, 0.32 - index * 0.01],
      [x + (index % 2 === 0 ? -0.018 : 0.018), y, z],
      index % 3 === 0 ? palette.stoneDark : palette.stone,
      [0, 0, (index % 2 === 0 ? -1 : 1) * 0.015],
      0.035,
    );
  }
  torus(root, `${name}-cap`, 0.2, 0.035, [x, height + 0.04, z], palette.iron);
}

function cauldron(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: GoblinPalette,
): void {
  sphere(
    root,
    `${name}-bowl`,
    0.24 * scale,
    [1, 0.68, 1],
    [x, 0.28 * scale, z],
    palette.soot,
    true,
  );
  torus(root, `${name}-rim`, 0.23 * scale, 0.035 * scale, [x, 0.42 * scale, z], palette.brass);
  for (const side of [-1, 1]) {
    beam(
      root,
      `${name}-leg`,
      [x + side * 0.12 * scale, 0, z],
      [x + side * 0.08 * scale, 0.2 * scale, z],
      0.025,
      palette.iron,
    );
  }
  sphere(root, `${name}-brew`, 0.17 * scale, [1, 0.14, 1], [x, 0.43 * scale, z], palette.moss);
}

function gear(
  root: THREE.Object3D,
  name: string,
  at: Point3,
  radius: number,
  palette: GoblinPalette,
  rotation: Point3 = [0, 0, 0],
): void {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...at);
  group.rotation.set(...rotation);
  root.add(group);
  torus(group, `${name}-wheel`, radius, radius * 0.13, [0, 0, 0], palette.brass, [0, 0, 0]);
  cylinder(group, `${name}-hub`, radius * 0.18, radius * 0.18, 0.11, [0, 0, 0], palette.iron, 10, [
    Math.PI / 2,
    0,
    0,
  ]);
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    block(
      group,
      `${name}-tooth`,
      [radius * 0.18, radius * 0.32, 0.12],
      [Math.sin(angle) * radius, Math.cos(angle) * radius, 0],
      palette.brass,
      [0, 0, -angle],
      0.012,
    );
  }
}

function weaponRack(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  width: number,
  palette: GoblinPalette,
): void {
  for (const side of [-1, 1]) {
    beam(
      root,
      `${name}-post`,
      [x + (side * width) / 2, 0, z],
      [x + (side * width) / 2, 0.82, z],
      0.04,
      palette.barkDark,
    );
  }
  beam(
    root,
    `${name}-rail`,
    [x - width / 2, 0.58, z],
    [x + width / 2, 0.58, z],
    0.045,
    palette.timberLight,
  );
  for (const offset of [-0.3, 0, 0.3]) {
    const weapon = new THREE.Group();
    weapon.name = `${name}-weapon`;
    weapon.position.set(x + offset * width, 0.48, z + 0.02);
    weapon.rotation.z = offset * 0.45;
    root.add(weapon);
    beam(weapon, `${name}-shaft`, [0, -0.42, 0], [0, 0.4, 0], 0.018, palette.barkDark);
    cone(weapon, `${name}-blade`, 0.065, 0.22, [0, 0.49, 0], palette.iron, [0, 0, 0], 6);
    ropeWrap(weapon, `${name}-grip`, 0, -0.05, 0, 0.038, palette);
  }
}

function trainingDummy(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  height: number,
  palette: GoblinPalette,
): void {
  beam(root, `${name}-body`, [x, 0, z], [x, height, z], 0.065, palette.barkDark);
  beam(
    root,
    `${name}-arms`,
    [x - 0.26, height * 0.68, z],
    [x + 0.26, height * 0.68, z],
    0.045,
    palette.timber,
  );
  sphere(root, `${name}-head`, 0.13, [1, 1.08, 0.85], [x, height + 0.08, z], palette.plaster);
  block(
    root,
    `${name}-vest`,
    [0.34, 0.34, 0.12],
    [x, height * 0.5, z],
    palette.hide,
    [0, 0, 0],
    0.06,
  );
  for (const side of [-1, 1]) {
    cone(
      root,
      `${name}-ear`,
      0.055,
      0.2,
      [x + side * 0.18, height + 0.1, z],
      palette.moss,
      [0, 0, (side * -Math.PI) / 2],
      7,
    );
  }
}

function firePit(
  root: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  scale: number,
  palette: GoblinPalette,
): void {
  stoneRing(root, `${name}-stone`, 0.28 * scale, 0.25 * scale, 9, 0.09, palette, x, z);
  for (const rotation of [-0.7, 0.7]) {
    block(
      root,
      `${name}-log`,
      [0.5 * scale, 0.07, 0.08],
      [x, 0.13, z],
      palette.barkDark,
      [0, rotation, 0],
      0.018,
    );
  }
  cone(
    root,
    `${name}-flame`,
    0.18 * scale,
    0.48 * scale,
    [x, 0.36 * scale, z],
    palette.fire,
    [0, 0, 0],
    9,
  );
  cone(
    root,
    `${name}-core`,
    0.1 * scale,
    0.31 * scale,
    [x, 0.31 * scale, z + 0.01],
    palette.ember,
    [0, 0, 0],
    8,
  );
}

function goblinRoundhouse(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const radiusX = s.width * 0.38;
  const radiusZ = s.depth * 0.34;
  stoneRing(root, "roundhouse-foundation-stone", radiusX, radiusZ, 18, 0.08, palette);
  cylinder(
    root,
    "goblin-roundhouse-heart",
    radiusX * 0.88,
    radiusX,
    s.wallHeight * 0.86,
    [0, s.wallHeight * 0.43, 0],
    palette.plaster,
    16,
    [0, 0, 0],
    true,
  ).scale.z = radiusZ / radiusX;
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const x = Math.sin(angle) * radiusX * 0.97;
    const z = Math.cos(angle) * radiusZ * 0.97;
    if (z > radiusZ * 0.72 && Math.abs(x) < 0.34) continue;
    beam(
      root,
      "roundhouse-load-bearing-rib",
      [x, 0.04, z],
      [x * 0.88, s.wallHeight * 0.84, z * 0.88],
      0.052,
      index % 2 === 0 ? palette.timberLight : palette.timber,
    );
    ropeWrap(
      root,
      "roundhouse-rib-lashing",
      x * 0.91,
      s.wallHeight * 0.58,
      z * 0.91,
      0.07,
      palette,
    );
  }
  archedRoof(
    root,
    "roundhouse-barrel-hide-roof",
    s.width * 0.86,
    s.depth * 0.86,
    s.wallHeight * 0.72,
    s.roofHeight * 0.9,
    palette.hide,
    palette,
  );
  door(root, "roundhouse-front-door", 0, radiusZ + 0.05, 0.52, s.wallHeight * 0.67, palette);
  window(
    root,
    "roundhouse-side-window",
    -radiusX * 0.72,
    s.wallHeight * 0.5,
    radiusZ * 0.72,
    palette,
    0.72,
  );
  chimney(
    root,
    "roundhouse-cook-chimney",
    radiusX * 0.48,
    -radiusZ * 0.18,
    s.wallHeight + s.roofHeight * 0.76,
    palette,
  );
  const porchY = 0.12;
  block(
    root,
    "roundhouse-porch",
    [0.92, porchY, 0.52],
    [0, porchY / 2, radiusZ + 0.35],
    palette.timber,
    [0, 0, 0],
    0.04,
    true,
  );
  lantern(
    root,
    "roundhouse-porch-lantern",
    [0.43, s.wallHeight * 0.62, radiusZ + 0.12],
    palette,
    0.82,
  );
  barrel(root, "roundhouse-water-barrel", -radiusX * 0.85, radiusZ * 0.82, 0.72, palette);
}

function goblinFungusStump(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const radius = Math.min(s.width, s.depth) * 0.31;
  stoneRing(root, "fungus-stump-stone-ring", radius * 1.04, radius * 0.96, 16, 0.08, palette);
  cylinder(
    root,
    "fungus-stump-core",
    radius * 0.82,
    radius,
    s.wallHeight * 1.08,
    [0, s.wallHeight * 0.54, 0],
    palette.bark,
    14,
    [0, 0, 0],
    true,
  );
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    const x = Math.sin(angle) * radius * 0.9;
    const z = Math.cos(angle) * radius * 0.9;
    beam(
      root,
      "fungus-stump-bark-rib",
      [x * 1.26, 0, z * 1.26],
      [x * 0.88, s.wallHeight * 0.92, z * 0.88],
      0.06,
      index % 3 === 0 ? palette.timberLight : palette.barkDark,
    );
  }
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2 + 0.24;
    beam(
      root,
      "fungus-stump-root-buttress",
      [Math.sin(angle) * radius * 0.58, 0.28, Math.cos(angle) * radius * 0.58],
      [Math.sin(angle) * radius * 1.5, 0.03, Math.cos(angle) * radius * 1.5],
      0.09,
      palette.barkDark,
      true,
    );
  }
  const capY = s.wallHeight + s.roofHeight * 0.46;
  const capRadius = radius * 1.26;
  sphere(root, "fungus-cap-roof", capRadius, [1.25, 0.34, 1.12], [0, capY, 0], palette.hide, true);
  sphere(
    root,
    "fungus-cap-underlayer",
    radius * 1.04,
    [1.2, 0.22, 1.08],
    [0, capY - 0.12, 0],
    palette.rope,
  );
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + 0.18;
    const ring = index % 3 === 0 ? 0.34 : index % 3 === 1 ? 0.55 : 0.72;
    const x = Math.sin(angle) * capRadius * 1.25 * ring;
    const z = Math.cos(angle) * capRadius * 1.12 * ring;
    const surfaceY = capY + capRadius * 0.34 * Math.sqrt(1 - ring * ring);
    sphere(
      root,
      "fungus-cap-spot",
      radius * (index % 3 === 0 ? 0.1 : 0.065),
      [1, 0.38, 1],
      [x, surfaceY + 0.025, z],
      index % 2 === 0 ? palette.bone : palette.violet,
    );
  }
  door(root, "fungus-hollow-door", 0, radius + 0.03, 0.47, s.wallHeight * 0.62, palette);
  window(
    root,
    "fungus-hollow-window",
    -radius * 0.72,
    s.wallHeight * 0.56,
    radius * 0.75,
    palette,
    0.62,
  );
  chimney(
    root,
    "fungus-hollow-smoke-pipe",
    radius * 0.42,
    -radius * 0.22,
    s.wallHeight + s.roofHeight * 0.7,
    palette,
  );
  stair(root, "fungus-hollow-step", 0, radius + 0.43, 0.7, 0.2, 2, palette);
  for (const side of [-1, 1]) {
    cylinder(
      root,
      "fungus-planter-stem",
      0.035,
      0.05,
      0.3,
      [side * radius * 1.28, 0.15, radius * 0.45],
      palette.plaster,
      8,
    );
    sphere(
      root,
      "fungus-planter-cap",
      0.16,
      [1, 0.3, 1],
      [side * radius * 1.28, 0.34, radius * 0.45],
      palette.moss,
    );
  }
}

function goblinBossHall(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const baseY = s.wallHeight * 0.2;
  stoneRing(root, "boss-hall-foundation", s.width * 0.43, s.depth * 0.39, 24, 0.09, palette);
  block(
    root,
    "boss-hall-dais",
    [s.width * 0.92, baseY, s.depth * 0.82],
    [0, baseY / 2, 0],
    palette.stoneDark,
    [0, 0, 0],
    0.1,
    true,
  );
  taperedBody(
    root,
    "boss-hall-oval-body",
    s.width * 0.76,
    s.depth * 0.64,
    s.wallHeight * 0.72,
    [0, baseY, -s.depth * 0.06],
    palette.plaster,
    0.86,
    [-s.width * 0.025, 0],
  );
  for (const x of [-s.width * 0.34, -s.width * 0.12, s.width * 0.12, s.width * 0.34]) {
    beam(
      root,
      "boss-hall-front-column",
      [x, baseY, s.depth * 0.26],
      [x * 0.94, baseY + s.wallHeight * 0.82, s.depth * 0.24],
      0.075,
      palette.timberLight,
      true,
    );
    ropeWrap(
      root,
      "boss-hall-column-lashing",
      x,
      baseY + s.wallHeight * 0.55,
      s.depth * 0.25,
      0.095,
      palette,
    );
  }
  archedRoof(
    root,
    "boss-hall-great-hide-roof",
    s.width * 0.94,
    s.depth * 0.78,
    baseY + s.wallHeight * 0.65,
    s.roofHeight * 0.96,
    palette.hide,
    palette,
    0,
    -s.depth * 0.04,
  );
  block(
    root,
    "boss-hall-balcony",
    [s.width * 0.78, 0.14, s.depth * 0.3],
    [0, baseY + 0.11, s.depth * 0.39],
    palette.timber,
    [0, 0, 0],
    0.05,
    true,
  );
  door(root, "boss-hall-double-door", 0, s.depth * 0.34, 0.78, s.wallHeight * 0.66, palette, baseY);
  for (const side of [-1, 1]) {
    beam(
      root,
      "boss-tusk-gate",
      [side * 0.52, baseY, s.depth * 0.5],
      [side * 0.28, baseY + s.wallHeight * 0.92, s.depth * 0.52],
      0.085,
      palette.bone,
      true,
    );
    cone(
      root,
      "boss-tusk-gate-tip",
      0.11,
      0.55,
      [side * 0.22, baseY + s.wallHeight * 1.08, s.depth * 0.52],
      palette.bone,
      [0, 0, side * -0.38],
      10,
      true,
    );
    banner(
      root,
      "boss-hall-standard",
      side * s.width * 0.45,
      s.depth * 0.25,
      s.wallHeight + s.roofHeight * 0.95,
      palette,
      side > 0 ? Math.PI : 0,
    );
  }
  skull(
    root,
    "boss-hall-crown-skull",
    [0, s.wallHeight + s.roofHeight * 0.63, s.depth * 0.36],
    1.3,
    palette,
  );
  stair(root, "boss-hall-grand-step", 0, s.depth * 0.72, 1.15, baseY, 3, palette);
  window(
    root,
    "boss-hall-window-left",
    -s.width * 0.25,
    baseY + s.wallHeight * 0.48,
    s.depth * 0.33,
    palette,
    0.74,
  );
  window(
    root,
    "boss-hall-window-right",
    s.width * 0.25,
    baseY + s.wallHeight * 0.48,
    s.depth * 0.33,
    palette,
    0.74,
  );
}

function goblinScrapCitadel(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const baseHeight = s.wallHeight * 0.58;
  block(
    root,
    "scrap-citadel-stone-plinth",
    [s.width * 0.82, baseHeight, s.depth * 0.74],
    [0, baseHeight / 2, 0],
    palette.stoneDark,
    [0, 0, 0],
    0.11,
    true,
  );
  for (const [x, z, height, radius] of [
    [-s.width * 0.31, -s.depth * 0.22, s.wallHeight * 0.88, s.width * 0.15],
    [s.width * 0.29, -s.depth * 0.18, s.wallHeight * 1.08, s.width * 0.17],
    [s.width * 0.1, s.depth * 0.24, s.wallHeight * 0.74, s.width * 0.13],
  ] as const) {
    cylinder(
      root,
      "scrap-citadel-timber-tower",
      radius * 0.9,
      radius,
      height,
      [x, height / 2, z],
      palette.bark,
      12,
      [0, 0, 0],
      true,
    );
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      beam(
        root,
        "scrap-citadel-tower-rib",
        [x + Math.sin(angle) * radius, 0.08, z + Math.cos(angle) * radius],
        [x + Math.sin(angle) * radius * 0.9, height * 0.9, z + Math.cos(angle) * radius * 0.9],
        0.046,
        palette.timberLight,
      );
    }
    torus(
      root,
      "scrap-citadel-parapet-ring",
      radius * 0.98,
      0.055,
      [x, height * 0.88, z],
      palette.iron,
    );
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      cone(
        root,
        "scrap-citadel-parapet-spike",
        0.045,
        0.36,
        [x + Math.sin(angle) * radius, height + 0.12, z + Math.cos(angle) * radius],
        index % 2 === 0 ? palette.iron : palette.bone,
        [0, 0, Math.sin(angle) * 0.16],
        7,
      );
    }
  }
  block(
    root,
    "scrap-citadel-upper-deck",
    [s.width * 0.76, 0.13, s.depth * 0.55],
    [0, baseHeight + 0.12, -s.depth * 0.04],
    palette.timber,
    [0, 0, 0],
    0.045,
    true,
  );
  for (const x of [-s.width * 0.34, 0, s.width * 0.34]) {
    beam(
      root,
      "scrap-citadel-deck-post",
      [x, 0, s.depth * 0.26],
      [x, baseHeight + 0.18, s.depth * 0.26],
      0.055,
      palette.barkDark,
    );
  }
  for (const [x, z, tilt] of [
    [-s.width * 0.34, s.depth * 0.38, -0.08],
    [0, s.depth * 0.39, 0.05],
    [s.width * 0.34, s.depth * 0.37, -0.03],
  ] as const) {
    block(
      root,
      "scrap-citadel-armour-plate",
      [s.width * 0.25, baseHeight * 0.6, 0.06],
      [x, baseHeight * 0.54, z],
      x === 0 ? palette.hideDark : palette.iron,
      [0, 0, tilt],
      0.025,
      true,
    );
    for (const rivetX of [-0.08, 0.08]) {
      sphere(
        root,
        "scrap-citadel-rivet",
        0.018,
        [1, 1, 0.55],
        [x + rivetX, baseHeight * 0.7, z + 0.04],
        palette.brass,
      );
    }
  }
  door(root, "scrap-citadel-gate", 0, s.depth * 0.38, 0.62, baseHeight * 0.72, palette);
  stair(root, "scrap-citadel-entry-ramp", 0, s.depth * 0.72, 0.86, baseHeight * 0.24, 4, palette);
  const craneX = s.width * 0.42;
  beam(
    root,
    "scrap-keep-hoist",
    [craneX, baseHeight, -s.depth * 0.2],
    [craneX, s.wallHeight * 1.25, -s.depth * 0.2],
    0.06,
    palette.barkDark,
    true,
  );
  beam(
    root,
    "scrap-keep-hoist-arm",
    [craneX, s.wallHeight * 1.18, -s.depth * 0.2],
    [s.width * 0.02, s.wallHeight * 1.28, -s.depth * 0.2],
    0.055,
    palette.timberLight,
    true,
  );
  rope(
    root,
    "scrap-keep-hoist-rope",
    [s.width * 0.08, s.wallHeight * 1.26, -s.depth * 0.2],
    [s.width * 0.08, baseHeight * 0.58, -s.depth * 0.2],
    0,
    palette.rope,
  );
  crate(root, "scrap-keep-hoist-cargo", s.width * 0.08, -s.depth * 0.2, 0.8, palette);
  gear(
    root,
    "scrap-keep-hoist-wheel",
    [craneX + 0.03, baseHeight * 1.24, -s.depth * 0.14],
    0.22,
    palette,
    [0, 0, 0],
  );
  banner(
    root,
    "scrap-citadel-high-banner",
    s.width * 0.26,
    -s.depth * 0.18,
    s.wallHeight + s.roofHeight * 1.6,
    palette,
  );
}

function goblinStabArena(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const radiusX = s.width * 0.42;
  const radiusZ = s.depth * 0.39;
  stoneRing(root, "stab-yard-arena-curb", radiusX, radiusZ, 22, 0.08, palette);
  cylinder(
    root,
    "stab-yard-sand-floor",
    radiusX * 0.94,
    radiusX * 0.94,
    0.08,
    [0, 0.04, 0],
    palette.plaster,
    24,
  ).scale.z = radiusZ / radiusX;
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    if (Math.cos(angle) > 0.72 && Math.abs(Math.sin(angle)) < 0.35) continue;
    const x = Math.sin(angle) * radiusX;
    const z = Math.cos(angle) * radiusZ;
    beam(
      root,
      "stab-yard-palisade",
      [x, 0, z],
      [x * 1.02, s.wallHeight * 0.72, z * 1.02],
      0.045,
      index % 3 === 0 ? palette.timberLight : palette.barkDark,
    );
    cone(
      root,
      "stab-yard-palisade-tip",
      0.055,
      0.22,
      [x * 1.02, s.wallHeight * 0.82, z * 1.02],
      palette.bone,
      [0, 0, Math.sin(angle) * 0.12],
      7,
    );
  }
  rope(
    root,
    "stab-yard-boundary-rope",
    [-radiusX, s.wallHeight * 0.48, 0],
    [radiusX, s.wallHeight * 0.48, 0],
    0.14,
    palette.violet,
    0.024,
  );
  const armoury = new THREE.Group();
  armoury.name = "stab-yard-armoury";
  armoury.position.set(-s.width * 0.3, 0, -s.depth * 0.18);
  root.add(armoury);
  taperedBody(
    armoury,
    "stab-yard-armoury-body",
    s.width * 0.34,
    s.depth * 0.38,
    s.wallHeight * 0.52,
    [0, 0, 0],
    palette.bark,
    0.88,
  );
  archedRoof(
    armoury,
    "stab-yard-armoury-roof",
    s.width * 0.4,
    s.depth * 0.46,
    s.wallHeight * 0.43,
    s.roofHeight * 0.46,
    palette.hide,
    palette,
  );
  door(armoury, "stab-yard-armoury-door", 0, s.depth * 0.2, 0.34, s.wallHeight * 0.42, palette);
  weaponRack(
    root,
    "stab-yard-weapon-rack",
    s.width * 0.24,
    -s.depth * 0.25,
    s.width * 0.34,
    palette,
  );
  trainingDummy(
    root,
    "stab-yard-dummy-left",
    s.width * 0.15,
    s.depth * 0.08,
    s.wallHeight * 0.62,
    palette,
  );
  trainingDummy(
    root,
    "stab-yard-dummy-right",
    s.width * 0.34,
    s.depth * 0.24,
    s.wallHeight * 0.52,
    palette,
  );
  for (const x of [-0.18, 0.18]) {
    block(
      root,
      "stab-yard-sparring-shield",
      [0.22, 0.06, 0.22],
      [x, 0.16, -s.depth * 0.02],
      palette.hideDark,
      [Math.PI / 2, 0, x],
      0.08,
    );
    sphere(
      root,
      "stab-yard-shield-boss",
      0.04,
      [1, 0.45, 1],
      [x, 0.205, -s.depth * 0.02],
      palette.brass,
    );
  }
  banner(
    root,
    "stab-yard-score-banner",
    radiusX * 0.9,
    -radiusZ * 0.82,
    s.wallHeight + s.roofHeight * 0.45,
    palette,
  );
}

function goblinSlingGallery(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const platformY = s.wallHeight * 0.24;
  block(
    root,
    "sling-firing-gallery",
    [s.width * 0.86, 0.16, s.depth * 0.34],
    [0, platformY, s.depth * 0.23],
    palette.timber,
    [0, 0, 0],
    0.055,
    true,
  );
  for (const x of [-s.width * 0.39, -s.width * 0.13, s.width * 0.13, s.width * 0.39]) {
    beam(
      root,
      "sling-gallery-support",
      [x, 0, s.depth * 0.08],
      [x, platformY, s.depth * 0.08],
      0.05,
      palette.barkDark,
    );
    beam(
      root,
      "sling-gallery-support",
      [x, 0, s.depth * 0.39],
      [x, platformY, s.depth * 0.39],
      0.05,
      palette.barkDark,
    );
    beam(
      root,
      "sling-gallery-roof-post",
      [x, platformY, s.depth * 0.34],
      [x, s.wallHeight * 0.85, s.depth * 0.34],
      0.045,
      palette.timberLight,
    );
  }
  archedRoof(
    root,
    "sling-gallery-awning",
    s.width * 0.94,
    s.depth * 0.42,
    s.wallHeight * 0.7,
    s.roofHeight * 0.44,
    palette.hide,
    palette,
    0,
    s.depth * 0.25,
  );
  stair(root, "sling-gallery-stairs", -s.width * 0.34, s.depth * 0.61, 0.46, platformY, 4, palette);
  for (const x of [-s.width * 0.24, 0, s.width * 0.24]) {
    beam(
      root,
      "sling-gallery-fork-left",
      [x - 0.1, platformY, s.depth * 0.38],
      [x, s.wallHeight * 0.68, s.depth * 0.36],
      0.032,
      palette.barkDark,
    );
    beam(
      root,
      "sling-gallery-fork-right",
      [x + 0.1, platformY, s.depth * 0.38],
      [x, s.wallHeight * 0.68, s.depth * 0.36],
      0.032,
      palette.barkDark,
    );
    rope(
      root,
      "sling-gallery-sling-cord",
      [x - 0.09, s.wallHeight * 0.63, s.depth * 0.36],
      [x + 0.09, s.wallHeight * 0.63, s.depth * 0.36],
      0.08,
      palette.violet,
      0.016,
    );
  }
  for (const x of [-s.width * 0.27, 0, s.width * 0.27]) {
    beam(
      root,
      "sling-range-lane-divider",
      [x, 0.02, s.depth * 0.02],
      [x, 0.02, -s.depth * 0.4],
      0.022,
      palette.rope,
    );
    const targetZ = -s.depth * 0.39;
    beam(
      root,
      "sling-target-post",
      [x, 0, targetZ],
      [x, s.wallHeight * 0.5, targetZ],
      0.035,
      palette.barkDark,
    );
    torus(
      root,
      "sling-target-outer",
      0.17,
      0.035,
      [x, s.wallHeight * 0.55, targetZ],
      palette.hide,
      [0, 0, 0],
    );
    torus(
      root,
      "sling-target-inner",
      0.085,
      0.025,
      [x, s.wallHeight * 0.55, targetZ + 0.01],
      palette.rope,
      [0, 0, 0],
    );
    sphere(
      root,
      "sling-target-bullseye",
      0.035,
      [1, 1, 0.4],
      [x, s.wallHeight * 0.55, targetZ + 0.035],
      palette.violet,
    );
  }
  block(
    root,
    "sling-ammunition-trough",
    [s.width * 0.46, 0.24, 0.3],
    [s.width * 0.18, 0.18, s.depth * 0.08],
    palette.iron,
    [0, 0, 0],
    0.05,
    true,
  );
  for (const x of [-0.3, -0.08, 0.14, 0.34]) {
    sphere(
      root,
      "sling-ammunition-stone",
      0.085,
      [1, 0.9, 1],
      [x, 0.34, s.depth * 0.08],
      palette.stoneDark,
    );
  }
  banner(
    root,
    "sling-gallery-range-flag",
    s.width * 0.42,
    -s.depth * 0.3,
    s.wallHeight + s.roofHeight * 0.55,
    palette,
  );
}

function goblinFeastHouse(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const kitchenX = -s.width * 0.25;
  taperedBody(
    root,
    "feast-kitchen-body",
    s.width * 0.4,
    s.depth * 0.68,
    s.wallHeight * 0.72,
    [kitchenX, 0, -s.depth * 0.05],
    palette.bark,
    0.9,
  );
  archedRoof(
    root,
    "feast-kitchen-roof",
    s.width * 0.48,
    s.depth * 0.76,
    s.wallHeight * 0.58,
    s.roofHeight * 0.65,
    palette.hideDark,
    palette,
    kitchenX,
    -s.depth * 0.05,
  );
  door(root, "feast-kitchen-door", kitchenX, s.depth * 0.3, 0.38, s.wallHeight * 0.5, palette);
  chimney(
    root,
    "feast-great-chimney",
    kitchenX - s.width * 0.1,
    -s.depth * 0.2,
    s.wallHeight + s.roofHeight * 0.8,
    palette,
  );
  const canopyX = s.width * 0.22;
  for (const x of [s.width * 0.02, s.width * 0.43]) {
    for (const z of [-s.depth * 0.35, s.depth * 0.35]) {
      beam(
        root,
        "feast-canopy-post",
        [x, 0, z],
        [x, s.wallHeight * 0.72, z],
        0.055,
        palette.timberLight,
        true,
      );
      ropeWrap(root, "feast-canopy-lashing", x, s.wallHeight * 0.62, z, 0.075, palette);
    }
  }
  archedRoof(
    root,
    "feast-open-canopy",
    s.width * 0.52,
    s.depth * 0.86,
    s.wallHeight * 0.66,
    s.roofHeight * 0.46,
    palette.hide,
    palette,
    canopyX,
    0,
  );
  for (const z of [-s.depth * 0.2, s.depth * 0.2]) {
    block(
      root,
      "feast-long-table",
      [s.width * 0.36, 0.14, 0.34],
      [canopyX, 0.48, z],
      palette.timber,
      [0, 0, 0],
      0.045,
      true,
    );
    for (const x of [canopyX - s.width * 0.16, canopyX + s.width * 0.16]) {
      beam(root, "feast-table-leg", [x, 0.05, z], [x, 0.43, z], 0.035, palette.barkDark);
    }
    for (const x of [canopyX - 0.18, canopyX, canopyX + 0.18]) {
      cylinder(root, "feast-bowl", 0.07, 0.05, 0.06, [x, 0.58, z], palette.brass, 10);
    }
  }
  firePit(root, "feast-roasting-fire", kitchenX + 0.08, s.depth * 0.04, 0.9, palette);
  beam(
    root,
    "feast-spit-left",
    [kitchenX - 0.28, 0.14, s.depth * 0.04],
    [kitchenX - 0.28, 0.72, s.depth * 0.04],
    0.035,
    palette.iron,
  );
  beam(
    root,
    "feast-spit-right",
    [kitchenX + 0.28, 0.14, s.depth * 0.04],
    [kitchenX + 0.28, 0.72, s.depth * 0.04],
    0.035,
    palette.iron,
  );
  beam(
    root,
    "feast-spit-bar",
    [kitchenX - 0.3, 0.58, s.depth * 0.04],
    [kitchenX + 0.3, 0.58, s.depth * 0.04],
    0.028,
    palette.iron,
  );
  sphere(
    root,
    "feast-spit-roast",
    0.16,
    [1.6, 0.72, 0.72],
    [kitchenX, 0.58, s.depth * 0.04],
    palette.hideDark,
  );
  barrel(root, "feast-ale-barrel", s.width * 0.44, s.depth * 0.34, 0.85, palette);
  barrel(root, "feast-ale-barrel", s.width * 0.38, s.depth * 0.18, 0.66, palette);
  lantern(root, "feast-canopy-lantern", [canopyX, s.wallHeight * 0.68, 0], palette, 0.92);
}

function goblinShamanSanctum(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const floorRadius = Math.min(s.width, s.depth) * 0.36;
  stoneRing(root, "shaman-sanctum-ring", floorRadius, floorRadius, 20, 0.08, palette);
  cylinder(
    root,
    "shaman-sanctum-floor",
    floorRadius * 0.92,
    floorRadius * 0.92,
    0.1,
    [0, 0.05, 0],
    palette.stoneDark,
    18,
    [0, 0, 0],
    true,
  );
  const trunk = beam(
    root,
    "shaman-twisted-tree",
    [0, 0.08, -s.depth * 0.08],
    [-s.width * 0.08, s.wallHeight * 1.18, -s.depth * 0.04],
    0.13,
    palette.barkDark,
    true,
  );
  trunk.scale.x = 1.08;
  for (const [toX, toY, toZ] of [
    [-s.width * 0.38, s.wallHeight * 1.34, -s.depth * 0.14],
    [s.width * 0.34, s.wallHeight * 1.46, -s.depth * 0.08],
    [s.width * 0.22, s.wallHeight * 1.14, s.depth * 0.2],
    [-s.width * 0.28, s.wallHeight * 1.05, s.depth * 0.18],
  ] as const) {
    beam(
      root,
      "shaman-tree-branch",
      [-s.width * 0.05, s.wallHeight * 0.82, -s.depth * 0.05],
      [toX, toY, toZ],
      0.065,
      palette.bark,
      true,
    );
    rope(
      root,
      "shaman-hanging-charm-rope",
      [toX, toY, toZ],
      [toX, toY - 0.42, toZ],
      0,
      palette.violet,
      0.015,
    );
    skull(root, "shaman-hanging-charm", [toX, toY - 0.5, toZ], 0.48, palette);
  }
  for (const [x, z] of [
    [-s.width * 0.3, -s.depth * 0.28],
    [s.width * 0.3, -s.depth * 0.28],
    [-s.width * 0.3, s.depth * 0.28],
    [s.width * 0.3, s.depth * 0.28],
  ] as const) {
    beam(
      root,
      "shaman-sanctum-canopy-post",
      [x, 0, z],
      [x, s.wallHeight * 0.78, z],
      0.05,
      palette.timberLight,
    );
    ropeWrap(root, "shaman-sanctum-post-lashing", x, s.wallHeight * 0.62, z, 0.07, palette);
  }
  archedRoof(
    root,
    "shaman-sanctum-split-canopy",
    s.width * 0.78,
    s.depth * 0.7,
    s.wallHeight * 0.68,
    s.roofHeight * 0.56,
    palette.hideDark,
    palette,
    0,
    -s.depth * 0.02,
  );
  cauldron(root, "shaman-brew-cauldron", 0, s.depth * 0.17, 1.05, palette);
  block(
    root,
    "shaman-bone-altar",
    [s.width * 0.42, 0.2, 0.36],
    [0, 0.21, -s.depth * 0.22],
    palette.bone,
    [0, 0, 0],
    0.07,
    true,
  );
  skull(root, "shaman-altar-skull", [0, 0.5, -s.depth * 0.2], 0.84, palette);
  for (const side of [-1, 1]) {
    lantern(
      root,
      "shaman-spirit-lantern",
      [side * s.width * 0.28, s.wallHeight * 0.7, s.depth * 0.24],
      palette,
      0.78,
    );
    cone(
      root,
      "shaman-incense",
      0.045,
      0.35,
      [side * 0.22, 0.22, -s.depth * 0.03],
      palette.violet,
      [0, 0, 0],
      7,
    );
  }
  stair(root, "shaman-sanctum-step", 0, s.depth * 0.54, 0.74, 0.16, 2, palette);
}

function goblinTinkerWorks(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const leftX = -s.width * 0.22;
  taperedBody(
    root,
    "tinker-workshop-bay",
    s.width * 0.52,
    s.depth * 0.7,
    s.wallHeight * 0.68,
    [leftX, 0, -s.depth * 0.04],
    palette.bark,
    0.86,
    [0.04, 0],
  );
  archedRoof(
    root,
    "tinker-workshop-roof",
    s.width * 0.58,
    s.depth * 0.78,
    s.wallHeight * 0.56,
    s.roofHeight * 0.62,
    palette.hideDark,
    palette,
    leftX,
    -s.depth * 0.04,
  );
  door(
    root,
    "tinker-workshop-door",
    leftX - s.width * 0.08,
    s.depth * 0.33,
    0.38,
    s.wallHeight * 0.48,
    palette,
  );
  window(
    root,
    "tinker-workshop-window",
    leftX + s.width * 0.12,
    s.wallHeight * 0.44,
    s.depth * 0.33,
    palette,
    0.68,
  );
  chimney(
    root,
    "tinker-forge-stack",
    leftX - s.width * 0.14,
    -s.depth * 0.22,
    s.wallHeight + s.roofHeight * 0.72,
    palette,
  );
  const awningX = s.width * 0.27;
  for (const x of [s.width * 0.06, s.width * 0.46]) {
    for (const z of [-s.depth * 0.3, s.depth * 0.3]) {
      beam(
        root,
        "tinker-open-bay-post",
        [x, 0, z],
        [x, s.wallHeight * 0.62, z],
        0.052,
        palette.timberLight,
        true,
      );
    }
  }
  archedRoof(
    root,
    "tinker-open-bay-canopy",
    s.width * 0.5,
    s.depth * 0.72,
    s.wallHeight * 0.54,
    s.roofHeight * 0.4,
    palette.hide,
    palette,
    awningX,
    0,
  );
  block(
    root,
    "tinker-heavy-workbench",
    [s.width * 0.36, 0.16, 0.42],
    [awningX, 0.5, s.depth * 0.12],
    palette.timber,
    [0, 0, 0],
    0.045,
    true,
  );
  for (const x of [awningX - s.width * 0.14, awningX + s.width * 0.14]) {
    beam(
      root,
      "tinker-bench-leg",
      [x, 0.05, s.depth * 0.12],
      [x, 0.46, s.depth * 0.12],
      0.035,
      palette.barkDark,
    );
  }
  block(
    root,
    "tinker-anvil",
    [0.34, 0.18, 0.18],
    [awningX, 0.7, s.depth * 0.12],
    palette.iron,
    [0, 0, 0],
    0.05,
    true,
  );
  cylinder(
    root,
    "tinker-anvil-base",
    0.11,
    0.15,
    0.36,
    [awningX, 0.46, s.depth * 0.12],
    palette.barkDark,
    9,
  );
  gear(
    root,
    "tinker-drive-gear-large",
    [s.width * 0.43, 0.62, -s.depth * 0.12],
    0.28,
    palette,
    [0, 0, 0],
  );
  gear(
    root,
    "tinker-drive-gear-small",
    [s.width * 0.28, 0.42, -s.depth * 0.1],
    0.17,
    palette,
    [0, 0, 0],
  );
  beam(
    root,
    "tinker-belt-axle",
    [s.width * 0.28, 0.42, -s.depth * 0.18],
    [s.width * 0.43, 0.62, -s.depth * 0.18],
    0.025,
    palette.iron,
  );
  const craneX = s.width * 0.48;
  beam(
    root,
    "tinker-jib-crane-mast",
    [craneX, 0, s.depth * 0.28],
    [craneX, s.wallHeight * 0.98, s.depth * 0.28],
    0.055,
    palette.barkDark,
    true,
  );
  beam(
    root,
    "tinker-jib-crane-arm",
    [craneX, s.wallHeight * 0.9, s.depth * 0.28],
    [s.width * 0.12, s.wallHeight * 0.95, s.depth * 0.28],
    0.05,
    palette.timberLight,
    true,
  );
  rope(
    root,
    "tinker-jib-crane-rope",
    [s.width * 0.16, s.wallHeight * 0.94, s.depth * 0.28],
    [s.width * 0.16, 0.42, s.depth * 0.28],
    0,
    palette.rope,
  );
  torus(
    root,
    "tinker-jib-crane-hook",
    0.07,
    0.018,
    [s.width * 0.16, 0.34, s.depth * 0.28],
    palette.iron,
    [0, 0, 0],
  );
  barrel(root, "tinker-oil-barrel", s.width * 0.42, -s.depth * 0.34, 0.72, palette);
  crate(root, "tinker-parts-crate", s.width * 0.2, -s.depth * 0.34, 0.75, palette);
  lantern(root, "tinker-work-lamp", [awningX, s.wallHeight * 0.58, s.depth * 0.28], palette, 0.86);
}

function goblinScavengerDepot(
  root: THREE.Group,
  s: BuildingVolumeDimensions,
  palette: GoblinPalette,
): void {
  const deckY = s.wallHeight * 0.32;
  for (const x of [-s.width * 0.38, -s.width * 0.12, s.width * 0.14, s.width * 0.38]) {
    for (const z of [-s.depth * 0.33, s.depth * 0.33]) {
      beam(root, "scavenger-depot-stilt", [x, 0, z], [x, deckY, z], 0.06, palette.barkDark, true);
      ropeWrap(root, "scavenger-depot-stilt-lashing", x, deckY * 0.72, z, 0.08, palette);
    }
  }
  block(
    root,
    "scavenger-depot-loading-deck",
    [s.width * 0.9, 0.16, s.depth * 0.78],
    [0, deckY, 0],
    palette.timber,
    [0, 0, 0],
    0.055,
    true,
  );
  taperedBody(
    root,
    "scavenger-depot-upper-store",
    s.width * 0.72,
    s.depth * 0.56,
    s.wallHeight * 0.66,
    [-s.width * 0.04, deckY, -s.depth * 0.08],
    palette.bark,
    0.86,
    [s.width * 0.03, 0],
  );
  const slattedFront = new THREE.Group();
  slattedFront.name = "scavenger-depot-slatted-front-assembly";
  slattedFront.position.y = deckY;
  root.add(slattedFront);
  logWall(
    slattedFront,
    "scavenger-depot-slatted-front",
    s.width * 0.68,
    s.wallHeight * 0.6,
    s.depth * 0.22,
    palette,
    -0.3,
    0.3,
  );
  archedRoof(
    root,
    "scavenger-depot-roof",
    s.width * 0.82,
    s.depth * 0.68,
    deckY + s.wallHeight * 0.54,
    s.roofHeight * 0.62,
    palette.hideDark,
    palette,
    -s.width * 0.04,
    -s.depth * 0.08,
  );
  door(
    root,
    "scavenger-depot-door",
    -s.width * 0.04,
    s.depth * 0.31,
    0.46,
    s.wallHeight * 0.48,
    palette,
    deckY,
  );
  const rampLength = s.depth * 0.72;
  block(
    root,
    "scavenger-loading-ramp",
    [s.width * 0.42, 0.12, rampLength],
    [s.width * 0.26, deckY / 2, s.depth * 0.54],
    palette.timber,
    [-Math.atan2(deckY, rampLength), 0, 0],
    0.045,
    true,
  );
  for (const side of [-1, 1]) {
    beam(
      root,
      "scavenger-ramp-rail",
      [s.width * 0.26 + side * s.width * 0.2, 0.08, s.depth * 0.86],
      [s.width * 0.26 + side * s.width * 0.2, deckY + 0.3, s.depth * 0.2],
      0.035,
      palette.timberLight,
    );
  }
  for (let shelf = 0; shelf < 2; shelf += 1) {
    const shelfY = deckY + 0.22 + shelf * 0.32;
    block(
      root,
      "scavenger-storage-shelf",
      [s.width * 0.52, 0.07, 0.3],
      [-s.width * 0.08, shelfY, s.depth * 0.34],
      palette.timberLight,
      [0, 0, 0],
      0.018,
    );
    for (const x of [-s.width * 0.28, s.width * 0.12]) {
      beam(
        root,
        "scavenger-shelf-post",
        [x, deckY, s.depth * 0.34],
        [x, deckY + 0.82, s.depth * 0.34],
        0.032,
        palette.barkDark,
      );
    }
  }
  crate(root, "scavenger-sorted-crate", -s.width * 0.3, s.depth * 0.36, 0.68, palette);
  crate(root, "scavenger-sorted-crate", s.width * 0.04, s.depth * 0.35, 0.58, palette);
  barrel(root, "scavenger-salvage-barrel", s.width * 0.42, -s.depth * 0.28, 0.78, palette);
  for (const [x, z, scale] of [
    [-s.width * 0.34, -s.depth * 0.3, 0.8],
    [s.width * 0.18, -s.depth * 0.32, 0.65],
  ] as const) {
    sphere(
      root,
      "scavenger-salvage-sack",
      0.2 * scale,
      [1, 0.82, 0.88],
      [x, deckY + 0.16, z],
      palette.violet,
    );
    ropeWrap(root, "scavenger-sack-tie", x, deckY + 0.3 * scale, z, 0.07 * scale, palette);
  }
  const pulleyX = -s.width * 0.42;
  beam(
    root,
    "scavenger-depot-pulley-mast",
    [pulleyX, 0, -s.depth * 0.3],
    [pulleyX, s.wallHeight * 1.18, -s.depth * 0.3],
    0.055,
    palette.barkDark,
    true,
  );
  beam(
    root,
    "scavenger-depot-pulley-arm",
    [pulleyX, s.wallHeight * 1.1, -s.depth * 0.3],
    [pulleyX + 0.46, s.wallHeight * 1.1, -s.depth * 0.3],
    0.05,
    palette.timberLight,
  );
  torus(
    root,
    "scavenger-depot-pulley",
    0.12,
    0.025,
    [pulleyX + 0.38, s.wallHeight * 1.04, -s.depth * 0.3],
    palette.brass,
    [0, 0, 0],
  );
  rope(
    root,
    "scavenger-depot-pulley-rope",
    [pulleyX + 0.38, s.wallHeight * 1.04, -s.depth * 0.3],
    [pulleyX + 0.38, 0.34, -s.depth * 0.3],
    0,
    palette.rope,
  );
  banner(
    root,
    "scavenger-depot-trade-sign",
    s.width * 0.4,
    s.depth * 0.24,
    s.wallHeight + s.roofHeight * 0.72,
    palette,
  );
  lantern(
    root,
    "scavenger-depot-lantern",
    [-s.width * 0.31, deckY + s.wallHeight * 0.52, s.depth * 0.34],
    palette,
    0.82,
  );
}

export function buildGoblinBuildingVolume(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  materials: FactionBuildingMaterials,
  archetype: FactionBuildingArchetype,
): void {
  const palette = goblinPalette(materials);
  switch (archetype) {
    case "housing-a":
      goblinRoundhouse(root, size, palette);
      break;
    case "housing-b":
      goblinFungusStump(root, size, palette);
      break;
    case "command-a":
      goblinBossHall(root, size, palette);
      break;
    case "command-b":
      goblinScrapCitadel(root, size, palette);
      break;
    case "training-a":
      goblinStabArena(root, size, palette);
      break;
    case "training-b":
      goblinSlingGallery(root, size, palette);
      break;
    case "community-a":
      goblinFeastHouse(root, size, palette);
      break;
    case "community-b":
      goblinShamanSanctum(root, size, palette);
      break;
    case "daily-life-a":
      goblinTinkerWorks(root, size, palette);
      break;
    case "daily-life-b":
      goblinScavengerDepot(root, size, palette);
      break;
  }
}
