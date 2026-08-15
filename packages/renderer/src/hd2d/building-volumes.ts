import {
  type BuildingArchetype,
  type BuildingVolumeDimensions,
  buildingVolumeDimensions,
} from "@lindocara/engine/buildings.js";
import type { ElementOrientation } from "@lindocara/engine/element-orientation.js";
import * as THREE from "three";

export type BuildingVolumeState = "standing" | "construction" | "destroyed";

export interface BuildingVolumeArt {
  archetype: BuildingArchetype;
  state: BuildingVolumeState;
  /** Orthographic palette preview. It is never projected over the world model. */
  front: THREE.Texture;
  wall: THREE.Texture;
  roof: THREE.Texture;
  stone: THREE.Texture;
  blueStone: THREE.Texture;
  wood: THREE.Texture;
  roofColor: number;
  /** Fixed authored quarter-turn. The model never follows the camera. */
  orientation?: ElementOrientation;
}

export interface NativeStaticVisual {
  mesh: THREE.Object3D;
  placeAt(x: number, y: number, z: number): void;
  setFrame(frame: number): void;
  update(now: number): void;
  dispose(): void;
}

export { type BuildingVolumeDimensions, buildingVolumeDimensions };

export function buildingVolumeHeight(
  archetype: BuildingArchetype,
  state: BuildingVolumeState,
): number {
  const size = buildingVolumeDimensions(archetype);
  return state === "destroyed"
    ? (size.wallHeight + size.roofHeight) * 0.46
    : size.wallHeight + size.roofHeight;
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

function shadow<T extends THREE.Mesh>(mesh: T): T {
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

type Size3 = readonly [number, number, number];
type Point3 = readonly [number, number, number];

function box(
  root: THREE.Object3D,
  name: string,
  size: Size3,
  at: Point3,
  material: THREE.Material,
  rotation: Point3 = [0, 0, 0],
): THREE.Mesh {
  const mesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(...size), material));
  mesh.name = name;
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  root.add(mesh);
  return mesh;
}

function cylinder(
  root: THREE.Object3D,
  name: string,
  radii: readonly [number, number],
  height: number,
  at: Point3,
  material: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const mesh = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(radii[0], radii[1], height, segments), material),
  );
  mesh.name = name;
  mesh.position.set(...at);
  root.add(mesh);
  return mesh;
}

function beamBetween(
  root: THREE.Object3D,
  a: readonly [number, number],
  b: readonly [number, number],
  z: number,
  material: THREE.Material,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  box(
    root,
    "timber-brace",
    [Math.hypot(dx, dy), 0.075, 0.085],
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z],
    material,
    [0, 0, Math.atan2(dy, dx)],
  );
}

function addWindow(
  root: THREE.Object3D,
  side: "front" | "back" | "left" | "right",
  along: number,
  y: number,
  size: BuildingVolumeDimensions,
  dark: THREE.Material,
  wood: THREE.Material,
  scale = 1,
): void {
  const window = new THREE.Group();
  window.name = "window";
  box(window, "window-recess", [0.38 * scale, 0.46 * scale, 0.045], [0, 0, 0], dark);
  box(window, "window-frame", [0.46 * scale, 0.06, 0.075], [0, 0, 0.01], wood);
  box(window, "window-frame", [0.06, 0.54 * scale, 0.075], [0, 0, 0.01], wood);
  if (side === "front" || side === "back") {
    window.position.set(
      along,
      y,
      side === "front" ? size.depth / 2 + 0.026 : -size.depth / 2 - 0.026,
    );
    window.rotation.y = side === "front" ? 0 : Math.PI;
  } else {
    window.position.set(
      side === "right" ? size.width / 2 + 0.026 : -size.width / 2 - 0.026,
      y,
      along,
    );
    window.rotation.y = side === "right" ? Math.PI / 2 : -Math.PI / 2;
  }
  root.add(window);
}

function archedDoorGeometry(width: number, height: number): THREE.ExtrudeGeometry {
  const radius = width / 2;
  const spring = height - radius;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.lineTo(-radius, spring);
  shape.bezierCurveTo(-radius, height - radius * 0.35, -radius * 0.55, height, 0, height);
  shape.bezierCurveTo(radius * 0.55, height, radius, height - radius * 0.35, radius, spring);
  shape.lineTo(radius, 0);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: false });
}

