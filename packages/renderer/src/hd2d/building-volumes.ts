import type { BuildingArchetype } from "@lindocara/engine/buildings.js";
import * as THREE from "three";

export type BuildingVolumeState = "standing" | "construction" | "destroyed";

export interface BuildingVolumeArt {
  archetype: BuildingArchetype;
  state: BuildingVolumeState;
  front: THREE.Texture;
  wall: THREE.Texture;
  roof: THREE.Texture;
  roofColor: number;
}

export interface NativeStaticVisual {
  mesh: THREE.Group;
  placeAt(x: number, y: number, z: number): void;
  setFrame(frame: number): void;
  update(now: number): void;
  dispose(): void;
}

interface Dimensions {
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
  roofShape: "gable" | "hip" | "cone";
}

export function buildingVolumeDimensions(archetype: BuildingArchetype): Dimensions {
  switch (archetype) {
    case "tower":
      return {
        width: 1.84,
        depth: 1.84,
        wallHeight: 3.2,
        roofHeight: 1.18,
        roofShape: "cone",
      };
    case "windmill":
      return {
        width: 2.15,
        depth: 2.05,
        wallHeight: 2.95,
        roofHeight: 1.08,
        roofShape: "cone",
      };
    case "archery":
      return {
        width: 2.98,
        depth: 2.18,
        wallHeight: 1.55,
        roofHeight: 1.44,
        roofShape: "gable",
      };
    case "barracks":
      return {
        width: 2.88,
        depth: 2.34,
        wallHeight: 1.95,
        roofHeight: 1.15,
        roofShape: "gable",
      };
    case "monastery":
      return {
        width: 3.12,
        depth: 2.48,
        wallHeight: 1.78,
        roofHeight: 1.35,
        roofShape: "gable",
      };
    case "castle":
      return {
        width: 3.18,
        depth: 2.72,
        wallHeight: 2.2,
        roofHeight: 0.94,
        roofShape: "hip",
      };
    case "house":
      return {
        width: 2.72,
        depth: 2.02,
        wallHeight: 1.35,
        roofHeight: 1.25,
        roofShape: "hip",
      };
  }
}

export function buildingVolumeHeight(
  archetype: BuildingArchetype,
  state: BuildingVolumeState,
): number {
  const size = buildingVolumeDimensions(archetype);
  return state === "destroyed"
    ? size.wallHeight * 0.45 + size.roofHeight * 0.7
    : size.wallHeight + size.roofHeight;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function shadow(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

type Point3 = readonly [number, number, number];
type Uv = readonly [number, number];
type Quad = readonly [Point3, Point3, Point3, Point3, readonly Uv[]];

const SQUARE_UV: readonly Uv[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function quadsGeometry(quads: readonly Quad[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [a, b, c, d, faceUvs] of quads) {
    const offset = positions.length / 3;
    for (const point of [a, b, c, d]) positions.push(...point);
    for (const uv of faceUvs) uvs.push(...uv);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function gableRoofGeometry(size: Dimensions, overhang: number): THREE.BufferGeometry {
  const x = size.width / 2 + overhang;
  const z = size.depth / 2 + overhang;
  const y = size.wallHeight;
  const peak = y + size.roofHeight;
  return quadsGeometry([
    [[-x, y, z], [x, y, z], [x, peak, 0], [-x, peak, 0], SQUARE_UV],
    [[x, y, -z], [-x, y, -z], [-x, peak, 0], [x, peak, 0], SQUARE_UV],
    [[-x, y, -z], [-x, y, z], [-x, peak, 0], [-x, peak, 0], SQUARE_UV],
    [[x, y, z], [x, y, -z], [x, peak, 0], [x, peak, 0], SQUARE_UV],
  ]);
}

function hipRoofGeometry(size: Dimensions, overhang: number): THREE.BufferGeometry {
  const x = size.width / 2 + overhang;
  const z = size.depth / 2 + overhang;
  const y = size.wallHeight;
  const peak = y + size.roofHeight;
  const ridge = Math.max(0.08, x - z);
  return quadsGeometry([
    [[-x, y, z], [x, y, z], [ridge, peak, 0], [-ridge, peak, 0], SQUARE_UV],
    [[x, y, -z], [-x, y, -z], [-ridge, peak, 0], [ridge, peak, 0], SQUARE_UV],
    [[x, y, z], [x, y, -z], [ridge, peak, 0], [ridge, peak, 0], SQUARE_UV],
    [[-x, y, -z], [-x, y, z], [-ridge, peak, 0], [-ridge, peak, 0], SQUARE_UV],
  ]);
}

function addWindow(
  root: THREE.Group,
  at: { x: number; y: number; z: number; rotationY?: number },
  scale = 1,
): void {
  const window = new THREE.Group();
  window.name = "window";
  const dark = new THREE.MeshLambertMaterial({ color: 0x173a4c });
  const wood = new THREE.MeshLambertMaterial({ color: 0x563921 });
  const pane = shadow(
    new THREE.Mesh(new THREE.BoxGeometry(0.42 * scale, 0.52 * scale, 0.045), dark),
  );
  window.add(pane);
  for (const x of [-0.24, 0.24]) {
    const frame = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.63 * scale, 0.075), wood));
    frame.position.x = x * scale;
    window.add(frame);
  }
  for (const y of [-0.3, 0.3]) {
    const frame = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.55 * scale, 0.07, 0.075), wood));
    frame.position.y = y * scale;
    window.add(frame);
  }
  const mullion = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.53 * scale, 0.085), wood));
  window.add(mullion);
  window.position.set(at.x, at.y, at.z);
  window.rotation.y = at.rotationY ?? 0;
  root.add(window);
}