function addDoor(
  root: THREE.Object3D,
  x: number,
  frontZ: number,
  leaf: THREE.Material,
  outline: THREE.Material,
  frame: THREE.Material,
  wood: THREE.Material,
  metal: THREE.Material,
  scale = 1,
): void {
  const width = 0.62 * scale;
  const height = 1.02 * scale;
  const radius = width / 2;
  const spring = height - radius;
  const door = new THREE.Group();
  door.name = "arched-door";
  door.position.set(x, 0, frontZ);

  // The dark, slightly larger arch is visible around the leaf and pushes it back into the wall.
  // Without that reveal the blue shape reads as a painted portal rather than an opening.
  const recess = shadow(
    new THREE.Mesh(archedDoorGeometry(width + 0.13 * scale, height + 0.08 * scale), outline),
  );
  recess.name = "door-recess";
  recess.position.z = -0.065;
  door.add(recess);

  const doorLeaf = shadow(new THREE.Mesh(archedDoorGeometry(width, height), leaf));
  doorLeaf.name = "door-leaf";
  doorLeaf.position.z = -0.015;
  door.add(doorLeaf);

  // Five individual vertical boards, two timber braces, iron hinges and a brass pull keep the leaf
  // readable at game scale. The groove heights follow the arch instead of escaping its silhouette.
  for (const offset of [-0.3, -0.1, 0.1, 0.3].map((part) => part * width)) {
    const top = spring + Math.sqrt(Math.max(0, radius * radius - offset * offset));
    box(
      door,
      "door-plank-gap",
      [0.018 * scale, top - 0.06 * scale, 0.022],
      [offset, top / 2, 0.044],
      outline,
    );
  }
  for (const y of [height * 0.29, height * 0.58]) {
    box(door, "door-timber-brace", [width * 0.78, 0.075 * scale, 0.055], [0, y, 0.052], wood);
    box(
      door,
      "door-hinge-strap",
      [width * 0.28, 0.035 * scale, 0.025],
      [-width * 0.27, y + 0.01 * scale, 0.083],
      outline,
    );
  }
  const handle = shadow(
    new THREE.Mesh(new THREE.TorusGeometry(0.045 * scale, 0.014 * scale, 6, 12), metal),
  );
  handle.name = "door-handle";
  handle.position.set(width * 0.27, height * 0.43, 0.098);
  door.add(handle);

  root.add(door);
  box(
    root,
    "door-jamb",
    [0.09, height * 0.78, 0.09],
    [x - width / 2 - 0.035, height * 0.39, frontZ + 0.02],
    frame,
  );
  box(
    root,
    "door-jamb",
    [0.09, height * 0.78, 0.09],
    [x + width / 2 + 0.035, height * 0.39, frontZ + 0.02],
    frame,
  );
  for (const angle of [-0.95, -0.48, 0, 0.48, 0.95]) {
    box(
      root,
      "door-arch-stone",
      [0.14 * scale, 0.11 * scale, 0.1],
      [
        x + Math.sin(angle) * width * 0.57,
        height * 0.78 + Math.cos(angle) * width * 0.46,
        frontZ + 0.02,
      ],
      frame,
      [0, 0, -angle],
    );
  }
  box(
    root,
    "door-threshold",
    [width + 0.18 * scale, 0.09 * scale, 0.16],
    [x, 0.035 * scale, frontZ + 0.015],
    frame,
  );
}

function addFourSideTimber(
  root: THREE.Object3D,
  size: BuildingVolumeDimensions,
  wood: THREE.Material,
): void {
  const front = size.depth / 2 + 0.035;
  const back = -front;
  for (const x of [-size.width / 2 + 0.055, size.width / 2 - 0.055]) {
    box(root, "corner-post", [0.11, size.wallHeight, 0.11], [x, size.wallHeight / 2, front], wood);
    box(root, "corner-post", [0.11, size.wallHeight, 0.11], [x, size.wallHeight / 2, back], wood);
  }
  for (const z of [-size.depth / 2 + 0.055, size.depth / 2 - 0.055]) {
    box(
      root,
      "side-post",
      [0.11, size.wallHeight, 0.11],
      [size.width / 2 + 0.035, size.wallHeight / 2, z],
      wood,
    );
    box(
      root,
      "side-post",
      [0.11, size.wallHeight, 0.11],
      [-size.width / 2 - 0.035, size.wallHeight / 2, z],
      wood,
    );
  }
  for (const z of [front, back]) {
    box(root, "timber-band", [size.width, 0.11, 0.08], [0, size.wallHeight - 0.08, z], wood);
    beamBetween(
      root,
      [-size.width * 0.42, 0.18],
      [-size.width * 0.08, size.wallHeight - 0.16],
      z,
      wood,
    );
    beamBetween(
      root,
      [size.width * 0.42, 0.18],
      [size.width * 0.08, size.wallHeight - 0.16],
      z,
      wood,
    );
  }
}

function addGableEnds(
  root: THREE.Object3D,
  size: BuildingVolumeDimensions,
  material: THREE.Material,
): void {
  const shape = new THREE.Shape();
  shape.moveTo(-size.width / 2, 0);
  shape.lineTo(size.width / 2, 0);
  shape.lineTo(0, size.roofHeight);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  for (const side of [-1, 1]) {
    const gable = shadow(new THREE.Mesh(geometry.clone(), material));
    gable.name = "gable-end";
    gable.position.set(0, size.wallHeight, side * (size.depth / 2 + 0.006));
    gable.rotation.y = side > 0 ? 0 : Math.PI;
    root.add(gable);
  }
  geometry.dispose();
}

function addPitchedRoof(
  root: THREE.Object3D,
  size: BuildingVolumeDimensions,
  roof: THREE.Material,
  outline: THREE.Material,
): THREE.Group {
  const roofGroup = new THREE.Group();
  roofGroup.name = "pitched-roof";
  const overhang = 0.18;
  const half = size.width / 2 + overhang;
  const slope = Math.hypot(half, size.roofHeight);
  const angle = Math.atan2(size.roofHeight, half);
  for (const side of [-1, 1]) {
    box(
      roofGroup,
      "blue-roof-slope",
      [slope, 0.12, size.depth + overhang * 2],
      [(side * half) / 2, size.wallHeight + size.roofHeight / 2, 0],
      roof,
      [0, 0, side * -angle],
    );
  }
  const ridge = cylinder(
    roofGroup,
    "roof-ridge",
    [0.075, 0.075],
    size.depth + overhang * 2,
    [0, size.wallHeight + size.roofHeight + 0.035, 0],
    outline,
    8,
  );
  ridge.rotation.x = Math.PI / 2;
  root.add(roofGroup);
  return roofGroup;
}

function addRoundStoneCourses(
  root: THREE.Object3D,
  radius: number,
  wallHeight: number,
  stoneShade: THREE.Material,
): void {
  let course = 0;
  // The generated masonry already carries readable block joints. A few raised blue courses add
  // depth and faction colour; repeating one every half-tile turned round buildings into stripes.
  for (let y = 0.38; y < wallHeight; y += 0.76) {
    cylinder(root, "stone-course", [radius + 0.012, radius + 0.012], 0.055, [0, y, 0], stoneShade);
    // Sparse protruding voussoirs break the smooth cylinder into the chunky, hand-set masonry
    // visible on the generated reference. Alternating them keeps the silhouette readable.
    for (let index = 0; index < 12; index += 3) {
      const angle = ((index + (course % 2) * 1.5) / 12) * Math.PI * 2;
      box(
        root,
        "stone-block",
        [0.24, 0.15, 0.09],
        [Math.sin(angle) * (radius + 0.025), y + 0.14, Math.cos(angle) * (radius + 0.025)],
        stoneShade,
        [0, angle, 0],
      );
    }
    course += 1;
  }
}

function addCircularCrenellations(
  root: THREE.Object3D,
  radius: number,
  y: number,
  stone: THREE.Material,
  wood: THREE.Material,
): void {
  const deck = shadow(new THREE.Mesh(new THREE.CircleGeometry(radius * 0.84, 16), wood));
  deck.name = "tower-deck";
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = y + 0.02;
  root.add(deck);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    box(
      root,
      "tower-battlement",
      [0.32, 0.34, 0.28],
      [Math.sin(angle) * radius * 0.93, y + 0.2, Math.cos(angle) * radius * 0.93],
      stone,
      [0, angle, 0],
    );
  }
}

function addRectangularBattlements(
  root: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  material: THREE.Material,
): void {
  const addRun = (count: number, front: boolean, side: number) => {
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1) - 0.5;
      box(
        root,
        "battlement",
        front ? [0.3, 0.3, 0.22] : [0.22, 0.3, 0.3],
        front
          ? [t * (width - 0.3), y, (side * depth) / 2]
          : [(side * width) / 2, y, t * (depth - 0.3)],
        material,
      );
    }
  };
  for (const side of [-1, 1]) {
    addRun(7, true, side);
    addRun(5, false, side);
  }
}