function addDoor(root: THREE.Group, x: number, z: number, rotationY = 0, scale = 1): void {
  const door = new THREE.Group();
  door.name = "door";
  const wood = new THREE.MeshLambertMaterial({ color: 0x76502f });
  const frameMaterial = new THREE.MeshLambertMaterial({ color: 0x3d2b1e });
  const slab = shadow(
    new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.98 * scale, 0.055), wood),
  );
  slab.position.y = 0.49 * scale;
  door.add(slab);
  for (const side of [-1, 1]) {
    const jamb = shadow(
      new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.08 * scale, 0.09), frameMaterial),
    );
    jamb.position.set(side * 0.35 * scale, 0.54 * scale, 0);
    door.add(jamb);
  }
  const lintel = shadow(
    new THREE.Mesh(new THREE.BoxGeometry(0.79 * scale, 0.1, 0.09), frameMaterial),
  );
  lintel.position.y = 1.04 * scale;
  door.add(lintel);
  door.position.set(x, 0, z);
  door.rotation.y = rotationY;
  root.add(door);
}

function addTimberFrame(root: THREE.Group, size: Dimensions, material: THREE.Material): void {
  const frontZ = size.depth / 2 + 0.014;
  const backZ = -frontZ;
  for (const z of [frontZ, backZ]) {
    for (const x of [-size.width / 2 + 0.055, size.width / 2 - 0.055]) {
      const beam = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(0.1, size.wallHeight, 0.07), material),
      );
      beam.position.set(x, size.wallHeight / 2, z);
      root.add(beam);
    }
    const band = shadow(new THREE.Mesh(new THREE.BoxGeometry(size.width, 0.1, 0.07), material));
    band.position.set(0, size.wallHeight - 0.08, z);
    root.add(band);
  }
}

function addStoneCourses(root: THREE.Group, size: Dimensions): void {
  const course = new THREE.MeshLambertMaterial({ color: 0xb5a680 });
  const radius = size.width * 0.505;
  for (let y = 0.42; y < size.wallHeight; y += 0.46) {
    const band = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.045, 12), course),
    );
    band.name = "stone-course";
    band.position.y = y;
    root.add(band);
  }
}

function makeSailBlade(wood: THREE.Material, canvas: THREE.Material): THREE.Group {
  const blade = new THREE.Group();
  const spar = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.65, 0.09), wood));
  spar.position.y = 0.86;
  blade.add(spar);
  for (const [y, width] of [
    [0.38, 0.34],
    [0.73, 0.43],
    [1.08, 0.52],
    [1.43, 0.61],
  ] as const) {
    const rung = shadow(new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, 0.065), wood));
    rung.position.set(width * 0.18, y, 0);
    blade.add(rung);
  }
  const sailGeometry = new THREE.BufferGeometry();
  sailGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0.07, 0.25, 0.055, 0.28, 0.25, 0.055, 0.54, 1.58, 0.055, 0.07, 1.58, 0.055],
      3,
    ),
  );
  sailGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  sailGeometry.computeVertexNormals();
  const sail = shadow(new THREE.Mesh(sailGeometry, canvas));
  blade.add(sail);
  return blade;
}

/**
 * Native architecture in the same spirit as the Lab house: the generated image is one measured
 * elevation, while the sides, back, roof and silhouette are real geometry. The facade now matches
 * the volume exactly instead of floating in front of a larger generic box.
 */