function makeSailBlade(wood: THREE.Material, canvas: THREE.Material): THREE.Group {
  const blade = new THREE.Group();
  box(blade, "sail-spar", [0.11, 1.58, 0.1], [0, 0.82, 0], wood);
  for (const [y, width] of [
    [0.32, 0.34],
    [0.65, 0.43],
    [0.98, 0.52],
    [1.31, 0.6],
  ] as const) {
    box(blade, "sail-rung", [width, 0.06, 0.075], [width * 0.17, y, 0], wood);
  }
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0.08, 0.22);
  sailShape.lineTo(0.26, 0.22);
  sailShape.lineTo(0.54, 1.46);
  sailShape.lineTo(0.08, 1.46);
  sailShape.closePath();
  const sail = shadow(new THREE.Mesh(new THREE.ShapeGeometry(sailShape), canvas));
  sail.name = "canvas-panel";
  sail.position.z = 0.058;
  blade.add(sail);
  return blade;
}

interface Materials {
  wall: THREE.MeshLambertMaterial;
  stone: THREE.MeshLambertMaterial;
  stoneShade: THREE.MeshLambertMaterial;
  wood: THREE.MeshLambertMaterial;
  deck: THREE.MeshLambertMaterial;
  outline: THREE.MeshLambertMaterial;
  blue: THREE.MeshLambertMaterial;
  roof: THREE.MeshLambertMaterial;
  window: THREE.MeshLambertMaterial;
  canvas: THREE.MeshLambertMaterial;
  metal: THREE.MeshLambertMaterial;
}

function makeMaterials(art: BuildingVolumeArt): Materials {
  const destroyed = art.state === "destroyed";
  for (const texture of [art.wall, art.roof, art.stone, art.blueStone, art.wood]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
  }
  return {
    wall: new THREE.MeshLambertMaterial({
      map: art.wall,
      color: destroyed ? 0x777064 : 0xffffff,
      flatShading: true,
    }),
    stone: new THREE.MeshLambertMaterial({
      map: art.stone,
      color: destroyed ? 0x746e65 : 0xffffff,
      flatShading: true,
    }),
    stoneShade: new THREE.MeshLambertMaterial({
      map: art.blueStone,
      color: destroyed ? 0x57545a : 0xffffff,
      flatShading: true,
    }),
    wood: new THREE.MeshLambertMaterial({
      map: art.wood,
      // Preserve the warm pixels from the timber texture. Multiplying them by another dark brown
      // made beams read as featureless black once the directional light and AO were applied.
      color: destroyed ? 0x4a433d : 0xffffff,
      flatShading: true,
    }),
    deck: new THREE.MeshLambertMaterial({
      map: art.wood,
      color: destroyed ? 0x585047 : 0xe4c093,
      flatShading: true,
    }),
    outline: new THREE.MeshLambertMaterial({ color: 0x161c2e, flatShading: true }),
    blue: new THREE.MeshLambertMaterial({
      // Doors use a clean faction colour. A brown albedo multiplied by cyan collapsed to black.
      color: destroyed ? 0x59626a : 0x326f80,
      flatShading: true,
    }),
    roof: new THREE.MeshLambertMaterial({
      map: art.roof,
      color: destroyed ? 0x55535a : art.roofColor,
      side: THREE.DoubleSide,
      flatShading: true,
    }),
    window: new THREE.MeshLambertMaterial({
      color: destroyed ? 0x2d3035 : 0x173b50,
      flatShading: true,
    }),
    canvas: new THREE.MeshLambertMaterial({
      color: destroyed ? 0x817b6b : 0xf5e7b9,
      side: THREE.DoubleSide,
      flatShading: true,
    }),
    metal: new THREE.MeshLambertMaterial({
      color: destroyed ? 0x6b665e : 0xd2ae59,
      flatShading: true,
    }),
  };
}

function buildHouse(root: THREE.Group, size: BuildingVolumeDimensions, m: Materials): void {
  box(
    root,
    "plaster-house",
    [size.width, size.wallHeight, size.depth],
    [0, size.wallHeight / 2, 0],
    m.wall,
  );
  addFourSideTimber(root, size, m.wood);
  addGableEnds(root, size, m.wall);
  addPitchedRoof(root, size, m.roof, m.outline);
  addDoor(
    root,
    size.width * 0.2,
    size.depth / 2 + 0.045,
    m.blue,
    m.outline,
    m.wood,
    m.wood,
    m.metal,
  );
  addWindow(root, "front", -size.width * 0.25, 0.66, size, m.window, m.wood, 0.85);
  addWindow(root, "back", 0, 0.72, size, m.window, m.wood, 0.9);
  addWindow(root, "left", 0.05, 0.69, size, m.window, m.wood, 0.78);
  box(
    root,
    "stone-chimney",
    [0.34, 1.12, 0.38],
    [-size.width * 0.28, size.wallHeight + size.roofHeight * 0.58, -size.depth * 0.16],
    m.stoneShade,
  );
  box(
    root,
    "chimney-cap",
    [0.43, 0.12, 0.47],
    [-size.width * 0.28, size.wallHeight + size.roofHeight * 1.03, -size.depth * 0.16],
    m.outline,
  );
}

function buildTower(root: THREE.Group, size: BuildingVolumeDimensions, m: Materials): void {
  const radius = size.width / 2;
  cylinder(
    root,
    "stone-watchtower",
    [radius * 0.94, radius],
    size.wallHeight,
    [0, size.wallHeight / 2, 0],
    m.stone,
  );
  addRoundStoneCourses(root, radius * 0.955, size.wallHeight, m.stoneShade);
  cylinder(
    root,
    "blue-parapet-band",
    [radius * 1.02, radius * 1.02],
    0.17,
    [0, size.wallHeight - 0.05, 0],
    m.stoneShade,
  );
  addCircularCrenellations(root, radius, size.wallHeight, m.stone, m.deck);
  addDoor(root, 0, radius + 0.045, m.blue, m.outline, m.stoneShade, m.wood, m.metal, 0.92);
  addWindow(root, "back", 0, 1.72, size, m.window, m.outline, 0.46);
  addWindow(root, "left", 0.05, 2.05, size, m.window, m.outline, 0.38);
  addWindow(root, "right", -0.12, 1.4, size, m.window, m.outline, 0.38);
}

function buildWindmill(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  m: Materials,
): THREE.Group {
  const bodyRadius = 0.82;
  cylinder(
    root,
    "mill-body",
    [0.62, bodyRadius],
    size.wallHeight,
    [0, size.wallHeight / 2, 0],
    m.stone,
  );
  addRoundStoneCourses(root, bodyRadius * 0.94, size.wallHeight, m.stoneShade);
  const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.02, size.roofHeight, 12), m.roof));
  roof.name = "windmill-cap";
  roof.position.y = size.wallHeight + size.roofHeight / 2;
  root.add(roof);
  addDoor(root, 0, bodyRadius + 0.045, m.blue, m.outline, m.stoneShade, m.wood, m.metal, 0.82);
  addWindow(
    root,
    "left",
    0,
    1.45,
    { ...size, width: bodyRadius * 2, depth: bodyRadius * 2 },
    m.window,
    m.outline,
    0.56,
  );
  addWindow(
    root,
    "right",
    -0.08,
    1.82,
    { ...size, width: bodyRadius * 2, depth: bodyRadius * 2 },
    m.window,
    m.outline,
    0.5,
  );

  const rotor = new THREE.Group();
  rotor.name = "windmill-rotor";
  for (let index = 0; index < 4; index += 1) {
    const blade = makeSailBlade(m.wood, m.canvas);
    blade.name = `sail-${index}`;
    blade.rotation.z = index * (Math.PI / 2);
    rotor.add(blade);
  }
  const hub = cylinder(rotor, "windmill-hub", [0.23, 0.23], 0.34, [0, 0, 0], m.wood);
  hub.rotation.x = Math.PI / 2;
  rotor.position.set(0, size.wallHeight * 0.73, bodyRadius + 0.24);
  root.add(rotor);
  return rotor;
}

function addTarget(root: THREE.Group, x: number, y: number, z: number, m: Materials): void {
  const disc = cylinder(root, "archery-target", [0.28, 0.28], 0.065, [x, y, z], m.canvas, 16);
  disc.rotation.x = Math.PI / 2;
  for (const radius of [0.18, 0.08]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.025, 6, 16), m.wood);
    ring.name = "target-ring";
    ring.position.set(x, y, z + 0.04);
    root.add(ring);
  }
}