export function makeBuildingVolume(art: BuildingVolumeArt): NativeStaticVisual {
  const group = new THREE.Group();
  group.name = `building-${art.archetype}-${art.state}`;
  const size = buildingVolumeDimensions(art.archetype);
  const destroyed = art.state === "destroyed";
  const construction = art.state === "construction";
  const body = new THREE.Group();
  body.name = "body";
  group.add(body);

  art.wall.wrapS = THREE.RepeatWrapping;
  art.wall.wrapT = THREE.RepeatWrapping;
  art.wall.needsUpdate = true;
  art.roof.wrapS = THREE.RepeatWrapping;
  art.roof.wrapT = THREE.RepeatWrapping;
  art.roof.needsUpdate = true;

  const wallMaterial = new THREE.MeshLambertMaterial({
    map: art.archetype === "tower" || art.archetype === "windmill" ? null : art.wall,
    color: destroyed
      ? 0x665d55
      : art.archetype === "tower" || art.archetype === "windmill"
        ? 0xe5d5aa
        : 0xffffff,
  });
  const woodMaterial = new THREE.MeshLambertMaterial({ color: destroyed ? 0x4b4138 : 0x5b3b23 });

  if (construction) {
    for (const x of [-size.width / 2, 0, size.width / 2]) {
      for (const z of [-size.depth / 2, size.depth / 2]) {
        const post = shadow(
          new THREE.Mesh(new THREE.BoxGeometry(0.13, size.wallHeight + 0.4, 0.13), woodMaterial),
        );
        post.position.set(x, (size.wallHeight + 0.4) / 2, z);
        body.add(post);
      }
    }
    for (const y of [0.45, size.wallHeight]) {
      const beam = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(size.width + 0.2, 0.12, 0.12), woodMaterial),
      );
      beam.position.set(0, y, size.depth / 2);
      body.add(beam);
    }
  } else if (art.archetype === "tower") {
    const tower = shadow(
      new THREE.Mesh(
        new THREE.CylinderGeometry(size.width / 2, size.width / 2, size.wallHeight, 12),
        wallMaterial,
      ),
    );
    tower.name = "stone-tower";
    tower.position.y = size.wallHeight / 2;
    body.add(tower);
    addStoneCourses(body, size);
  } else if (art.archetype === "windmill") {
    const mill = shadow(
      new THREE.Mesh(
        new THREE.CylinderGeometry(size.width * 0.36, size.width / 2, size.wallHeight, 12),
        wallMaterial,
      ),
    );
    mill.name = "mill-body";
    mill.position.y = size.wallHeight / 2;
    body.add(mill);
    addStoneCourses(body, size);
    addDoor(body, 0, size.depth / 2 + 0.08, 0, 0.9);
    addWindow(body, { x: size.width / 2 + 0.035, y: 1.55, z: 0, rotationY: Math.PI / 2 }, 0.72);
    addWindow(body, { x: -size.width / 2 - 0.035, y: 1.92, z: 0, rotationY: -Math.PI / 2 }, 0.66);
  } else {
    const walls = shadow(
      new THREE.Mesh(new THREE.BoxGeometry(size.width, size.wallHeight, size.depth), wallMaterial),
    );
    walls.name = "timber-walls";
    walls.position.y = size.wallHeight / 2;
    body.add(walls);
    addTimberFrame(body, size, woodMaterial);
  }

  if (!construction && art.archetype !== "windmill") {
    const facadeMaterial = new THREE.MeshLambertMaterial({
      map: art.front,
      transparent: true,
      alphaTest: 0.5,
      color: destroyed ? 0x80736b : 0xffffff,
      side: THREE.DoubleSide,
    });
    const facadeHeight = size.wallHeight + size.roofHeight;
    const facade = shadow(
      new THREE.Mesh(new THREE.PlaneGeometry(size.width, facadeHeight), facadeMaterial),
    );
    facade.name = "generated-front-elevation";
    facade.position.set(0, facadeHeight / 2, size.depth / 2 + 0.028);
    body.add(facade);
  }

  if (!construction) {
    const backScale = art.archetype === "tower" ? 0.7 : 0.82;
    if (art.archetype !== "windmill") {
      addWindow(
        body,
        { x: 0, y: size.wallHeight * 0.58, z: -size.depth / 2 - 0.035, rotationY: Math.PI },
        backScale,
      );
    }
    if (art.archetype !== "tower" && art.archetype !== "windmill") {
      addWindow(
        body,
        { x: size.width / 2 + 0.035, y: size.wallHeight * 0.56, z: 0, rotationY: Math.PI / 2 },
        0.72,
      );
      addWindow(
        body,
        { x: -size.width / 2 - 0.035, y: size.wallHeight * 0.56, z: 0, rotationY: -Math.PI / 2 },
        0.72,
      );
    }
  }

  const roofMaterial = new THREE.MeshLambertMaterial({
    map: art.roof,
    color: destroyed ? 0x514943 : art.roofColor,
    side: THREE.DoubleSide,
  });
  let roof: THREE.Mesh | null = null;
  if (!construction) {
    const geometry =
      size.roofShape === "gable"
        ? gableRoofGeometry(size, 0.18)
        : size.roofShape === "hip"
          ? hipRoofGeometry(size, 0.2)
          : new THREE.ConeGeometry(
              size.width * 0.69,
              size.roofHeight,
              art.archetype === "windmill" ? 12 : 8,
            );
    roof = shadow(new THREE.Mesh(geometry, roofMaterial));
    roof.name = `${size.roofShape}-roof`;
    if (size.roofShape === "cone") roof.position.y = size.wallHeight + size.roofHeight / 2;
    group.add(roof);
  }

  let rotor: THREE.Group | null = null;
  if (art.archetype === "windmill" && !construction && !destroyed) {
    rotor = new THREE.Group();
    rotor.name = "windmill-rotor";
    const sailMaterial = new THREE.MeshLambertMaterial({
      color: 0xeee0b5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    });
    for (let index = 0; index < 4; index += 1) {
      const blade = makeSailBlade(woodMaterial, sailMaterial);
      blade.name = `sail-${index}`;
      blade.rotation.z = index * (Math.PI / 2);
      rotor.add(blade);
    }
    const hub = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.34, 12), woodMaterial),
    );
    hub.name = "windmill-hub";
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    rotor.position.set(0, size.wallHeight * 0.73, size.depth / 2 + 0.25);
    group.add(rotor);
  }

  if (destroyed) {
    body.scale.y = 0.43;
    if (roof) {
      roof.rotation.z = -0.34;
      roof.rotation.x = 0.12;
      roof.position.x = size.width * 0.18;
      roof.position.y = size.wallHeight * 0.43 + size.roofHeight * 0.28;
    }
    const rubbleMaterial = new THREE.MeshLambertMaterial({ color: 0x746a5d });
    for (let index = 0; index < 7; index += 1) {
      const rubble = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.28), rubbleMaterial));
      rubble.name = "rubble";
      const angle = (index / 7) * Math.PI * 2;
      rubble.position.set(
        Math.cos(angle) * size.width * 0.42,
        0.1,
        Math.sin(angle) * size.depth * 0.42,
      );
      rubble.rotation.y = angle * 1.7;
      group.add(rubble);
    }
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
  const deckMaterial = new THREE.MeshLambertMaterial({ map: deckTexture, color: 0xd1a66d });
  const deck = shadow(
    new THREE.Mesh(
      new THREE.BoxGeometry(
        horizontal ? BRIDGE_DECK_LENGTH : BRIDGE_DECK_WIDTH,
        0.12,
        horizontal ? BRIDGE_DECK_WIDTH : BRIDGE_DECK_LENGTH,
      ),
      deckMaterial,
    ),
  );
  deck.name = "walkable-deck";
  // `placeAt` receives the physics top. Keeping the top at local y=0 makes rendering and movement
  // share one exact plane instead of placing a decorative bridge above an unrelated collider.
  deck.position.y = -0.06;
  group.add(deck);

  const railMaterial = new THREE.MeshLambertMaterial({ color: 0x674125 });
  for (const side of [-1, 1]) {
    for (const height of [0.28, 0.52]) {
      const rail = shadow(
        new THREE.Mesh(
          new THREE.BoxGeometry(
            horizontal ? BRIDGE_DECK_LENGTH : BRIDGE_RAIL_WIDTH,
            0.1,
            horizontal ? BRIDGE_RAIL_WIDTH : BRIDGE_DECK_LENGTH,
          ),
          railMaterial,
        ),
      );
      rail.name = "bridge-rail";
      rail.position.set(
        horizontal ? 0 : side * (BRIDGE_DECK_WIDTH / 2 - BRIDGE_RAIL_WIDTH / 2),
        height,
        horizontal ? side * (BRIDGE_DECK_WIDTH / 2 - BRIDGE_RAIL_WIDTH / 2) : 0,
      );
      group.add(rail);
    }
    for (const along of [-1.42, 0, 1.42]) {
      const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.72, 0.13), railMaterial));
      post.name = "bridge-post";
      post.position.set(
        horizontal ? along : side * (BRIDGE_DECK_WIDTH / 2 - 0.065),
        0.3,
        horizontal ? side * (BRIDGE_DECK_WIDTH / 2 - 0.065) : along,
      );
      group.add(post);
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