function buildHall(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  m: Materials,
  kind: "archery" | "monastery",
): void {
  if (kind === "archery") {
    // Tiny Swords' archery building is a closed lodge with a deep target display below the roof,
    // not a roof floating over an empty shooting court. Keep the complete shell solid and express
    // the trade through a recessed dark panel, two mounted targets and a separate small entrance.
    box(
      root,
      "guild-room",
      [size.width, size.wallHeight, size.depth],
      [0, size.wallHeight / 2, 0],
      m.wall,
    );
    const front = size.depth / 2 + 0.042;
    box(
      root,
      "range-shadow",
      [size.width * 0.55, size.wallHeight * 0.68, 0.07],
      [-size.width * 0.17, size.wallHeight * 0.48, front],
      m.window,
    );
    for (const x of [-size.width * 0.46, size.width * 0.13]) {
      box(
        root,
        "range-post",
        [0.13, size.wallHeight * 0.86, 0.12],
        [x, size.wallHeight * 0.43, front + 0.045],
        m.wood,
      );
    }
    addTarget(root, -size.width * 0.31, 0.72, front + 0.06, m);
    addTarget(root, -size.width * 0.04, 0.8, front + 0.06, m);
    addDoor(
      root,
      size.width * 0.31,
      front + 0.015,
      m.blue,
      m.outline,
      m.wood,
      m.wood,
      m.metal,
      0.74,
    );
  } else {
    box(
      root,
      "monastery-hall",
      [size.width, size.wallHeight, size.depth],
      [0, size.wallHeight / 2, 0],
      m.wall,
    );
    addDoor(root, 0, size.depth / 2 + 0.045, m.blue, m.outline, m.wood, m.wood, m.metal, 0.9);
    addWindow(root, "front", -size.width * 0.31, 0.8, size, m.window, m.wood, 0.7);
    addWindow(root, "front", size.width * 0.31, 0.8, size, m.window, m.wood, 0.7);
    const belfryY = size.wallHeight + size.roofHeight * 0.62;
    box(root, "belfry-post", [0.1, 0.58, 0.1], [-0.26, belfryY, size.depth * 0.18], m.wood);
    box(root, "belfry-post", [0.1, 0.58, 0.1], [0.26, belfryY, size.depth * 0.18], m.wood);
    cylinder(
      root,
      "monastery-bell",
      [0.13, 0.2],
      0.28,
      [0, belfryY, size.depth * 0.18],
      m.stoneShade,
      10,
    );
  }
  addFourSideTimber(root, size, m.wood);
  addGableEnds(root, size, m.wall);
  addPitchedRoof(root, size, m.roof, m.outline);
  addWindow(root, "back", 0, size.wallHeight * 0.56, size, m.window, m.wood, 0.76);
}

function buildFortress(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  m: Materials,
  kind: "barracks" | "castle",
): void {
  const bodyWidth = 2.32;
  const bodyDepth = 1.92;
  box(
    root,
    "fortified-hall",
    [bodyWidth, size.wallHeight, bodyDepth],
    [0, size.wallHeight / 2, 0],
    m.stone,
  );
  box(
    root,
    "blue-rampart-band",
    [bodyWidth + 0.12, 0.16, bodyDepth + 0.12],
    [0, size.wallHeight - 0.06, 0],
    m.stoneShade,
  );
  const towerRadius = 0.37;
  const towerHeight = size.wallHeight + (kind === "castle" ? 0.26 : 0.08);
  // The barracks is one readable fortified hall. Detached front turrets made its silhouette look
  // assembled from unrelated parts; only the larger castle keeps integrated corner towers.
  const towerPositions: readonly (readonly [number, number])[] =
    kind === "castle"
      ? [
          [-1.12, 0.79],
          [1.12, 0.79],
          [-1.12, -0.79],
          [1.12, -0.79],
        ]
      : [];
  for (const [x, z] of towerPositions) {
    cylinder(
      root,
      "corner-tower",
      [towerRadius, towerRadius],
      towerHeight,
      [x, towerHeight / 2, z],
      m.stone,
      12,
    );
    cylinder(
      root,
      "corner-tower-band",
      [towerRadius + 0.025, towerRadius + 0.025],
      0.13,
      [x, towerHeight - 0.04, z],
      m.stoneShade,
      12,
    );
    addCircularCrenellationsAt(root, towerRadius, towerHeight, x, z, m.stone, m.deck);
  }
  const deck = box(
    root,
    "timber-roof-deck",
    [bodyWidth, 0.12, bodyDepth],
    [0, size.wallHeight + 0.03, 0],
    m.deck,
  );
  deck.receiveShadow = true;
  for (let index = 1; index < 7; index += 1) {
    const x = -bodyWidth / 2 + (index * bodyWidth) / 7;
    box(
      root,
      "roof-deck-seam",
      [0.025, 0.025, bodyDepth - 0.08],
      [x, size.wallHeight + 0.102, 0],
      m.outline,
    );
  }
  addRectangularBattlements(root, bodyWidth, bodyDepth, size.wallHeight + 0.22, m.stoneShade);
  addDoor(
    root,
    0,
    bodyDepth / 2 + 0.05,
    m.blue,
    m.outline,
    m.stoneShade,
    m.wood,
    m.metal,
    kind === "castle" ? 1.28 : 1.12,
  );
  addWindow(
    root,
    "back",
    0,
    size.wallHeight * 0.58,
    { ...size, width: bodyWidth, depth: bodyDepth },
    m.window,
    m.outline,
    0.6,
  );
}

function addCircularCrenellationsAt(
  root: THREE.Group,
  radius: number,
  y: number,
  x: number,
  z: number,
  stone: THREE.Material,
  wood: THREE.Material,
): void {
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  addCircularCrenellations(holder, radius, y, stone, wood);
  root.add(holder);
}

function buildConstruction(root: THREE.Group, size: BuildingVolumeDimensions, m: Materials): void {
  for (const x of [-size.width / 2, 0, size.width / 2]) {
    for (const z of [-size.depth / 2, size.depth / 2]) {
      box(
        root,
        "scaffold-post",
        [0.13, size.wallHeight + 0.36, 0.13],
        [x, (size.wallHeight + 0.36) / 2, z],
        m.wood,
      );
    }
  }
  for (const y of [0.4, size.wallHeight]) {
    for (const z of [-size.depth / 2, size.depth / 2]) {
      box(root, "scaffold-beam", [size.width + 0.18, 0.12, 0.12], [0, y, z], m.wood);
    }
  }
}

function addRubble(root: THREE.Group, size: BuildingVolumeDimensions, m: Materials): void {
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    box(
      root,
      "rubble",
      [0.25 + (index % 3) * 0.06, 0.16 + (index % 2) * 0.05, 0.24],
      [Math.cos(angle) * size.width * 0.4, 0.1, Math.sin(angle) * size.depth * 0.4],
      index % 2 ? m.stone : m.stoneShade,
      [0.1 * (index % 3), angle * 1.7, 0.08 * (index % 2)],
    );
  }
}

/**
 * A complete native model. The authored point is the front threshold, so the whole solid base is
 * shifted behind it. No camera-facing or generated elevation is present: every visible side is
 * real geometry and remains coherent when the HD-2D camera yaws or tilts.
 */
export function makeBuildingVolume(art: BuildingVolumeArt): NativeStaticVisual {
  const group = new THREE.Group();
  group.name = `building-${art.archetype}-${art.state}`;
  group.rotation.y = -(art.orientation ?? 0) * (Math.PI / 2);
  const size = buildingVolumeDimensions(art.archetype);
  const materials = makeMaterials(art);
  const structure = new THREE.Group();
  structure.name = "native-architecture";
  structure.position.z = -size.depth / 2;
  group.add(structure);

  let rotor: THREE.Group | null = null;
  if (art.state === "construction") {
    buildConstruction(structure, size, materials);
  } else {
    switch (art.archetype) {
      case "house":
        buildHouse(structure, size, materials);
        break;
      case "tower":
        buildTower(structure, size, materials);
        break;
      case "windmill":
        rotor = buildWindmill(structure, size, materials);
        break;
      case "archery":
        buildHall(structure, size, materials, "archery");
        break;
      case "monastery":
        buildHall(structure, size, materials, "monastery");
        break;
      case "barracks":
        buildFortress(structure, size, materials, "barracks");
        break;
      case "castle":
        buildFortress(structure, size, materials, "castle");
        break;
    }
  }

  if (art.state === "destroyed") {
    rotor = null;
    structure.scale.y = 0.43;
    structure.rotation.z = -0.045;
    addRubble(structure, size, materials);
  }

  return {
    mesh: group,
    placeAt(x, y, z) {
      group.position.set(x, y, z);
    },
    setFrame() {},
    update(now) {
      if (rotor) rotor.rotation.z = now * 0.00027;
    },
    dispose() {
      group.removeFromParent();
      disposeObject(group);
    },
  };
}

export const BRIDGE_DECK_LENGTH = 3;
export const BRIDGE_DECK_WIDTH = 1;
export const BRIDGE_RAIL_WIDTH = 0.11;
export const BRIDGE_VISUAL_LIFT = 0.045;

function bridgePoint(horizontal: boolean, along: number, side: number, y: number): THREE.Vector3 {
  return horizontal ? new THREE.Vector3(along, y, side) : new THREE.Vector3(side, y, along);
}

/** Native rope-and-plank bridge: the physics top remains y=0, while the visible boards sit a few
 * centimetres above terrain so bank triangles can never be coplanar with them and flicker. */
export function makeBridgeVolume(
  deckTexture: THREE.Texture,
  orientation: "horizontal" | "vertical",
): NativeStaticVisual {
  const group = new THREE.Group();
  group.name = `bridge-${orientation}`;
  const horizontal = orientation === "horizontal";
  deckTexture.wrapS = THREE.RepeatWrapping;
  deckTexture.wrapT = THREE.RepeatWrapping;
  deckTexture.needsUpdate = true;
  const plankMaterial = new THREE.MeshLambertMaterial({
    map: deckTexture,
    color: 0xc59659,
    flatShading: true,
  });
  const darkWood = new THREE.MeshLambertMaterial({ color: 0x56351f, flatShading: true });
  const ropeMaterial = new THREE.MeshLambertMaterial({ color: 0xb68a55, flatShading: true });
  const deck = new THREE.Group();
  deck.name = "walkable-deck";
  group.add(deck);

  const plankCount = 11;
  for (let index = 0; index < plankCount; index += 1) {
    const along = -BRIDGE_DECK_LENGTH / 2 + ((index + 0.5) * BRIDGE_DECK_LENGTH) / plankCount;
    const plankAlong = BRIDGE_DECK_LENGTH / plankCount - 0.018;
    const plankAcross = 0.87 + ((index * 7) % 3) * 0.035;
    const y = BRIDGE_VISUAL_LIFT - 0.055 + (index % 3) * 0.008;
    box(
      deck,
      "bridge-plank",
      horizontal ? [plankAlong, 0.11, plankAcross] : [plankAcross, 0.11, plankAlong],
      horizontal ? [along, y, 0] : [0, y, along],
      plankMaterial,
      [0, ((index % 4) - 1.5) * 0.008, ((index % 3) - 1) * 0.006],
    );
  }

  for (const side of [-0.3, 0.3]) {
    box(
      group,
      "bridge-underbeam",
      horizontal ? [BRIDGE_DECK_LENGTH, 0.13, 0.13] : [0.13, 0.13, BRIDGE_DECK_LENGTH],
      horizontal ? [0, -0.13, side] : [side, -0.13, 0],
      darkWood,
    );
  }

  const postAlong = [-1.42, 0, 1.42] as const;
  for (const side of [-0.43, 0.43]) {
    for (const along of postAlong) {
      const point = bridgePoint(horizontal, along, side, 0.32);
      box(group, "bridge-post", [0.13, 0.72, 0.13], [point.x, point.y, point.z], darkWood, [
        0,
        0,
        along === 0 ? 0.015 : -Math.sign(along) * 0.035,
      ]);
    }
    for (let segment = 0; segment < postAlong.length - 1; segment += 1) {
      const from = postAlong[segment] ?? 0;
      const to = postAlong[segment + 1] ?? 0;
      const curve = new THREE.CatmullRomCurve3([
        bridgePoint(horizontal, from, side, 0.66),
        bridgePoint(horizontal, (from + to) / 2, side, 0.49),
        bridgePoint(horizontal, to, side, 0.66),
      ]);
      const rope = shadow(
        new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 6, false), ropeMaterial),
      );
      rope.name = "bridge-rope";
      group.add(rope);
    }
  }

  return {
    mesh: group,
    placeAt(x, y, z) {
      group.position.set(x, y, z - (horizontal ? 0.5 : 1.5));
    },
    setFrame() {},
    update() {},
    dispose() {
      group.removeFromParent();
      disposeObject(group);
    },
  };
}
